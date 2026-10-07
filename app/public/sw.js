// Service worker: shows web push notifications and opens their link.
// Payload: app/lib/notifications.ts (PushPayload). Registered by the app
// shell (app/routes/app.tsx). No offline caching.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Padelpárbaj", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "hu",
      data: { url: data.url || "/notifications" },
    }),
  );
});

// Opens the link in an open app window if there is one, else a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          await client.focus();
          await client.navigate(url);
          return;
        } catch {
          // Not controlled by this worker yet: open a new window instead.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
