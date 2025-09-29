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
function ServicesModal({ open, onClose, services = [], loading, error, onPick }) {
  const [term, setTerm] = useState("");
  const [cat, setCat]   = useState("sve");

  // kategorije iz podataka
  const categories = useMemo(() => {
    const set = new Set();
    for (const s of services) if (s?.categoryName) set.add(s.categoryName);
    return ["sve", ...Array.from(set).sort((a,b)=>a.localeCompare(b, "sr"))];
  }, [services]);

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return services.filter(s => {
      const okCat = cat === "sve" || s?.categoryName === cat;
      if (!okCat) return false;
      if (!t) return true;
      const hay = `${s?.name || ''} ${s?.categoryName || ''}`.toLowerCase();
      return hay.includes(t);
    });
  }, [services, term, cat]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="srv-modal" role="dialog" aria-modal="true">
      <div className="srv-modal__backdrop" onClick={onClose} />
      <div className="srv-modal__panel" role="document" onClick={(e)=>e.stopPropagation()}>
        <div className="srv-modal__header">
          <h3 className="srv-modal__title">Usluge</h3>
          <button className="srv-btn srv-btn--ghost" onClick={onClose} aria-label="Zatvori">✕</button>
        </div>

        <div className="srv-filters">
          <div className="srv-input-wrap">
            <input
              className="srv-input"
              placeholder="Pretraži uslugu…"
              value={term}
              onChange={(e)=>setTerm(e.target.value)}
            />
            {term && (<button className="srv-clear" onClick={()=>setTerm("")} aria-label="Obriši pretragu">×</button>)}
          </div>
          <select className="srv-select" value={cat} onChange={(e)=>setCat(e.target.value)}>
            {categories.map(c => (
              <option key={c} value={c}>{c === "sve" ? "Sve kategorije" : c}</option>
            ))}
          </select>
        </div>

        <div className="srv-body">
          {loading ? (
            <div className="srv-empty">Učitavam usluge…</div>
          ) : error ? (
            <div className="srv-empty" style={{color:'#b00020'}}>{error}</div>
          ) : filtered.length === 0 ? (
            <div className="srv-empty">Nema rezultata za zadate filtere.</div>
          ) : (
            <div className="srv-grid">
              {filtered.map((s) => (
                <button key={`${s.id}-${s.name}`} className="srv-card" onClick={()=>onPick?.(s)}>
                  <div className="srv-card__text">
                    <div className="srv-card__title">{s.name}</div>
                    {s.categoryName && <div className="srv-chip">{s.categoryName}</div>}
                  </div>
                  <span className="srv-card__cta">Zakaži</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .srv-modal{ position:fixed; inset:0; z-index:1000; display:flex; align-items:center; justify-content:center; }
        .srv-modal__backdrop{ position:absolute; inset:0; background:rgba(4,4,5,0.55); backdrop-filter:saturate(120%) blur(6px); animation:fadeIn .2s ease-out; }
        .srv-modal__panel{ position:relative; width:min(1080px,92vw); max-height:86vh; background:rgba(255,255,255,0.88); border:1px solid rgba(0,0,0,0.06); box-shadow:0 20px 60px rgba(0,0,0,0.25); border-radius:20px; overflow:hidden; transform:scale(0.98); animation:popIn .18s ease-out forwards; }

        .srv-modal__header{ position:sticky; top:0; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; background:linear-gradient(180deg, rgba(255,255,255,0.95), rgba(255,255,255,0.85)); border-bottom:1px solid rgba(0,0,0,0.06); backdrop-filter:saturate(120%) blur(4px); z-index:2; }
        .srv-modal__title{ margin:0; font-size:20px; font-weight:600; letter-spacing:0.2px; }

        .srv-filters{ position:sticky; top:56px; display:flex; gap:10px; padding:12px 16px; background:linear-gradient(180deg, rgba(255,255,255,0.92), rgba(255,255,255,0.78)); border-bottom:1px solid rgba(0,0,0,0.06); z-index:1; }
        .srv-input-wrap{ position:relative; flex:1 1 auto; }
        .srv-input{ width:100%; height:40px; border-radius:12px; border:1px solid #e6e0d6; padding:0 42px 0 12px; font-size:14px; outline:none; background:#fff; }
        .srv-input:focus{ border-color:#d0c7b9; box-shadow:0 0 0 3px rgba(172,149,116,0.18); }
        .srv-clear{ position:absolute; right:8px; top:50%; transform:translateY(-50%); border:0; background:transparent; font-size:20px; line-height:1; padding:4px; cursor:pointer; color:#888; }
        .srv-select{ height:40px; min-width:180px; border-radius:12px; border:1px solid #e6e0d6; padding:0 12px; background:#fff; font-size:14px; }

        .srv-body{ overflow:auto; max-height: calc(86vh - 56px - 52px); }
        .srv-grid{ padding:14px 16px 18px; display:grid; grid-template-columns: repeat( auto-fill, minmax(220px,1fr) ); gap:12px; }
        .srv-card{ position:relative; display:flex; align-items:flex-end; justify-content:space-between; text-align:left; gap:10px; border:1px solid rgba(0,0,0,0.06); background:linear-gradient(180deg, #ffffff, #faf7f3); padding:14px; border-radius:16px; cursor:pointer; transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
        .srv-card:hover{ transform: translateY(-2px); box-shadow:0 10px 26px rgba(0,0,0,0.12); border-color: rgba(172,149,116,0.35); }
        .srv-card:active{ transform: translateY(0); }
        .srv-card__title{ font-weight:600; font-size:15px; margin-bottom:6px; color:var(--ink, #1f1f1f); }
        .srv-chip{ margin-top:8px; display:inline-block; font-size:11px; padding:4px 8px; border-radius:999px; background:#f4efe9; border:1px solid #eadfce; }
        .srv-card__cta{ font-size:13px; padding:8px 10px; border-radius:10px; border:1px solid #eadfce; background:#fff; }

        .srv-empty{ opacity:0.75; padding:24px; text-align:center; }
        .srv-btn{ height:36px; padding:0 12px; border-radius:10px; border:1px solid #d8d1c6; background:var(--card, #f4efe9); cursor:pointer; }
        .srv-btn--ghost{ background:transparent; border:0; height:auto; font-size:20px; }

        @keyframes popIn{ to{ transform:scale(1); } }
        @keyframes fadeIn{ from{ opacity:0 } to{ opacity:1 } }

        @media (max-width: 760px){
          .srv-modal__panel{ width:100vw; height:92vh; max-height:92vh; border-radius:16px 16px 0 0; }
          .srv-filters{ top:56px; }
          .srv-body{ max-height: calc(92vh - 56px - 52px); }
          .srv-grid{ grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px; padding:12px; }
          .srv-select{ min-width:140px; }
          .srv-card{ padding:12px; border-radius:14px; }
          .srv-card__title{ font-size:14px; }
          .srv-card__cta{ padding:6px 8px; font-size:12px; }
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
        .map(s => ({ id: s.id, name: s.name, categoryName: catById.get(s.categoryId) || null }));

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
