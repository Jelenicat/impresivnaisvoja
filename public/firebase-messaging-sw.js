// public/firebase-messaging-sw.js
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDH0mxtNU3poGUhYFfZkcX-kWljSw9hgg4",
  authDomain: "impresivnaisvoja-7da43.firebaseapp.com",
  projectId: "impresivnaisvoja-7da43",
  storageBucket: "impresivnaisvoja-7da43.firebasestorage.app",
  messagingSenderId: "184235668413",
  appId: "1:184235668413:web:bb7a87ba08411ca67418d4"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  self.registration.showNotification(payload.notification.title, {
    body: payload.notification.body,
    icon: "/icons/icon-192.png",
  });
});
