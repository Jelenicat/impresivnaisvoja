// src/pages/booking/BookingServices.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { db } from "../../firebase";
import { collection, doc, onSnapshot, orderBy, query, where, getDoc } from "firebase/firestore";

function readCart(){ try{return JSON.parse(localStorage.getItem("bookingCart")||"[]");}catch{return[];} }
function writeCart(items){ localStorage.setItem("bookingCart", JSON.stringify(items)); }

// helper: iz naziva kategorije izaberi niz slika
function imagesForCategory(name = ""){
  const n = name.toLowerCase();
  // MANIKIR
  if (n.includes("manik")) {
    return ["/manikir1.webp", "/manikir2.webp", "/manikir3.webp"];
  }
  // PEDIKIR
  if (n.includes("pedik")) {
    return ["/pedikir1.webp", "/pedikir2.webp", "/pedikir3.webp"];
  }
  // DEPILACIJA ŠEĆERNOM PASTOM
  if (n.includes("šećer") || n.includes("secer") || n.includes("pasta")) {
    return ["/depilacijapasta.webp"];
  }
  // KLASIČNA DEPILACIJA
  if (n.includes("depil")) {
    return ["/depilacija1.webp"];
  }
  // fallback
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
    // naziv kategorije u naslovu
    (async () => {
      const snap = await getDoc(doc(db, "categories", catId));
      const name = snap.exists() ? snap.data().name : "Usluge";
      setCatName(name);
      setIdx(0); // reset slidera na promenu kategorije
    })();

    // usluge iz kategorije
    const q = query(
      collection(db, "services"),
      where("categoryId", "==", catId),
      orderBy("order")
    );
    return onSnapshot(q, snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, [catId]);

  function inCart(id){ return readCart().some(x=>x.serviceId===id); }
  function toggleAdd(svc){
    let items = readCart();
    if (items.some(x=>x.serviceId===svc.id)){
      items = items.filter(x=>x.serviceId!==svc.id);
    } else {
      items.push({
        serviceId: svc.id,
        name: svc.name,
        durationMin: svc.durationMin,
        priceRsd: svc.priceRsd,
        categoryId: svc.categoryId
      });
    }
    writeCart(items);
    // re-render
    setServices([...services]);
  }

  return (
    <div className="sv-wrap">
      <style>{`
        .sv-wrap{ min-height:100dvh; background:#0f0f10; color:#111; }
        .hero {
          position: relative;
          height: 220px;
          background: #111;
          overflow: hidden;
        }
        .hero img{
          width: 100%; height: 100%;
          object-fit: cover; display:block;
        }
        .hero .arrow{
          position:absolute; top:50%; transform: translateY(-50%);
          background: rgba(17,17,17,.7);
          color:#fff; border:0; width:36px; height:36px; border-radius:10px; cursor:pointer;
          display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800;
        }
        .hero .arrow.left{ left:10px; }
        .hero .arrow.right{ right:10px; }
        .hero .dots{
          position:absolute; left:0; right:0; bottom:10px; display:flex; gap:6px; justify-content:center;
        }
        .hero .dot{
          width:8px; height:8px; border-radius:999px; background:rgba(255,255,255,.45);
        }
        .hero .dot.active{ background:#fff; }

        .sv-sheet{
          min-height:100dvh; background:#fff; border-top-left-radius:22px; border-top-right-radius:22px;
          padding:18px 14px 100px;
        }
        .title{ font-size:22px; font-weight:900; text-align:center; margin:12px 0 14px; }

        .item{
          display:grid; grid-template-columns: 1fr auto; gap:10px;
          padding:12px; border-radius:16px; border:1px solid #eee; margin-bottom:10px; background:#fff;
        }
        .name{ font-weight:900; font-size:18px; color:#0f0f10; }
        .meta{ font-size:14px; color:#6b7280; margin-top:2px; }
        .actions{ display:flex; align-items:center; gap:8px; }
        .btn{ padding:10px 14px; border-radius:12px; border:1px solid #e5e5e5; background:#fff; cursor:pointer; font-weight:700; }
        .btn-dark{ background:#1f1f1f; color:#fff; border-color:#1f1f1f; }
        .btn-ghost{ background:#fff; }

        .fab{ position:fixed; left:14px; right:14px; bottom:18px; display:flex; gap:10px; }
        .fab .btn-dark{ flex:1; padding:14px; border-radius:14px; font-size:16px; }

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
        <div className="title">{catName || "Usluge"}</div>

        {services.map(s=>(
          <div key={s.id} className="item">
            <div>
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
