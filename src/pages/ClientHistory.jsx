// src/pages/ClientHistory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

/* ---------- helpers ---------- */
function getClient(){
  try{
    const raw = localStorage.getItem("clientProfile");
    if (raw){
      const p = JSON.parse(raw);
      const fullName = `${p.firstName||""} ${p.lastName||""}`.trim();
      return {
        id: p.id || null,
        name: fullName || (p.displayName||""),
        phone: p.phone || "",
        email: p.email || ""
      };
    }
    const id    = localStorage.getItem("clientId")   || localStorage.getItem("userId") || null;
    const name  = localStorage.getItem("clientName") || localStorage.getItem("displayName") || "";
    const phone = localStorage.getItem("clientPhone")|| localStorage.getItem("phone") || "";
    const email = localStorage.getItem("clientEmail")|| localStorage.getItem("email") || "";
    return { id, name, phone, email };
  }catch{
    return { id:null, name:"", phone:"", email:"" };
  }
}

const toJsDate = (x) => (x?.toDate?.() ? x.toDate() : (x instanceof Date ? x : new Date(x)));
const normPhone = (p) => String(p || "").replace(/\D+/g, "");
const fmtDate = (d) => {
  const x = toJsDate(d);
  if (!x || isNaN(x)) return "";
  return x.toLocaleString("sr-RS", { dateStyle:"medium", timeStyle:"short" });
};

export default function ClientHistory(){
  const nav = useNavigate();
  const { state } = useLocation();
  const client = useMemo(()=>getClient(),[]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    const phoneNorm = normPhone(client?.phone);
    if (!client?.id && !phoneNorm){
      nav("/onboarding", { replace:true, state:{ reason:"history-needs-login" }});
      return;
    }

    const seen = new Map();
    const pushSnap = (snap) => {
      snap.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
      const all = Array.from(seen.values()).sort((a,b)=>{
        const ta = toJsDate(a.start)?.getTime() ?? 0;
        const tb = toJsDate(b.start)?.getTime() ?? 0;
        return tb - ta;
      });
      setItems(all);
      setLoading(false);
    };

    const unsubs = [];
    if (client?.id){
      const q1 = query(
        collection(db, "appointments"),
        where("clientId","==", client.id),
        orderBy("start","desc")
      );
      unsubs.push(onSnapshot(q1, pushSnap));
    }
    if (phoneNorm){
      const q2 = query(
        collection(db, "appointments"),
        where("clientPhoneNorm","==", phoneNorm),
        orderBy("start","desc")
      );
      unsubs.push(onSnapshot(q2, pushSnap));
    }
    return ()=> unsubs.forEach(u => u && u());
  }, [client?.id, client?.phone, nav]);

  const now = Date.now();
  const upcoming = items.filter(a => {
    const t = toJsDate(a.start)?.getTime();
    return Number.isFinite(t) && t >= now && a.status !== "canceled";
  });
  const past = items.filter(a => {
    const t = toJsDate(a.start)?.getTime();
    return Number.isFinite(t) && t < now;
  });

  async function cancel(id){
    if (!window.confirm("Sigurno želiš da otkažeš ovaj termin?")) return;
    try{
      await updateDoc(doc(db,"appointments", id), {
        status: "canceled",
        canceledAt: serverTimestamp(),
        canceledBy: client?.id || "public"
      });
    }catch(e){
      alert("Greška pri otkazivanju.");
      console.error(e);
    }
  }

  return (
    <div className="wrap">
      <style>{`
        .wrap{min-height:100dvh;background:#f5f5f5;}
        .sheet{background:#fff;min-height:100dvh;padding:20px;}
        @media(min-width:768px){
          .sheet{max-width:800px;margin:0 auto;border-radius:22px;
                 box-shadow:0 4px 14px rgba(0,0,0,.08);}
        }
        .hdr{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
        .back{appearance:none;border:none;background:#eee;padding:8px 14px;
              border-radius:10px;font-weight:600;cursor:pointer;}
        .title{font-size:24px;font-weight:900;margin:0 0 20px;text-align:center;}
        .sec{margin-top:20px;}
        .sec h3{font-size:18px;margin:0 0 12px;font-weight:800;color:#333;}
        .card{border:1px solid #e5e5e5;border-radius:16px;padding:16px 18px;
              margin-bottom:18px;background:#fff;
              box-shadow:0 2px 6px rgba(0,0,0,.05);}
        @media(min-width:768px){
          .card{padding:20px 24px;}
        }
        .row{display:flex;justify-content:space-between;gap:10px;margin:6px 0;}
        .muted{opacity:.7;font-size:14px;}
        .badge{display:inline-block;padding:4px 10px;font-size:12px;font-weight:700;
               border-radius:999px;}
        .badge.canceled{background:#ffecec;color:#c00;}
        .btn{padding:10px 14px;border-radius:12px;font-weight:700;
             border:none;cursor:pointer;}
        .btn.ghost{background:#fff;color:#111;border:1px solid #ddd;}
        .btn.primary{background:#111;color:#fff;}
        .rowbtns{display:flex;gap:10px;margin-top:12px;justify-content:flex-end}
        .empty{padding:20px;border:2px dashed #ccc;border-radius:12px;
               background:#fafafa;text-align:center;color:#666;}
        .loading{padding:20px;text-align:center;}
      `}</style>

      <div className="sheet">
        <div className="hdr">
          <button className="back" onClick={()=>nav("/home")}>← Nazad</button>
        </div>
        <div className="title">Moji termini</div>

        {loading ? (
          <div className="loading">Učitavanje…</div>
        ) : (
          <>
            <div className="sec">
              <h3>Budući</h3>
              {upcoming.length === 0 ? (
                <div className="empty">Nema zakazanih budućih termina.</div>
              ) : upcoming.map(a=>(
                <div key={a.id} className="card">
                  <div className="row">
                    <div><b>{a.servicesFirstName || a.servicesLabel || "Usluga"}</b></div>
                    <div className="muted">{fmtDate(a.start)}</div>
                  </div>
                  <div className="row">
                    <div className="muted">{a.employeeUsername || "Zaposleni"}</div>
                    <div className="muted">{Number(a.totalAmountRsd||0).toLocaleString("sr-RS")} RSD</div>
                  </div>
                  <div className="rowbtns">
                    <button className="btn ghost" onClick={()=>nav("/booking/employee", { state:{ rescheduleId:a.id }})}>Pomeri</button>
                    <button className="btn primary" onClick={()=>cancel(a.id)}>Otkaži</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="sec">
              <h3>Prošli</h3>
              {past.length === 0 ? (
                <div className="empty">Nema prošlih termina.</div>
              ) : past.map(a=>(
                <div key={a.id} className="card">
                  <div className="row">
                    <div><b>{a.servicesFirstName || a.servicesLabel || "Usluga"}</b></div>
                    <div className="muted">{fmtDate(a.start)}</div>
                  </div>
                  <div className="row">
                    <div className="muted">{a.employeeUsername || "Zaposleni"}</div>
                    <div className="muted">{Number(a.totalAmountRsd||0).toLocaleString("sr-RS")} RSD</div>
                  </div>
                  {a.status === "canceled" && (
                    <div style={{marginTop:6}}>
                      <span className="badge canceled">Otkazano</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
