// src/pages/Home.jsx
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { db, getFcmToken } from "../firebase";
import {
  doc, setDoc, serverTimestamp, getDoc,
  collection, query, orderBy, onSnapshot,
  where, getDocs
} from "firebase/firestore";
import AuthModal from "../components/AuthModal.jsx";

export default function Home() {
  const nav = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);

  // MODAL-i
  const [servicesOpen, setServicesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  // === AUTO-REDIRECT za admin/salon/radnik ako su već ulogovani ===
  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role) nav("/admin", { replace: true });
  }, [nav]);

  function goToServices() { nav("/booking"); }

  function handleBookClick() {
    const profile = localStorage.getItem("clientProfile");
    if (profile) goToServices();
    else setAuthOpen(true);
  }

  async function saveFcmTokenRecord({ token, ownerId, role, username }) {
    if (!token) return;
    try {
      await setDoc(
        doc(db, "fcmTokens", token),
        {
          token, ownerId, role, username,
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
    const phoneNorm = (profile?.phone || "").replace(/\D+/g, "");
    const emailNorm = (profile?.email || "").trim().toLowerCase();
    const tempId = phoneNorm || emailNorm || crypto.randomUUID();

    localStorage.setItem("clientProfile", JSON.stringify({
      firstName: profile.firstName || "",
      lastName : profile.lastName  || "",
      phone    : phoneNorm || "",
      email    : emailNorm || "",
      id       : tempId
    }));

    goToServices();

    (async () => {
      try {
        let fcmToken = null;
        try { fcmToken = await getFcmToken(); } catch {}

        const existingId = await resolveExistingClientId({ phoneNorm, emailNorm });
        const docId = existingId || tempId;
        const ref = doc(db, "clients", docId);

        if (existingId) {
          const curSnap = await getDoc(ref);
          const cur = curSnap.exists() ? curSnap.data() : {};
          const patch = { lastLoginAt: serverTimestamp() };
          if (!cur.firstName && profile.firstName) patch.firstName = profile.firstName;
          if (!cur.lastName  && profile.lastName)  patch.lastName  = profile.lastName;
          if (!cur.phone     && phoneNorm)         patch.phone     = phoneNorm;
          if (!cur.email     && emailNorm)         patch.email     = emailNorm;
          if (fcmToken) patch.fcmToken = fcmToken;
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

        if (fcmToken) {
          await saveFcmTokenRecord({
            token: fcmToken,
            ownerId: docId,
            role: "client",
            username: emailNorm || phoneNorm || docId,
          });
        }
      } catch (e) {
        console.warn("Pozadinski upis nije uspeo:", e);
      }
    })();
  }

  const isClientLogged = !!localStorage.getItem("clientProfile");

  /* ===================== Usluge iz Firestore-a (bez cena) ===================== */
  const [svcGroups, setSvcGroups] = useState([]);   // [{ cat, items: [name, ...] }]

  useEffect(() => {
    // čitamo sve iz "services", sortirano, pa lokalno filtriramo inactive i pravimo grupe
    // (bez where != false da ne zahteva indeks)
    const q = query(
      collection(db, "services"),
      orderBy("category", "asc"),
      orderBy("name", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const byCat = new Map();
      snap.forEach((d) => {
        const s = d.data() || {};
        if (s.active === false) return; // preskoči neaktivne
        const cat  = (s.category || s.cat || "Usluge").toString();
        const name = (s.name || s.title || s.naziv || "").toString().trim();
        if (!name) return;
        if (!byCat.has(cat)) byCat.set(cat, new Set());
        byCat.get(cat).add(name);
      });
      const groups = Array.from(byCat.entries()).map(([cat, set]) => ({
        cat, items: Array.from(set)
      }));
      setSvcGroups(groups);
    }, (err) => {
      console.warn("Greška pri čitanju services:", err);
      setSvcGroups([]); // fallback prazan
    });
    return () => unsub();
  }, []);

  /* ===================== Galerija ===================== */
  const gallerySources = useCallback(() => {
    const mk = Array.from({ length: 10 }, (_, i) => `/manikir${i + 1}.webp`);
    const pk = Array.from({ length: 3  }, (_, i) => `/pedikir${i + 1}.webp`);
    const tr = Array.from({ length: 3  }, (_, i) => `/trepavice${i + 1}.webp`);
    return [
      { title: "Manikir",   imgs: mk },
      { title: "Pedikir",   imgs: pk },
      { title: "Trepavice", imgs: tr },
    ];
  }, []);

  return (
    <div className="page">
      {/* Hero sa CTA preko slike (Ken Burns je samo na slici) */}
      <div className="hero">
        <picture className="kb-frame">
          <source srcSet="/IMG_4989-1.webp" media="(min-width: 1024px)" />
          <img className="kb-img" src="/IMG_4989.webp" alt="impresivnaisvoja" />
        </picture>

        {/* Glavno CTA dugme */}
        <div className="cta-wrap hero-cta">
          <button className="btn btn-accent btn-big" onClick={handleBookClick}>
            ZAKAŽI TERMIN
          </button>
        </div>
      </div>

      {/* Sekundarna dugmad */}
      {isClientLogged && (
        <div className="cta-wrap" style={{ flexDirection: "column", gap: 12, alignItems: "center" }}>
          <button
            className="btn btn-outline btn-big"
            onClick={() => nav("/me/history", { state:{ tab:"upcoming", autoCancel:true }})}
          >
            OTKAŽI USLUGU
          </button>
          <button className="btn btn-outline btn-big" onClick={() => nav("/me/history")}>
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
        </div>
      )}

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
        <button className="btn btn-outline btn-wide" onClick={() => setServicesOpen(true)}>
          USLUGE
        </button>
        <button className="btn btn-outline btn-wide" onClick={() => setGalleryOpen(true)}>
          GALERIJA
        </button>
      </div>

      {/* Mapa + adresa + kontakt info */}
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

        <div style={{ textAlign: "center", marginTop: "10px" }}>
          <p style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 500 }}>
            <span role="img" aria-label="Lokacija">📍</span>
            MAKENZIJEVA 26, BEOGRAD
          </p>
        </div>

        <div className="contact-info">
          <p><b>Radno vreme:</b></p>
          <p>Pon–Pet: 08–21h</p>
          <p>Subota: 08–16h</p>
          <p><b>Telefon:</b> 067 768 8007</p>
        </div>
      </section>

      {/* Admin login */}
      <div className="footer-login">
        <Link className="btn btn-dark btn-small" to="/admin-login">ULOGUJ SE</Link>
      </div>

      {/* Footer potpis */}
      <footer className="app-footer">App by Jelena — 060 420 4623</footer>

      {/* Auth modal */}
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSubmit={async (profile) => {
          setAuthOpen(false);
          await saveClientProfile(profile || {});
        }}
      />

      {/* ===== MODAL: USLUGE (žive iz Firestore-a, bez cena) ===== */}
      {servicesOpen && (
        <div className="modal-backdrop" onClick={() => setServicesOpen(false)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()}>
            <h3>Usluge salona</h3>

            {svcGroups.length === 0 ? (
              <p style={{ textAlign:"center", margin:"8px 0 0" }}>Učitavam usluge…</p>
            ) : (
              <div style={{ display:"grid", gap:12, maxHeight: "70vh", overflow:"auto" }}>
                {svcGroups.map(group => (
                  <div key={group.cat} style={{ border:"1px solid #eee", borderRadius:12, padding:12, background:"#fff" }}>
                    <div style={{ fontWeight:800, marginBottom:8 }}>{group.cat}</div>
                    <ul style={{ margin:0, paddingLeft:18 }}>
                      {group.items.map(item => (
                        <li key={item} style={{ margin:"6px 0" }}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <div className="actions">
              <button className="btn btn-outline" onClick={()=>setServicesOpen(false)}>Zatvori</button>
              <button className="btn btn-accent" onClick={()=>{ setServicesOpen(false); handleBookClick(); }}>
                Zakaži termin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: GALERIJA ===== */}
      {galleryOpen && (
        <div className="modal-backdrop" onClick={() => setGalleryOpen(false)}>
          <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ maxWidth: 980, width: "95%" }}>
            <h3>Galerija</h3>
            <div style={{ display:"grid", gap:20, maxHeight: "70vh", overflow:"auto" }}>
              {gallerySources().map(section => (
                <div key={section.title}>
                  <div style={{ fontWeight: 800, margin: "8px 0 12px" }}>{section.title}</div>
                  <div
                    style={{
                      display:"grid",
                      gridTemplateColumns:"repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 10
                    }}
                  >
                    {section.imgs.map(src => (
                      <div key={src} style={{
                        borderRadius:12,
                        overflow:"hidden",
                        border:"1px solid #eee",
                        background:"#f6f6f6"
                      }}>
                        <img
                          src={src}
                          alt={section.title}
                          style={{ width:"100%", height:160, objectFit:"cover", display:"block" }}
                          loading="lazy"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn btn-outline" onClick={()=>setGalleryOpen(false)}>Zatvori</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
