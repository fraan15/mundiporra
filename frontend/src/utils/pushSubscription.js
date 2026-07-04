import { api } from "../api/client";

export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const decodeKey = (value) => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
};

export async function repairPushSubscription(status) {
  if (!pushSupported() || !status?.configured || Notification.permission !== "granted") {
    return { subscription: null, repaired: false };
  }

  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (!current) return { subscription: null, repaired: false };

  const registeredEndpoints = status.subscription_endpoints || [];
  if (registeredEndpoints.includes(current.endpoint)) {
    return { subscription: current, repaired: false };
  }

  await current.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeKey(status.public_key)
  });
  await api("/push/subscribe", {
    method: "POST",
    body: { subscription: subscription.toJSON() }
  });
  return { subscription, repaired: true };
}
