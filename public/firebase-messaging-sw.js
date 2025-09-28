/* eslint-disable no-undef */

/* ---------------- Firebase (compat) ---------------- */
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

// Init Firebase – isti config kao na frontu
firebase.initializeApp({
  apiKey: "AIzaSyDH0mxtNU3poGUhYFfZkcX-kWljSw9hgg4",
  authDomain: "impresivnaisvoja-7da43.firebaseapp.com",
  projectId: "impresivnaisvoja-7da43",
  storageBucket: "impresivnaisvoja-7da43.appspot.com",
  messagingSenderId: "184235668413",
  appId: "1:184235668413:web:bb7a87ba08411ca67418d4",
});

let messaging;
try {
  messaging = firebase.messaging();
} catch (_) {
  // no-op (npr. browser bez FCM-a)
}

/* --------------- PWA: jednostavan offline cache --------------- */
const CACHE_NAME = "impresivna-v1";
const APP_SHELL = [
  "/", // SPA entry
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
  );
  self.clients.claim();
});

// Network-first za HTML (SPA rute), cache-first za statiku
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const isHTML = req.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
  } else {
    event.respondWith(
      caches.match(req).then((res) => res || fetch(req))
    );
  }
});

/* ----------------- FCM background notifikacije ----------------- */
/*
   Data-only pristup:
   - Backend šalje SVE u `data` (title, body, url/screen, appointmentId, employeeId…)
   - Ovdje sami prikazujemo notifikaciju (tačno jedna)
   - Ako stigne i `notification`, fallback-ujemo na njega (kompatibilnost)
*/
if (messaging && messaging.onBackgroundMessage) {
  messaging.onBackgroundMessage((payload) => {
    try {
      const title =
        payload?.data?.title ||
        payload?.notification?.title ||
        "Impresivna i svoja";

      const body =
        payload?.data?.body ||
        payload?.notification?.body ||
        "";

      // Stringifikuj sva data polja (robustno)
      const rawData = payload?.data || {};
      const data = Object.fromEntries(
        Object.entries(rawData).map(([k, v]) => [k, String(v ?? "")])
      );

      // Normalize: ako je backend poslao employeeUsername, setuj i employeeId radi URL-a
      data.employeeId = data.employeeId || data.employeeUsername || "";

      // Prikaži notifikaciju
      self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data,
      });
    } catch (_) {
      // swallow
    }
  });
}

/* --------------- Klik na notifikaciju -> deep-link --------------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const d = event.notification?.data || {};

  // Prioritet: eksplicitni d.url, pa d.screen, pa fallback
  let url = d.url || d.screen || "/me/history";

  // Ako nije kompletan URL – pretvori u apsolutni na istom originu
  if (!/^https?:\/\//i.test(url)) {
    const u = new URL(url, self.location.origin);
    // Ako nismo dobili eksplicitni d.url, dopuni query parametrima
    if (!d.url) {
      if (d.appointmentId) u.searchParams.set("appointmentId", d.appointmentId);
      if (d.employeeId) u.searchParams.set("employeeId", d.employeeId);
    }
    url = u.toString();
  }

  event.waitUntil(
    (async () => {
      const list = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // Fokusiraj postojeći tab ako ga ima; probaj i navigate
      if (list && list.length) {
        for (const client of list) {
          try {
            await client.focus();
            await client.navigate(url); // isto porijeklo → dozvoljeno
            return;
          } catch (_) {
            // ako ne uspe, probaj sledeći ili padni na openWindow
          }
        }
      }

      // Ako nema tabova – otvori novi
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })()
  );
});
