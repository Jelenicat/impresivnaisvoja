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
const CACHE_NAME = "impresivna-v3";
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
    event.respondWith(fetch(req).catch(() => caches.match("/index.html")));
  } else {
    event.respondWith(caches.match(req).then((res) => res || fetch(req)));
  }
});

/* ----------------- FCM background notifikacije ----------------- */
/*
   Prihvata i data-only i notification payload:
   - Ako server salje `notification`, i dalje prikazujemo sami (da klik/deeplink radi konzistentno)
   - Ako server salje data-only, isto radi
*/
if (messaging && messaging.onBackgroundMessage) {
  messaging.onBackgroundMessage((payload) => {
    try {
      // Ako browser vec automatski prikazuje "notification", nemoj duplirati.
      if (payload?.notification && !payload?.data?.forceShow) return;
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

      // Normalizacije – da klik handler uvek ima iste kljuceve
      data.employeeId = data.employeeId || data.employeeUsername || "";
      data.appointmentId = data.appointmentId || data.apptId || data.apptID || "";
      data.url = data.url || data.screen || "";

      // Prikazi notifikaciju (uvek jedna)
      self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data,
        tag: data.reason || data.tag || "",
        renotify: false,
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

  // Prioritet: eksplicitni d.url, pa d.screen, pa sigurni fallback na kalendar
  let url = d.url || d.screen || "/admin/kalendar";

  // Ako nije kompletan URL – pretvori u apsolutni na istom originu
  if (!/^https?:\/\//i.test(url)) {
    const u = new URL(url, self.location.origin);

    // Ako url nije eksplicitno prosledjen kao `d.url`,
    // dopuni query sa appointmentId/employeeId (uzima i apptId/employeeUsername fallback)
    if (!d.url) {
      const appt = d.appointmentId || d.apptId || d.apptID || "";
      const emp = d.employeeId || d.employeeUsername || "";
      if (appt) u.searchParams.set("appointmentId", appt);
      if (emp) u.searchParams.set("employeeId", emp);
    }

    url = u.toString();
  }

  event.waitUntil(
    (async () => {
      const list = await clients.matchAll({ type: "window", includeUncontrolled: true });

      // Fokusiraj postojeci tab ako ga ima; probaj i navigate
      if (list && list.length) {
        for (const client of list) {
          try {
            await client.focus();
            await client.navigate(url);
            return;
          } catch (_) {}
        }
      }

      // Ako nema tabova – otvori novi
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })()
  );
});



