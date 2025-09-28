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
const fmtPrice = (n) => (Number(n)||0).toLocaleString("sr-RS");

/* ---------- prikaz više usluga ---------- */
function normalizeServices(a){
  const raw = a?.services;
  if (!raw) return [];
  if (Array.isArray(raw)){
    return raw.map(s=>{
      if (typeof s==="string") return {id:s, name:s};
      return {id:s.serviceId||s.id, name:s.name||"Usluga", priceRsd:s.priceRsd||0};
    });
  }
  if (typeof raw==="object") return [{id:raw.id||raw.serviceId, name:raw.name||"Usluga", priceRsd:raw.priceRsd||0}];
  return [];
}

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
        const val = { id: d.id, ...d.data(), __src: source };
        seen.set(`${source}:${d.id}`, val);
      });
      const all = Array.from(seen.values()).sort((a,b)=>(
        (toJsDate(b.start)?.getTime()||0) - (toJsDate(a.start)?.getTime()||0)
      ));
      setItems(all);
      setLoading(false);
    };

    if (mode==="cancel" || mode==="history"){
      if (client?.id){
        const q1 = query(collection(db,"appointments"), where("clientId","==",client.id), orderBy("start","desc"));
        unsubs.push(onSnapshot(q1,(snap)=>pushDocs(snap,"active")));
      }
      if (phoneNorm){
        const q2 = query(collection(db,"appointments"), where("clientPhoneNorm","==",phoneNorm), orderBy("start","desc"));
        unsubs.push(onSnapshot(q2,(snap)=>pushDocs(snap,"active")));
      }
    }
    if (mode==="history"){
      if (client?.id){
        const h1 = query(collection(db,"appointments_history"), where("clientId","==",client.id), orderBy("start","desc"));
        unsubs.push(onSnapshot(h1,(snap)=>pushDocs(snap,"history")));
      }
      if (phoneNorm){
        const h2 = query(collection(db,"appointments_history"), where("clientPhoneNorm","==",phoneNorm), orderBy("start","desc"));
        unsubs.push(onSnapshot(h2,(snap)=>pushDocs(snap,"history")));
      }
    }
    return ()=>unsubs.forEach(u=>u&&u());
  }, [client?.id, client?.phone, nav, mode]);

  const nowMs = Date.now();
  const upcoming = items.filter(a=>a.__src==="active" && toJsDate(a.start)?.getTime()>=nowMs && a.status!=="canceled")
                        .sort((a,b)=>toJsDate(a.start)-toJsDate(b.start));
  const past = [
    ...items.filter(a=>a.__src==="active" && toJsDate(a.start)?.getTime()<nowMs),
    ...items.filter(a=>a.__src==="history")
  ].sort((a,b)=>toJsDate(b.start)-toJsDate(a.start));

  async function cancel(id){
    if (!window.confirm("Sigurno želiš da otkažeš ovaj termin?")) return;
    try{
      const ref  = doc(db,"appointments", id);
      const snap = await getDoc(ref);
      if (!snap.exists()){
        setItems(prev=>prev.filter(x=>!(x.__src==="active"&&x.id===id)));
        alert("Termin više ne postoji.");
        return;
      }
      const a = snap.data()||{};
      const when = toJsDate(a.start);
      await setDoc(doc(db,"appointments_history",id),{
        ...a, originalId:id, status:"canceled",
        canceledAt:serverTimestamp(), canceledBy:getClient()?.id||"public",
        archivedAt:serverTimestamp()
      },{merge:true});
      await deleteDoc(ref);
      setItems(prev=>prev.filter(x=>!(x.__src==="active"&&x.id===id)));
      await addDoc(collection(db,"notifications"),{
        kind:"appointment_canceled",
        title:"❌ Termin otkazan",
        body:`${a?.clientName||getClient()?.name||"Klijent"} je otkazao ${a?.servicesLabel||"uslugu"} ${when?`— ${niceDate(when)} u ${hhmm(when)}`:""}`,
        toRoles:["admin","salon"],
        toEmployeeId:a?.employeeUsername||null,
        createdAt:serverTimestamp(),
        sent:false
      });
      alert("Termin je otkazan.");
    }catch(e){ console.error(e); alert("Greška pri otkazivanju."); }
  }

  return (
    <div className="wrap">
      <style>{`
        .wrap{min-height:100dvh;background:#f5f5f5;}
        .sheet{background:#fff;min-height:100dvh;padding:20px;}
        @media(min-width:768px){.sheet{max-width:800px;margin:0 auto;border-radius:22px;box-shadow:0 4px 14px rgba(0,0,0,.08);}}
        .title{text-align:center;font-size:24px;font-weight:900;margin-bottom:20px;}
        .card{border:1px solid #e5e5e5;border-radius:16px;padding:16px 18px;margin-bottom:18px;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.05);}
        .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
        .badge{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;}
        .badge.canceled{background:#ffecec;color:#c00;}
        .badge.upcoming{background:#ecfdf5;color:#065f46;}
        .badge.done{background:#f0f9ff;color:#075985;}
        .services{margin-top:6px;}
        .chip{display:inline-block;margin:3px;padding:4px 8px;border-radius:12px;background:#fafafa;font-size:12px;}
        .total{margin-top:6px;font-weight:700;}
        .rowbtns{display:flex;gap:10px;margin-top:12px;justify-content:flex-end}
        .btn{padding:8px 12px;border-radius:10px;font-weight:700;cursor:pointer;}
        .btn.ghost{background:#fff;border:1px solid #ddd;}
        .btn.primary{background:#111;color:#fff;}
      `}</style>
      <div className="sheet">
        <div className="title">{mode==="cancel"?"Otkaži termin":"Istorija termina"}</div>
        {loading? <div>Učitavanje…</div> : (
          <>
            {mode==="cancel"?(
              <div>
                <h3>Budući termini</h3>
                {upcoming.length===0? <div>Nema zakazanih termina.</div> :
                  upcoming.map(a=>{
                    const svcs=normalizeServices(a);
                    return(
                      <div key={a.id} className="card">
                        <div className="head">
                          <span className="badge upcoming">Zakazano</span>
                          <span>{fmtDate(a.start)}</span>
                        </div>
                        <div>{a.employeeUsername||"Zaposleni"}</div>
                        <div className="services">
                          {svcs.map(s=><span key={s.id||s.name} className="chip">{s.name}</span>)}
                        </div>
                        <div className="total">{fmtPrice(a.totalAmountRsd||0)} RSD</div>
                        <div className="rowbtns">
                          <button className="btn ghost" onClick={()=>nav("/booking/employee",{state:{rescheduleId:a.id}})}>Pomeri</button>
                          <button className="btn primary" onClick={()=>cancel(a.id)}>Otkaži</button>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            ):(
              <div>
                <h3>Prošli i otkazani termini</h3>
                {past.length===0? <div>Nema stavki u istoriji.</div> :
                  past.map(a=>{
                    const svcs=normalizeServices(a);
                    const canceled=(a.status==="canceled"||a.__src==="history");
                    return(
                      <div key={`${a.__src}:${a.id}`} className="card">
                        <div className="head">
                          <span className={`badge ${canceled?"canceled":"done"}`}>
                            {canceled?"Otkazano":"Završen"}
                          </span>
                          <span>{fmtDate(a.start)}</span>
                        </div>
                        <div>{a.employeeUsername||"Zaposleni"}</div>
                        <div className="services">
                          {svcs.map(s=><span key={s.id||s.name} className="chip">{s.name}</span>)}
                        </div>
                        <div className="total">{fmtPrice(a.totalAmountRsd||0)} RSD</div>
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
