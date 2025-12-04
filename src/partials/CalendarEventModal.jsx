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
function groupServicesByCategory(selectedIds, allServices) {
  const byId = new Map((allServices || []).map(s => [s.id, s]));
  const groups = new Map(); // Map<categoryId, {categoryId, services: Service[]}>
  for (const id of (selectedIds || [])) {
    const s = byId.get(id);
    if (!s) continue;
    const k = s.categoryId || "__no_cat__";
    if (!groups.has(k)) groups.set(k, { categoryId: k, services: [] });
    groups.get(k).services.push(s);
  }
  return [...groups.values()];
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

  // početni autosum (za zaključavanje custom cene)
  const initialAutoSum = useMemo(() => {
    if (value?.type === "block") return 0;
    const byId = new Map((services || []).map(s => [s.id, s]));
    return (initialServiceIds || []).reduce((acc, id) => {
      const s = byId.get(id);
      return acc + (Number(s?.priceRsd) || 0);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, value?.id]);

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

  // custom price locking
  const [customPrice, setCustomPrice] = useState(() => {
    const existing = Number(value?.priceRsd ?? 0);
    return existing > 0 && existing !== initialAutoSum;
  });

  useEffect(() => {
    if (isBlock) return;

    const byId = new Map((services || []).map(s => [s.id, s]));
    const sum = (form.services || []).reduce((acc, id) => {
      const s = byId.get(id);
      return acc + (Number(s?.priceRsd) || 0);
    }, 0);

    const existing = Number(value?.priceRsd ?? form.priceRsd ?? 0);

    if (existing > 0 && existing !== sum) {
      setCustomPrice(true);
      setForm(f => ({ ...f, priceRsd: existing }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.id, services]);

  const [manualEnd, setManualEnd] = useState(!!value?.manualEnd);
  // --- original times for edit-confirm ---
const [originalStart, setOriginalStart] = useState(null);
const [originalEnd, setOriginalEnd] = useState(null);
const [originalEmployee, setOriginalEmployee] = useState(null);
// kad se promeni "value" (npr. otvoren drugi termin), zapamti početne vrednosti
useEffect(() => {
  setOriginalStart(value?.start || null);
  setOriginalEnd(value?.end || null);
  setOriginalEmployee(value?.employeeUsername || null);
}, [value?.id]);

function hasTimeChanged() {
  if (!originalStart || !originalEnd) return false;        // samo za postojeći termin
  const a = new Date(originalStart).getTime();
  const b = new Date(originalEnd).getTime();
  const c = new Date(form.start).getTime();
  const d = new Date(form.end).getTime();
  return a !== c || b !== d;
}
function hasEmployeeChanged() {
  // ako je novi termin, originalEmployee je null i ne pitamo
  if (!value?.id) return false;
  return (originalEmployee ?? null) !== (form.employeeUsername ?? null);
}
  const [svcQuery, setSvcQuery] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientListOpen, setClientListOpen] = useState(false);

  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 480 : false;
useEffect(() => {
  if (!isMobile) {
    const hasSelected = Array.isArray(form.services) && form.services.length > 0;
    setDesktopSvcsOpen(!hasSelected);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isMobile, value?.id]);
useEffect(() => {
  if (!isMobile && (!form.services || form.services.length === 0)) {
    setDesktopSvcsOpen(true);
  }
}, [isMobile, form.services?.length]);

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
    const knownIds = new Set((services||[]).map(s=>s.id));
    const fromValue = Array.isArray(value?.services) ? value.services : [];
    if (!fromValue.length) return [];
    return fromValue.filter(s => typeof s === "object" && !knownIds.has(sid(s)));
  }, [value?.services, services]);

  // Izabrane usluge kao objekti iz kataloga
  const selectedServiceObjs = useMemo(() => {
    const byId = new Map((services || []).map(s => [s.id, s]));
    return (form.services || []).map(id => byId.get(id)).filter(Boolean);
  }, [form.services, services]);

  // Grupisano po kategoriji
  const groupedByCat = useMemo(() => {
    const m = new Map(); // Map<categoryId, Service[]>
    for (const s of selectedServiceObjs) {
      const k = s?.categoryId || "__no_cat__";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return m;
  }, [selectedServiceObjs]);

  /* ---------- actions ---------- */
function onServiceToggle(id, checked) {
  setForm((f) => {
    let nextServices;
    if (serviceMode === "replace") {
      nextServices = checked ? [id] : [];
    } else {
      const set = new Set(f.services || []);
      if (checked) set.add(id);
      else set.delete(id);
      nextServices = Array.from(set);
    }

    // preračunaj sumu za nove usluge
    const map = new Map((services || []).map(s => [s.id, s]));
    const nextSum = (nextServices || []).reduce((sum, sid) => sum + (Number(map.get(sid)?.priceRsd) || 0), 0);

    return {
      ...f,
      services: nextServices,
      // u "replace" modu prepiši cenu na automatsku i otključaj auto trajanje
      ...(serviceMode === "replace" ? { priceRsd: nextSum, } : {}),
    };
  });

  // uvek vrati auto-kraj da se vreme prilagodi izboru usluga
  if (manualEnd) setManualEnd(false);
  // ako želiš da i u "replace" režimu uvek ide auto-cena:
  if (serviceMode === "replace") setCustomPrice(false);
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
    // === BLOKADA ostaje ista ===
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

    // Ako edituješ postojeći doc, zadrži postojeći behavior (jedan doc)
    // – da ne bismo neočekivano brisali i kreirali više novih.
    const editingExisting = !!form.id;
 // ako je edit i promenjeno je vreme I/ILI radnica -> pitaj korisnika
 if (editingExisting && (hasTimeChanged() || hasEmployeeChanged())) {
   const both = hasTimeChanged() && hasEmployeeChanged();
   const msg = both
     ? "Promenili ste vreme i radnicu. Da li želite da sačuvate ove promene?"
     : hasEmployeeChanged()
         ? "Promenili ste radnicu. Da li želite da sačuvate ovu promenu?"
         : "Promenili ste vreme. Da li želite da sačuvate ovu promenu?";
   const ok = window.confirm(msg);
   if (!ok) {
     setSaving(false);
     return; // prekini čuvanje
   }
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

    // === Ako je EDIT -> jedan doc kao i do sada ===
    if (editingExisting) {
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
    paid: (role === "admin" || role === "salon") ? (form.paid ?? null) : null,
    note: form.note || "",
    updatedAt: serverTimestamp(),
    noShow: !!form.noShow,
    isOnline,
    bookedVia: form.bookedVia ?? value?.bookedVia ?? null,
    status,
    totalAmountRsd: Number(form.priceRsd) || 0,
    totalDurationMin: Math.max(15, totalDurationMin),
    servicesLabel,
    paymentStatus, paymentMethod, isPaid,
  };

  await setDoc(doc(db,"appointments", form.id), payload, { merge:true });

  /* ====== OVDJE UBACI NOTIF BLOK ====== */
  try {
    const actorRole = role; // "admin" | "salon" | "worker"
    const oldEmp = originalEmployee ?? null;
    const newEmp = form.employeeUsername ?? null;
    const timeChanged = hasTimeChanged();
    const empChanged  = hasEmployeeChanged();

    const fmt = (d)=>{
      try{
        const x = new Date(d);
        const dd = String(x.getDate()).padStart(2,"0");
        const mm = String(x.getMonth()+1).padStart(2,"0");
        const yyyy = x.getFullYear();
        const hh = String(x.getHours()).padStart(2,"0");
        const min = String(x.getMinutes()).padStart(2,"0");
        return `${dd}.${mm}.${yyyy}. ${hh}:${min}`;
      }catch{ return ""; }
    };
    const titleDate = `${fmt(form.start)}–${fmt(form.end)}`;

    // ime radnice za poruku ka adminu
    const empObj = (employees||[]).find(e=>e.username===newEmp || e.username===oldEmp);
    const empName = empObj ? `${empObj.firstName||""} ${empObj.lastName||""}`.trim() : (newEmp || "radnica");

    // ime klijenta (lepši body)
    const clientName =
      (clientForUI?.firstName || value?.clientName || "")
      + (clientForUI?.lastName ? ` ${clientForUI.lastName}` : "");

    let payloadNotif = null;

    if (actorRole === "admin" || actorRole === "salon") {
      if (empChanged) {
        // premešteno drugoj radnici -> samo novoj radnici
        payloadNotif = {
          kind: "toEmployee",
          employeeUsername: newEmp,
          title: "Dodeljen vam je novi termin",
          body: clientName ? `${clientName} • ${titleDate}` : `${titleDate}`,
          screen: "/admin",
          reason: "ADMIN_MOVED_TO_NEW_EMP"
        };
      } else if (timeChanged) {
        // istoj radnici pomereno vreme
        payloadNotif = {
          kind: "toEmployee",
          employeeUsername: newEmp,
          title: "Vaš termin je pomeren",
          body: clientName ? `${clientName} • ${titleDate}` : `${titleDate}`,
          screen: "/admin",
          reason: "ADMIN_RESCHEDULED"
        };
      }
    } else if (actorRole === "worker") {
      if (timeChanged || empChanged) {
        // radnica je pomerila -> ide adminu
        payloadNotif = {
          kind: "toAdmin",
          title: "Radnica je pomerila termin",
          body: `${empName} • ${titleDate}`,
          screen: "/admin",
          reason: "WORKER_RESCHEDULED"
        };
      }
    }

    if (payloadNotif) {
      await fetch("/api/pushMoveNotif", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payloadNotif)
      });
    }
  } catch (e) {
    console.warn("pushMoveNotif error:", e);
  }
  /* ====== /NOTIF BLOK ====== */

  onSaved?.();
  return;
}
    // === HELPER: notifikacije za NOV termin (admin/salon kreira) ===
    async function notifyOnNewAppointment(startTime, endTime) {
      // Samo ako je neko iz salona/admina kreirao
      if (role !== "admin" && role !== "salon") return;

      const fmt = (d) => {
        try {
          const x = new Date(d);
          const dd = String(x.getDate()).padStart(2, "0");
          const mm = String(x.getMonth() + 1).padStart(2, "0");
          const yyyy = x.getFullYear();
          const hh = String(x.getHours()).padStart(2, "0");
          const min = String(x.getMinutes()).padStart(2, "0");
          return `${dd}.${mm}.${yyyy}. ${hh}:${min}`;
        } catch {
          return "";
        }
      };

      const titleDate = `${fmt(startTime)}–${fmt(endTime)}`;

      const clientName =
        (clientForUI?.firstName || value?.clientName || "") +
        (clientForUI?.lastName ? ` ${clientForUI.lastName}` : "");

      const body = clientName ? `${clientName} • ${titleDate}` : titleDate;

      const employeeUsername =
        form.employeeUsername || (employees[0]?.username || "");

      try {
        // 1) radnica
        await fetch("/api/pushMoveNotif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "toEmployee",
            employeeUsername,
            title: "Imate novi termin",
            body,
            screen: "/admin",
            reason: "ADMIN_CREATED",
          }),
        });

        // 2) admin
        await fetch("/api/pushMoveNotif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "toAdmin",
            title: "Salon je zakazao novi termin",
            body,
            screen: "/admin",
            reason: "ADMIN_CREATED",
          }),
        });
      } catch (e) {
        console.warn("pushMoveNotif NEW error:", e);
      }
    }
    // === /HELPER ===


    // === NOV TERMIN -> RAZDVOJI PO KATEGORIJAMA ===
    const groups = groupServicesByCategory(form.services, services);

    // Ako zapravo ima samo jedna kategorija, ponašaj se kao i do sada (jedan doc)
    if (groups.length <= 1) {
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
        isOnline, bookedVia: form.bookedVia ?? value?.bookedVia ?? null, status,
        totalAmountRsd: Number(form.priceRsd) || 0,
        totalDurationMin: Math.max(15, totalDurationMin),
        servicesLabel,
        paymentStatus, paymentMethod, isPaid,
      };

      await addDoc(collection(db,"appointments"), { ...payload, createdAt: serverTimestamp() });
        await notifyOnNewAppointment(form.start, form.end);
      onSaved?.();
      return;
    }

    // Više kategorija -> napravi više DOC-ova, naslaganih po vremenu
    const groupId = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `grp_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

    let cursor = new Date(form.start);
    let totalSum = 0;

    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const svcIds = g.services.map(s => s.id);
      const gDuration = g.services.reduce((a,s)=> a + (Number(s.durationMin)||0), 0) || 15;
      const gSum = g.services.reduce((a,s)=> a + (Number(s.priceRsd)||0), 0);
      totalSum += gSum;

      const gStart = new Date(cursor);
      const gEnd = new Date(gStart.getTime() + gDuration*60000);
      cursor = gEnd;

      const servicesLabel = makeServicesLabel(services, svcIds);

      const payload = {
        type: "appointment",
        employeeUsername: form.employeeUsername || (employees[0]?.username || ""),
        clientId: clientId || null,
        services: svcIds,
        start: gStart,
        end: gEnd,
        priceRsd: gSum,                     // cena po kartici (po kategoriji)
        source: "manual",
        pickedEmployee: false,
        paid: _canSetPayment ? (form.paid ?? null) : null,
        note: form.note || "",
        updatedAt: serverTimestamp(),
        noShow: !!form.noShow,
        isOnline, bookedVia: form.bookedVia ?? value?.bookedVia ?? null, status,
        totalAmountRsd: gSum,
        totalDurationMin: Math.max(15, gDuration),
        servicesLabel,
        paymentStatus, paymentMethod, isPaid,
        // meta za grupu
        groupId,
        groupIndex: i,
        groupCount: groups.length,
        categoryId: g.categoryId || null,
      };

      await addDoc(collection(db,"appointments"), { ...payload, createdAt: serverTimestamp() });
    }

    // (opciono) mogao bi da upišeš i zbir u poslednju karticu ili da ga ignorišeš;
    // kalendar će sada videti više dokumenata i iscrtaće više kartica.
    await notifyOnNewAppointment(form.start, cursor);
    onSaved?.();
  }catch(e){
    console.error(e);
    alert("Greška pri čuvanju.");
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
    setClientDrawerOpen(true);
  }

  const selectedClient = (clients || []).find(c => c.id === form.clientId);

  const fallbackFromAppointment = useMemo(() => {
    const full = String(value?.clientName || "").trim();
    const [first, ...rest] = full.split(/\s+/);
    if (!form.clientId && !full && !value?.clientPhone && !value?.clientEmail) return null;
    return {
      id: form.clientId || null,
      firstName: first || "",
      lastName: (rest.join(" ") || ""),
      phone: value?.clientPhone || "",
      email: value?.clientEmail || "",
    };
  }, [form.clientId, value?.clientName, value?.clientPhone, value?.clientEmail]);

  const clientForUI = clientLive || selectedClient || fallbackFromAppointment;

  useEffect(()=>{
    if (!clientForUI || !clientForUI.id) return;
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

  /* ===== MOBILNI: expandable sekcije ===== */
  const [openEmp, setOpenEmp] = useState(false);
  const [openClient, setOpenClient] = useState(false);
  const [openTime, setOpenTime] = useState(false);
  const [openSvcs, setOpenSvcs] = useState(false);
  const [openPrice, setOpenPrice] = useState(false);
  // Režim rada za izbor usluga: "add" (dodaj) ili "replace" (promeni)
const [serviceMode, setServiceMode] = useState(value?.id ? "replace" : "add");

useEffect(() => {
  // pri otvaranju postojećeg termina: samo podesi režim i auto-kraj, ne diraj usluge
  setMode(value?.id ? "replace" : "add", { squashSelection: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [value?.id]);



// ⬇️ dodaj odmah iznad ovog bloka
// ⬇️ REPLACE stari setMode ovim
function setMode(next, { squashSelection = true } = {}) {
  setServiceMode(next);

  if (next === "replace") {
    if (manualEnd) setManualEnd(false);
    if (squashSelection) {
      setForm(f => {
        const arr = Array.isArray(f.services) ? f.services : [];
        return arr.length <= 1 ? f : { ...f, services: [arr[arr.length - 1]] };
      });
    }
  }

  if (next === "add" && manualEnd) {
    setManualEnd(false);
  }
}



// ⬇️ ovo zamenjuje tvoj stari toggle
function ServiceModeToggle() {
  return (
    <div className="svc-mode-toggle">
      <button
        type="button"
        className={`svc-mode-btn ${serviceMode === "replace" ? "active" : ""}`}
        onClick={() => setMode("replace")}   // seče izbor – namerno, jer je user kliknuo
      >🔄 Promeni</button>

      <button
        type="button"
        className={`svc-mode-btn ${serviceMode === "add" ? "active" : ""}`}
        onClick={() => setMode("add")}
      >➕ Dodaj</button>
    </div>
  );
}




  const [openPay, setOpenPay] = useState(false);
  const [openNote, setOpenNote] = useState(false);
// Desktop: da li je otvoren kompletan meni za usluge
const [desktopSvcsOpen, setDesktopSvcsOpen] = useState(false);

  function SelectedServiceCards() {
    if (!selectedServiceObjs.length) return null;
    return (
      <div className="svc-groups">
        {[...groupedByCat.entries()].map(([catId, arr]) => {
          const catName = categoriesMap.get(catId)?.name || "Bez kategorije";
          const subDur = arr.reduce((a, s) => a + (Number(s.durationMin) || 0), 0);
          const subSum = arr.reduce((a, s) => a + (Number(s.priceRsd) || 0), 0);
          return (
            <div key={catId} className="svc-card">
              <div className="svc-card__head">
                <div className="svc-card__title">{catName}</div>
                <div className="svc-card__sum">
                  {subDur} min · {subSum.toLocaleString("sr-RS")} RSD
                </div>
              </div>
              <div className="svc-card__body">
                {arr.map(s => (
                  <div key={s.id} className="svc-row">
                    <div className="svc-row__name">{s.name}</div>
                    <div className="svc-row__meta">
                      {s.durationMin} min · {Number(s.priceRsd||0).toLocaleString("sr-RS")} RSD
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ---------- UI ---------- */
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <style>{`
:root{
  --ink:#1f1f1f; --muted:#6b6b6b; --bg:#fff; --border:#e6e0d7; --soft:#faf6f0; --focus: rgba(199,178,153,.35);
  --chip:#f5f7ff; --chip-border:#dbe3ff;
}
* { -webkit-tap-highlight-color: transparent; }

/* --- GLOBAL --- */
.cal-modal input:not([type="radio"]):not([type="checkbox"]),
.cal-modal select, .cal-modal textarea, .cal-modal button{
  color:var(--ink)!important; -webkit-text-fill-color:var(--ink)!important; appearance:none; -webkit-appearance:none; outline:none;
}
.cal-modal input[type="checkbox"], .cal-modal input[type="radio"]{
  appearance:auto; -webkit-appearance:auto; accent-color:#1f1f1f; width:18px; height:18px; outline:none;
}
.cal-modal :is(input,select,textarea):focus{ box-shadow:0 0 0 3px var(--focus); border-color:#c7b299; }
::selection{ background:#f3e8d7; color:#000; }

/* --- SERVICES --- */
.svc-groups{ display:grid; gap:10px; margin-top:10px; }
.svc-card{ border:1px solid var(--border); border-radius:12px; background:#fff; overflow:hidden; }
.svc-card__head{ display:flex; justify-content:space-between; align-items:center; padding:10px 12px; background:#faf6f0; border-bottom:1px solid #f1eee8; font-weight:700; }
.svc-card__title{ font-weight:800; }
.svc-card__sum{ font-weight:800; }
.svc-card__body{ padding:8px 12px; display:grid; gap:8px; }
.svc-row{ display:flex; justify-content:space-between; align-items:center; }
.svc-row__name{ font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.svc-row__meta{ opacity:.8; white-space:nowrap; }

.modal-backdrop{ position:fixed; inset:0; background:#0007; display:flex; align-items:stretch; justify-content:flex-end; padding:0; z-index:1000; }
.cal-modal.modal{ background:var(--bg); width:100%; max-width:900px; height:100%; border-left:1px solid var(--border); box-shadow:-14px 0 40px rgba(0,0,0,.18); display:flex; flex-direction:column; }

/* --- HEADER --- */
.cal-modal .h{ position:sticky; top:0; z-index:5; display:flex; gap:10px; justify-content:space-between; align-items:center; padding:12px 14px; background:var(--bg); border-bottom:1px solid #efeae3; }
.cal-modal .title-left{ display:flex; flex-direction:column; gap:6px; flex:1; }
.cal-modal .client-chip{ display:inline-flex; align-items:center; gap:8px; padding:7px 10px; background:var(--chip); border:1px solid var(--chip-border); border-radius:999px; font-size:18px; max-width:320px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-modal .client-info-row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cal-modal .icon-btn{ display:none; align-items:center; justify-content:center; width:36px; height:36px; border:1px solid var(--border); border-radius:10px; background:#fff; font-size:18px; }

/* --- CONTENT --- */
.cal-modal .content{ flex:1 1 auto; overflow-y:auto; overflow-x:hidden; padding:14px; }
.cal-modal .grid{ display:grid; gap:10px; grid-template-columns:1fr 1fr; }
.cal-modal .label{ font-size:12px; color:#706a61; margin-bottom:4px; font-weight:600; }
.cal-modal .row{ display:grid; gap:6px; }
.muted{ color:#6b7280; font-size:12px; }

.cal-modal .input, .cal-modal .select, .cal-modal .textarea{
  width:100%; padding:10px 12px; border-radius:12px; border:1px solid var(--border); background:#fff; font-size:14px; min-height:40px; box-sizing:border-box;
}
.cal-modal .textarea{ min-height:84px; resize:vertical; }

.cal-modal .pill{ display:inline-flex; align-items:center; gap:6px; background:var(--soft); border:1px solid var(--border); padding:6px 10px; border-radius:999px; font-size:13px; cursor:pointer; }
.cal-modal .danger{ border-color:#ef4444; color:#ef4444; background:#fff; }
.cal-modal .btn{ padding:10px 12px; border-radius:12px; border:1px solid var(--border); background:#fff; cursor:pointer; min-width:110px; font-weight:700; }
.cal-modal .btn-primary{ color:#fff; border-color:#1f1f1f; }
.cal-modal .btn-ghost{ background:#fff; color:#1f1f1f; }

/* --- SERVICE LIST --- */
.cal-modal .svc-search{ position:relative; display:flex; align-items:center; gap:8px; margin-bottom:8px; }
.cal-modal .svc-search .icon{ position:absolute; left:12px; pointer-events:none; }
.cal-modal .svc-search .input-plain{ padding-left:34px; }
.cal-modal .svc-totals{ position:sticky; top:0; z-index:2; background:#fff; border:1px solid var(--border); border-radius:10px; padding:8px 10px; display:flex; align-items:center; justify-content:space-between; font-size:13px; margin-bottom:8px; }
/* --- SERVICE MODE TOGGLE --- */
.svc-mode-toggle{
  display:flex; gap:8px; margin:6px 0 10px 0; flex-wrap:wrap;
}
.svc-mode-btn{
  padding:6px 10px; border:1px solid var(--border); border-radius:10px;
  background:#fff; cursor:pointer; font-weight:700; font-size:13px;
}
.svc-mode-btn.active{
  background:var(--focus); border-color:#c7b299;
}

.svc-summary{ display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--border); background:#fff; border-radius:12px; padding:10px 12px; flex-wrap:wrap; }
.svc-summary__names{ font-weight:700; min-width:180px; }
.svc-summary__meta{ color:#6b7280; font-size:13px; }

.cal-modal .services{ display:grid; grid-template-columns:1fr; gap:8px; }
.cal-modal .svc{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px; border:1px solid #eee; border-radius:12px; background:#fff; }
.cal-modal .svc-title{ display:flex; align-items:center; gap:10px; flex:1; min-width:0; }
.cal-modal .color-dot{ width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
.cal-modal .svc-name{ font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cal-modal .svc-meta{ color:#6b7280; font-size:12px; white-space:nowrap; }

/* --- FOOTER --- */
.cal-modal .footer{ position:sticky; bottom:0; z-index:5; background:linear-gradient(0deg,#fff 80%, #ffffffcc 100%); border-top:1px solid #efeae3; padding:10px 14px; display:flex; gap:10px; justify-content:space-between; align-items:center; flex-wrap:wrap; }
.cal-modal .footer-right{ display:flex; gap:8px; min-width:200px; }

/* --- HEADER ACTIONS --- */
.cal-modal .h-actions{ display:flex; gap:14px; align-items:center; flex-wrap:nowrap; overflow-x:visible; padding:4px 0; }
.cal-modal .h-actions .pill, .cal-modal .h-actions .danger{ padding:8px 12px; font-size:14px; }
.cal-modal .h-actions .icon-btn{ flex:0 0 auto; }

/* --- RESPONSIVE --- */
@media(max-width:820px){
  .cal-modal .grid{ grid-template-columns:1fr; gap:12px; }
}

/* --- MOBILE (max 480px) --- */
@media(max-width:480px){
  .cal-modal .grid{ grid-template-columns:1fr !important; gap:14px; }

  .cal-modal .h-actions{ display:flex; gap:12px; row-gap:8px; align-items:center; flex-wrap:wrap; overflow-x:visible; padding-bottom:2px; padding-top:2px; justify-content:flex-start; }
  .cal-modal .h-actions > *{ margin-right:12px; }
  .cal-modal .h-actions > *:last-child{ margin-right:0; }
  .cal-modal .h-actions .pill, .cal-modal .h-actions .danger{ padding:8px 10px; font-size:13px; line-height:1.1; }

  .cal-modal .client-chip{ margin-right:8px; cursor:pointer; font-size:20px; padding:6px 9px; }

  .cal-modal .h{ padding:10px 12px; }
  .cal-modal .icon-btn{ display:inline-flex; }
  .cal-modal .pill{ padding:5px 8px; font-size:12px; }
  .cal-modal .content{ padding:10px 12px; }
  .cal-modal .input, .cal-modal .select{ padding:12px; font-size:15px; min-height:40px; }
  .cal-modal .textarea{ padding:12px; font-size:15px; }

  /* Veća cena */
  .cal-modal .expander-price .expander-sub{ font-size:20px; font-weight:800; }
  .cal-modal .price-input{ font-size:22px; font-weight:700; padding:14px 12px; }

  /* Prelamanje naziva usluge */
  .cal-modal .svc-name{
    white-space:normal;
    overflow:visible;
    text-overflow:clip;
    line-height:1.25;
  }
  .cal-modal .svc{ align-items:flex-start; }
  .cal-modal .svc-title{ align-items:flex-start; min-width:0; }
  .cal-modal .color-dot{ margin-top:2px; }

  /* expandable sekcije */
  .cal-modal .expander{
    width:100%; text-align:left; padding:12px; border:1px solid var(--border);
    background:#fff; border-radius:12px; font-weight:700; display:flex; justify-content:space-between; align-items:center;
  }
  .cal-modal .expander-sub{ display:block; font-size:15px; color:#6b7280; margin-top:4px; font-weight:500; }
  .cal-modal .section{ border:1px solid var(--border); border-radius:12px; padding:10px; background:#fff; }
}
`}</style>

      <div className="modal cal-modal" onMouseDown={(e)=>e.stopPropagation()}>

        {/* ===== HEADER ===== */}
        <div className="h">
          <div className="title-left">
            <div style={{fontWeight:700, fontSize:16}}>
              {isBlock ? (form.id ? "Blokada" : "Nova blokada") : (form.id ? "Termin" : "Novi termin")}
            </div>

            {/* === MOBILNI: client chip ispod akcicl === */}
            {isMobile ? (
              <>
                <div className="h-actions">
                  {(!isBlock && (form.isOnline || form.bookedVia === "public_app")) && (
                    <span className="pill" title="Online rezervacija">🌐 Online</span>
                  )}
                  {form.id && !isBlock && (
                    <button className="pill" onClick={markNoShow} title="Označi kao no-show">No-show ⚠️</button>
                  )}
                  {form.id && (
                    <button className="pill danger" onClick={()=>onDelete?.(form.id)} title="Obriši">Obriši</button>
                  )}
                </div>

                {!isBlock && clientForUI && (
                  <div
                    className="client-info-row"
                    style={{ marginTop: 6, flexDirection: "column", alignItems: "flex-start" }}
                  >
                    {form.clientId ? (
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

                    {clientForUI?.note?.trim() && (
                      <div className="muted" style={{ marginTop: 6, fontSize: "13px" }}>
                        📝 {clientForUI.note}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* === DESKTOP: klijent (levo) + akcije (desno) === */
              <div className="h-actions">
                {!isBlock && clientForUI && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginRight: 6 }}>
                    {form.clientId ? (
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

                    {clientForUI?.note?.trim() && (
                      <div className="muted" style={{ marginTop: 6, fontSize: "13px" }}>
                        📝 {clientForUI.note}
                      </div>
                    )}
                  </div>
                )}

                {(!isBlock && (form.isOnline || form.bookedVia === "public_app")) && (
                  <span className="pill" title="Online rezervacija">🌐 Online</span>
                )}
                {form.id && !isBlock && (
                  <button className="pill" onClick={markNoShow} title="Označi kao no-show">No-show ⚠️</button>
                )}
                {form.id && (
                  <button className="pill danger" onClick={()=>onDelete?.(form.id)} title="Obriši">Obriši</button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ===== SCROLLABLE CONTENT ===== */}
        <div className="content">
          {/* === MOBILNI: sekcije === */}
          {isMobile ? (
            <div className="grid">
              {/* Radnica */}
              <div className="row">
                <button className="expander" onClick={()=>setOpenEmp(v=>!v)}>
                  <span>
                    Radnica
                    <span className="expander-sub">
                      {selectedEmployee ? `${selectedEmployee.firstName} ${selectedEmployee.lastName}` : "Izaberi radnicu"}
                    </span>
                  </span>
                  <span>{openEmp ? "▴" : "▾"}</span>
                </button>
                {openEmp && (
                  <div className="section">
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
                )}
              </div>

              {/* Klijent */}
              {!isBlock && (
                <div className="row">
                  <button className="expander" onClick={()=>setOpenClient(v=>!v)}>
                    <span>
                      Klijent
                      <span className="expander-sub">
                        {clientForUI ? formatClient(clientForUI || {}, role) : "Pronađi/izaberi klijenta"}
                      </span>
                    </span>
                    <span>{openClient ? "▴" : "▾"}</span>
                  </button>

                  {openClient && (
                    <div className="section" style={{ position:"relative" }}>
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
                                    <div style={{ fontWeight:600 }}>{formatClient(c, role)}</div>
                                  </div>
                                  <div className="muted">{(c.servicesDoneCount ?? 0) > 0 ? `#${c.servicesDoneCount}` : ""}</div>
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
                        <div className="muted" style={{ color:"#ef4444", fontSize:"13px", padding:"8px", background:"#fef2f2", borderRadius:"6px", marginTop:8 }}>
                          ⚠️ Klijent je blokiran — ne može da zakaže termin.
                        </div>
                      )}

                      {newClientOpen && !form.clientId && (
                        <div className="new-client-grid" style={{display:"grid", gap:10, marginTop:8}}>
                          <input className="input" placeholder="Ime *" value={newClient.firstName} onChange={e=>setNewClient(v=>({...v, firstName:e.target.value}))}/>
                          <input className="input" placeholder="Prezime" value={newClient.lastName} onChange={e=>setNewClient(v=>({...v, lastName:e.target.value}))}/>
                          <input className="input" placeholder="Telefon *" inputMode="tel" value={newClient.phone} onChange={e=>setNewClient(v=>({...v, phone:e.target.value}))}/>
                          <input className="input" placeholder="Email (opciono)" inputMode="email" value={newClient.email} onChange={e=>setNewClient(v=>({...v, email:e.target.value}))}/>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Početak / Kraj */}
              <div className="row">
                <button className="expander" onClick={()=>setOpenTime(v=>!v)}>
                  <span>
                    Datum i vreme
                    <span className="expander-sub">
                      {toLocalInput(form.start).replace("T"," ")} → {toLocalInput(form.end).replace("T"," ")}
                    </span>
                  </span>
                  <span>{openTime ? "▴" : "▾"}</span>
                </button>

                {openTime && (
                  <div className="section">
                    <div className="row">
                      <div className="label">Početak</div>
                      <input
                        className="input" type="datetime-local"
                        value={toLocalInput(form.start)}
                        onChange={(e)=>setForm(f=>({...f, start:new Date(e.target.value)}))}
                      />
                    </div>

                    <div className="row" style={{marginTop:8}}>
                      <div className="label">Kraj</div>
                      <input
                        className="input" type="datetime-local"
                        value={toLocalInput(form.end)}
                        onChange={(e)=>{ setForm(f=>({...f, end:new Date(e.target.value)})); setManualEnd(true); }}
                      />
                      {manualEnd && (
                        <button className="pill" type="button" onClick={()=>setManualEnd(false)} style={{marginTop:8}}>
                          ↻ Auto trajanje
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Usluge (checkbox lista kao na desktopu) */}
              {!isBlock && (
                <div className="row">
                  <button className="expander" onClick={()=>setOpenSvcs(v=>!v)}>
                    <span>
                      Usluge
                      <span className="expander-sub">
                        {(makeServicesLabel(services, form.services) || "Nije izabrano")} · {autoDurationMin}min · {autoTotal} RSD
                      </span>
                    </span>
                    <span>{openSvcs ? "▴" : "▾"}</span>
                  </button>

              {openSvcs && (
  <div className="section">
    <div className="svc-totals">
      <span>⏱️ Trajanje (auto): <b>{autoDurationMin} min</b></span>
    </div>

    {/* Režim biranja usluga: "Promeni" ili "Dodaj" */}
    <ServiceModeToggle />

    <div className="svc-search">
      <span className="icon">🔍</span>
      <input
        className="input input-plain"
        placeholder="Pretraži usluge… (naziv ili kategorija)"
        value={svcQuery}
        onChange={(e)=>setSvcQuery(e.target.value)}
      />
      {svcQuery && (
        <button
          className="pill"
          onClick={()=>setSvcQuery("")}
          title="Obriši pretragu"
          style={{position:"absolute", right:8}}
        >
          ✕
        </button>
      )}
    </div>

    <div className="services">
      {filteredServices.map(s => {
        const color = (categoriesMap?.get?.(s.categoryId)?.color) || "#ddd";
        const checked = (form.services || []).includes(s.id);
        return (
          <label key={s.id} className="svc">
            <span className="svc-title">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e)=>onServiceToggle(s.id, e.target.checked)}
                style={{ width:18, height:18, marginRight:6 }}
              />
              <span className="color-dot" style={{ background: color }} />
              <span className="svc-name">{s.name}</span>
            </span>
            <span className="svc-meta">
              {s.durationMin}min · {s.priceRsd} RSD
            </span>
          </label>
        );
      })}

      {filteredServices.length === 0 && (
        <div className="muted" style={{ padding:"16px", textAlign:"center" }}>
          Nema definisanih usluga za ovu radnicu.
        </div>
      )}

      {ghostServices.length > 0 && (
        <div className="note-inline" style={{ marginTop:8 }}>
          Ovaj termin sadrži usluge koje nisu u trenutnom katalogu:{" "}
          {ghostServices.map(g => g?.name || sid(g)).filter(Boolean).join(", ")}
        </div>
      )}

      <SelectedServiceCards />
    </div>
  </div>
)}

                </div>
              )}

              {/* Cena */}
              {!isBlock && (
 <div className="row"> <button className="expander" onClick={()=>setOpenPrice(v=>!v)}> <span> Cena <span className="expander-sub">{Number(form.priceRsd||0)} RSD</span> </span> <span>{openPrice ? "▴" : "▾"}</span> </button> {openPrice && ( <div className="section"> <div className="label">Cena (RSD)</div> <input className="input" type="number" value={form.priceRsd} onChange={(e)=>{ setForm(f=>({...f, priceRsd:e.target.value})); setCustomPrice(true); }} disabled={!canEditPrice} /> <div className="muted" style={{marginTop:6}}> Ručno menjana cena ostaje (ne prepisujemo auto-ukupnom). </div> </div> )} </div>

              )}

              {/* Plaćanje — jedino mesto */}
              {!isBlock && showPayment && (
                <div className="row">
                  <button className="expander" onClick={()=>setOpenPay(v=>!v)}>
                    <span>
                      Plaćanje
                      <span className="expander-sub">
                        {form.paid==="cash" ? "Keš" : form.paid==="card" ? "Kartica" : form.paid==="bank" ? "Uplata na račun" : "Nije naplaćeno"}
                      </span>
                    </span>
                    <span>{openPay ? "▴" : "▾"}</span>
                  </button>
                  {openPay && (
                    <div className="section">
                      <div className="label">Način plaćanja</div>
                      <div style={{display:"grid", gap:10}}>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid_m" checked={form.paid===null}  onChange={()=>setForm(f=>({...f,paid:null}))}/>
                          <span style={{marginLeft:10}}>nije naplaćeno</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid_m" checked={form.paid==="cash"} onChange={()=>setForm(f=>({...f,paid:"cash"}))}/>
                          <span style={{marginLeft:10}}>keš 💵</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid_m" checked={form.paid==="card"} onChange={()=>setForm(f=>({...f,paid:"card"}))}/>
                          <span style={{marginLeft:10}}>kartica 💳</span>
                        </label>
                        <label className="svc" style={{alignItems:"center"}}>
                          <input type="radio" name="paid_m" checked={form.paid==="bank"} onChange={()=>setForm(f=>({...f,paid:"bank"}))}/>
                          <span style={{marginLeft:10}}>uplata na račun 🏦</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Beleškaeška */}
              <div className="row">
                <button className="expander" onClick={()=>setOpenNote(v=>!v)}>
                  <span>
                    Beleška
                    <span className="expander-sub">{form.note?.trim() ? form.note : "Dodaj belešku"}</span>
                  </span>
                  <span>{openNote ? "▴" : "▾"}</span>
                </button>
                {openNote && (
                  <div className="section">
                    <div className="label">Beleška</div>
                    <textarea className="textarea" value={form.note||""} onChange={(e)=>setForm(f=>({...f, note:e.target.value}))}/>
                  </div>
                )}
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
             {/* Usluge (DESKTOP: sažetak -> klik -> kompletan meni) */}
{!isBlock && (
  <div className="row" style={{gridColumn:"1 / -1"}}>
    <div className="label">Usluge</div>

    {/* Ako je meni zatvoren i postoje izabrane usluge -> prikaži sažetak */}
    {!desktopSvcsOpen && (form.services?.length > 0) ? (
      <div className="svc-summary">
        <div className="svc-summary__names">
          {makeServicesLabel(services, form.services)}
        </div>
        <div className="svc-summary__meta">
          ⏱️ {autoDurationMin} min · 💰 {autoTotal} RSD
        </div>
        <button className="pill" onClick={()=>setDesktopSvcsOpen(true)}>
          Promeni
        </button>
      </div>
    ) : (
      <>
        {/* Kompletan postojeći meni za usluge */}
        <div className="svc-totals">
          <span>💰 Ukupno (auto): <b>{autoTotal} RSD</b></span>
          <span>⏱️ Trajanje (auto): <b>{autoDurationMin} min</b></span>
        </div>
<ServiceModeToggle />
        <div className="svc-search">
          <span className="icon">🔍</span>
          <input
            className="input input-plain"
            placeholder="Pretraži usluge… (naziv ili kategorija)"
            value={svcQuery}
            onChange={(e)=>setSvcQuery(e.target.value)}
          />
          {svcQuery && (
            <button
              className="pill"
              onClick={()=>setSvcQuery("")}
              title="Obriši pretragu"
              style={{position:"absolute", right:8}}
            >
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

          {/* Prikaz kartica izabranih usluga po kategorijama (već imaš komponentu) */}
          <SelectedServiceCards />
        </div>

        {/* Dugme "Gotovo" – zatvara meni nazad u sažetak ako ima izabranih */}
        <div style={{display:"flex", justifyContent:"flex-end", marginTop:8}}>
          <button
            type="button"
            className="pill"
            onClick={()=> setDesktopSvcsOpen(!(form.services?.length > 0))}
            title="Zatvori meni usluga"
          >
            Gotovo
          </button>
        </div>
      </>
    )}
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
                <div className="label">Beleška</div>
                <textarea className="textarea" value={form.note||""} onChange={(e)=>setForm(f=>({...f, note:e.target.value}))}/>
              </div>
            </div>
          )}
        </div>

        {/* ===== FOOTER ===== */}
        <div className="footer">
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
