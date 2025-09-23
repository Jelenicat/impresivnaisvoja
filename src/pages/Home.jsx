// src/pages/Home.jsx
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { db, getFcmToken } from "../firebase";
import {
  doc, setDoc, serverTimestamp, getDoc,
  collection, query, where, getDocs
} from "firebase/firestore";
import AuthModal from "../components/AuthModal.jsx";

export default function Home() {
  const nav = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);

  function goToServices() {
    nav("/booking");
  }

  function handleBookClick() {
    const profile = localStorage.getItem("clientProfile");
    if (profile) {
      goToServices();
    } else {
      setAuthOpen(true);
    }
  }

  async function saveFcmTokenRecord({ token, ownerId, role, username }) {
    if (!token) return;
    try {
      await setDoc(
        doc(db, "fcmTokens", token),
        {
          token,
          ownerId,
          role,
          username,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          lastSeenAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("Ne mogu da upišem fcmTokens rekord:", e);
    }
  }

  async function resolveExistingClientId({ phoneNorm, emailNorm }) {
    if (phoneNorm) {
      const d = await getDoc(doc(db, "clients", phoneNorm));
      if (d.exists()) return d.id;
    }
    if (emailNorm) {
      const d = await getDoc(doc(db, "clients", emailNorm));
      if (d.exists()) return d.id;
    }
    if (phoneNorm) {
      const qs = await getDocs(query(collection(db, "clients"), where("phone", "==", phoneNorm)));
      if (!qs.empty) return qs.docs[0].id;
    }
    if (emailNorm) {
      const qs = await getDocs(query(collection(db, "clients"), where("email", "==", emailNorm)));
      if (!qs.empty) return qs.docs[0].id;
    }
    return null;
  }

  async function saveClientProfile(profile) {
    try {
      const phoneNorm = (profile?.phone || "").replace(/\D+/g, "");
      const emailNorm = (profile?.email || "").trim().toLowerCase();

      let fcmToken = null;
      try { fcmToken = await getFcmToken(); } catch {}

      const existingId = await resolveExistingClientId({ phoneNorm, emailNorm });
      const docId = existingId || phoneNorm || emailNorm || crypto.randomUUID();
      const ref = doc(db, "clients", docId);

      if (existingId) {
        const curSnap = await getDoc(ref);
        const cur = curSnap.exists() ? curSnap.data() : {};
        const patch = { lastLoginAt: serverTimestamp() };
        if (!cur.firstName && profile.firstName) patch.firstName = profile.firstName;
        if (!cur.lastName  && profile.lastName)  patch.lastName  = profile.lastName;
        if (!cur.phone     && phoneNorm)         patch.phone     = phoneNorm;
        if (!cur.email     && emailNorm)         patch.email     = emailNorm;
        await setDoc(ref, patch, { merge: true });
      } else {
        await setDoc(ref, {
          firstName  : profile.firstName || null,
          lastName   : profile.lastName  || null,
          phone      : phoneNorm || null,
          email      : emailNorm || null,
          id         : docId,
          fcmToken   : fcmToken || null,
          createdAt  : serverTimestamp(),
          lastLoginAt: serverTimestamp(),
        }, { merge: true });
      }

      await saveFcmTokenRecord({
        token: fcmToken,
        ownerId: docId,
        role: "client",
        username: emailNorm || phoneNorm || docId,
      });

      localStorage.setItem("clientProfile", JSON.stringify({
        firstName: profile.firstName || "",
        lastName : profile.lastName  || "",
        phone    : phoneNorm || "",
        email    : emailNorm || "",
        id       : docId
      }));

      goToServices();
    } catch (e) {
      console.error("Greška pri čuvanju profila:", e);
      alert("Ups, došlo je do greške pri čuvanju profila.");
    }
  }

  const isClientLogged = !!localStorage.getItem("clientProfile");

  return (
    <div className="page">
      {/* Hero */}
      <div className="hero">
        <img src="/Home.webp" alt="impresivnaisvoja" />
      </div>

      {/* CTA */}
      <div className="cta-wrap" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className="btn btn-accent btn-big" onClick={handleBookClick}>
          ZAKAŽI TERMIN
        </button>

        {isClientLogged && (
          <>
            <button
              className="btn btn-outline btn-big"
              onClick={() => nav("/me/history", { state:{ tab:"upcoming", autoCancel:true }})}
            >
              OTKAŽI USLUGU
            </button>

            <button
              className="btn btn-outline btn-big"
              onClick={() => nav("/me/history")}
            >
              ISTORIJA
            </button>

            <button
              className="btn btn-outline btn-big"
              onClick={() => {
                localStorage.removeItem("clientProfile");
                alert("Odjavljeni ste.");
                nav("/home", { replace:true });
              }}
            >
              ODJAVI SE
            </button>
          </>
        )}
      </div>

      {/* O NAMA */}
      <section className="section">
        <h2>O Nama</h2>
        <p>
          Leote je salon u kojem lepota znači biti svoja. Naš tim posvećen je tome
          da svaka žena oseti pažnju, negu i luksuz u svakom trenutku. Kod nas ne
          postoje univerzalni standardi — verujemo da je prava lepota u tome da
          budete impresivni i svoji, baš na svoj način.
        </p>
      </section>

      {/* Usluge & Galerija */}
      <div className="usluge-galerija" style={{ display: "grid", gap: 12, padding: "20px" }}>
        <button className="btn btn-outline btn-wide">USLUGE</button>
        <button className="btn btn-outline btn-wide">GALERIJA</button>
      </div>

      {/* Mapa i adresa */}
      <section className="section">
        <h2>Gde se nalazimo?</h2>
        <div style={{ margin: "12px 0 8px" }}>
          <iframe
            className="map"
            loading="lazy"
            allowFullScreen
            src="https://www.google.com/maps?q=Makenzijeva%2026%2C%20Beograd&output=embed"
            title="Mapa — Makenzijeva 26, Beograd"
          />
        </div>
        <p style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
            <path d="M12 2C8.686 2 6 4.686 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.314-2.686-6-6-6zm0 8a2 2 0 110-4 2 2 0 010 4z"/>
          </svg>
          MAKENZIJEVA 26, BEOGRAD
        </p>
      </section>

      {/* Admin/salon login na dnu */}
      <div className="footer-login">
        <Link className="btn btn-dark btn-small" to="/admin-login">ULOGUJ SE</Link>
      </div>

      {/* Modal za klijenta */}
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSubmit={async (profile) => {
          setAuthOpen(false);
          await saveClientProfile(profile || {});
        }}
      />
    </div>
  );
}
