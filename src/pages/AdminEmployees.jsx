// src/pages/AdminEmployees.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection, query, orderBy, onSnapshot,
  doc, setDoc, serverTimestamp, deleteDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";

/* ============== helpers ============== */
const isMobile = () =>
  (typeof window !== "undefined")
    ? window.matchMedia("(max-width: 760px)").matches
    : false;

function cls(...x){ return x.filter(Boolean).join(" "); }
function Pill({ active, children, onClick, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cls("pill", active && "pill--active")}
    >
      {children}
    </button>
  );
}
function Empty({ children }) { return <div className="empty">{children}</div>; }

/* ============== Drawer (PORTAL) za biranje usluga ============== */
function ServicePickerDrawer({ open, onClose, categories, servicesByCat, value, onSave }) {
  const [sel, setSel] = useState(new Set(value || []));
  const [search, setSearch] = useState("");
  const [openCats, setOpenCats] = useState({});

  useEffect(() => { setSel(new Set(value || [])); }, [value, open]);

  const q = search.trim().toLowerCase();

  function toggleService(id) {
    setSel(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function setWholeCategory(catId, addAll) {
    const ids = (servicesByCat.get(catId) || []).map(s => s.id);
    setSel(prev => {
      const next = new Set(prev);
      ids.forEach(id => addAll ? next.add(id) : next.delete(id));
      return next;
    });
  }

  if (!open) return null;

  const UI = (
    <div className="drawer-veil" onClick={onClose}>
      <aside className="drawer" onClick={(e)=>e.stopPropagation()} role="dialog" aria-label="Izbor usluga">
        <header className="drawer__header">
          <div className="drawer__title">
            Dodaj usluge
            <span className="drawer__subtitle">izabrano: {sel.size}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zatvori">✕</button>
        </header>

        <div className="search-wrap">
          <input className="input" placeholder="Pretraži usluge ili kategorije…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>

        <div className="drawer__body">
          {categories.map(cat => {
            const all = servicesByCat.get(cat.id) || [];
            const catMatch = cat.name.toLowerCase().includes(q);
            const list = q ? all.filter(s => s.name.toLowerCase().includes(q) || catMatch) : all;

            const allIn = all.length>0 && all.every(s => sel.has(s.id));
            const someIn = all.some(s => sel.has(s.id));
            const isOpen = openCats[cat.id] ?? true;

            if (!catMatch && q && list.length === 0) return null;

            return (
              <section key={cat.id} className="cat">
                <div className="cat__head" onClick={() => setOpenCats(m => ({...m, [cat.id]: !isOpen}))}>
                  <div className="cat__title">
                    <span className="chev">{isOpen ? "▾" : "▸"}</span>
                    <span>{cat.name}</span>
                    {someIn && <span className="cat__count">{all.filter(s=>sel.has(s.id)).length}/{all.length}</span>}
                  </div>
                  <div className="cat__actions" onClick={(e)=>e.stopPropagation()}>
                    <Pill active={allIn} onClick={()=>setWholeCategory(cat.id, !allIn)}>
                      {allIn ? "Sve odznači" : "Označi sve"}
                    </Pill>
                  </div>
                </div>

                {isOpen && (
                  <div className="chips">
                    {list.map(s => (
                      <Pill key={s.id} active={sel.has(s.id)} onClick={()=>toggleService(s.id)}>
                        {s.name}
                      </Pill>
                    ))}
                    {list.length === 0 && <Empty>Nema rezultata u ovoj kategoriji.</Empty>}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <footer className="drawer__footer">
          <button className="btn btn--ghost" onClick={onClose}>Otkaži</button>
          <div className="spacer" />
          <button className="btn btn--primary" onClick={()=>onSave?.(Array.from(sel))}>Sačuvaj izbor</button>
        </footer>
      </aside>

      <style>{`
        .drawer-veil{position:fixed;inset:0;background:rgba(0,0,0,.28);backdrop-filter:blur(2px);display:flex;justify-content:flex-end;z-index:1000;}
        .drawer{width:min(720px,96vw);height:100%;background:#fff;border-left:1px solid #eee;display:flex;flex-direction:column;animation:slideIn .2s ease;}
        @keyframes slideIn{from{transform:translateX(8px);opacity:.8}to{transform:translateX(0);opacity:1}}
        @media (max-width:760px){ 
          .drawer{width:100%;border-radius:16px 16px 0 0;align-self:flex-end;height:90vh;animation:rise .22s ease;padding-bottom:8px;}
          .drawer-veil{align-items:flex-end;}
          @keyframes rise{from{transform:translateY(8px);opacity:.9} to{transform:translateY(0);opacity:1}}
        }
        .drawer__header{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f1eee8;background:#faf8f5;}
        .drawer__title{font-weight:700;font-size:16px;display:flex;gap:10px;align-items:center}
        .drawer__subtitle{font-weight:500;color:#8a8378;font-size:12px;background:#f1eee8;padding:4px 8px;border-radius:999px}
        .icon-btn{border:0;background:#fff;border:1px solid #ddd6cc;border-radius:10px;padding:8px 10px;cursor:pointer}
        .search-wrap{padding:10px 12px;border-bottom:1px solid #f5f2ed}
        .input{width:100%;padding:11px 12px;border-radius:12px;border:1px solid #e6e0d7;background:#fff}
        .drawer__body{padding:8px 12px;overflow-y:auto}
        .cat{border:1px solid #eee;border-radius:14px;margin:10px 0;overflow:hidden}
        .cat__head{display:flex;align-items:center;justify-content:space-between;background:#fff;padding:10px 12px;cursor:pointer}
        .cat__title{display:flex;align-items:center;gap:8px;font-weight:600}
        .cat__count{font-size:12px;color:#6f6b63;background:#f1eee8;border-radius:999px;padding:2px 8px}
        .cat__actions{display:flex;gap:8px}
        .chips{display:flex;gap:8px;flex-wrap:wrap;padding:10px}

        .pill{padding:8px 12px;border-radius:999px;border:1px solid #ddd6cc;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#1f1f1f;}
        .pill--active{background:#f2f2f2;color:#1f1f1f;border-color:#ccc;box-shadow: inset 0 0 0 2px rgba(0,0,0,.03);}
        .pill:active{background:#f5f5f5}

        .empty{opacity:.65;font-size:13px;padding:8px}
        .drawer__footer{display:flex;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid #f1eee8;background:#faf8f5}
        .spacer{flex:1}
        .btn{
          background:#fff;
          color:#1f1f1f;
          -webkit-text-fill-color:#1f1f1f;
          border:1px solid #ddd6cc;
          padding:12px 16px;
          border-radius:14px;
          cursor:pointer;
          font-weight:700;
          font-size:14px;
        }
        .btn:active{ background:#f7f7f7; }
        .btn--primary{
          background:#fff;
          color:#1f1f1f;
          -webkit-text-fill-color:#1f1f1f;
          border:1px solid #1f1f1f;
        }
      `}</style>
    </div>
  );

  return createPortal(UI, document.body);
}

/* ============== Drawer za DODAVANJE radnika (MOBILE) ============== */
function AddEmployeeDrawer({ open, onClose, onSubmit, initialPassword, onOpenPicker, selectedCount, loading }) {
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState(initialPassword || "");

  useEffect(()=>{ setPassword(initialPassword || ""); }, [initialPassword, open]);

  if (!open) return null;
  return createPortal(
    <div className="drawer-veil" onClick={onClose}>
      <aside className="drawer" onClick={(e)=>e.stopPropagation()} role="dialog" aria-label="Dodaj radnika">
        <header className="drawer__header">
          <div className="drawer__title">Dodaj radnika</div>
          <button className="icon-btn" onClick={onClose} aria-label="Zatvori">✕</button>
        </header>
        <div className="drawer__body" style={{display:"grid", gap:10}}>
          <input className="input" placeholder="Ime" value={firstName} onChange={e=>setFirstName(e.target.value)} />
          <input className="input" placeholder="Prezime" value={lastName} onChange={e=>setLastName(e.target.value)} />
          <input className="input" placeholder="Korisničko ime (unikat)" value={username} onChange={e=>setUsername(e.target.value)} />
          <input className="input" placeholder="Privremena lozinka" value={password} onChange={e=>setPassword(e.target.value)} />
          <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginTop:4}}>
            <button type="button" className="btn btn--ghost" onClick={onOpenPicker}>Dodaj usluge</button>
            <span className="muted">izabrano: {selectedCount}</span>
          </div>
        </div>
        <footer className="drawer__footer">
          <button className="btn btn--ghost" onClick={onClose}>Otkaži</button>
          <div className="spacer" />
          <button
            className="btn btn--primary"
            onClick={()=>onSubmit({ firstName, lastName, username, password })}
            disabled={loading}
          >
            {loading ? "Dodavanje…" : "Sačuvaj radnika"}
          </button>
        </footer>
      </aside>
    </div>,
    document.body
  );
}

/* ============== Drawer DETALJI radnika (MOBILE) ============== */
function EmployeeDetailDrawer({ open, onClose, employee, onSave, onDelete, onOpenPicker }) {
  const [local, setLocal] = useState(employee);

  useEffect(()=>{ setLocal(employee); }, [employee, open]);

  if (!open || !employee) return null;
  const cnt = local?.serviceIds?.length || 0;

  return createPortal(
    <div className="drawer-veil" onClick={onClose}>
      <aside className="drawer" onClick={(e)=>e.stopPropagation()} role="dialog" aria-label="Detalji radnika">
        <header className="drawer__header">
          <div className="drawer__title">
            {local?.firstName} {local?.lastName}
            <span className="drawer__subtitle">@{local?.username}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Zatvori">✕</button>
        </header>

        <div className="drawer__body" style={{display:"grid", gap:10}}>
          <div style={{display:"grid", gap:8}}>
            <label className="label">Ime</label>
            <input className="input" value={local?.firstName||""} onChange={e=>setLocal(v=>({...v, firstName:e.target.value}))}/>
          </div>
          <div style={{display:"grid", gap:8}}>
            <label className="label">Prezime</label>
            <input className="input" value={local?.lastName||""} onChange={e=>setLocal(v=>({...v, lastName:e.target.value}))}/>
          </div>
          <div style={{display:"grid", gap:8}}>
            <label className="label">Privremena lozinka</label>
            <input className="input" value={local?.tempPassword||""} onChange={e=>setLocal(v=>({...v, tempPassword:e.target.value}))}/>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
            <span className="label">Status:</span>
            <Pill active={!!local?.active} onClick={()=>setLocal(v=>({...v, active: !v.active}))}>
              {local?.active ? "Aktivan" : "Neaktivan"}
            </Pill>
          </div>
          <div style={{display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
            <button className="btn btn--ghost" onClick={onOpenPicker}>Usluge</button>
            <span className="muted">izabrano: {cnt}</span>
          </div>
        </div>

        <footer className="drawer__footer">
          <button className="btn btn--ghost" onClick={()=>onDelete?.(local)}>Obriši</button>
          <div className="spacer" />
          <button className="btn btn--primary" onClick={()=>onSave?.(local)}>Sačuvaj izmene</button>
        </footer>
      </aside>
      <style>{`
        .label{ font-size:13px; color:#6b665e; }
      `}</style>
    </div>,
    document.body
  );
}

/* ============== Glavna stranica ============== */
export default function AdminEmployees() {
  const nav = useNavigate();
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // globalno izabrane usluge (za add)
  const [serviceIds, setServiceIds] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // add drawer (mobile)
  const [addOpen, setAddOpen] = useState(false);
  const [password, setPassword] = useState(() => Math.random().toString(36).slice(2,8));

  // edit drawer (mobile)
  const [editing, setEditing] = useState(null); // objekat zaposlenog ili null
  const [editPickerOpen, setEditPickerOpen] = useState(false);

  // desktop edit state
  const [desktopEditing, setDesktopEditing] = useState(null);
  const [desktopAdd, setDesktopAdd] = useState({
    firstName: "", lastName: "", username: "", tempPassword: ""
  });
  const [desktopServiceIdsAdd, setDesktopServiceIdsAdd] = useState([]);
  const [desktopServiceIdsEdit, setDesktopServiceIdsEdit] = useState([]);

  // kolekcije
  useEffect(() => {
    const unsubCats = onSnapshot(query(collection(db,"categories"), orderBy("order")), s =>
      setCategories(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    const unsubSrv = onSnapshot(query(collection(db,"services"), orderBy("categoryId"), orderBy("order")), s =>
      setServices(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    const unsubEmp = onSnapshot(query(collection(db,"employees"), orderBy("createdAt")), s => {
      const arr = s.docs.map(d => ({ id:d.id, ...d.data() }));
      setEmployees(arr);
      // osveži desktopEditing ako postoji
      if (desktopEditing) {
        const up = arr.find(e => e.username === desktopEditing.username);
        if (up) {
          setDesktopEditing(up);
          setDesktopServiceIdsEdit(up.serviceIds || []);
        }
      }
    });
    return () => { unsubCats(); unsubSrv(); unsubEmp(); };
  }, []); // eslint-disable-line

  const servicesByCat = useMemo(() => {
    const m = new Map();
    services.forEach(s => {
      const k = s.categoryId || "__none__";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    });
    return m;
  }, [services]);

  async function addEmployee({ firstName, lastName, username, password: pwd }) {
    const u = String(username||"").trim();
    const fn = String(firstName||"").trim();
    const ln = String(lastName||"").trim();
    const pw = String(pwd||"").trim();
    if (!u || !pw || !fn || !ln) {
      alert("Popunite ime, prezime, korisničko ime i lozinku.");
      return;
    }
    setLoading(true);
    try {
      await setDoc(
        doc(db, "employees", u),
        {
          username: u,
          role: "worker",
          firstName: fn,
          lastName: ln,
          tempPassword: pw,
          active: true,
          serviceIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
      // reset
      setServiceIds([]);
      setPassword(Math.random().toString(36).slice(2,8));
      setAddOpen(false);
    } catch (e) {
      console.error(e);
      alert("Greška pri dodavanju zaposlenog.");
    } finally {
      setLoading(false);
    }
  }

  async function addEmployeeDesktop() {
    const { firstName, lastName, username, tempPassword } = desktopAdd;
    const payload = {
      firstName, lastName, username,
      password: tempPassword || Math.random().toString(36).slice(2,8)
    };
    // koristi desktopServiceIdsAdd umesto globalnog
    setServiceIds(desktopServiceIdsAdd);
    await addEmployee(payload);
    setDesktopAdd({ firstName:"", lastName:"", username:"", tempPassword:"" });
    setDesktopServiceIdsAdd([]);
  }

  async function saveEmployeeEdit(next) {
    try {
      await setDoc(
        doc(db, "employees", next.username),
        {
          firstName: next.firstName?.trim() || "",
          lastName: next.lastName?.trim() || "",
          tempPassword: next.tempPassword?.trim() || next.tempPassword,
          active: !!next.active,
          serviceIds: next.serviceIds || [],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setEditing(null);
    } catch (e) {
      console.error(e);
      alert("Greška pri čuvanju izmena.");
    }
  }

  async function saveEmployeeEditDesktop() {
    if (!desktopEditing) return;
    try {
      await setDoc(
        doc(db, "employees", desktopEditing.username),
        {
          firstName: (desktopEditing.firstName||"").trim(),
          lastName: (desktopEditing.lastName||"").trim(),
          tempPassword: (desktopEditing.tempPassword||""),
          active: !!desktopEditing.active,
          serviceIds: desktopServiceIdsEdit,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      alert("Sačuvano.");
    } catch (e) {
      console.error(e);
      alert("Greška pri čuvanju izmena.");
    }
  }

  async function removeEmployee(u) {
    if (!window.confirm(`Obrisati zaposlenog "${u.username}"?`)) return;
    try { await deleteDoc(doc(db, "employees", u.username)); }
    catch (e) { console.error(e); alert("Greška pri brisanju."); }
    finally { setEditing(null); if (desktopEditing?.username === u.username) setDesktopEditing(null); }
  }

  const mobile = isMobile();

  return (
    <div className="page">
      <div style={{marginBottom:"12px", marginTop:"50px"}}>
  <button
    className="btn btn--ghost"
    onClick={()=>nav("/admin")}
  >
    ← Nazad
  </button>
</div>

      <style>{`
        *,*::before,*::after{ box-sizing:border-box; }
        html,body,#root{ min-height:100%; height:auto; }
        html,body{ overflow-x:hidden; }

        .page{ 
          padding:16px clamp(10px,4vw,40px); 
          background:linear-gradient(180deg,#f7f4ef 0,#f0ebe4 100%); 
          min-height:100vh; 
          overflow-x:hidden;
          overflow-y:auto;
        }
          .btn--ghost {
  background:#fff;
  border:1px solid #ddd6cc;
  border-radius:12px;
  padding:8px 14px;
  font-size:14px;
}

        h1{ 
          font-family:"Playfair Display",serif; 
          margin:8px 0 16px; 
          font-size: clamp(22px,2.4vw,30px); 
          text-align:center;
          color:#2c261f;
        }
        .card{ 
          background:#fff; 
          border-radius:22px; 
          box-shadow:0 12px 34px rgba(0,0,0,.08); 
          padding:16px; 
          width:100%;
        }

        /* Buttons / inputs */
        .btn{ 
          background:#fff;
          color:#000; 
          padding:12px 16px; 
          border-radius:14px; 
          cursor:pointer; 
          font-weight:700;
          font-size:14px;
          border:1px solid #ddd6cc;
        }
        .btn--ghost{ background:#fff; color:#1f1f1f; border:1px solid #ddd6cc; }
        .btn--ghost:active{ background:#f2f2f2; border-color:#ccc; box-shadow: inset 0 0 0 2px rgba(0,0,0,.03); }
        .btn:disabled{ opacity:.6; cursor:not-allowed; }
        .btn--primary{
          background:#fff;
          color:#1f1f1f;
          -webkit-text-fill-color:#1f1f1f;
          border:1px solid #1f1f1f;
        }
        .input{ width:100%; padding:12px; border-radius:12px; border:1px solid #e6e0d7; background:#fff; font-size:14px; color:#1f1f1f; -webkit-text-fill-color:#1f1f1f; }
        .input:focus{ outline:none; border-color:#1f1f1f; box-shadow:0 0 0 3px rgba(31,31,31,.05); }

        .muted{ opacity:.7; font-size:13px; }

        /* Chip lista radnika (mobile) */
        .emp-list{ display:grid; gap:10px; grid-template-columns: repeat(2,minmax(0,1fr)); }
        .emp-chip{
          display:flex; align-items:center; gap:10px; justify-content:center;
          padding:12px;
          border-radius:14px;
          background:#fff;
          border:1px solid #e6e0d7;
          font-weight:700;
          text-align:center;
          min-height:52px;
        }
        .emp-chip small{ font-weight:600; opacity:.7; display:block; }

        /* Desktop layout */
        @media(min-width:761px){
          .grid{
            display:grid;
            grid-template-columns: 320px 1fr;
            gap:16px;
            align-items:start;
          }
          .emp-list-desktop{
            display:flex;
            flex-direction:column;
            gap:8px;
          }
          .emp-row{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:10px;
            padding:10px 12px;
            border:1px solid #e6e0d7;
            border-radius:12px;
            background:#fff;
          }
          .emp-row__name{ font-weight:700; }
          .emp-row__user{ opacity:.7; font-size:12px; }
          .emp-row__actions{ display:flex; gap:8px; }
          .form-grid{ display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
          .form-row{ display:grid; gap:6px; }
          .section-title{ font-weight:800; margin:6px 0 8px; }
          .inline-actions{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
          .badge{ font-size:12px; padding:4px 8px; border-radius:999px; background:#f1eee8; color:#6f6b63; }
        }

        /* Mobilni header + spacing */
        @media(max-width:760px){
          .page{ padding:12px 12px 90px; }
          h1{ font-size:20px; margin:4px 0 10px; }
          .top-actions{ display:flex; gap:10px; margin-bottom:12px;padding-top:50px; }
          input, select, button {
            color:#1f1f1f !important;
            -webkit-text-fill-color:#1f1f1f !important;
            accent-color:#1f1f1f !important;
            -webkit-tap-highlight-color: transparent;
          }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0px 1000px #fff inset !important;
            -webkit-text-fill-color:#1f1f1f !important;
          }
          .card{ padding:12px; border-radius:16px; }
        }

        /* ----- stilovi podeljeni sa drawerima ----- */
        .drawer-veil{position:fixed;inset:0;background:rgba(0,0,0,.28);backdrop-filter:blur(2px);display:flex;justify-content:flex-end;z-index:1000;}
        .drawer{width:min(720px,96vw);height:100%;background:#fff;border-left:1px solid #eee;display:flex;flex-direction:column;animation:slideIn .2s ease;}
        @keyframes slideIn{from{transform:translateX(8px);opacity:.8}to{transform:translateX(0);opacity:1}}
        @media (max-width:760px){ 
          .drawer{width:100%;border-radius:16px 16px 0 0;align-self:flex-end;height:90vh;animation:rise .22s ease;padding-bottom:8px;}
          .drawer-veil{align-items:flex-end;}
          @keyframes rise{from{transform:translateY(8px);opacity:.9} to{transform:translateY(0);opacity:1}}
        }
        .drawer__header{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid #f1eee8;background:#faf8f5;}
        .drawer__title{font-weight:700;font-size:16px;display:flex;gap:10px;align-items:center}
        .drawer__subtitle{font-weight:600;color:#8a8378;font-size:12px;background:#f1eee8;padding:4px 8px;border-radius:999px}
        .icon-btn{border:0;background:#fff;border:1px solid #ddd6cc;border-radius:10px;padding:8px 10px;cursor:pointer}
        .drawer__body{padding:10px 12px;overflow-y:auto}
        .drawer__footer{display:flex;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid #f1eee8;background:#faf8f5}
        @media (max-width:760px){
          .drawer__footer{
            flex-direction: column !important;
            justify-content: center;
            align-items: center;
            gap: 10px;
          }
          .drawer__footer .btn{
            width: 50%;
            max-width: 260px;
            text-align: center;
            margin-left: 0;
          }
        }

        .spacer{flex:1}
        .pill{ padding:8px 12px; border-radius:999px; border:1px solid #ddd6cc; background:#fff; cursor:pointer; font-size:13px; font-weight:600; color:#1f1f1f; }
        .pill--active{ background:#f2f2f2; color:#1f1f1f; border-color:#ccc; box-shadow: inset 0 0 0 2px rgba(0,0,0,.03); }
        .pill:active{ background:#f5f5f5; }
        .empty{opacity:.65;font-size:13px;padding:8px}
        /* ===== Desktop lev stub – poboljšanja ===== */
@media (min-width: 761px){
  /* širi i fleksibilniji levi stub */
  .grid{
    grid-template-columns: clamp(320px, 28vw, 420px) 1fr;
    gap: 20px;
    align-items: start;
  }

  /* levo: kartica sa listom da „lepi” uz vrh i skroluje */
  .grid > .card:first-child{
    position: sticky;
    top: 16px;
    align-self: start;
    max-height: calc(100vh - 32px);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .grid > .card:first-child .emp-list-desktop{
    overflow-y: auto;
    max-height: 100%;
    padding-right: 4px; /* da se ne lepi scrollbar */
  }

  /* red u listi: stabilan raspored i bolji wrap dugmića */
  .emp-row{
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 10px;
  }
  .emp-row > div:first-child{ min-width: 0; } /* da elipsira */
  .emp-row__name{
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .emp-row__user{ white-space: nowrap; opacity: .7; font-size: 12px; }

  .emp-row__actions{
    display: flex;
    gap: 6px;
    flex-wrap: wrap;           /* ako nema mesta, prelomi u drugi red */
    justify-content: flex-end;
  }
  .emp-row .btn{               /* kompaktnija dugmad u listi */
    padding: 8px 10px;
    font-size: 12px;
  }
  .badge{ white-space: nowrap; }
}

      `}</style>

      

      {mobile ? (
        <>
          {/* MOBILNI: jedno dugme gore + grid chipova */}
          <div className="top-actions">
            <button className="btn btn--ghost" onClick={()=>setAddOpen(true)}>Dodaj radnika</button>
          </div>

          <div className="emp-list">
            {employees.map(u => (
              <button
                key={u.username}
                className="emp-chip"
                onClick={()=>setEditing({
                  ...u,
                  tempPassword: u.tempPassword || "",
                  serviceIds: u.serviceIds || [],
                })}
              >
                <div style={{display:"grid", gap:2}}>
                  <span>{u.firstName} {u.lastName}</span>
                  <small>@{u.username}</small>
                </div>
              </button>
            ))}
            {employees.length === 0 && (
              <div className="card" style={{gridColumn:"1/-1", textAlign:"center"}}>
                <Empty>Još nema zaposlenih.</Empty>
              </div>
            )}
          </div>

          {/* ADD drawer */}
          <AddEmployeeDrawer
            open={addOpen}
            onClose={()=>setAddOpen(false)}
            onSubmit={addEmployee}
            initialPassword={password}
            onOpenPicker={()=>setPickerOpen(true)}
            selectedCount={serviceIds.length}
            loading={loading}
          />
          <ServicePickerDrawer
            open={pickerOpen}
            onClose={()=>setPickerOpen(false)}
            categories={categories}
            servicesByCat={servicesByCat}
            value={serviceIds}
            onSave={(arr)=>{ setServiceIds(arr); setPickerOpen(false); }}
          />

          {/* EDIT drawer */}
          <EmployeeDetailDrawer
            open={!!editing}
            onClose={()=>setEditing(null)}
            employee={editing}
            onSave={saveEmployeeEdit}
            onDelete={removeEmployee}
            onOpenPicker={()=>setEditPickerOpen(true)}
          />
          <ServicePickerDrawer
            open={editPickerOpen}
            onClose={()=>setEditPickerOpen(false)}
            categories={categories}
            servicesByCat={servicesByCat}
            value={editing?.serviceIds || []}
            onSave={(arr)=>setEditing(v=>({...v, serviceIds: arr}))}
          />
        </>
      ) : (
        /* DESKTOP: levi stub – lista radnika; desni – dve kartice: Dodaj + Izmeni */
        <div className="grid">
          {/* LEVO: Lista radnika + dugme dodaj (otvara desno karticu) */}
          <div className="card">
            <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
              <div className="section-title">Spisak radnika</div>
              <button className="btn btn--ghost" onClick={()=>{
                setDesktopEditing(null);
                setDesktopAdd({ firstName:"", lastName:"", username:"", tempPassword:"" });
                setDesktopServiceIdsAdd([]);
              }}>
                + Novi radnik
              </button>
            </div>

            <div className="emp-list-desktop">
              {employees.map(u => (
                <div key={u.username} className="emp-row">
                  <div>
                    <div className="emp-row__name">{u.firstName} {u.lastName}</div>
                    <div className="emp-row__user">@{u.username}</div>
                  </div>
                  <div className="emp-row__actions">
                    <span className="badge">{u.active ? "Aktivan" : "Neaktivan"}</span>
                    <button
                      className="btn btn--ghost"
                      onClick={()=>{
                        setDesktopEditing(u);
                        setDesktopServiceIdsEdit(u.serviceIds || []);
                      }}
                    >
                      Uredi
                    </button>
                    <button className="btn btn--ghost" onClick={()=>removeEmployee(u)}>Obriši</button>
                  </div>
                </div>
              ))}
              {employees.length === 0 && <Empty>Još nema zaposlenih.</Empty>}
            </div>
          </div>

          {/* DESNO: Dodaj + Izmeni */}
          <div style={{display:"grid", gap:16}}>
            {/* Dodaj radnika (desktop) */}
            <div className="card">
              <div className="section-title">Dodaj radnika</div>
              <div className="form-grid">
                <div className="form-row">
                  <label>Ime</label>
                  <input
                    className="input"
                    value={desktopAdd.firstName}
                    onChange={(e)=>setDesktopAdd(v=>({...v, firstName:e.target.value}))}
                    placeholder="Ime"
                  />
                </div>
                <div className="form-row">
                  <label>Prezime</label>
                  <input
                    className="input"
                    value={desktopAdd.lastName}
                    onChange={(e)=>setDesktopAdd(v=>({...v, lastName:e.target.value}))}
                    placeholder="Prezime"
                  />
                </div>
                <div className="form-row">
                  <label>Korisničko ime (unikat)</label>
                  <input
                    className="input"
                    value={desktopAdd.username}
                    onChange={(e)=>setDesktopAdd(v=>({...v, username:e.target.value}))}
                    placeholder="npr. ana"
                  />
                </div>
                <div className="form-row">
                  <label>Privremena lozinka</label>
                  <input
                    className="input"
                    value={desktopAdd.tempPassword}
                    onChange={(e)=>setDesktopAdd(v=>({...v, tempPassword:e.target.value}))}
                    placeholder="automatska ako ostaviš prazno"
                  />
                </div>
              </div>

              <div className="inline-actions" style={{marginTop:10}}>
                <button
                  className="btn btn--ghost"
                  onClick={()=>setPickerOpen(true)}
                  title="Dodaj usluge ovom radniku"
                >
                  Dodaj usluge
                </button>
                <span className="muted">izabrano: {desktopServiceIdsAdd.length}</span>
              </div>

              <div style={{display:"flex", gap:10, marginTop:12}}>
                <button className="btn btn--primary" onClick={addEmployeeDesktop} disabled={loading}>
                  {loading ? "Dodavanje…" : "Sačuvaj radnika"}
                </button>
                <button
                  className="btn btn--ghost"
                  onClick={()=>{
                    setDesktopAdd({ firstName:"", lastName:"", username:"", tempPassword:"" });
                    setDesktopServiceIdsAdd([]);
                  }}
                >
                  Očisti
                </button>
              </div>

              {/* Reuse picker; kada se koristi za ADD na desktopu, pišemo u desktopServiceIdsAdd */}
              <ServicePickerDrawer
                open={pickerOpen && !desktopEditing}
                onClose={()=>setPickerOpen(false)}
                categories={categories}
                servicesByCat={servicesByCat}
                value={desktopServiceIdsAdd}
                onSave={(arr)=>{ setDesktopServiceIdsAdd(arr); setPickerOpen(false); }}
              />
            </div>

            {/* Izmeni radnika (desktop) */}
            <div className="card">
              <div className="section-title">Izmeni radnika</div>
              {!desktopEditing ? (
                <Empty>Izaberi radnika iz liste sa leve strane.</Empty>
              ) : (
                <>
                  <div className="form-grid">
                    <div className="form-row">
                      <label>Ime</label>
                      <input
                        className="input"
                        value={desktopEditing.firstName || ""}
                        onChange={(e)=>setDesktopEditing(v=>({...v, firstName:e.target.value}))}
                      />
                    </div>
                    <div className="form-row">
                      <label>Prezime</label>
                      <input
                        className="input"
                        value={desktopEditing.lastName || ""}
                        onChange={(e)=>setDesktopEditing(v=>({...v, lastName:e.target.value}))}
                      />
                    </div>
                    <div className="form-row">
                      <label>Korisničko ime</label>
                      <input className="input" value={desktopEditing.username} disabled />
                    </div>
                    <div className="form-row">
                      <label>Privremena lozinka</label>
                      <input
                        className="input"
                        value={desktopEditing.tempPassword || ""}
                        onChange={(e)=>setDesktopEditing(v=>({...v, tempPassword:e.target.value}))}
                      />
                    </div>
                  </div>

                  <div className="inline-actions" style={{marginTop:10}}>
                    <span>Status:</span>
                    <Pill
                      active={!!desktopEditing.active}
                      onClick={()=>setDesktopEditing(v=>({...v, active: !v.active}))}
                    >
                      {desktopEditing.active ? "Aktivan" : "Neaktivan"}
                    </Pill>
                  </div>

                  <div className="inline-actions" style={{marginTop:10}}>
                    <button
                      className="btn btn--ghost"
                      onClick={()=>setEditPickerOpen(true)}
                    >
                      Usluge
                    </button>
                    <span className="muted">izabrano: {desktopServiceIdsEdit.length}</span>
                  </div>

                  <div style={{display:"flex", gap:10, marginTop:12}}>
                    <button className="btn btn--primary" onClick={saveEmployeeEditDesktop}>Sačuvaj izmene</button>
                    <button className="btn btn--ghost" onClick={()=>desktopEditing && removeEmployee(desktopEditing)}>Obriši</button>
                  </div>

                  {/* Reuse picker za EDIT na desktopu */}
                  <ServicePickerDrawer
                    open={editPickerOpen}
                    onClose={()=>setEditPickerOpen(false)}
                    categories={categories}
                    servicesByCat={servicesByCat}
                    value={desktopServiceIdsEdit}
                    onSave={(arr)=>{ setDesktopServiceIdsEdit(arr); setEditPickerOpen(false); setDesktopEditing(v=>({...v, serviceIds: arr})); }}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
