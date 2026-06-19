import webpush from "web-push";
import { db, now } from "../db/database.js";

const publicKey = process.env.VAPID_PUBLIC_KEY || "";
const privateKey = process.env.VAPID_PRIVATE_KEY || "";
export const pushConfigured = Boolean(publicKey && privateKey);

if (pushConfigured) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", publicKey, privateKey);
}

const categoryForType = (type) => {
  if (["match_available", "match_closed", "result_published"].includes(type)) return "match_updates";
  if (["points_earned", "points_adjustment"].includes(type)) return "points";
  if (type === "top_three") return "ranking";
  return "social";
};

export function getPushPreferences(userId) {
  return db.prepare(`
    SELECT match_updates,points,ranking,social FROM notification_preferences WHERE user_id=?
  `).get(userId) || { match_updates: 1, points: 1, ranking: 1, social: 1 };
}

export async function sendPushToUser(userId, payload) {
  if (!pushConfigured || !getPushPreferences(userId)[categoryForType(payload.type)]) return;
  const subscriptions = db.prepare("SELECT * FROM push_subscriptions WHERE user_id=?").all(userId);
  await Promise.allSettled(subscriptions.map(async (row) => {
    try {
      await webpush.sendNotification({
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth }
      }, JSON.stringify({
        title: payload.title,
        body: payload.message,
        url: payload.link?.startsWith("/") ? payload.link : "/",
        tag: payload.eventKey || `${payload.type}:${payload.entityId || "general"}`
      }), { TTL: 60 * 60 * 6, urgency: "normal" });
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        db.prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(row.endpoint);
      } else {
        console.error("No se pudo enviar una notificacion push:", error.statusCode || error.message);
      }
    }
  }));
}

export function savePushSubscription(userId, subscription, userAgent = "") {
  const { endpoint, keys } = subscription || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error("Suscripcion push no valida.");
  const stamp = now();
  db.prepare(`
    INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,
      auth=excluded.auth,user_agent=excluded.user_agent,updated_at=excluded.updated_at
  `).run(userId, endpoint, keys.p256dh, keys.auth, String(userAgent).slice(0, 500), stamp, stamp);
}

export { publicKey as vapidPublicKey };
