// src/pages/ClientHistory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp
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
const hhmm = (d) => d.toLocaleTimeString("sr-RS",{hour:"2-digit",minute:"2-digit"});
const niceDate = (d) => d.toLocaleDateString("sr-RS",{weekday:"short", day:"2-digit", month:"2-digit", year:"numeric"});
const fmtDate = (d) => {
  const x = toJsDate(d);
  if (!x || isNaN(x)) return "";
  return `${niceDate(x)} ${hhmm(x)}`;
};
const fmtPrice = (n)=> (Number(n)||0).toLocaleString("sr-RS");

/** normalize services field (može biti string ID, objekat ili niz) */
function normalizeServices(a){
  const raw = a?.services;
  if (!raw) return [];
  if (Array.isArray(raw)){
    if (raw.length===0) return [];
    if (typeof raw[0]==="string") return raw.map(id=>({id,name:id}));
    if (typeof raw[0]==="object") return raw.map(x=>({id:x.id||x.serviceId,name:x.name||"—",priceRsd:x.priceRsd||0}));
    return [];
  }
  if (typeof raw==="object") return [{id:raw.id||raw.serviceId,name:raw.name||"—",priceRsd:raw.priceRsd||0}];
  if (typeof raw==="string") return [{id:raw,name:raw}];
  return [];
}

/* ---------- styles ---------- */
const styles = `
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
@media(min-width:768px){.card{padding:20px 24px;}}

.head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.badge{padding:4px 10px;font-size:12px;font-weight:700;border-radius:999px;border:1px solid;}
.badge.upcoming{background:#ecfdf5;color:#065f46;border-color:#a7f3d0;}
.badge.done{background:#f0f9ff;color:#075985;border-color:#bae6fd;}
.badge.canceled{background:#fef2f2;color:#991b1b;border-color:#fecaca;}

.grid{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;line-height:1.45;margin-bottom:6px;}
.label{color:#6b7280;font-size:12px;}
.value{font-weight:700;font-size:13px;}

.services{margin-top:6px;}
.chip{display:inline-block;margin:4px 6px 0 0;padding:4px 8px;
      font-size:12px;font-weight:700;border:1px solid #e6e0d7;
      border-radius:999px;background:#faf6f0;}

.total{margin-top:8px;font-weight:800;}
.reason{margin-top:4px;font-size:13px;color:#991b1b;}
.empty{padding:20px;border:2px dashed #ccc;border-radius:12px;
       background:#fafafa;text-align:center;color:#666;}
.loading{padding:20px;text-align:center;}
`;

/* ---------- component ---------- */
export default function ClientHistory(){
  const nav = useNavigate();
  const location = useLocation();
  const client = useMemo(()=>getClient(),[]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const mode = location?.state?.autoCancel ? "cancel" : "history";

  useEffect(()=>{
    const phoneNorm = normPhone(client?.phone);
    if (!client?.id && !phoneNorm){
      nav("/onboarding", { replace:true, state:{ reason:"history-needs-login" }});
      return;
    }
    const unsubs = [];
    const seen = new Map();
    const pushDocs = (snap, source) => {
      snap.forEach(d => {
        seen.set(`${source}:${d.id}`, { id:d.id, ...d.data(), __src:source });
      });
      const all = Array.from(seen.values()).sort((a,b)=>
        (toJsDate(b.start)?.getTime()||0) - (toJsDate(a.start)?.getTime()||0)
      );
      setItems(all); setLoading(false);
    };

    if (mode==="cancel" || mode==="history"){
      if (client?.id){
        const q1 = query(collection(db,"appointments"),where("clientId","==",client.id),orderBy("start","desc"));
        unsubs.push(onSnapshot(q1,(snap)=>pushDocs(snap,"active")));
      }
      if (phoneNorm){
        const q2 = query(collection(db,"appointments"),where("clientPhoneNorm","==",phoneNorm),orderBy("start","desc"));
        unsubs.push(onSnapshot(q2,(snap)=>pushDocs(snap,"active")));
      }
    }
    if (mode==="history"){
      if (client?.id){
        const h1 = query(collection(db,"appointments_history"),where("clientId","==",client.id),orderBy("start","desc"));
        unsubs.push(onSnapshot(h1,(snap)=>pushDocs(snap,"history")));
      }
      if (phoneNorm){
        const h2 = query(collection(db,"appointments_history"),where("clientPhoneNorm","==",phoneNorm),orderBy("start","desc"));
        unsubs.push(onSnapshot(h2,(snap)=>pushDocs(snap,"history")));
      }
    }
    return ()=>unsubs.forEach(u=>u&&u());
  },[client?.id, client?.phone, nav, mode]);

  const nowMs = Date.now();
  const upcoming = items.filter(a=>a.__src==="active" && toJsDate(a.start)?.getTime()>=nowMs && a.status!=="canceled");
  const past = [
    ...items.filter(a=>a.__src==="active" && toJsDate(a.start)?.getTime()<nowMs),
    ...items.filter(a=>a.__src==="history")
  ].sort((a,b)=>(toJsDate(b.start)-toJsDate(a.start)));

  return (
    <div className="wrap">
      <style>{styles}</style>
      <div className="sheet">
        <div className="hdr">
          <button className="back" onClick={()=>nav("/home")}>← Nazad</button>
        </div>
        <div className="title">{mode==="cancel" ? "Otkaži termin" : "Istorija termina"}</div>

        {loading ? <div className="loading">Učitavanje…</div> : (
          <>
            {mode==="cancel" ? (
              <div className="sec">
                <h3>Budući termini</h3>
                {upcoming.length===0 ? <div className="empty">Nema zakazanih budućih termina.</div> :
                  upcoming.map(a=>{
                    const svcs = normalizeServices(a);
                    return (
                      <div key={a.id} className="card">
                        <div className="head">
                          <span className="badge upcoming">Zakazano</span>
                          <span className="time">{fmtDate(a.start)}</span>
                        </div>
                        <div className="grid">
                          <div className="label">Radnik</div>
                          <div className="value">{a.employeeUsername||"Zaposleni"}</div>
                        </div>
                        {svcs.length>0 && (
                          <div className="services">
                            {svcs.map(s=><span key={s.id||s.name} className="chip">{s.name}</span>)}
                          </div>
                        )}
                        <div className="total">{fmtPrice(a.totalAmountRsd||0)} RSD</div>
                      </div>
                    );
                  })
                }
              </div>
            ) : (
              <div className="sec">
                <h3>Prošli i otkazani termini</h3>
                {past.length===0 ? <div className="empty">Nema stavki u istoriji.</div> :
                  past.map(a=>{
                    const svcs = normalizeServices(a);
                    const status = a.status || (a.__src==="history"?"canceled":"done");
                    return (
                      <div key={`${a.__src}:${a.id}`} className="card">
                        <div className="head">
                          <span className={`badge ${status==="done"?"done":status==="canceled"?"canceled":"upcoming"}`}>
                            {status==="done"?"Završen":status==="canceled"?"Otkazano":"Zakazano"}
                          </span>
                          <span className="time">{fmtDate(a.start)}</span>
                        </div>
                        <div className="grid">
                          <div className="label">Radnik</div>
                          <div className="value">{a.employeeUsername||"Zaposleni"}</div>
                        </div>
                        {svcs.length>0 && (
                          <div className="services">
                            {svcs.map(s=><span key={s.id||s.name} className="chip">{s.name}</span>)}
                          </div>
                        )}
                        <div className="total">{fmtPrice(a.totalAmountRsd||0)} RSD</div>
                        {status==="canceled" && a.cancelReason && (
                          <div className="reason"><b>Razlog:</b> {a.cancelReason}</div>
                        )}
                      </div>
                    );
                  })
                }
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
