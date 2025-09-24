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
  if (typeof valueServices[0] === "object") return valueServices.map(s => sid(s)).filter(Boolean);
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

  useEffect(() => {
    setForm(f => ({ ...f, services: initialServiceIds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id]);

  const [newClientOpen, setNewClientOpen] = useState(!value?.clientId);
  const [newClient, setNewClient] = useState({ firstName:"", lastName:"", phone:"", email:"" });
  const [saving, setSaving] = useState(false);
  const [clientDrawerOpen, setClientDrawerOpen] = useState(false);

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

  const canEditPrice = role === "admin";
  const canChangeEmp = role !== "worker";
  const isBlock = form.type === "block";
  const showPayment = role === "admin" || role === "salon";

  const [customPrice, setCustomPrice] = useState(false);
  const [manualEnd, setManualEnd] = useState(!!value?.manualEnd);
  const [svcQuery, setSvcQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientListOpen, setClientListOpen] = useState(false);

  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 480 : false;

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

  useEffect(()=>{
    if(isBlock) return;
    setForm(f=>{
      const keep = (f.services||[]).filter(id=>allowedServiceIds.includes(id));
      return keep.length===(f.services?.length||0) ? f : {...f, services: keep};
    });
  }, [form.employeeUsername, isBlock, allowedServiceIds]);

  const autoTotal = useMemo(()=>{
    if(isBlock) return 0;
    const map = new Map((services || []).map(s=>[s.id, s]));
    return (form.services||[]).reduce((sum,id)=> sum + (Number(map.get(id)?.priceRsd)||0), 0);
  }, [form.services, services, isBlock]);

  useEffect(()=>{
    if(isBlock) return;
    if (!customPrice) setForm(f=>({ ...f, priceRsd: autoTotal }));
  }, [autoTotal, customPrice, isBlock]);

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

  /* ===== PROMPT režim za mobilni ===== */
  function promptEmployee(){
    const list = (employees||[]).map((e,i)=>`${i+1}) ${e.firstName} ${e.lastName}`).join("\n");
    const ans = window.prompt(`Izaberi radnicu (unesi broj):\n${list}`, "");
    if(!ans) return;
    const idx = Number(ans)-1;
    const emp = employees[idx];
    if(emp) setForm(f=>({...f, employeeUsername: emp.username}));
  }

  function promptClient(){
    const q = window.prompt("Upiši deo imena/prezimena ili telefon:", "");
    if(!q) return;
    const n = normalized(q);
    const matches = (clients||[]).filter(c=>{
      const name = `${c.firstName||""} ${c.lastName||""}`.toLowerCase();
      const phone = (c.phone||c.phoneNumber||c.mobile||"").toString();
      return name.includes(n) || phone.includes(n);
    }).slice(0,10);
    if(matches.length===0){ alert("Nema rezultata."); return; }
    const list = matches.map((c,i)=>`${i+1}) ${formatClient(c, role)}`).join("\n");
    const pick = window.prompt(`Pronađeno:\n${list}\n\nUnesi broj željenog klijenta.`, "1");
    if(!pick) return;
    const idx = Number(pick)-1;
    const c = matches[idx];
    if(c) { setForm(f=>({ ...f, clientId:c.id })); setNewClientOpen(false); }
  }

  function promptStart(){
    const cur = toLocalInput(form.start).replace("T"," ");
    const ans = window.prompt("Početak (YYYY-MM-DD HH:MM):", cur);
    if(!ans) return;
    const s = ans.replace(" ","T");
    const d = new Date(s);
    if(!isNaN(d)) setForm(f=>({...f, start:d}));
  }

  function promptEnd(){
    const cur = toLocalInput(form.end).replace("T"," ");
    const ans = window.prompt("Kraj (YYYY-MM-DD HH:MM):", cur);
    if(!ans) return;
    const s = ans.replace(" ","T");
    const d = new Date(s);
    if(!isNaN(d)) { setForm(f=>({...f, end:d})); setManualEnd(true); }
  }

  function promptServices(){
    const all = (services||[]).filter(s=>allowedServiceIds.includes(s.id));
    if(all.length===0){ alert("Nema definisanih usluga za ovu radnicu."); return; }
    const idxList = all.map((s,i)=>{
      const checked = (form.services||[]).includes(s.id) ? "✓ " : "  ";
      const cat = categoriesMap?.get?.(s.categoryId)?.name || "";
      return `${checked}${i+1}) ${s.name} ${cat?`(${cat})`:''} · ${s.durationMin}min · ${s.priceRsd} RSD`;
    }).join("\n");
    const ans = window.prompt(
      `Usluge (unesi brojeve, zarezom; npr 1,3,5)\n${idxList}`,
      ""
    );
    if(!ans && ans!=="") return;
    const picks = String(ans).split(",").map(s=>Number(s.trim())-1).filter(n=>!isNaN(n) && n>=0 && n<all.length);
    const ids = Array.from(new Set(picks.map(i=>all[i].id)));
    setForm(f=>({ ...f, services: ids }));
  }

  function promptPrice(){
    const cur = String(form.priceRsd ?? 0);
    const ans = window.prompt("Cena (RSD):", cur);
    if(!ans) return;
    const n = Number(ans);
    if(!isNaN(n)) { setForm(f=>({ ...f, priceRsd:n })); setCustomPrice(true); }
  }

  function promptPayment(){
    const map = [
      {k:null,  label:"0) nije naplaćeno"},
      {k:"cash",label:"1) keš"},
      {k:"card",label:"2) kartica"},
      {k:"bank",label:"3) uplata na račun"},
    ];
    const ans = window.prompt(
      `Način plaćanja (unesi broj):\n${map.map(m=>m.label).join("\n")}`,
      form.paid==="cash"? "1" : form.paid==="card"? "2" : form.paid==="bank"? "3" : "0"
    );
    if(ans==null) return;
    const n = Number(ans);
    const picked = n===1?"cash" : n===2?"card" : n===3?"bank" : null;
    setForm(f=>({...f, paid:picked}));
  }

  function promptNote(){
    const cur = String(form.note ?? "");
    const ans = window.prompt("Beleška:", cur);
    if(ans==null) return;
    setForm(f=>({...f, note: ans}));
  }

  /* ---------- UI ---------- */
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <style>{`
        /* ===== THEME RESET & TWEAKS ===== */
        :root{
          --ink:#1f1f1f;
          --muted:#6b6b6b;
          --bg:#fff;
          --border:#e6e0d7;
          --soft:#faf6f0;
          --focus: rgba(199,178,153,.35);
          --chip:#f5f7ff; --chip-border:#dbe3ff; /* više sivo nego plavo */
        }
        * { -webkit-tap-highlight-color: transparent; }
        /* neutralizuj iOS plavo; ali ne diramo radio/checkbox */
        .cal-modal input:not([type="radio"]):not([type="checkbox"]),
        .cal-modal select,
        .cal-modal textarea,
        .cal-modal button{
          color:var(--ink)!important;
          -webkit-text-fill-color:var(--ink)!important;
          appearance:none;
          -webkit-appearance:none;
          outline:none;
        }
        /* vidljiv, neutralan radio/checkbox */
        .cal-modal input[type="checkbox"],
        .cal-modal input[type="radio"]{
          appearance:auto;
          -webkit-appearance:auto;
          accent-color:#1f1f1f;
          width:18px; height:18px;
          outline:none;
        }

        .cal-modal :is(input,select,textarea):focus{
          box-shadow:0 0 0 3px var(--focus); border-color:#c7b299;
        }
        ::selection{ background:#f3e8d7; color:#000; }

        /* ===== Backdrop & Shell ===== */
        .modal-backdrop{
          position:fixed; inset:0; background:#0007;
          display:flex; align-items:stretch; justify-content:flex-end;
          padding:0; z-index:1000;
        }
        .cal-modal.modal{
          background:var(--bg); width:100%; max-width:900px; height:100%;
          border-left:1px solid var(--border); box-shadow:-14px 0 40px rgba(0,0,0,.18);
          display:flex; flex-direction:column;
        }

        /* ===== Header ===== */
        .cal-modal .h{
          position:sticky; top:0; z-index:5;
          display:flex; gap:10px; justify-content:space-between; align-items:center;
          padding:12px 14px; background:var(--bg); border-bottom:1px solid #efeae3;
        }
        .cal-modal .title-left{ display:flex; flex-direction:column; gap:6px; flex:1; }
        .cal-modal .client-chip{
          display:inline-flex; align-items:center; gap:8px;
          padding:7px 10px; background:var(--chip); border:1px solid var(--chip-border);
          border-radius:999px; font-size:14px; max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
        }
        .cal-modal .client-info-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .cal-modal .icon-btn{
          display:none; align-items:center; justify-content:center;
          width:36px; height:36px; border:1px solid var(--border);
          border-radius:10px; background:#fff; font-size:18px; line-height:1;
        }

        /* ===== Content ===== */
        .cal-modal .content{
          flex:1 1 auto; overflow-y:auto; overflow-x:hidden; padding:14px;
        }
        .cal-modal .grid{ display:grid; gap:10px; grid-template-columns:1fr 1fr; }
        .cal-modal .label{ font-size:12px; color:#706a61; margin-bottom:4px; font-weight:600; }
        .cal-modal .row{ display:grid; gap:6px; }
        .muted{ color:#6b7280; font-size:12px; }

        /* Inputs */
        .cal-modal .input, .cal-modal .select, .cal-modal .textarea{
          width:100%; padding:10px 12px; border-radius:12px;
          border:1px solid var(--border); background:#fff; font-size:14px; min-height:40px; box-sizing:border-box;
        }
        .cal-modal .textarea{ min-height:84px; resize:vertical; }

        /* Buttons */
        .cal-modal .pill{ display:inline-flex; align-items:center; gap:6px; background:var(--soft); border:1px solid var(--border); padding:6px 10px; border-radius:999px; font-size:13px; cursor:pointer; }
        .cal-modal .danger{ border-color:#ef4444; color:#ef4444; background:#fff; }
        .cal-modal .btn{ padding:10px 12px; border-radius:12px; border:1px solid var(--border); background:#fff; cursor:pointer; min-width:110px; font-weight:700; flex:0 0 auto; }
        .cal-modal .btn-primary{  color:#fff; border-color:#1f1f1f; }
        .cal-modal .btn-ghost{ background:#fff; color:#1f1f1f; }

        /* Services */
        .cal-modal .svc-search{ position:relative; display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .cal-modal .svc-search .icon{ position:absolute; left:12px; pointer-events:none; }
        .cal-modal .svc-search .input-plain{ padding-left:34px; }

        .cal-modal .svc-totals{
          position:sticky; top:0; z-index:2;
          background:linear-gradient(#fff,#fff); border:1px solid var(--border); border-radius:10px;
          padding:8px 10px; display:flex; align-items:center; justify-content:space-between; font-size:13px; margin-bottom:8px;
        }

        .cal-modal .services{
          display:grid; grid-template-columns:1fr; gap:8px;
        }
        .cal-modal .svc{
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:10px; border:1px solid #eee; border-radius:12px; background:#fff;
        }
        .cal-modal .svc-title{ display:flex; align-items:center; gap:10px; flex:1; min-width:0; }
        .cal-modal .color-dot{ width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
        .cal-modal .svc-name{ font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .cal-modal .svc-meta{ color:#6b7280; font-size:12px; white-space:nowrap; }

        .cal-modal .note-inline{ margin-top:4px; font-size:12px; color:#4b5563; background:#fffbea; border:1px solid #fde68a; padding:6px 8px; border-radius:8px; }

        .cal-modal .client-search-wrap{ position:relative; }
        .cal-modal .dropdown{
          position:absolute; top:100%; left:0; right:0; z-index:20;
          background:#fff; border:1px solid var(--border); border-radius:12px; box-shadow:0 12px 30px rgba(0,0,0,.12); margin-top:6px;
          max-height:45vh; overflow:auto;
        }
        .cal-modal .drop-item{ padding:12px 14px; cursor:pointer; border-bottom:1px solid #f7f3ed; display:flex; flex-direction:column; gap:4px; }
        .cal-modal .drop-item:first-child{ font-weight:700; border-bottom:1px solid #f1ebe4; background:#faf6f0; }
        .cal-modal .drop-item:hover{ background:#faf6f0; }

        .cal-modal .footer{
          position:sticky; bottom:0; z-index:5;
          background:linear-gradient(0deg,#fff 80%, #ffffffcc 100%);
          border-top:1px solid #efeae3; padding:10px 14px;
          display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap;
        }
        .cal-modal .footer-left{
          display:flex; gap:8px; flex-wrap:wrap;
        }
        .cal-modal .footer-right{ display:flex; gap:8px; min-width:200px; }

        /* --- Responsive --- */
        @media(max-width:820px){
          .cal-modal .grid{ grid-template-columns:1fr; gap:12px; }
        }
        @media(max-width:480px){
          .cal-modal .h{ padding:10px 12px; }
          .cal-modal .client-chip{ max-width:100%; padding:6px 9px; font-size:13px; }
          .cal-modal .icon-btn{ display:inline-flex; }
          .cal-modal .pill{ padding:5px 8px; font-size:12px; }
          .cal-modal .content{ padding:10px 12px; }
          .cal-modal .input, .cal-modal .select{ padding:12px; font-size:15px; min-height:40px; }
          .cal-modal .textarea{ padding:12px; font-size:15px; }
          .cal-modal .footer{ padding:12px; }
          .cal-modal .footer-right .btn-ghost{ display:none; }
          /* sakrij quick-pay dugmad zauvek na mob—izbacili smo ih */
          .cal-modal .footer-left{ display:none; }
          /* “prompt” dugmad izgled */
          .cal-modal .prompt-btn{
            width:100%; text-align:left; padding:12px; border:1px solid var(--border);
            background:#fff; border-radius:12px; font-weight:600;
          }
          .cal-modal .prompt-sub{ display:block; font-size:12px; color:#6b7280; margin-top:4px; font-weight:500; }
        }
        @media(min-width:821px){
          .cal-modal .services{ grid-template-columns:1fr 1fr; }
        }
      `}</style>

      <div className="modal cal-modal" onMouseDown={(e)=>e.stopPropagation()}>

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

          <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
            {(!isBlock && (form.isOnline || form.bookedVia === "public_app")) && (
              <span className="pill" title="Online rezervacija">🌐 Online</span>
            )}

            {form.id && !isBlock && (
              <button className="pill" onClick={markNoShow} title="Označi kao no-show">No-show ⚠️</button>
            )}
            {form.id && (
              <button className="pill danger" onClick={()=>onDelete?.(form.id)} title="Obriši">Obriši</button>
            )}

            <button className="icon-btn" onClick={onClose} title="Zatvori">✕</button>
            <button className="btn hide-mobile btn-ghost" onClick={onClose}>Zatvori</button>
          </div>
        </div>

        {/* ===== SCROLLABLE CONTENT ===== */}
        <div className="content">
          {/* === MOBILNI PROMPT REŽIM === */}
          {isMobile ? (
            <div className="grid">
              {/* Radnica */}
              <div className="row">
                <div className="label">Radnica</div>
                <button className="prompt-btn" onClick={promptEmployee}>
                  {selectedEmployee ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}` : "Izaberi radnicu"}
                </button>
              </div>

              {/* Klijent */}
              {!isBlock && (
                <div className="row">
                  <div className="label">Klijent</div>
                  <button className="prompt-btn" onClick={promptClient}>
                    {form.clientId ? formatClient(clientForUI || {}, role) : "Pronađi/izaberi klijenta"}
                  </button>
                </div>
              )}

              {/* Početak / Kraj */}
              <div className="row">
                <div className="label">Početak</div>
                <button className="prompt-btn" onClick={promptStart}>
                  {toLocalInput(form.start).replace("T"," ")}
                </button>
              </div>
              <div className="row">
                <div className="label">Kraj</div>
                <button className="prompt-btn" onClick={promptEnd}>
                  {toLocalInput(form.end).replace("T"," ")}
                </button>
                {manualEnd && (
                  <button className="pill" type="button" onClick={()=>setManualEnd(false)}>
                    ↻ Auto trajanje
                  </button>
                )}
              </div>

              {/* Usluge (prompt) */}
              {!isBlock && (
                <div className="row" style={{gridColumn:"1 / -1"}}>
                  <div className="label">Usluge</div>

                  {/* sticky totals */}
                  <div className="svc-totals">
                    <span>💰 Ukupno (auto): <b>{autoTotal} RSD</b></span>
                    <span>⏱️ Trajanje (auto): <b>{autoDurationMin} min</b></span>
                  </div>

                  <button className="prompt-btn" onClick={promptServices}>
                    Uredi usluge
                    <span className="prompt-sub">
                      {makeServicesLabel(services, form.services) || "Nije izabrano"}
                    </span>
                  </button>

                  {/* (na mob ne renderujemo dužu listu, sve ide kroz prompt) */}
                  {ghostServices.length>0 && (
                    <div className="note-inline" style={{ marginTop:8 }}>
                      Ovaj termin sadrži usluge koje nisu u trenutnom katalogu:{" "}
                      {ghostServices.map(g => g?.name || sid(g)).filter(Boolean).join(", ")}
                    </div>
                  )}
                </div>
              )}

              {/* Cena */}
              {!isBlock && (
                <div className="row">
                  <div className="label">Cena (RSD)</div>
                  <button className="prompt-btn" onClick={promptPrice}>
                    {Number(form.priceRsd||0)} RSD
                  </button>
                </div>
              )}

              {/* Plaćanje — samo jedno mesto (prompt) */}
              {!isBlock && showPayment && (
                <div className="row" style={{gridColumn:"1 / -1"}}>
                  <div className="label">Plaćanje</div>
                  <button className="prompt-btn" onClick={promptPayment}>
                    {form.paid==="cash" ? "Keš 💵" :
                     form.paid==="card" ? "Kartica 💳" :
                     form.paid==="bank" ? "Uplata na račun 🏦" :
                     "Nije naplaćeno"}
                  </button>
                </div>
              )}

              {/* Beleška (prompt) */}
              <div className="row" style={{gridColumn:"1 / -1"}}>
                <div className="label">Beleška</div>
                <button className="prompt-btn" onClick={promptNote}>
                  {form.note?.trim() ? "Izmeni belešku" : "Dodaj belešku"}
                  {form.note?.trim() && <span className="prompt-sub">{form.note}</span>}
                </button>
              </div>
            </div>
          ) : (
          /* === DESKTOP — postojeći detaljni UI === */
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
                              <div className="muted" style={{ marginTop:3 }}>
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
                    <div className="new-client-grid" style={{display:"grid", gap:10}}>
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
                  <button className="pill" type="button" onClick={()=>setManualEnd(false)}>
                    ↻ Auto trajanje
                  </button>
                )}
              </div>

              {/* Usluge */}
              {!isBlock && (
                <div className="row" style={{gridColumn:"1 / -1"}}>
                  <div className="label">Usluge</div>

                  {/* sticky totals */}
                  <div className="svc-totals">
                    <span>💰 Ukupno (auto): <b>{autoTotal} RSD</b></span>
                    <span>⏱️ Trajanje (auto): <b>{autoDurationMin} min</b></span>
                  </div>

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
                              style={{ width:18, height:18, marginRight:6 }}
                            />
                            <span className="color-dot" style={{background:color}}/>
                            <span className="svc-name">{s.name}</span>
                          </span>
                          <span className="svc-meta">{s.durationMin}min · {s.priceRsd} RSD</span>
                        </label>
                      );
                    })}
                    {filteredServices.length===0 && (
                      <div className="muted" style={{padding:"16px", textAlign:"center"}}>
                        Nema definisanih usluga za ovu radnicu.
                      </div>
                    )}

                    {ghostServices.length>0 && (
                      <div className="note-inline" style={{ marginTop:8 }}>
                        Ovaj termin sadrži usluge koje nisu u trenutnom katalogu:{" "}
                        {ghostServices.map(g => g?.name || sid(g)).filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cena / plaćanje */}
              {!isBlock && (
                <>
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
                      <div className="payment-options" style={{display:"grid", gap:10}}>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid" checked={form.paid===null}  onChange={()=>setForm(f=>({...f,paid:null}))}/>
                          <span style={{marginLeft:10}}>nije naplaćeno</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid" checked={form.paid==="cash"} onChange={()=>setForm(f=>({...f,paid:"cash"}))}/>
                          <span style={{marginLeft:10}}>keš 💵</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid" checked={form.paid==="card"} onChange={()=>setForm(f=>({...f,paid:"card"}))}/>
                          <span style={{marginLeft:10}}>kartica 💳</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid" checked={form.paid==="bank"} onChange={()=>setForm(f=>({...f,paid:"bank"}))}/>
                          <span style={{marginLeft:10}}>uplata na račun 🏦</span>
                        </label>
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
          )}
        </div>

        {/* ===== FOOTER ===== */}
        <div className="footer">
          {/* uklonjeno: quick-pay dugmad na dnu */}
          <div className="footer-right">
            <button className="btn btn-ghost" onClick={onClose}>Otkaži</button>
            <button className="btn btn-primary" disabled={saving} onClick={save}>
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
