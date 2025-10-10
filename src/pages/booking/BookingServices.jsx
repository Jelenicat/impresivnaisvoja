// src/pages/booking/BookingServices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../firebase";
import { collection, doc, onSnapshot, orderBy, query, where, getDoc } from "firebase/firestore";

/* ---------- Cart helpers (IDENTIČNO kao u BookingTime.jsx) ---------- */
function getCartKey(){
  try{
    const raw = localStorage.getItem("clientProfile");
    const p = raw ? JSON.parse(raw) : null;
    return `bookingCart:${p?.id || "anon"}`;
  }catch{
    return "bookingCart:anon";
  }
}
function readCart(){
  try{
    const key = getCartKey();

    // migracija sa starog globalnog ključa (ako postoji i ako per-user još nije postavljen)
    const legacy = localStorage.getItem("bookingCart");
    if (legacy && !localStorage.getItem(key)){
      localStorage.setItem(key, legacy);
      localStorage.removeItem("bookingCart");
    }

    return JSON.parse(localStorage.getItem(key) || "[]");
  }catch{
    return [];
  }
}
function writeCart(items){
  try{
    localStorage.setItem(getCartKey(), JSON.stringify(items));
  }catch{}
}

/* ---------- helper: slike po kategoriji ---------- */
function imagesForCategory(name = "") {
  const n = name.toLowerCase();

  if (n.includes("trepav") || n.includes("lash")) {
    return ["/trepavice1.webp", "/trepavice2.webp"];
  }
  if (n.includes("obrve") || n.includes("obrva") || n.includes("brow")) {
    return ["/trepavice1.webp", "/trepavice2.webp", "/trepavice3.webp"];
  }
  if (n.includes("manik")) {
    return [
      "/manikir1.webp", "/manikir2.webp", "/manikir4.webp",
      "/manikir5.webp", "/manikir6.webp", "/manikir7.webp",
      "/manikir8.webp", "/manikir9.webp", "/manikir10.webp"
    ];
  }
  if (n.includes("pedik")) {
    return ["/pedikir1.webp", "/pedikir2.webp", "/pedikir3.webp"];
  }
  if (n.includes("šećer") || n.includes("secer") || n.includes("pasta")) {
    return ["/depilacijapasta.webp"];
  }
  if (n.includes("depil")) {
    return ["/depilacija.webp"];
  }
  return ["/usluge1.webp"];
}

export default function BookingServices(){
  const { catId } = useParams();
  const nav = useNavigate();
  const [services, setServices] = useState([]);
  const [catName, setCatName] = useState("");
  const [details, setDetails] = useState(null);

  // slider state
  const [idx, setIdx] = useState(0);
  const imgs = useMemo(() => imagesForCategory(catName), [catName]);
  const canPrev = imgs.length > 1;
  const prev = () => setIdx(i => (i - 1 + imgs.length) % imgs.length);
  const next = () => setIdx(i => (i + 1) % imgs.length);

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "categories", catId));
      const name = snap.exists() ? snap.data().name : "Usluge";
      setCatName(name);
      setIdx(0);
    })();

    const q = query(
      collection(db, "services"),
      where("categoryId", "==", catId),
      orderBy("order")
    );
    return onSnapshot(q, snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [catId]);

  function inCart(id){ return readCart().some(x => x.serviceId === id); }
  function toggleAdd(svc){
    let items = readCart();
    if (items.some(x => x.serviceId === svc.id)){
      items = items.filter(x => x.serviceId !== svc.id);
    } else {
      items.push({
        serviceId: svc.id,
        name: svc.name,
        durationMin: svc.durationMin,
        priceRsd: svc.priceRsd,
        categoryId: svc.categoryId,
      });
    }
    writeCart(items);
    // trigger re-render
    setServices([...services]);
  }

  return (
    <div className="sv-wrap">
      <style>{`
        .sv-wrap{ min-height:100dvh; background:#0f0f10; color:#111; }
        .sv-wrap *{ -webkit-tap-highlight-color: transparent; }

        .hero { position: relative; height: 300px; background: #111; overflow: hidden; }
        .hero img{ width: 100%; height: 100%; object-fit: cover; display:block; }
        .hero .arrow{
          position:absolute; top:50%; transform: translateY(-50%);
          background: rgba(17,17,17,.7); color:#fff; border:0; width:36px; height:36px;
          border-radius:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;
          font-size:18px; font-weight:800; -webkit-appearance:none; appearance:none;
        }
        .hero .arrow.left{ left:10px; }
        .hero .arrow.right{ right:10px; }
        .hero .dots{ position:absolute; left:0; right:0; bottom:10px; display:flex; gap:6px; justify-content:center; }
        .hero .dot{ width:8px; height:8px; border-radius:999px; background:rgba(255,255,255,.45); }
        .hero .dot.active{ background:#fff; }

        .sv-sheet{
          min-height:100dvh; background:#fff; border-top-left-radius:22px; border-top-right-radius:22px;
          padding:18px 14px 100px;
        }

        .sv-hdr{ display:flex; align-items:center; justify-content:flex-start; margin: 6px 0 8px; }
        .sv-back{
          -webkit-appearance:none; appearance:none;
          background: rgba(255,255,255,0.9);
          color:#0f0f10; border:1px solid #eaeaea;
          padding:10px 12px; border-radius:12px;
          font-weight:800; font-size:15px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          cursor:pointer;
          transition: transform .15s ease, box-shadow .2s ease, opacity .2s ease;
        }
        .sv-back:hover{ transform: translateX(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.12); }
        .sv-back:active{ transform: translateY(1px); }

        .title{ font-size:22px; font-weight:900; text-align:center; margin:12px 0 14px; }

        /* >>> Responsive kartica usluge */
        .item{
          display:grid; grid-template-columns: minmax(0,1fr) auto; gap:10px;
          padding:12px; border-radius:16px; border:1px solid #eee; margin-bottom:10px; background:#fff;
        }
        .info{ min-width:0; } /* dozvoli levoj koloni da se stisne */
        .name{
          font-weight:900; font-size:18px; color:#0f0f10;
          display:-webkit-box; -webkit-line-clamp:2; line-clamp:2; -webkit-box-orient:vertical;
          overflow:hidden;
          word-break: break-word;
        }
        .meta{ font-size:14px; color:#6b7280; margin-top:2px; }

        .actions{ display:flex; align-items:center; gap:8px; flex-shrink:0; }

        .btn{
          -webkit-appearance:none; appearance:none;
          padding:10px 14px; border-radius:12px; border:1px solid #e5e5e5;
          background:#fff; cursor:pointer; font-weight:800;
          color:#111; text-decoration:none; outline:none;
        }
        .btn:focus, .btn:active { outline:none; color:#111; }
        .btn-ghost{ background:#fff; color:#111; }
        .btn-dark{ background:#1f1f1f; color:#fff; border-color:#1f1f1f; }

        .fab{ position:fixed; left:14px; right:14px; bottom:18px; display:flex; gap:10px; }
        .fab .btn-dark{ flex:1; padding:14px; border-radius:14px; font-size:16px; }

        /* Ultra mali telefoni: akcije u novi red */
        @media (max-width: 380px){
          .item{ grid-template-columns: 1fr; }
          .actions{ justify-content: space-between; margin-top:8px; }
        }

        @media (min-width: 720px){
          .hero{ height: 280px; }
        }
      `}</style>

      {/* HERO KARUSEL */}
      <div className="hero">
        <img src={imgs[idx]} alt={catName || "Kategorija"} />
        {canPrev && (
          <>
            <button className="arrow left" onClick={prev} aria-label="Prethodna slika">‹</button>
            <button className="arrow right" onClick={next} aria-label="Sledeća slika">›</button>
            <div className="dots">
              {imgs.map((_, i) => <div key={i} className={`dot ${i===idx? "active":""}`} />)}
            </div>
          </>
        )}
      </div>

      <div className="sv-sheet">
        {/* Gornje dugme Nazad → /booking (kategorije) */}
        <div className="sv-hdr">
          <button className="sv-back" onClick={()=>nav("/booking")}>← Nazad</button>
        </div>

        <div className="title">{catName || "Usluge"}</div>

        {services.map(s=>(
          <div key={s.id} className="item">
            <div className="info">
              <div className="name">{s.name}</div>
              <div className="meta">
                Trajanje: {s.durationMin} min • Fiksna cena: {Number(s.priceRsd||0).toLocaleString("sr-RS")} RSD
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={()=>setDetails(s)}>Detalji</button>
              <button className={`btn ${inCart(s.id) ? "" : "btn-dark"}`} onClick={()=>toggleAdd(s)}>
                {inCart(s.id) ? "Ukloni" : "Dodaj"}
              </button>
            </div>
          </div>
        ))}

        <div className="fab">
          <button className="btn btn-dark" onClick={()=>nav("/booking")}>Nazad</button>
          <button className="btn btn-dark" onClick={()=>nav("/booking/employee")}>Nastavi</button>
        </div>
      </div>

      {!!details && <DetailsModal svc={details} onClose={()=>setDetails(null)} />}
    </div>
  );
}

function DetailsModal({ svc, onClose }){
  return (
    <div className="mdk" onClick={onClose}>
      <style>{`
        .mdk{ position:fixed; inset:0; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; z-index:30; }
        .dlg{ background:#fff; width:min(560px,90vw); border-radius:16px; padding:16px; }
        .dlg h3{ margin:0 0 6px; font-size:18px; font-weight:900; }
        .dlg p{ margin:0; color:#4b5563; white-space:pre-wrap; }
      `}</style>
      <div className="dlg" onClick={e=>e.stopPropagation()}>
        <h3>{svc.name}</h3>
        <p>{svc.description || "Opis usluge."}</p>
      </div>
    </div>
  );
}
