import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { db, getFcmToken } from "../firebase";
import {
  doc, setDoc, serverTimestamp, getDoc,
  collection, getDocs, query, where
} from "firebase/firestore";
import AuthModal from "../components/AuthModal.jsx";

/* =============================================================
   Lepši modal za „USLUGE” (search + filter + kartice)
   - Bez cena, prikaz samo naziva i kategorije
   - Na klik usluge vodi u flow za zakazivanje (po potrebi login)
   - Mobilni: fullscreen panel, sticky filter bar
============================================================= */
/* =============================================================
   Lepši modal (2 koraka): Kategorije → Usluge
   - Korak 1: mreža kategorija
   - Korak 2: lista usluga u odabranoj kategoriji (sa pretragom)
   - Kompaktni razmaci i elegantan izgled
============================================================= */
function ServicesModal({ open, onClose, services = [], loading, error, onPick }) {
  const [selectedCat, setSelectedCat] = useState(null); // null => prikaz kategorija
  const [term, setTerm] = useState("");

  // kategorije iz podataka
  const categories = useMemo(() => {
    const set = new Set();
    for (const s of services) if (s?.categoryName) set.add(s.categoryName);
    return Array.from(set).sort((a,b)=>a.localeCompare(b, "sr-RS", { sensitivity: "base" }));
  }, [services]);

  // usluge izabrane kategorije + pretraga
  const catServices = useMemo(() => {
    if (!selectedCat) return [];
    const t = term.trim().toLowerCase();
    return services
      .filter(s => s.categoryName === selectedCat)
      .filter(s => !t || (s.name || "").toLowerCase().includes(t));
  }, [services, selectedCat, term]);

  useEffect(() => { setTerm(""); }, [selectedCat]);
  useEffect(() => { if (!open) setSelectedCat(null); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="srv2-modal" role="dialog" aria-modal="true">
      <div className="srv2-backdrop" onClick={onClose} />

      {/* MANJI, ELEGANTAN PANEL — nije zalepljen za vrh, već blago spušten */}
      <div className="srv2-panel slim" role="document" onClick={(e)=>e.stopPropagation()}>
        {/* Header (kompaktan) */}
        <div className="srv2-head slim">
          <div className="srv2-bc">
            {selectedCat ? (
              <>
                <button className="srv2-link" onClick={()=>setSelectedCat(null)} aria-label="Nazad na kategorije">Kategorije</button>
                <span className="srv2-sep">/</span>
                <span className="srv2-cur">{selectedCat}</span>
              </>
            ) : (
              <span className="srv2-cur">Kategorije</span>
            )}
          </div>
          <button className="srv2-x" onClick={onClose} aria-label="Zatvori">✕</button>
        </div>

        {/* Filters bar (samo na drugom koraku) */}
        {selectedCat && (
          <div className="srv2-filters slim">
            <div className="srv2-input-wrap">
              <input
                className="srv2-input"
                placeholder="Pretraži uslugu…"
                value={term}
                onChange={(e)=>setTerm(e.target.value)}
              />
              {term && <button className="srv2-clear" onClick={()=>setTerm("")} aria-label="Obriši">×</button>}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="srv2-body slim">
          {loading ? (
            <div className="srv2-empty">Učitavam…</div>
          ) : error ? (
            <div className="srv2-empty" style={{color:'#b00020'}}>{error}</div>
          ) : !selectedCat ? (
            // KORAK 1: Kategorije — JEDNA KOLONA
            categories.length ? (
              <div className="srv2-list cats one-col">
{categories.map(cat => (
  <button
    key={cat}
    className="srv2-row cat fancy"
    onClick={() => setSelectedCat(cat)}
    title={cat}
  >
    <div className="srv2-row-title">
      {cat}
    </div>
  </button>
))}


            
              </div>
            ) : (
              <div className="srv2-empty">Nema kategorija.</div>
            )
          ) : (
            // KORAK 2: Usluge u kategoriji — JEDNA KOLONA
            catServices.length ? (
              <div className="srv2-list one-col">
                {catServices.map(s => (
                  <button
                    key={`${s.id}-${s.name}`}
                    className="srv2-row fancy"
                    onClick={()=>onPick?.(s)}
                    title={s.name}
                  >
                    <div className="srv2-row-title srv2-col">
  <div className="srv2-name">{s.name}</div>

  {s.priceRsd != null && (
    <div className="srv2-price">
      {Number(s.priceRsd).toLocaleString("sr-RS")} RSD
    </div>
  )}
</div>
<span className="srv2-cta">Zakaži</span>


                  </button>
                ))}
              </div>
            ) : (
              <div className="srv2-empty">Nema usluga za zadate filtere.</div>
            )
          )}
        </div>
      </div>

      {/* CSS — manji, spušten panel + jedna kolona + fensi hoveri */}
      <style>{`
        .srv2-modal{
        
          position:fixed; inset:0; z-index:1000;
          display:flex; align-items:flex-start; justify-content:center;
          padding:36vh 30px 40vh; /* malo spušteno od vrha */
        }
        .srv2-backdrop{ position:absolute; inset:0; background:rgba(6,6,8,.52); backdrop-filter: blur(6px) saturate(120%); }

        .srv2-panel{
          position:relative;
          width:min(720px, 92vw);
          max-height:82vh;
          background:linear-gradient(180deg, #ffffffee, #fffffff6);
          border:1px solid rgba(0,0,0,.06);
          border-radius:18px;
          box-shadow:0 18px 48px rgba(0,0,0,.18);
          overflow:hidden; display:flex; flex-direction:column;
        }
        .srv2-panel.slim{ width:min(560px, 92vw); max-height:78vh; border-radius:16px; }

        .srv2-head{
          display:flex; align-items:center; justify-content:space-between;
          padding:12px 14px; border-bottom:1px solid rgba(0,0,0,.06);
          background:linear-gradient(180deg,#fff,#faf8f5);
        }
        .srv2-head.slim{ padding:10px 12px; }
        .srv2-bc{ display:flex; align-items:center; gap:8px; font-size:13px; letter-spacing:.2px; }
        .srv2-link{ background:transparent; border:none; color:#6a5d4b; font-weight:700; cursor:pointer; }
        .srv2-sep{ color:#b7aea0; }
        .srv2-cur{ font-weight:800; color:#2a2a2e; }
        .srv2-x{ background:transparent; border:none; font-size:18px; cursor:pointer; color:#666; line-height:1; }

        .srv2-filters{ padding:8px 12px; border-bottom:1px solid rgba(0,0,0,.06); background:linear-gradient(180deg,#ffffff, #faf8f5); }
        .srv2-filters.slim{ padding:8px 12px; }
        .srv2-input-wrap{ position:relative; }
        .srv2-input{
          width:100%; height:36px; border-radius:10px; border:1px solid #e6e0d6; padding:0 40px 0 10px; font-size:14px; outline:none; background:#fff;
        }
        .srv2-input:focus{ border-color:#d7cfc3; box-shadow:0 0 0 3px rgba(172,149,116,.18); }
        .srv2-clear{ position:absolute; right:6px; top:50%; transform:translateY(-50%); border:0; background:transparent; font-size:18px; color:#888; cursor:pointer; }

        .srv2-body{ overflow:auto; }
        .srv2-body.slim{ max-height: calc(78vh - 46px - 0px); }

        /* LISTA U JEDNOJ KOLONI */
        .srv2-list{ display:flex; flex-direction:column; padding:8px; gap:8px; }
        .srv2-list.cats{ padding:6px 8px 10px; }
        .srv2-list.one-col{ max-width: 100%; }

        /* Elegantne “row” kartice */
        .srv2-row{
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:12px 14px; border-radius:12px; border:1px solid #eee4d6; background:#fff; cursor:pointer;
          transition: background .14s ease, box-shadow .16s ease, border-color .14s ease, transform .08s ease;
        }
        .srv2-row.fancy:hover{
          background:#fffaf4;
          box-shadow:0 10px 28px rgba(0,0,0,.08);
          border-color:#e2d6c5;
          transform:translateY(-1px);
        }
        .srv2-row.cat{ padding:12px 14px; }

       .srv2-row-title{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:4px;

  font-size:15px;
  font-weight:800;
  color:#26262a;

  white-space:normal;
  overflow:visible;
  text-overflow:unset;
}

.srv2-name{
  white-space:normal;
  line-height:1.25;
}

.srv2-price{
  font-size:13px;
  color:#6a5d4b;
  font-weight:600;
}


        .srv2-cta{
          font-size:12px; padding:6px 10px; border-radius:999px; border:1px solid #eadfce; background:#fff;
          color:#6a5d4b; font-weight:700; line-height:1;
        }
        .srv2-cta.arrow{ padding:4px 8px; border-radius:10px; }

        .srv2-empty{ padding:18px; text-align:center; color:#777; }

        @media (max-width: 760px){
          .srv2-modal{ padding:10vh 8px 2vh; }
          .srv2-panel{ width:100%; border-radius:16px; }
          .srv2-panel.slim{ width:100%; max-height:76vh; }
          .srv2-body.slim{ max-height: calc(86vh - 46px - 0px); }
          .srv2-row{ padding:32px; border-radius:12px; }
          .srv2-row-title{ font-size:14px; }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);

  // MODAL-i
  const [servicesOpen, setServicesOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);

  /* === AUTO-REDIRECT za admin/salon/radnik ako su već ulogovani === */
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
  const [servicesFlat, setServicesFlat] = useState([]); // {id, name, categoryName}
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState("");

  const loadServices = useCallback(async () => {
    setSvcLoading(true);
    setSvcError("");
    try {
      const [catSnap, svcSnap] = await Promise.all([
        getDocs(collection(db, "categories")),
        getDocs(collection(db, "services")),
      ]);

      const catById = new Map();
      catSnap.forEach(d => {
        const data = d.data() || {};
        const name = (data.name || data.title || "").toString().trim();
        if (name) catById.set(d.id, name);
      });

      const raw = [];
      svcSnap.forEach(d => raw.push({ id: d.id, ...(d.data() || {}) }));

    const valid = raw
  .filter(s => (s.name || "").toString().trim())
  .map(s => ({
    id: s.id,
    name: s.name,
    categoryName: catById.get(s.categoryId) || null,
    priceRsd: s.priceRsd ?? s.price ?? null
  }));


      // sort: cat -> name
      valid.sort((a, b) => {
        const ac = a.categoryName || "~"; // tilde da cat=null ode na kraj
        const bc = b.categoryName || "~";
        if (ac !== bc) return ac.localeCompare(bc, "sr-RS", { sensitivity: "base" });
        return a.name.localeCompare(b.name, "sr-RS", { sensitivity: "base" });
      });

      setServicesFlat(valid);
    } catch (e) {
      console.error("Greška pri učitavanju usluga:", e);
      setSvcError("Ne mogu da učitam usluge. Pokušaj kasnije.");
      setServicesFlat([]);
    } finally {
      setSvcLoading(false);
    }
  }, []);

  // Učitaj usluge tek kada se modal otvori (da se ne radi nepotreban fetch)
  useEffect(() => {
    if (servicesOpen) loadServices();
  }, [servicesOpen, loadServices]);

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
          Impresivna i svoja je salon lepote posvećen negovanju autentične 
          ženstvenosti i samopouzdanja. Naš tim posvećen je tome
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

      {/* Auth modal */}
      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSubmit={async (profile) => {
          setAuthOpen(false);
          await saveClientProfile(profile || {});
        }}
      />

      {/* ===== MODAL: USLUGE – lepši prikaz ===== */}
      <ServicesModal
        open={servicesOpen}
        onClose={() => setServicesOpen(false)}
        services={servicesFlat}
        loading={svcLoading}
        error={svcError}
        onPick={(s) => {
          setServicesOpen(false);
          // Ako korisnik nije ulogovan, tražimo login, posle vodimo na booking
          const profile = localStorage.getItem("clientProfile");
          if (!profile) {
            setAuthOpen(true);
          } else {
            // Može i sa preselected: nav("/booking", { state: { serviceName: s.name } });
            goToServices();
          }
        }}
      />

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
