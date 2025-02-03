import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "url";

import express from "express";
import webpush from "web-push";

const HTTP_PORT = 8000;
// Generate VAPID keys in https://vapidkeys.com
const vapidKeys = {
  subject: "mailto:contato@lojaintegrada.com.br",
  publicKey:
    "BHzXBBr1eU3v20zsWCnpHAPOyo_NoP0uWw4VomrhAimbkZSbCbEnqgGP9kpNRBEtYDEkjuGuGZsInKrQD8la-a0",
  privateKey: "MQuvOwGHV5tISYYxB-L-EFYZpJOBAWgn8e8h03njhic",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

webpush.setVapidDetails(
  vapidKeys.subject,
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

app.use(express.static(path.resolve(__dirname, "./public")));
app.set("view engine", "ejs");
app.set("views", path.resolve(__dirname, "./views/"));

const logger = {
  info: console.log,
  error: console.error,
};

const browsersByIdFilepath = path.resolve(__dirname, "browsers-by-id.json");

let browsersById = {};
try {
  const contents = await fs.promises.readFile(browsersByIdFilepath);
  browsersById = JSON.parse(contents);
} catch (ex) {
  // ignore
}

async function writeBrowsersById() {
  await fs.promises.writeFile(
    browsersByIdFilepath,
    JSON.stringify(browsersById)
  );
}

function buildHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (ex) {
      logger.error(ex);
      res.status(500).json({ error: ex.message });
    }
  };
}

app.get(
  "/",
  buildHandler((req, res) => {
    res.render("index", {
      vapidPublicKey: vapidKeys.publicKey,
      browsers: Object.values(browsersById),
    });
  })
);

app.post(
  "/subscribe",
  express.json(),
  buildHandler(async (req, res) => {
    logger.info(req.body);
    const { userId, storeId, fingerprint, pushSubscription } = req.body;
    const id = `${userId}-${storeId}-${fingerprint}`;

    browsersById[id] = { userId, storeId, fingerprint, pushSubscription };
    await writeBrowsersById();

    res.status(200).json({ ok: true });
  })
);

app.post(
  "/unsubscribe",
  express.json(),
  buildHandler(async (req, res) => {
    logger.info(req.body);
    const { userId, storeId, fingerprint } = req.body;
    const id = `${userId}-${storeId}-${fingerprint}`;

    delete browsersById[id];
    await writeBrowsersById();

    res.status(200).json({ ok: true });
  })
);

app.post(
  "/notify",
  express.urlencoded({ extended: true }),
  buildHandler(async (req, res) => {
    logger.info(req.body);
    const { storeId, userId, message, title, actions } = req.body;
    const notificationPayload = JSON.stringify({
      notification: {
        title,
        body: message,
        data: {
          userId,
          storeId,
          actionsUrls: {
            primary: "https://app.lojaintegrada.com.br/painel",
            secondary: "https://google.com",
          },
        },
        actions: actions
          ? [
              {
                action: "primary",
                type: "button",
                title: "Baixar",
              },
              {
                action: "secondary",
                type: "button",
                title: "Ignorar",
              },
            ]
          : undefined,
      },
      userId,
      storeId,
      timestamp: Date.now(),
    });

    for (const {
      userId: _userId,
      storeId: _storeId,
      pushSubscription,
      fingerprint,
    } of Object.values(browsersById)) {
      const savedUserId = _userId.toString();
      const savedStoreId = _storeId.toString();
      const id = `${savedUserId}-${savedStoreId}-${fingerprint}`;

      if (
        !!storeId &&
        !!userId &&
        (storeId !== savedStoreId || userId !== savedUserId)
      ) {
        continue;
      }

      if (
        (userId && userId === savedUserId) ||
        (storeId && storeId === savedStoreId)
      ) {
        try {
          logger.info(
            `Sending notification for store: ${storeId} user: ${userId}`
          );
          await webpush.sendNotification(
            JSON.parse(pushSubscription),
            notificationPayload
          );
        } catch (ex) {
          logger.error(ex);
          logger.info("id", id);
          logger.error("erro, deletando", browsersById[id]);
          // if error, removes from browsersById
          delete browsersById[id];
        }
      }
    }

    await writeBrowsersById();
    res.redirect("/");
  })
);

app.listen(HTTP_PORT, () => {
  logger.info(`http server opened on ${HTTP_PORT}`);
});
