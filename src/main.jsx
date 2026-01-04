import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

// Force scroll to top on load to prevent white space
window.addEventListener("load", () => {
  window.scrollTo(0, 0);
});

// Service worker registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then((reg) => {
        console.log("✅ Service Worker registrovan:", reg.scope);
        reg.update(); // ⬅️ preporučeno (opciono)
      })
      .catch((err) => {
        console.error("❌ Greška pri registraciji SW:", err);
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);