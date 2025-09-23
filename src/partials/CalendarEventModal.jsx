// src/partials/CalendarEventModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, serverTimestamp, setDoc, updateDoc,
  increment, deleteDoc, onSnapshot
} from "firebase/firestore";
import { db } from "../firebase";
import ClientProfileDrawer from "./ClientProfileDrawer";

/* ---------- helpers ---------- */
function toLocalInput(d){
  if(!d) return "";
  const x = new Date(d);
  if (isNaN(x)) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth()+1).padStart(2,"0");
  const day = String(x.getDate()).padStart(2,"0");
  const h = String(x.getHours()).padStart(2,"0");
  const mm = String(x.getMinutes()).padStart(2,"0");
  return `${y}-${m}-${day}T${h}:${mm}`;
}
function getServiceIdsForEmployee(employee, services){
  const fromEmp = Array.isArray(employee?.serviceIds) ? new Set(employee.serviceIds) : null;
  if (fromEmp) return services.filter(s=>fromEmp.has(s.id)).map(s=>s.id);
  return services
    .filter(s => Array.isArray(s.employeeUsernames) ? s.employeeUsernames.includes(employee?.username) : true)
    .map(s=>s.id);
}
function getPhone(c){
  return (c?.phone ?? c?.phoneNumber ?? c?.mobile ?? "").toString();
}
function formatClient(c, role="admin"){
  if(!c) return "—";
  const phone = getPhone(c);
  if(role==="admin"){
    return `${c.firstName || ""} ${c.lastName || ""}${phone ? ` · ${phone}` : ""}`.trim();
  }
  const last3 = phone.replace(/\D/g,"").slice(-3);
  const initial = c.lastName ? `${(c.lastName[0]||"").toUpperCase()}.` : "";
  return `${c.firstName || ""} ${initial}${last3 ? ` · ***${last3}` : ""}`.trim();
}

// ID helper + normalizacija
const sid = (s) => String(s?.serviceId ?? s?.id ?? s ?? "");
function extractServiceIds(valueServices){
  if (!Array.isArray(valueServices) || valueServices.length===0) return [];
  // ako su objekti (public booking format) -> izvuci serviceId/id
  if (typeof valueServices[0] === "object") return valueServices.map(s => sid(s)).filter(Boolean);
  // ako su već id-jevi
  return valueServices.map(x => String(x));
}

// Generiše "servicesLabel" iz kataloga i izabranih ID-jeva
function makeServicesLabel(services, selectedIds){
  const byId = new Map((services||[]).map(s => [s.id, s]));
  const names = (selectedIds||[]).map(id => byId.get(id)?.name).filter(Boolean);
  return names.join(", ");
}

export default function CalendarEventModal({
  role = "admin",                 // "admin" | "salon" | "worker"
  value = {},
  employees = [],
  services = [],
  clients = [],
  categoriesMap = new Map(),
  date = null,
  onClose,
  onSaved,
  onDelete
}){
  // >>> NORMALIZUJ već na startu (da bi checkboxovi bili čekirani)
  const initialServiceIds = useMemo(() => extractServiceIds(value?.services), [value?.services]);

  /* ---------- form state ---------- */
  const [form, setForm] = useState({
    services: initialServiceIds,
    priceRsd: 0,
    start: value?.start || new Date(),
    end: value?.end || new Date(),

    // poravnanje sa šemom
    isOnline: value?.isOnline ?? false,
    bookedVia: value?.bookedVia ?? null,
    status: value?.status ?? null,
    paymentStatus: value?.paymentStatus ?? null,
    paymentMethod: value?.paymentMethod ?? null,

    // zadrži postojeće
    ...value,

    // UI proxy za plaćanje
    paid: value?.paid !== undefined
      ? value.paid
      : (value?.paymentStatus === "paid"
          ? (value?.paymentMethod || "cash")
          : null),
  });

  // Ako dobiješ novi "value" (drugi termin), ponovo normalizuj usluge
  useEffect(() => {
    setForm(f => ({ ...f, services: initialServiceIds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id]); // menja se pri otvaranju drugog termina

  // "novi klijent" forma otvara se kad se izabere "Dodaj novog klijenta"
  const [newClientOpen, setNewClientOpen] = useState(!value?.clientId);
  const [newClient, setNewClient] = useState({ firstName:"", lastName:"", phone:"", email:"" });
  const [saving, setSaving] = useState(false);

  // Drawer za profil klijenta
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);

  // LIVE klijent
  const [clientLive, setClientLive] = useState(null);
  useEffect(()=>{
    if(!form.clientId){ setClientLive(null); return; }
    const ref = doc(db, "clients", form.clientId);
    const unsub = onSnapshot(ref, snap=>{
      if(snap.exists()){
        setClientLive({ id: snap.id, ...snap.data() });
      }else{
        setClientLive(null);
      }
    });
    return ()=>unsub && unsub();
  }, [form.clientId]);

  // dozvole po ulozi
  const canEditPrice = role === "admin";
  const canChangeEmp = role !== "worker";
  const isBlock = form.type === "block";
  const showPayment = role === "admin" || role === "salon";

  /* cena – auto vs custom */
  const [customPrice, setCustomPrice] = useState(false);

  /* kraj – auto vs ručno */
  const [manualEnd, setManualEnd] = useState(!!value?.manualEnd);

  /* usluge – pretraga */
  const [svcQuery, setSvcQuery] = useState("");

  /* klijenti – pretraga + dropdown */
  const [clientQuery, setClientQuery] = useState("");
  const [clientListOpen, setClientListOpen] = useState(false);

  const normalized = (s="") => s.toString().toLowerCase().trim();
  const filteredClients = useMemo(() => {
    const q = normalized(clientQuery);
    const base = (clients || []);
    if (!q) return base.slice(0, 100);
    return base.filter(c => {
      const name = `${c.firstName||""} ${c.lastName||""}`;
      const phone = (c.phone || c.phoneNumber || c.mobile || "").toString();
      return normalized(name).includes(q) || phone.includes(q);
    }).slice(0, 100);
  }, [clients, clientQuery]);

  /* ---------- derived ---------- */
  const selectedEmployee = useMemo(
    ()=> (employees || []).find(e=>e.username===form.employeeUsername) || null,
    [employees, form.employeeUsername]
  );
  const allowedServiceIds = useMemo(
    ()=> getServiceIdsForEmployee(selectedEmployee, services || []),
    [selectedEmployee, services]
  );
  const filteredServices = useMemo(()=>{
    const base = (services || []).filter(s => allowedServiceIds.includes(s.id));
    const q = (svcQuery || "").trim().toLowerCase();
    if (!q) return base;
    return base.filter(s => {
      const name = (s.name || "").toLowerCase();
      const catName = (categoriesMap?.get?.(s.categoryId)?.name || "").toLowerCase();
      return name.includes(q) || catName.includes(q);
    });
  }, [services, allowedServiceIds, svcQuery, categoriesMap]);

  // usluge koje ova radnica ne radi -> ukloni iz selekcije
  useEffect(()=>{
    if(isBlock) return;
    setForm(f=>{
      const keep = (f.services||[]).filter(id=>allowedServiceIds.includes(id));
      return keep.length===(f.services?.length||0) ? f : {...f, services: keep};
    });
  }, [form.employeeUsername, isBlock, allowedServiceIds]);

  // auto ukupna cena
  const autoTotal = useMemo(()=>{
    if(isBlock) return 0;
    const map = new Map((services || []).map(s=>[s.id, s]));
    return (form.services||[]).reduce((sum,id)=> sum + (Number(map.get(id)?.priceRsd)||0), 0);
  }, [form.services, services, isBlock]);

  useEffect(()=>{
    if(isBlock) return;
    if (!customPrice) setForm(f=>({ ...f, priceRsd: autoTotal }));
  }, [autoTotal, customPrice, isBlock]);

  // auto trajanje = zbir durationMin
  const autoDurationMin = useMemo(()=>{
    if(isBlock) return 60;
    const map = new Map((services || []).map(s=>[s.id, s]));
    const total = (form.services||[]).reduce((sum,id)=> sum + (Number(map.get(id)?.durationMin)||0), 0);
    return Math.max(15, total || 15);
  }, [form.services, services, isBlock]);

  useEffect(()=>{
    if (isBlock || manualEnd) return;
    const start = new Date(form.start);
    const nextEnd = new Date(start.getTime() + autoDurationMin * 60000);
    setForm(f=>({ ...f, end: nextEnd }));
  }, [autoDurationMin, form.start, isBlock, manualEnd]);

  // “Ghost” usluge – postoje u terminu, nema ih više u katalogu
  const ghostServices = useMemo(() => {
    const catIds = new Set((services||[]).map(s=>s.id));
    const fromValue = Array.isArray(value?.services) ? value.services : [];
    if (!fromValue.length) return [];
    return fromValue.filter(s => typeof s === "object" && !catIds.has(sid(s)));
  }, [value?.services, services]);

  /* ---------- actions ---------- */
  function onServiceToggle(id, checked){
    setForm(f=>{
      const set = new Set(f.services || []);
      if (checked) set.add(id); else set.delete(id);
      return { ...f, services: Array.from(set) };
    });
  }

  async function ensureNewClientIfNeeded(){
    if (isBlock) return null;
    if (form.clientId) return form.clientId;

    const fn = (newClient.firstName||"").trim();
    const ln = (newClient.lastName||"").trim();
    const ph = (newClient.phone||"").trim();
    const em = (newClient.email||"").trim();
    if (!fn && !ph) return null;

    const docRef = await addDoc(collection(db,"clients"), {
      firstName: fn || "",
      lastName: ln || "",
      phone: ph || "",
      email: em || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      noShowCount: 0,
      note: ""
    });
    return docRef.id;
  }

  async function save(){
    setSaving(true);
    try{
      if (isBlock) {
        const payload = {
          type: "block",
          employeeUsername: form.employeeUsername || (employees[0]?.username || ""),
          clientId: null,
          services: [],
          start: form.start,
          end: form.end,
          priceRsd: 0,
          source: "manual",
          pickedEmployee: false,
          paid: null,
          note: form.note || "",
          updatedAt: serverTimestamp(),
        };
        if(form.id){
          await setDoc(doc(db,"appointments", form.id), payload, { merge:true });
        }else{
          await addDoc(collection(db,"appointments"), { ...payload, createdAt: serverTimestamp() });
        }
        onSaved?.();
        return;
      }

      // stop ako je klijent blokiran
      const pickedClient = (clients || []).find(c => c.id === form.clientId);
      if (pickedClient?.blocked) {
        alert("Ovaj klijent je blokiran i ne može da zakaže termin.");
        setSaving(false);
        return;
      }

      const clientId = await ensureNewClientIfNeeded();

      // mapiranje plaćanja
      const _canSetPayment = (role === "admin" || role === "salon");
      const paymentMethod = _canSetPayment
        ? (form.paid === "cash" ? "cash"
          : form.paid === "card" ? "card"
          : form.paid === "bank" ? "bank"
          : null)
        : (form.paymentMethod ?? null);
      const paymentStatus = _canSetPayment
        ? (form.paid ? "paid" : "unpaid")
        : (form.paymentStatus ?? "unpaid");
      const isPaid = paymentStatus === "paid";

      const isOnline = !!(form.isOnline || value?.isOnline || form.bookedVia === "public_app" || value?.bookedVia === "public_app");
      const status = isOnline ? "booked" : (form.status || "booked");

      const servicesLabel = makeServicesLabel(services, form.services);

      const totalDurationMin =
        (form.services || [])
          .map(id => (services.find(s=>s.id===id)?.durationMin)||0)
          .reduce((a,b)=>a+b,0) || 15;

      const payload = {
        type: "appointment",
        employeeUsername: form.employeeUsername || (employees[0]?.username || ""),
        clientId: clientId || null,
        // ADMIN modal i dalje čuva kao niz ID-jeva (tvoj postojeći model)
        services: Array.isArray(form.services) ? form.services : [],
        start: form.start,
        end: form.end,
        priceRsd: Number(form.priceRsd)||0,
        source: "manual",
        pickedEmployee: false,

        paid: _canSetPayment ? (form.paid ?? null) : null,

        note: form.note || "",
        updatedAt: serverTimestamp(),
        noShow: !!form.noShow,

        isOnline,
        bookedVia: form.bookedVia ?? value?.bookedVia ?? null,
        status,

        totalAmountRsd: Number(form.priceRsd) || 0,
        totalDurationMin: Math.max(15, totalDurationMin),

        servicesLabel,

        paymentStatus,
        paymentMethod,
        isPaid,
      };

      if(form.id){ await setDoc(doc(db,"appointments", form.id), payload, { merge:true }); }
      else { await addDoc(collection(db,"appointments"), { ...payload, createdAt: serverTimestamp() }); }

      onSaved?.();
    }catch(e){
      console.error(e); alert("Greška pri čuvanju.");
    } finally {
      setSaving(false);
    }
  }

  async function markNoShow(){
    if (!form.clientId) { alert("Nema klijenta vezanog za termin."); return; }
    try{
      await updateDoc(doc(db,"clients", form.clientId), { noShowCount: increment(1), updatedAt: serverTimestamp() });
      setForm(f=>({ ...f, noShow: true }));
      if (form.id) {
        await setDoc(doc(db,"appointments", form.id), { noShow: true, updatedAt: serverTimestamp() }, { merge:true });
      }

      const currentCount = (clientLive?.noShowCount ?? 0) + 1;
      if (currentCount >= 5 && !clientLive?.blocked) {
        await updateDoc(doc(db,"clients", form.clientId), { blocked: true, updatedAt: serverTimestamp() });
        alert("Klijent je automatski blokiran (5 no-show).");
      } else {
        alert("Označeno kao no-show.");
      }
    }catch(e){
      console.error(e); alert("Greška pri označavanju no-show.");
    }
  }

  function openClientProfile(){
    if(!form.clientId) return;
    if (role === "worker") return;
    setClientDrawerOpen(true);
  }

  const selectedClient = (clients || []).find(c => c.id === form.clientId);
  const clientForUI = clientLive || selectedClient || null;

  useEffect(()=>{
    if (!clientForUI) return;
    const cnt = clientForUI.noShowCount || 0;
    if (cnt >= 5 && !clientForUI.blocked) {
      updateDoc(doc(db,"clients", clientForUI.id), {
        blocked: true, updatedAt: serverTimestamp()
      }).catch(console.error);
    }
  }, [clientForUI?.id, clientForUI?.noShowCount, clientForUI?.blocked]);

  async function handleToggleBlock(){
    if(!clientForUI) return;
    try{
      await updateDoc(doc(db,"clients", clientForUI.id), {
        blocked: !clientForUI.blocked,
        updatedAt: serverTimestamp()
      });
    }catch(e){
      console.error(e); alert("Greška pri promeni blokade.");
    }
  }
  async function handleDeleteClient(){
    if(!clientForUI) return;
    if(!window.confirm("Da li sigurno želiš da obrišeš ovog klijenta?")) return;
    try{
      await deleteDoc(doc(db,"clients", clientForUI.id));
      setClientDrawerOpen(false);
    }catch(e){
      console.error(e); alert("Greška pri brisanju klijenta.");
    }
  }

  /* ---------- UI ---------- */
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <style>{`
        /* ===== Backdrop & Shell ===== */
        .modal-backdrop{
          position:fixed; inset:0; background:#0007;
          display:flex; align-items:stretch; justify-content:flex-end;
          padding:0; z-index:1000;
        }
        .modal{
          background:#fff; width:100%; max-width:900px; height:100%;
          border-left:1px solid #e6e0d7; box-shadow:-14px 0 40px rgba(0,0,0,.18);
          display:flex; flex-direction:column;
        }

        /* ===== Sticky Header ===== */
        .h{
          position:sticky; top:0; z-index:5;
          display:flex; gap:10px; justify-content:space-between; align-items:center;
          padding:14px 16px; background:#fff; border-bottom:1px solid #efeae3;
        }
        .title-left{ 
          display:flex; flex-direction:column; align-items:flex-start; gap:8px; 
          flex:1;
        }
        .client-chip{ 
          display:inline-flex; align-items:center; gap:8px; 
          padding:8px 12px; background:#f5f7ff; border:1px solid #dbe3ff; 
          border-radius:999px; cursor:pointer; font-size:14px; 
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
          max-width:200px;
        }
        .client-chip:hover{ background:#eef2ff; }
        .client-info-row{
          display:flex; align-items:center; gap:8px; flex-wrap:wrap;
        }

        /* ===== Scrollable Content ===== */
        .content{
          flex:1 1 auto; overflow:auto; padding:16px;
        }
        .grid{ 
          display:grid; gap:12px; grid-template-columns:1fr 1fr; 
        }
        @media(max-width:820px){ 
          .grid{ grid-template-columns:1fr; gap:14px; } 
        }

        .label{ 
          font-size:12px; color:#706a61; margin-bottom:4px; 
          font-weight:600;
        }
        .row{ 
          display:grid; gap:8px; 
        }

        .input, .select, .textarea{
          width:100%; padding:12px 14px; border-radius:12px; 
          border:1px solid #e6e0d7; background:#fff; font-size:14px; 
          min-height:44px; box-sizing:border-box;
        }
        .textarea{ min-height:90px; }

        .pill { 
          display:inline-flex; align-items:center; gap:6px; 
          background:#faf6f0; border:1px solid #e6e0d7; 
          padding:8px 12px; border-radius:999px; font-size:13px; 
          cursor:pointer; white-space:nowrap;
        }
        .danger { 
          border-color:#ef4444; color:#ef4444; background:#fff; 
        }

        /* ===== Services ===== */
        .svc-search{ 
          position:relative; display:flex; align-items:center; gap:8px; 
          margin-bottom:8px; 
        }
        .svc-search .icon{ 
          position:absolute; left:12px; pointer-events:none; 
        }
        .svc-search .input-plain{ padding-left:34px; }

        .services{
          display:grid; grid-template-columns:1fr; gap:8px;
          max-height:260px; overflow:auto; padding:8px;
          border:1px solid #e6e0d7; border-radius:12px; background:#fff;
        }
        @media(max-width:820px){
          .services{ 
            max-height:40vh; 
            padding:12px;
          } 
        }
        .svc{
          display:flex; align-items:center; justify-content:space-between; gap:8px;
          padding:10px; border:1px solid #eee; border-radius:12px;
        }
        .svc-title{ 
          display:flex; align-items:center; gap:10px; 
          flex:1; 
        }
        .color-dot{ width:10px; height:10px; border-radius:50%; }
        .muted{ color:#6b7280; font-size:12px; }

        .note-inline{
          margin-top: 4px;
          font-size: 12px;
          color: #4b5563;
          background: #fffbea;
          border: 1px solid #fde68a;
          padding: 6px 8px;
          border-radius: 8px;
          max-width: 100%;
          word-break: break-word;
        }

        /* ===== Client dropdown ===== */
        .client-search-wrap{ position:relative; }
        .dropdown{
          position:absolute; top:100%; left:0; right:0; z-index:20;
          background:#fff; border:1px solid #e6e0d7; border-radius:12px;
          box-shadow:0 12px 30px rgba(0,0,0,.12); margin-top:6px;
          max-height:300px; overflow:auto;
        }
        .drop-item{ 
          padding:12px 14px; cursor:pointer; border-bottom:1px solid #f7f3ed; 
          display:flex; flex-direction:column; gap:4px;
        }
        .drop-item:first-child{ 
          font-weight:700; border-bottom:1px solid #f1ebe4; 
          background:#faf6f0;
        }
        .drop-item:hover{ background:#faf6f0; }

        /* ===== Sticky Footer (mobile-first) ===== */
        .footer{
          position:sticky; bottom:0; z-index:5;
          background:linear-gradient(0deg,#fff 80%, #ffffffcc 100%);
          border-top:1px solid #efeae3; padding:12px 16px;
          display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap;
        }
        .btn{ 
          padding:12px 16px; border-radius:12px; border:1px solid #ddd6cc; 
          background:#fff; cursor:pointer; min-width:120px; font-weight:600; 
          flex:1; max-width:200px;
        }
        .btn-dark{ 
          background:#1f1f1f; color:#fff; border-color:#1f1f1f; 
        }
        .footer-left{ 
          display:flex; gap:8px; flex-wrap:wrap; 
          flex:1;
        }
        .footer-right{ 
          display:flex; gap:10px; 
          min-width:200px;
        }

        @media(max-width:820px){
          .h{ padding:12px 16px; flex-direction:column; align-items:stretch; gap:12px; }
          .title-left{ gap:6px; order:2; }
          .h > div:last-child{ order:1; display:flex; gap:8px; flex-wrap:wrap; justify-content:center; }
          .pill{ padding:6px 10px; font-size:12px; flex:0 0 auto; }
          .content{ padding:12px 16px; }
          .grid{ gap:16px; }
          .input, .select{ padding:14px 16px; font-size:16px; }
          .svc{ flex-direction:column; align-items:flex-start; gap:8px; padding:12px; }
          .svc-title{ width:100%; justify-content:space-between; }
          .services{ max-height:35vh; }
          .dropdown{ max-height:40vh; border-radius:0; margin-top:4px; }
          .drop-item{ padding:16px; flex-direction:row; }
          .drop-item .muted{ font-size:11px; }
          .footer{ padding:16px; gap:12px; }
          .btn{ padding:14px 16px; font-size:16px; min-height:48px; }
          .footer-left{ order:2; width:100%; justify-content:center; gap:8px; }
          .footer-right{ order:1; width:100%; justify-content:center; gap:12px; min-width:auto; }
          .client-chip{ max-width:none; flex:1; justify-content:center; padding:10px 14px; }
          .client-info-row{ width:100%; justify-content:center; gap:6px; }
          .no-show-badge{ padding:4px 8px; font-size:11px; border-radius:6px; white-space:nowrap; }
          .new-client-grid{ display:grid; gap:12px; grid-template-columns:1fr; }
          .new-client-grid input{ padding:14px 16px; font-size:16px; }
          .payment-options{ display:grid; gap:12px; }
          .payment-options label{ display:flex; align-items:center; gap:8px; padding:8px; border:1px solid #e6e0d7; border-radius:8px; cursor:pointer; font-size:14px; }
          .payment-options input[type="radio"]{ width:18px; height:18px; }
          .textarea{ padding:14px 16px; font-size:16px; line-height:1.4; resize:vertical; }
          .manual-end-btn{ padding:6px 12px; font-size:12px; width:auto; align-self:flex-start; }
        }
        @media(max-width:480px){
          .h{ padding:10px 12px; }
          .content{ padding:10px 12px; }
          .footer{ padding:12px 12px; }
          .services{ max-height:30vh; }
          .dropdown{ max-height:35vh; }
          .pill{ padding:5px 8px; font-size:11px; }
          .client-chip{ padding:8px 10px; font-size:13px; }
        }
        @media(max-width:820px) and (hover: none) and (pointer: coarse){
          .svc{ padding:16px; }
          .drop-item{ padding:18px 16px; }
          .btn{ min-height:52px; }
        }
      `}</style>

      <div className="modal" onMouseDown={(e)=>e.stopPropagation()}>
        {/* ===== HEADER ===== */}
        <div className="h">
          <div className="title-left">
            <div style={{fontWeight:700, fontSize:16}}>
              {isBlock ? (form.id ? "Blokada" : "Nova blokada") : (form.id ? "Termin" : "Novi termin")}
            </div>

            {!isBlock && form.clientId && (
              <>
                <div className="client-info-row">
                  {(role==="admin" || role==="salon") ? (
                    <button
                      className="client-chip"
                      onClick={openClientProfile}
                      title="Otvori profil klijenta"
                    >
                      👤 {formatClient(clientForUI || {}, role)}
                    </button>
                  ) : (
                    <span className="client-chip" title="Klijent">
                      👤 {formatClient(clientForUI || {}, role)}
                    </span>
                  )}

                  {(clientForUI?.noShowCount || 0) > 0 && (
                    <span
                      className="no-show-badge"
                      style={{ background:"#fee2e2", color:"#b91c1c", fontWeight:700, fontSize:12, padding:"4px 8px", borderRadius:"6px" }}
                      title={`Klijent nije došao ${clientForUI.noShowCount} puta`}
                    >
                      No-show {clientForUI.noShowCount}
                    </span>
                  )}
                </div>

                {clientForUI?.note && (
                  <div className="note-inline" title="Beleška sa profila klijenta">
                    📝 {clientForUI.note}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            {(!isBlock && (form.isOnline || form.bookedVia === "public_app")) && (
              <span className="pill" title="Online rezervacija">🌐 Online</span>
            )}

            {form.id && !isBlock && (
              <button className="pill" onClick={markNoShow} title="Označi kao no-show">No-show ⚠️</button>
            )}
            {form.id && (
              <button className="pill danger" onClick={()=>onDelete?.(form.id)} title="Obriši">Obriši</button>
            )}
            <button className="btn" onClick={onClose}>Zatvori</button>
          </div>
        </div>

        {/* ===== SCROLLABLE CONTENT ===== */}
        <div className="content">
          <div className="grid">
            {/* Radnica */}
            <div className="row">
              <div className="label">Radnica</div>
              <select
                className="select"
                disabled={!canChangeEmp}
                value={form.employeeUsername || (employees[0]?.username || "")}
                onChange={(e)=>setForm(f=>({...f, employeeUsername:e.target.value}))}
              >
                {(employees||[]).map(e=><option key={e.username} value={e.username}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>

            {/* Klijent */}
            {!isBlock && (
              <div className="row" style={{ position:"relative" }}>
                <div className="label">Klijent</div>

                <div className="client-search-wrap">
                  <input
                    className="input"
                    placeholder="Pretraži klijente (ime, prezime ili telefon)…"
                    value={clientQuery}
                    onChange={e => {
                      setClientQuery(e.target.value);
                      setClientListOpen(true);
                    }}
                    onFocus={() => setClientListOpen(true)}
                    onBlur={() => setTimeout(()=>setClientListOpen(false), 120)}
                  />

                  {clientListOpen && (
                    <div className="dropdown">
                      <div
                        className="drop-item"
                        onMouseDown={(e)=>e.preventDefault()}
                        onClick={()=>{
                          setForm(f => ({ ...f, clientId:null }));
                          setNewClientOpen(true);
                          setClientListOpen(false);
                        }}
                      >
                        ➕ Dodaj novog klijenta
                      </div>

                      {filteredClients.map(c => (
                        <div
                          key={c.id}
                          className="drop-item"
                          title={c.blocked ? "Klijent je blokiran" : ""}
                          onMouseDown={(e)=>e.preventDefault()}
                          onClick={()=>{
                            setForm(f => ({ ...f, clientId: c.id }));
                            setNewClientOpen(false);
                            setClientListOpen(false);
                            setClientQuery(`${c.firstName||""} ${c.lastName||""}`.trim());
                          }}
                        >
                          <div style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"space-between", width:"100%" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <span style={{ width:8, height:8, borderRadius:999, background: c.blocked ? "#ef4444" : "#a7f3d0" }} />
                              <div style={{ fontWeight:600 }}>
                                {formatClient(c, role)}
                              </div>
                            </div>
                            <div className="muted">
                              {(c.servicesDoneCount ?? 0) > 0 ? `#${c.servicesDoneCount}` : ""}
                            </div>
                          </div>
                          {(c.note || c.noShowCount>0) && (
                            <div className="muted" style={{ marginTop:3, fontSize:"12px" }}>
                              {c.note ? `📝 ${c.note}` : ""}{c.note && c.noShowCount>0 ? " · " : ""}
                              {c.noShowCount>0 ? `no-show: ${c.noShowCount}` : ""}
                            </div>
                          )}
                        </div>
                      ))}

                      {filteredClients.length === 0 && (
                        <div className="muted" style={{ padding:"16px" }}>
                          Nema rezultata. Izaberi "Dodaj novog klijenta" iznad.
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!newClientOpen && form.clientId && (clients.find(c=>c.id===form.clientId)?.blocked) && (
                  <div className="muted" style={{ color:"#ef4444", fontSize:"13px", padding:"8px", background:"#fef2f2", borderRadius:"6px" }}>
                    ⚠️ Klijent je blokiran — ne može da zakaže termin.
                  </div>
                )}

                {newClientOpen && !form.clientId && (
                  <div className="new-client-grid">
                    <input className="input" placeholder="Ime *" value={newClient.firstName} onChange={e=>setNewClient(v=>({...v, firstName:e.target.value}))}/>
                    <input className="input" placeholder="Prezime" value={newClient.lastName} onChange={e=>setNewClient(v=>({...v, lastName:e.target.value}))}/>
                    <input className="input" placeholder="Telefon *" inputMode="tel" value={newClient.phone} onChange={e=>setNewClient(v=>({...v, phone:e.target.value}))}/>
                    <input className="input" placeholder="Email (opciono)" inputMode="email" value={newClient.email} onChange={e=>setNewClient(v=>({...v, email:e.target.value}))}/>
                  </div>
                )}
              </div>
            )}

            {/* Vreme */}
            <div className="row">
              <div className="label">Početak</div>
              <input
                className="input" type="datetime-local"
                value={toLocalInput(form.start)}
                onChange={(e)=>setForm(f=>({...f, start:new Date(e.target.value)}))}
              />
            </div>

            <div className="row">
              <div className="label">Kraj</div>
              <input
                className="input" type="datetime-local"
                value={toLocalInput(form.end)}
                onChange={(e)=>{ setForm(f=>({...f, end:new Date(e.target.value)})); setManualEnd(true); }}
              />
              {manualEnd && (
                <button className="pill manual-end-btn" type="button" onClick={()=>setManualEnd(false)}>
                  ↻ Auto trajanje
                </button>
              )}
            </div>

            {/* Usluge */}
            {!isBlock && (
              <>
                <div className="row" style={{gridColumn:"1 / -1"}}>
                  <div className="label">Usluge</div>
                  <div className="svc-search">
                    <span className="icon">🔍</span>
                    <input
                      className="input input-plain"
                      placeholder="Pretraži usluge… (naziv ili kategorija)"
                      value={svcQuery}
                      onChange={(e)=>setSvcQuery(e.target.value)}
                    />
                    {svcQuery && (
                      <button className="pill" onClick={()=>setSvcQuery("")} title="Obriši pretragu" style={{position:"absolute", right:8}}>
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="services">
                    {filteredServices.map(s=>{
                      const color = (categoriesMap?.get?.(s.categoryId)?.color) || "#ddd";
                      const checked = (form.services||[]).includes(s.id);
                      return (
                        <label key={s.id} className="svc">
                          <span className="svc-title">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e)=>onServiceToggle(s.id, e.target.checked)}
                              style={{ width:18, height:18, marginRight:"auto" }}
                            />
                            <span className="color-dot" style={{background:color}}/>
                            <span style={{fontWeight:600}}>{s.name}</span>
                          </span>
                          <span className="muted">{s.durationMin}min · {s.priceRsd} RSD</span>
                        </label>
                      );
                    })}
                    {filteredServices.length===0 && <div className="muted" style={{padding:"16px", textAlign:"center"}}>Nema definisanih usluga za ovu radnicu.</div>}

                    {/* Ghost info – usluge iz termina koje nisu u katalogu */}
                    {ghostServices.length>0 && (
                      <div className="note-inline" style={{ marginTop:8 }}>
                        Ovaj termin sadrži usluge koje nisu u trenutnom katalogu:
                        {" "}
                        {ghostServices.map(g => g?.name || sid(g)).filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="muted" style={{fontSize:"13px", padding:"8px 4px", background:"#f9fafb", borderRadius:"6px"}}>
                    💰 Ukupno (auto): {autoTotal} RSD • ⏱️ Trajanje (auto): {autoDurationMin} min
                  </div>
                </div>

                {/* Cena / plaćanje */}
                <div className="row">
                  <div className="label">Cena (RSD)</div>
                  <input
                    className="input" type="number" value={form.priceRsd}
                    onChange={(e)=>{ setForm(f=>({...f, priceRsd:e.target.value})); setCustomPrice(true); }}
                    disabled={!canEditPrice}
                  />
                </div>

                {showPayment && (
                  <div className="row" style={{gridColumn:"1 / -1"}}>
                    <div className="label">Plaćanje</div>
                    <div className="payment-options">
                      <label><input type="radio" name="paid" checked={form.paid===null}  onChange={()=>setForm(f=>({...f,paid:null}))}/> nije naplaćeno</label>
                      <label><input type="radio" name="paid" checked={form.paid==="cash"} onChange={()=>setForm(f=>({...f,paid:"cash"}))}/> keš 💵</label>
                      <label><input type="radio" name="paid" checked={form.paid==="card"} onChange={()=>setForm(f=>({...f,paid:"card"}))}/> kartica 💳</label>
                      <label><input type="radio" name="paid" checked={form.paid==="bank"} onChange={()=>setForm(f=>({...f,paid:"bank"}))}/> uplata na račun 🏦</label>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Beleška */}
            <div className="row" style={{gridColumn:"1 / -1"}}>
              <div className="label">Beleška (vidi ko ima pristup)</div>
              <textarea className="textarea" value={form.note||""} onChange={(e)=>setForm(f=>({...f, note:e.target.value}))}/>
            </div>
          </div>
        </div>

        {/* ===== STICKY FOOTER BUTTONS ===== */}
        <div className="footer">
          <div className="footer-left">
            {(!isBlock && form.id && form.paid===null && (role==="admin" || role==="salon")) && (
              <>
                <button className="btn" onClick={()=>setForm(f=>({...f, paid:"cash"}))}>💵 Keš</button>
                <button className="btn" onClick={()=>setForm(f=>({...f, paid:"card"}))}>💳 Kartica</button>
                <button className="btn" onClick={()=>setForm(f=>({...f, paid:"bank"}))}>🏦 Račun</button>
              </>
            )}
          </div>
          <div className="footer-right">
            <button className="btn" onClick={onClose}>Otkaži</button>
            <button className="btn-dark" disabled={saving} onClick={save}>
              {saving ? "Čuvam..." : (value?.create ? "Sačuvaj novi" : "Sačuvaj")}
            </button>
          </div>
        </div>
      </div>

      {/* DRAWER: profil klijenta */}
      {clientDrawerOpen && clientForUI && (
        <div onMouseDown={(e)=>e.stopPropagation()}>
          <ClientProfileDrawer
            client={clientForUI}
            role={role}
            onClose={()=>setClientDrawerOpen(false)}
            onDelete={handleDeleteClient}
            onToggleBlock={handleToggleBlock}
          />
        </div>
      )}
    </div>
  );
}
