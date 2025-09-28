// src/App.jsx
import React, { useEffect, useState } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import Splash from "./pages/Splash.jsx";
import Home from "./pages/Home.jsx";
import AdminLogin from "./pages/AdminLogin.jsx";
import AdminHome from "./pages/AdminHome.jsx";
import Services from "./pages/Services.jsx";
import AdminEmployees from "./pages/AdminEmployees.jsx";
import AdminShifts from "./pages/AdminShifts.jsx";
import AdminCalendar from "./pages/AdminCalendar.jsx";
import AdminClients from "./pages/AdminClients.jsx";
import AdminFinance from "./pages/AdminFinance.jsx";
import BookingCategories from "./pages/booking/BookingCategories.jsx";
import BookingServices from "./pages/booking/BookingServices.jsx";
import BookingTime from "./pages/booking/BookingTime.jsx";
import EmployeeSelect from "./pages/booking/EmployeeSelect.jsx";
import ClientHistory from "./pages/ClientHistory.jsx";

// FCM foreground listener
import { app } from "./firebase";
import { getMessaging, isSupported, onMessage } from "firebase/messaging";

// helper: samo admin
function RequireAdmin({ children }) {
  const role = localStorage.getItem("role");
  if (role !== "admin") return <Navigate to="/admin-login" replace />;
  return children;
}

// helper: svi koji imaju neku rolu (admin, salon, worker)
function RequireFinance({ children }) {
  const role = localStorage.getItem("role");
  if (!role) return <Navigate to="/admin-login" replace />;
  return children;
}

// vrlo prost toaster bez biblioteka
function showToast(title, body, onClick) {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;right:12px;bottom:12px;background:#111;color:#fff;padding:12px 14px;border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.2);cursor:pointer;z-index:9999;max-width:86vw";
  el.innerHTML = `
    <div style="font-weight:800">${title}</div>
    <div style="opacity:.85;margin-top:4px">${body}</div>
  `;
  el.onclick = () => {
    onClick?.();
    document.body.contains(el) && document.body.removeChild(el);
  };
  document.body.appendChild(el);
  setTimeout(() => {
    document.body.contains(el) && document.body.removeChild(el);
  }, 6000);
}

export default function App() {
  const { pathname } = useLocation();

  // HEADER SAMO NA HOME (/home)
  const showTopBrand = pathname === "/home";

  // dodajemo klasu .scrolled kad se skroluje
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // FCM foreground poruke (dok je tab u fokusu)
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      try {
        if (!(await isSupported())) return;
        const messaging = getMessaging(app);

        const toNice = (tsOrIso) => {
          if (!tsOrIso) return "";
          const d =
            typeof tsOrIso === "string" ? new Date(tsOrIso) : new Date(Number(tsOrIso));
          if (isNaN(d)) return "";
          return d.toLocaleString("sr-RS", { dateStyle: "medium", timeStyle: "short" });
        };

        unsub = onMessage(messaging, (payload) => {
          const d = payload?.data || {};

          // Auto title/body na osnovu tipa i dodatnih polja
          let autoTitle = "Impresivna i svoja";
          let autoBody = "";

          const kind = d.kind || d.type; // tolerancija na nazive
          const whenTxt = d.startISO ? toNice(d.startISO) : (d.startTs ? toNice(d.startTs) : "");

          if (kind === "booked" || kind === "appointment_created") {
            autoTitle = "Zakazan termin";
            autoBody = [
              d.clientName ? `Klijent: ${d.clientName}` : null,
              d.servicesLabel || null,
              whenTxt ? `Početak: ${whenTxt}` : null,
            ].filter(Boolean).join(" · ");
          } else if (kind === "canceled" || kind === "appointment_canceled") {
            autoTitle = "Otkazan termin";
            autoBody = [
              d.clientName ? `Klijent: ${d.clientName}` : null,
              d.servicesLabel || null,
              whenTxt ? `Vreme: ${whenTxt}` : null,
            ].filter(Boolean).join(" · ");
          } else if (kind === "reminder") {
            autoTitle = "Podsetnik na termin";
            autoBody = [
              d.servicesLabel || null,
              whenTxt ? `Početak: ${whenTxt}` : null,
            ].filter(Boolean).join(" · ");
          }

          // Ako backend ipak pošalje gotove title/body – koristi njih ako nisu prazni
          const title =
            (d.title || "").trim() ||
            payload?.notification?.title ||
            autoTitle;

          const body =
            (d.body || "").trim() ||
            payload?.notification?.body ||
            autoBody;

          // Fallback URL: ako nema eksplicitnog d.url, probaj da složiš kalendar sa query parametrima
          const primaryApptId =
            d.appointmentId || (Array.isArray(d.appointmentIds) ? d.appointmentIds[0] : "");
          let url = d.url || d.screen || "";
          if (!url) {
            const u = new URL("/admin/kalendar", window.location.origin);
            if (primaryApptId) u.searchParams.set("appointmentId", primaryApptId);
            if (d.employeeUsername) u.searchParams.set("employeeId", d.employeeUsername);
            url = u.toString();
          }

          showToast(title, body, () => {
            try {
              const dest = /^https?:\/\//i.test(url)
                ? url
                : new URL(url, window.location.origin).toString();
              window.location.assign(dest);
            } catch {
              window.location.assign("/admin/kalendar");
            }
          });

          // (opciono) sistemska notifikacija i u foregroundu:
          // if (Notification.permission === "granted") {
          //   new Notification(title, { body, icon: "/icons/icon-192.png" });
          // }
        });
      } catch {
        // ignore
      }
    })();
    return () => unsub && unsub();
  }, []);

  // vrednosti iz localStorage za prosleđivanje u AdminCalendar/Finance
  const role = localStorage.getItem("role") || "";
  // Kalendar očekuje username – čuvamo ga kao employeeUsername (fallback na "username")
  const currentUsername =
    localStorage.getItem("employeeUsername") ||
    localStorage.getItem("username") ||
    null;

  return (
    <div className="app-shell">
      {/* MEDIA QUERY STIL ZA TELEFON */}
      <style>{`
        @media (max-width: 768px) {
          .brand-header {
            padding-top: 50px; /* spusti ceo header */
            padding-bottom: 8px;
          }
          .brand-header .logo-wrap {
            display: flex;
            justify-content: center;
          }
          .brand-header .logo-header {
            height: 150px; /* smanji/sredi visinu po želji */
          }
        }
 
      `}</style>

      {showTopBrand && (
        <header className={`brand-header ${scrolled ? "scrolled" : ""}`}>
          <Link to="/home">
            <div className="logo-wrap">
              <img src="/logo.webp" alt="impresivnaisvoja" className="logo-header" />
            </div>
          </Link>
        </header>
      )}

      <Routes>
        {/* javni deo */}
        <Route path="/" element={<Splash />} />
        <Route path="/home" element={<Home />} />
        <Route path="/admin-login" element={<AdminLogin />} />

        {/* booking flow */}
        <Route path="/booking" element={<BookingCategories />} />
        <Route path="/booking/:catId" element={<BookingServices />} />
        <Route path="/booking/employee" element={<EmployeeSelect />} />
        <Route path="/booking/time" element={<BookingTime />} />

        {/* klijent — istorija/otkazivanje */}
        <Route path="/me/history" element={<ClientHistory />} />

        {/* admin/salon početna – zaštićeno: bilo koja rola */}
        <Route
          path="/admin"
          element={
            <RequireFinance>
              <AdminHome />
            </RequireFinance>
          }
        />

        {/* FINANSIJE — admin, salon i worker */}
        <Route
          path="/admin/finansije"
          element={
            <RequireFinance>
              <AdminFinance role={role} currentUsername={currentUsername} />
            </RequireFinance>
          }
        />

        {/* Kalendar — svi vide svoj deo */}
        <Route
          path="/admin/kalendar"
          element={<AdminCalendar role={role} currentUsername={currentUsername} />}
        />

        {/* Smene — samo admin */}
        <Route
          path="/admin/smene"
          element={
            <RequireAdmin>
              <AdminShifts />
            </RequireAdmin>
          }
        />

        {/* Klijenti */}
        <Route path="/admin/klijenti" element={<AdminClients />} />

        {/* Usluge (editor usluga/kategorija) */}
        <Route path="/admin/usluge" element={<Services />} />

        {/* Zaposleni */}
        <Route path="/admin/zaposleni" element={<AdminEmployees />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {pathname === "/home" && (
  <footer className="app-footer">
    App by Jelena — 060 420 4623
  </footer>
)}

    </div>
  );
}
