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

export default function ClientHistory(){
  const nav = useNavigate();
  const location = useLocation();
  const client = useMemo(()=>getClient(),[]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // "cancel"  -> budući termini (za otkazivanje)
  // "history" -> istorija (prošli + otkazani)
  const mode = location?.state?.autoCancel ? "cancel" : "history";

  useEffect(()=>{
    const phoneNorm = normPhone(client?.phone);
    if (!client?.id && !phoneNorm){
      nav("/onboarding", { replace:true, state:{ reason:"history-needs-login" }});
      return;
    }

    const unsubs = [];

    // Helper koji spaja results u mapu i updejtuje listu
    const seen = new Map();
    const pushDocs = (snap, source) => {
      snap.forEach(d => {
        const val = { id: d.id, ...d.data(), __src: source };
        seen.set(`${source}:${d.id}`, val);
      });
      const all = Array.from(seen.values()).sort((a,b)=>{
        const ta = toJsDate(a.start)?.getTime() ?? 0;
        const tb = toJsDate(b.start)?.getTime() ?? 0;
        return tb - ta;
      });
      setItems(all);
      setLoading(false);
    };

    if (mode === "cancel") {
      // Za otkazivanje nam trebaju samo budući iz ACTIVE kolekcije
      if (client?.id){
        const q1 = query(
          collection(db, "appointments"),
          where("clientId","==", client.id),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(q1, (snap)=>pushDocs(snap, "active")));
      }
      if (phoneNorm){
        const q2 = query(
          collection(db, "appointments"),
          where("clientPhoneNorm","==", phoneNorm),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(q2, (snap)=>pushDocs(snap, "active")));
      }
    } else {
      // ISTORIJA:
      // 1) prošli termini iz ACTIVE kolekcije (ostali u bazi)
      if (client?.id){
        const q1 = query(
          collection(db, "appointments"),
          where("clientId","==", client.id),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(q1, (snap)=>pushDocs(snap, "active")));
      }
      if (phoneNorm){
        const q2 = query(
          collection(db, "appointments"),
          where("clientPhoneNorm","==", phoneNorm),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(q2, (snap)=>pushDocs(snap, "active")));
      }

      // 2) OTKAZANI iz HISTORY kolekcije (mi ih premeštamo tamo prilikom otkazivanja)
      if (client?.id){
        const h1 = query(
          collection(db, "appointments_history"),
          where("clientId","==", client.id),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(h1, (snap)=>pushDocs(snap, "history")));
      }
      if (phoneNorm){
        const h2 = query(
          collection(db, "appointments_history"),
          where("clientPhoneNorm","==", phoneNorm),
          orderBy("start","desc")
        );
        unsubs.push(onSnapshot(h2, (snap)=>pushDocs(snap, "history")));
      }
    }

    return ()=> unsubs.forEach(u => u && u());
  }, [client?.id, client?.phone, nav, mode]);

  const nowMs = Date.now();

  // Budući (za ekran "cancel") računamo iz items ali filtriramo na kraju
  const upcoming = items
    .filter(a => a.__src === "active")
    .filter(a => {
      const t = toJsDate(a.start)?.getTime();
      return Number.isFinite(t) && t >= nowMs && a.status !== "canceled";
    })
    .sort((a,b)=>toJsDate(a.start)-toJsDate(b.start));

  // Istorija: prošli iz active + svi iz history
  const past = [
    // prošli iz active
    ...items.filter(a => {
      if (a.__src !== "active") return false;
      const t = toJsDate(a.start)?.getTime();
      return Number.isFinite(t) && t < nowMs;
    }),
    // i svi iz history (otkazani – bez obzira na vreme)
    ...items.filter(a => a.__src === "history")
  ].sort((a,b)=> (toJsDate(b.start) - toJsDate(a.start)));

  // HARD-DELETE sa premeštanjem u appointments_history + push notifikacija
  async function cancel(id){
    if (!window.confirm("Sigurno želiš da otkažeš ovaj termin?")) return;
    try{
      const ref  = doc(db,"appointments", id);
      const snap = await getDoc(ref);
      if (!snap.exists()){
        // već obrisan ili pomeren
        setItems(prev => prev.filter(x => !(x.__src==="active" && x.id===id)));
        alert("Termin više ne postoji.");
        return;
      }
      const a = snap.data() || {};
      const when = toJsDate(a.start);

      // 1) upiši u appointments_history sa istim id-jem (lako spajanje)
      await setDoc(
        doc(db, "appointments_history", id),
        {
          ...a,
          originalId: id,
          status: "canceled",
          canceledAt: serverTimestamp(),
          canceledBy: getClient()?.id || "public",
          archivedAt: serverTimestamp()
        },
        { merge: true }
      );

      // 2) obriši iz aktivne kolekcije (nestaje iz admin kalendara)
      await deleteDoc(ref);

      // 3) optimistički UI – skloni iz lokalne liste active
      setItems(prev => prev.filter(x => !(x.__src==="active" && x.id===id)));

      // 4) kreiraj notification dokument
      const title = "❌ Termin otkazan";
      const body =
        `${a?.clientName || getClient()?.name || "Klijent"} je otkazao ` +
        `${a?.servicesFirstName || a?.servicesLabel || "uslugu"}` +
        `${when ? ` — ${niceDate(when)} u ${hhmm(when)}` : ""}`;

      const notifRef = await addDoc(collection(db, "notifications"), {
        kind: "appointment_canceled",
        title, body,
        toRoles: ["admin", "salon"],
        toEmployeeId: a?.employeeUsername || null,
        data: {
          appointmentIds: [id],
          employeeId: a?.employeeUsername || "",
          employeeUsername: a?.employeeUsername || "",
          screen: "/admin/calendar",
          url: `/admin/calendar${
            when ? `?date=${when.toISOString().slice(0,10)}` : ""
          }${a?.employeeUsername ? `${when ? "&" : "?"}employeeId=${a.employeeUsername}` : ""}`
        },
        createdAt: serverTimestamp(),
        sent: false
      });

      // 5) odmah pinguj API da isporuči notifikaciju
      fetch("/api/sendNotifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifId: notifRef.id })
      }).catch(()=>{});

      alert("Termin je otkazan.");
    }catch(e){
      console.error("Cancel error:", e);
      alert("Greška pri otkazivanju. Pokušaj ponovo.");
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

        <div className="title">
          {mode === "cancel" ? "Otkaži termin" : "Istorija termina"}
        </div>

        {loading ? (
          <div className="loading">Učitavanje…</div>
        ) : (
          <>
            {mode === "cancel" ? (
              <div className="sec">
                <h3>Budući termini</h3>
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
                      <button
                        className="btn ghost"
                        onClick={()=>nav("/booking/employee", { state:{ rescheduleId:a.id }})}
                      >
                        Pomeri
                      </button>
                      <button className="btn primary" onClick={()=>cancel(a.id)}>Otkaži</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sec">
                <h3>Prošli i otkazani termini</h3>
                {past.length === 0 ? (
                  <div className="empty">Nema stavki u istoriji.</div>
                ) : past.map(a=>(
                  <div key={`${a.__src}:${a.id}`} className="card">
                    <div className="row">
                      <div><b>{a.servicesFirstName || a.servicesLabel || "Usluga"}</b></div>
                      <div className="muted">{fmtDate(a.start)}</div>
                    </div>
                    <div className="row">
                      <div className="muted">{a.employeeUsername || "Zaposleni"}</div>
                      <div className="muted">{Number(a.totalAmountRsd||0).toLocaleString("sr-RS")} RSD</div>
                    </div>
                    { (a.status === "canceled" || a.__src==="history") && (
                      <div style={{marginTop:6}}>
                        <span className="badge canceled">Otkazano</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
