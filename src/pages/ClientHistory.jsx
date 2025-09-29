// src/pages/ClientHistory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  collection, query, where, orderBy, onSnapshot,
  doc, getDoc, setDoc, deleteDoc, serverTimestamp, getDocs
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
        email: (p.email || "").toLowerCase()
      };
    }
    const id    = localStorage.getItem("clientId")   || localStorage.getItem("userId") || null;
    const name  = localStorage.getItem("clientName") || localStorage.getItem("displayName") || "";
    const phone = localStorage.getItem("clientPhone")|| localStorage.getItem("phone") || "";
    const email = (localStorage.getItem("clientEmail")|| localStorage.getItem("email") || "").toLowerCase();
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

/* ---------- services normalization (radi za stare i nove zapise) ---------- */
const sid = (s) => String(s?.serviceId ?? s?.id ?? s ?? "");

function expandServicesForHistory(appt){
  const raw = appt?.services;
  if (!raw) return [];

  if (Array.isArray(raw)){
    return raw.map(item=>{
      if (typeof item === "string"){
        const id = sid(item);
        return { serviceId:id, name:id, durationMin:0, priceRsd:0, categoryId:null, categoryName:null };
      }
      const id = sid(item);
      return {
        serviceId: id,
        name: item.name || "",
        durationMin: Number(item.durationMin)||0,
        priceRsd: Number(item.priceRsd)||0,
        categoryId: item.categoryId ?? null,
        categoryName: item.categoryName ?? null
      };
    });
  }

  if (typeof raw === "object"){
    const id = sid(raw);
    return [{
      serviceId: id,
      name: raw.name || "",
      durationMin: Number(raw.durationMin)||0,
      priceRsd: Number(raw.priceRsd)||0,
      categoryId: raw.categoryId ?? null,
      categoryName: raw.categoryName ?? null
    }];
  }

  return [];
}

function normalizeAppointment(appt){
  const expanded = expandServicesForHistory(appt);
  const servicesLabel =
    appt.servicesLabel ||
    expanded.map(s => s.name).filter(Boolean).join(", ");

  const totalDurationMin =
    appt.totalDurationMin ||
    Math.max(15, expanded.reduce((sum, s) => sum + (Number(s.durationMin)||0), 0) || 15);

  const totalAmountRsd =
    (appt.totalAmountRsd != null ? Number(appt.totalAmountRsd) : null) ??
    (appt.priceRsd != null ? Number(appt.priceRsd) : null) ??
    expanded.reduce((sum, s) => sum + (Number(s.priceRsd)||0), 0);

  const paymentStatus = appt.paymentStatus ?? (appt.paid ? "paid" : "unpaid");
  const paymentMethod = appt.paymentMethod ?? (typeof appt.paid === "string" ? appt.paid : null);
  const isPaid = paymentStatus === "paid";

  return {
    ...appt,
    services: expanded,
    servicesIds: expanded.map(s => s.serviceId),
    servicesLabel,
    totalDurationMin,
    totalAmountRsd,
    paymentStatus,
    paymentMethod,
    isPaid
  };
}

/* ---------- util: da li string liči na Firestore docId ---------- */
function isDocIdLike(str){
  if (!str) return false;
  return /^[A-Za-z0-9_-]{15,}$/.test(str.trim());
}

/* ---------- lookup helper: nađi employee docId po username (za notifikaciju) ---------- */
async function getEmployeeIdByUsername(username){
  if (!username) return null;
  const qx = query(collection(db, "employees"), where("username", "==", username));
  const snap = await getDocs(qx);
  const first = snap.docs[0];
  return first ? first.id : null;
}

/* ---------- component ---------- */
export default function ClientHistory(){
  const nav = useNavigate();
  const location = useLocation();
  const client = useMemo(()=>getClient(),[]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // indeks servisa { [serviceId]: {name, durationMin, priceRsd, ...} }
  const [svcIndex, setSvcIndex] = useState({});
  // indeks kategorija { [categoryId]: categoryName } (ne prikazujemo je, ali punimo index)
  const [catIndex, setCatIndex] = useState({});

  const mode = location?.state?.autoCancel ? "cancel" : "history";

  // Učitaj sve servise
  useEffect(()=>{
    const unsub = onSnapshot(collection(db, "services"), (snap)=>{
      const m = {};
      snap.forEach(d=>{
        const v = d.data() || {};
        m[d.id] = {
          id: d.id,
          name: v.name || "",
          durationMin: Number(v.durationMin)||0,
          priceRsd: Number(v.priceRsd)||0,
          categoryId: v.categoryId ?? null,
          categoryName: v.categoryName ?? null
        };
      });
      setSvcIndex(m);
    });
    return ()=>unsub && unsub();
  },[]);

  // Učitaj kategorije
  useEffect(()=>{
    const unsub = onSnapshot(collection(db, "categories"), (snap)=>{
      const m = {};
      snap.forEach(d=>{
        const v = d.data() || {};
        const name = (v.name || v.title || "").toString().trim();
        if (name) m[d.id] = name;
      });
      setCatIndex(m);
    });
    return ()=>unsub && unsub();
  },[]);

  useEffect(()=>{
    const phoneNorm = normPhone(client?.phone);
    const rawPhone  = String(client?.phone||"").trim();
    const email     = String(client?.email||"").trim().toLowerCase();

    if (!client?.id && !phoneNorm && !rawPhone && !email){
      nav("/onboarding", { replace:true, state:{ reason:"history-needs-login" }});
      return;
    }

    const unsubs = [];
    const seen = new Map();

    const pushDocs = (snap, source) => {
      snap.forEach(d => {
        const existing = seen.get(d.id);
        const val = { id: d.id, ...d.data(), __src: source };
        if (!existing || existing.__src === "history") {
          seen.set(d.id, val);
        }
      });
      const all = Array.from(seen.values())
        .sort((a,b)=>((toJsDate(b.start)?.getTime()||0) - (toJsDate(a.start)?.getTime()||0)));
      setItems(all);
      setLoading(false);
    };

    const addQ = (col, field, value, tag) => {
      if (!value) return;
      try{
        const qx = query(
          collection(db, col),
          where(field, "==", value),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(qx,(snap)=>pushDocs(snap, tag)));
      }catch(e){
        console.warn(`Query index needed for ${col}.${field}`, e);
      }
    };

    if (mode==="cancel" || mode==="history"){
      addQ("appointments", "clientId",        client?.id,     "active");
      addQ("appointments", "clientPhoneNorm", phoneNorm,      "active");
      addQ("appointments", "clientPhone",     rawPhone,       "active");
      addQ("appointments", "clientEmail",     email,          "active");
    }
    if (mode==="history"){
      addQ("appointments_history", "clientId",        client?.id, "history");
      addQ("appointments_history", "clientPhoneNorm", phoneNorm,  "history");
      addQ("appointments_history", "clientPhone",     rawPhone,   "history");
      addQ("appointments_history", "clientEmail",     email,      "history");
    }

    return ()=>unsubs.forEach(u=>u&&u());
  }, [client?.id, client?.phone, client?.email, nav, mode]);

  // normalizovani zapisi
  const normalized = useMemo(()=> (items || []).map(normalizeAppointment), [items]);

  // hidracija + korekcija servicesLabel, bez prikaza kategorije u nazivu
  const hydrated = useMemo(()=>{
    return (normalized || []).map(a=>{
      const hydraServices = (a.services || []).map(s=>{
        const meta = svcIndex[s.serviceId] || {};
        const resolvedCategoryId =
          s.categoryId ?? meta.categoryId ?? null;

        const resolvedCategoryName =
          s.categoryName ??
          meta.categoryName ??
          (resolvedCategoryId ? catIndex[resolvedCategoryId] : null) ??
          null;

        // NEMA fallback-a na serviceId; ako nema imena, ostaje prazno
        const resolvedName =
          (s.name || meta.name || "").trim();

        return {
          ...s,
          name: resolvedName,
          durationMin: s.durationMin || meta.durationMin || 0,
          priceRsd: s.priceRsd || meta.priceRsd || 0,
          categoryId: resolvedCategoryId,
          categoryName: resolvedCategoryName
        };
      });

      const derivedLabel = hydraServices.map(x=>x.name).filter(Boolean).join(", ");
      const labelToUse =
        (a.servicesLabel && a.servicesLabel.trim() && !isDocIdLike(a.servicesLabel))
          ? a.servicesLabel.trim()
          : derivedLabel;

      const totalDurationMin = a.totalDurationMin ||
        Math.max(15, hydraServices.reduce((acc,x)=>acc+(x.durationMin||0),0) || 15);

      const totalAmountRsd = (a.totalAmountRsd != null ? a.totalAmountRsd : null) ??
        hydraServices.reduce((acc,x)=>acc+(x.priceRsd||0),0);

      return { ...a, services: hydraServices, servicesLabel: labelToUse, totalDurationMin, totalAmountRsd };
    });
  }, [normalized, svcIndex, catIndex]);

  const nowMs = Date.now();
  const upcoming = useMemo(()=>
    (hydrated || [])
      .filter(a => toJsDate(a.start)?.getTime()>=nowMs && a.status!=="cancelled")
      .sort((a,b)=>toJsDate(a.start)-toJsDate(b.start))
  , [hydrated, nowMs]);

  const past = useMemo(()=>
    (hydrated || [])
      .filter(a => toJsDate(a.start)?.getTime() < nowMs || a.status==="cancelled")
      .sort((a,b)=>toJsDate(b.start)-toJsDate(a.start))
  , [hydrated, nowMs]);

  async function cancel(id){
    if (!window.confirm("Sigurno želiš da otkažeš ovaj termin?")) return;
    try{
      const ref  = doc(db,"appointments", id);
      const snap = await getDoc(ref);
      if (!snap.exists()){
        setItems(prev=>prev.filter(x=>x.id!==id));
        alert("Termin više ne postoji.");
        return;
      }
      const a = snap.data()||{};
      const when = toJsDate(a.start);

      await setDoc(doc(db,"appointments_history",id),{
        ...a,
        originalId:id,
        status:"cancelled",
        cancelledAt:serverTimestamp(),
        cancelledBy:getClient()?.id||"public",
        archivedAt:serverTimestamp()
      },{merge:true});

      await deleteDoc(ref);
      setItems(prev=>prev.filter(x=>x.id!==id));

      const employeeId = await getEmployeeIdByUsername(a?.employeeUsername);

      const title = "❌ Termin otkazan";
      const prettyWhen = when ? `— ${niceDate(when)} u ${hhmm(when)}` : "";
      const body = `${a?.clientName || getClient()?.name || "Klijent"} je otkazao ${a?.servicesLabel || "uslugu"} ${prettyWhen}`;

      const screen = "/admin";
      const url = `/admin?appointmentId=${id}${employeeId?`&employeeId=${employeeId}`:""}`;

      try{
        await fetch("/api/sendNotifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "appointment_canceled",
            title,
            body,
            toRoles: ["admin","salon"],
            toEmployeeId: employeeId || null,
            data: {
              screen,
              url,
              appointmentIds: [id],
              employeeId: employeeId || "",
              employeeUsername: a?.employeeUsername || ""
            }
          })
        });
      }catch(e){
        console.warn("Slanje notifikacije nije uspelo:", e);
      }

      alert("Termin je otkazan.");
    }catch(e){ console.error(e); alert("Greška pri otkazivanju."); }
  }

  return (
    <div className="wrap">
      <style>{`
        .wrap{
          min-height:100svh;
          background:#f5f5f5;
        }
        @supports not (height: 100svh){
          .wrap{ min-height:100dvh; }
        }

        .sheet{
          background:#fff;
          min-height:100%;
          padding:50px 20px 80px;
          overflow: visible;
        }
        @media(min-width:768px){
          .sheet{
            max-width:800px;
            margin:0 auto;
            border-radius:22px;
            box-shadow:0 4px 14px rgba(0,0,0,.08);
          }
        }

        .title{
          text-align:center;
          font-size:24px;
          font-weight:900;
          margin-bottom:20px;
          padding-top:40px;
        }

        .card{
          display:flex;
          flex-direction:column;
          border:1px solid #e5e5e5;
          border-radius:16px;
          padding:16px 18px;
          margin-bottom:18px;
          background:#fff;
          box-shadow:0 2px 6px rgba(0,0,0,.05);
          overflow:visible;
        }
        .card *{ min-height:0; }

        .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}
        .badge{padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;}
        .badge.canceled{background:#ffecec;color:#c00;}
        .badge.upcoming{background:#ecfdf5;color:#065f46;}
        .badge.done{background:#f0f9ff;color:#075985;}

        .services{margin-top:6px;}
        .chip{
          display:inline-block;
          margin:3px;
          padding:4px 8px;
          border-radius:12px;
          background:#fafafa;
          font-size:12px;
          max-width:100%;
          white-space:nowrap;
          text-overflow:ellipsis;
          overflow:hidden;
        }

        .total{margin-top:6px;font-weight:700;}
        .rowbtns{
          display:flex;
          gap:10px;
          margin-top:12px;
          justify-content:flex-end;
          flex-wrap:wrap;
        }
        .btn{padding:10px 14px;border-radius:10px;font-weight:700;cursor:pointer;line-height:1;}
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
                    // pripremi čipove bez ID-jeva
                    const chips = (a.services || []).filter(s => s.name && !isDocIdLike(s.name));
                    return(
                      <div key={a.id} className="card">
                        <div className="head">
                          <span className="badge upcoming">Zakazano</span>
                          <span>{fmtDate(a.start)}</span>
                        </div>

                        <div>{a.employeeUsername||"Zaposleni"}</div>

                        {a.servicesLabel ? (
                          <div style={{marginTop:6, fontWeight:600}}>
                            {a.servicesLabel}
                          </div>
                        ) : null}

                        {chips.length>0 && (
                          <div className="services">
                            {chips.map(s=>(
                              <span
                                key={s.serviceId || s.name}
                                className="chip"
                                title={s.name}
                              >
                                {s.name}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="total">{fmtPrice(a.totalAmountRsd||0)} RSD</div>
                        <div className="rowbtns">
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
                    const canceled=(a.status==="cancelled" || a.__src==="history");
                    const chips = (a.services || []).filter(s => s.name && !isDocIdLike(s.name));
                    return(
                      <div key={a.id} className="card">
                        <div className="head">
                          <span className={`badge ${canceled?"canceled":"done"}`}>
                            {canceled?"Otkazano":"Završen"}
                          </span>
                          <span>{fmtDate(a.start)}</span>
                        </div>

                        <div>{a.employeeUsername||"Zaposleni"}</div>

                        {a.servicesLabel ? (
                          <div style={{marginTop:6, fontWeight:600}}>
                            {a.servicesLabel}
                          </div>
                        ) : null}

                        {chips.length>0 && (
                          <div className="services">
                            {chips.map(s=>(
                              <span
                                key={s.serviceId || s.name}
                                className="chip"
                                title={s.name}
                              >
                                {s.name}
                              </span>
                            ))}
                          </div>
                        )}

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
