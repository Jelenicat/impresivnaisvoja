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
import ClientHistory from "./pages/ClientHistory.jsx"; // ⇠ NOVO

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

export default function App() {
  const { pathname } = useLocation();

  // HEADER SAMO NA HOME (/home) I NIGDE VIŠE
  const showTopBrand = pathname === "/home";

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // vrednosti iz localStorage za prosleđivanje u AdminCalendar/Finance
  const role = localStorage.getItem("role") || "";
  const currentUsername = localStorage.getItem("employeeId") || null;

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
        <Route path="/me/history" element={<ClientHistory />} /> {/* ⇠ NOVO */}

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
    </div>
  );
}