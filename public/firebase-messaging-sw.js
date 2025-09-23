// public/firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

// Firebase init (kao i do sada)
firebase.initializeApp({
  apiKey: "AIzaSyDH0mxtNU3poGUhYFfZkcX-kWljSw9hgg4",
  authDomain: "impresivnaisvoja-7da43.firebaseapp.com",
  projectId: "impresivnaisvoja-7da43",
  storageBucket: "impresivnaisvoja-7da43.appspot.com",
  messagingSenderId: "184235668413",
  appId: "1:184235668413:web:bb7a87ba08411ca67418d4"
});

const messaging = firebase.messaging();

// --- PWA: jednostavan offline cache ---
const CACHE_NAME = "impresivna-v1";
const APP_SHELL = [
  "/",                // SPA entry
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Network-first za HTML (SPA rute), cache-first za statiku
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const isHTML = req.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    // Network-first za stranice
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html"))
    );
  } else {
    // Cache-first za ostalo (ikonice, manifest…)
    event.respondWith(
      caches.match(req).then((res) => res || fetch(req))
    );
  }
});

// --- FCM background notifikacije ---
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "Impresivna i svoja";
  const body = payload?.notification?.body || "";
  const data = payload?.data || {};

  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/me/history";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(url) : null;
    })
  );
});
