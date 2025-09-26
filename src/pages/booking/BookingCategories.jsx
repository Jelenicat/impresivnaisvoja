import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../firebase";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";

// Ako kasnije dodaš polje `image` u kategoriji, koristi se ono;
// u suprotnom biramo sliku po nazivu (fallback).
const IMG_BY_NAME = (name = "") => {
  const n = name.toLowerCase();
  if (n.includes("šećer") || n.includes("secer")) return "/depilacijapasta.webp";
  if (n.includes("depil")) return "/depilacija.webp";
  if (n.includes("manik")) return "/manikir.webp";
  if (n.includes("pedik")) return "/pedikir.webp";
  return "/depilacija.webp";
};

export default function BookingCategories(){
  const nav = useNavigate();
  const [cats, setCats] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("order"));
    return onSnapshot(q, snap => {
      setCats(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  return (
    <div className="bk-wrap">
      <style>{`
        .bk-wrap{ min-height:100dvh; background:#0f0f10; color:#fff; }
        .bk-hero{ height:200px; background:url('/usluge1.webp') center/cover no-repeat; }
        .bk-sheet{
          margin-top:-24px; background:rgba(255,255,255,.9);
          color:#111; backdrop-filter:saturate(140%) blur(10px);
          border-top-left-radius:22px; border-top-right-radius:22px;
          padding:26px 12px 24px; /* veći odmak od vrha */
        }

        /* Header sa “Nazad” */
        .bk-hdr{
          display:flex; align-items:center; justify-content:flex-start;
          margin-bottom:12px;
        }
        .bk-back{
          appearance:none; border:0; background:transparent; cursor:pointer;
          font-weight:800; font-size:16px; padding:10px 6px;
          border-radius:12px; color:#0f0f10;
          box-shadow:0 2px 8px rgba(0,0,0,0.06);
          background:rgba(255,255,255,0.8);
          transition:transform .15s ease, box-shadow .2s ease, opacity .2s ease;
        }
        .bk-back:hover{ transform:translateX(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.12); }
        .bk-back:active{ transform:translateY(1px); }

        .bk-title{ font-size:22px; font-weight:900; text-align:center; margin:6px 0 14px; }

        /* LISTA: slika levo, naziv desno */
        .list{ display:flex; flex-direction:column; gap:10px; }
        .row{
          display:grid;
          grid-template-columns: 84px 1fr auto;
          align-items:center; gap:12px;
          background:#fff; border:1px solid #eee; border-radius:16px;
          padding:8px; cursor:pointer;
        }
        .thumb{
          width:84px; height:84px; border-radius:14px; object-fit:cover; display:block;
        }
        .name{
          font-weight:900; font-size:18px; color:#0f0f10; line-height:1.15;
        }
        .chev{
          font-weight:800; color:#1f1f1f; padding:8px 10px; border-radius:10px;
        }
        .row:active{ transform: translateY(1px); }

        @media (min-width: 720px){
          .bk-hero{ height:260px; }
          .row{ grid-template-columns: 100px 1fr auto; }
          .thumb{ width:100px; height:100px; }
        }
      `}</style>

      <div className="bk-hero" />

      <div className="bk-sheet">
        {/* Header sa dugmetom Nazad */}
        <div className="bk-hdr">
          <button className="bk-back" onClick={() => nav("/home")}>← Nazad</button>
        </div>

        <div className="bk-title">Kategorije</div>

        <div className="list">
          {cats.map(c => {
            const imgSrc = c.image || IMG_BY_NAME(c.name);
            return (
              <div
                key={c.id}
                className="row"
                onClick={() => nav(`/booking/${c.id}`)}
              >
                <img className="thumb" src={imgSrc} alt={c.name} />
                <div className="name">{c.name}</div>
                <div className="chev">›</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
