import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection, query, orderBy, onSnapshot,
  doc, setDoc, serverTimestamp, deleteDoc
} from "firebase/firestore";
import { db } from "../firebase";

/* ============== UI helpers ============== */
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
        @media (max-width:720px){ 
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
        .pill{padding:8px 12px;border-radius:999px;border:1px solid #ddd6cc;background:#fff;cursor:pointer;font-size:13px}
        .pill--active{background:#1f1f1f;color:#fff;border-color:#1f1f1f}
        .empty{opacity:.65;font-size:13px;padding:8px}
        .drawer__footer{display:flex;gap:10px;align-items:center;padding:10px 12px;border-top:1px solid #f1eee8;background:#faf8f5}
        .spacer{flex:1}
        .btn{padding:10px 14px;border-radius:12px;cursor:pointer;border:1px solid transparent}
        .btn--ghost{background:#fff;border-color:#ddd6cc}
        .btn--primary{background:#1f1f1f;color:#fff}
      `}</style>
    </div>
  );

  return createPortal(UI, document.body); // ⭐ portal
}

/* ============== Glavna stranica ============== */
export default function AdminEmployees() {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // forma (bez bedževa – samo brojač)
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [username,  setUsername]  = useState("");
  const [password,  setPassword]  = useState(() => Math.random().toString(36).slice(2,8));
  const [serviceIds, setServiceIds] = useState([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState(null); // objekat zaposlenog ili null

  // kolekcije
  useEffect(() => {
    const unsubCats = onSnapshot(query(collection(db,"categories"), orderBy("order")), s =>
      setCategories(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    const unsubSrv = onSnapshot(query(collection(db,"services"), orderBy("categoryId"), orderBy("order")), s =>
      setServices(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    const unsubEmp = onSnapshot(query(collection(db,"employees"), orderBy("createdAt")), s =>
      setEmployees(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return () => { unsubCats(); unsubSrv(); unsubEmp(); };
  }, []);

  const servicesByCat = useMemo(() => {
    const m = new Map();
    services.forEach(s => {
      const k = s.categoryId || "__none__";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    });
    return m;
  }, [services]);

  async function addEmployee() {
    const u = username.trim();
    if (!u || !password.trim() || !firstName.trim() || !lastName.trim()) {
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
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          tempPassword: password.trim(),
          active: true,
          serviceIds,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: false }
      );
      // reset
      setFirstName(""); setLastName("");
      setUsername(""); setPassword(Math.random().toString(36).slice(2,8));
      setServiceIds([]);
    } catch (e) {
      console.error(e);
      alert("Greška pri dodavanju zaposlenog.");
    } finally {
      setLoading(false);
    }
  }

  async function saveEmployeeEdit(next) {
    try {
      await setDoc(
        doc(db, "employees", next.username),
        {
          firstName: next.firstName.trim(),
          lastName: next.lastName.trim(),
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

  async function removeEmployee(u) {
    if (!window.confirm(`Obrisati zaposlenog "${u.username}"?`)) return;
    try { await deleteDoc(doc(db, "employees", u.username)); }
    catch (e) { console.error(e); alert("Greška pri brisanju."); }
  }

  return (
    <div className="page">
      <style>{`
        *,*::before,*::after{ box-sizing:border-box; }
        html,body,#root{ min-height:100%; height:auto; }
        html,body{ overflow-x:hidden; }

        .page{ 
          padding:16px clamp(10px,4vw,40px); 
          background:linear-gradient(180deg,#f7f4ef 0,#f0ebe4 100%); 
          min-height:100vh; 
          overflow-x:hidden;
          overflow-y:auto; /* Ensure smooth scrolling */
        }
        h1{ 
          font-family:"Playfair Display",serif; 
          margin:8px 0 16px; 
          font-size: clamp(22px,2.4vw,30px); 
          text-align:center;
          color:#2c261f;
        }
        .grid{ display:grid; gap:14px; grid-template-columns: 1fr; min-width:0; }
        @media(min-width:980px){ .grid{ grid-template-columns: 420px 1fr; align-items:start; } }

        .card{ 
          background:#fff; 
          border-radius:22px; 
          box-shadow:0 12px 34px rgba(0,0,0,.08); 
          padding:16px; 
          width:100%;
          box-sizing:border-box;
        }
        .card h3{ margin:0 0 10px; font-size:16px; font-weight:700; color:#2c261f; }
        .row{ display:grid; gap:10px; grid-template-columns: repeat(2,minmax(0,1fr)); }
        .input{ 
          width:100%; 
          padding:12px; 
          border-radius:12px; 
          border:1px solid #e6e0d7; 
          background:#fff; 
          font-size:14px;
        }
        .input:focus{ outline:none; border-color:#1f1f1f; box-shadow:0 0 0 3px rgba(31,31,31,.05); }
        .btn{ 
          border:0; 
          background:#1f1f1f; 
          color:#fff; 
          padding:11px 14px; 
          border-radius:12px; 
          cursor:pointer; 
          font-weight:600;
          font-size:14px;
        }
        .btn--ghost{ background:#fff; color:#1f1f1f; border:1px solid #ddd6cc }
        .btn:hover:not(:disabled){ background:#333; }
        .btn:disabled{ opacity:.6; cursor:not-allowed; }
        .muted{ opacity:.7; font-size:13px; }

        .table{ width:100%; border-collapse: collapse; }
        .table th,.table td{ padding:10px 12px; border-bottom:1px dashed #eee; text-align:left; font-size:14px }
        .table th{ font-weight:700; color:#36322b; background:#faf8f5 }
        .table__actions{ display:flex; gap:8px; flex-wrap:wrap }

        .pill{ 
          padding:8px 12px;
          border-radius:999px;
          border:1px solid #ddd6cc;
          background:#fff;
          cursor:pointer;
          font-size:13px;
          font-weight:600;
        }
        .pill--active{ background:#1f1f1f;color:#fff;border-color:#1f1f1f }
        .badge{ 
          background:#f1eee8; 
          border:1px solid #e7dfd4; 
          color:#5c564c; 
          padding:4px 8px; 
          border-radius:999px; 
          font-size:12px 
        }

        @media(max-width:768px){
          .page{ padding:4px clamp(8px,2vw,12px) 84px; }
          h1{ font-size:18px; margin:4px 0 8px; }
          .card{ padding:12px; border-radius:16px; }
          .row{ gap:8px; grid-template-columns: 1fr; } /* Stack inputs */
          .table th,.table td{ padding:8px 10px; font-size:13px; }
          .table__actions{ gap:6px; }
        }

        @media(max-width:380px){
          .input{ height:38px; font-size:13px; padding:10px; }
          .btn, .pill{ font-size:12.5px; padding:8px 12px; }
        }
      `}</style>

      <h1>Zaposleni</h1>

      <div className="grid">
        {/* Forma – Novi zaposleni */}
        <div className="card">
          <h3>Novi zaposleni</h3>
          <div className="row">
            <input className="input" placeholder="Ime" value={firstName} onChange={e=>setFirstName(e.target.value)} />
            <input className="input" placeholder="Prezime" value={lastName} onChange={e=>setLastName(e.target.value)} />
            <input className="input" placeholder="Korisničko ime (unikat)" value={username} onChange={e=>setUsername(e.target.value)} />
            <input className="input" placeholder="Privremena lozinka" value={password} onChange={e=>setPassword(e.target.value)} />
          </div>

          {/* Nema bedževa ispod – samo dugme + brojač */}
          <div style={{marginTop:12, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap"}}>
            <button type="button" className="btn btn--ghost" onClick={()=>setPickerOpen(true)}>
              Dodaj usluge
            </button>
            <span className="muted">izabrano: {serviceIds.length}</span>
          </div>

          <div style={{marginTop:14, display:'flex', gap:10}}>
            <button className="btn" disabled={loading} onClick={addEmployee}>
              {loading ? "Dodavanje…" : "Dodaj zaposlenog"}
            </button>
          </div>
        </div>

        {/* Spisak */}
        <div className="card">
          <h3>Spisak</h3>
          <table className="table">
            <thead>
              <tr>
                <th style={{width:160}}>Korisnik</th>
                <th>Ime i prezime</th>
                <th style={{width:120}}>Usluge</th>
                <th style={{width:120}}>Status</th>
                <th style={{width:220}}>Akcije</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(u => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>{u.firstName} {u.lastName}</td>
                  <td>{u.serviceIds?.length || 0}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background:u.active?"#e6fbef":"#fff3f3",
                        borderColor:u.active?"#bfead2":"#f3c9c9",
                        color:u.active?"#106a3a":"#912323"
                      }}
                    >
                      {u.active ? "aktivan" : "neaktivan"}
                    </span>
                  </td>
                  <td>
                    <div className="table__actions">
                      <button
                        className="pill"
                        onClick={()=>setEditing({
                          ...u,
                          tempPassword: u.tempPassword || "",
                          serviceIds: u.serviceIds || [],
                        })}
                      >
                        Izmeni
                      </button>
                      <button className="pill" onClick={()=>removeEmployee(u)} style={{borderColor:"#f2c0c0", color:"#b00020"}}>
                        Obriši
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={5}><Empty>Još nema zaposlenih.</Empty></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer – dodavanje usluga */}
      <ServicePickerDrawer
        open={pickerOpen}
        onClose={()=>setPickerOpen(false)}
        categories={categories}
        servicesByCat={servicesByCat}
        value={serviceIds}
        onSave={(arr)=>{ setServiceIds(arr); setPickerOpen(false); }}
      />

      {/* Izmena zaposlenog: zaglavlje + status/ime/prezime + drawer za usluge */}
      {editing && (
        <>
          <div className="drawer-veil" onClick={()=>setEditing(null)} style={{background:"transparent", pointerEvents:"none"}}>
            <aside className="drawer" onClick={(e)=>e.stopPropagation()} style={{pointerEvents:"none", background:"transparent", border:"none", boxShadow:"none"}}>
              <div style={{pointerEvents:"auto", background:"#fff", borderRadius:18, margin:10, padding:14, boxShadow:"0 12px 30px rgba(0,0,0,.12)"}}>
                <div className="drawer__header">
                  <div className="drawer__title">
                    Izmena zaposlenog – {editing.username}
                    <span className="drawer__subtitle">izabrano: {editing.serviceIds?.length || 0}</span>
                  </div>
                  <button className="icon-btn" onClick={()=>setEditing(null)} aria-label="Zatvori">✕</button>
                </div>

                <div style={{padding:"12px 14px"}}>
                  <div className="row" style={{marginBottom:10}}>
                    <input className="input" placeholder="Ime" value={editing.firstName} onChange={e=>setEditing(v=>({...v, firstName:e.target.value}))} />
                    <input className="input" placeholder="Prezime" value={editing.lastName} onChange={e=>setEditing(v=>({...v, lastName:e.target.value}))} />
                    <input className="input" placeholder="Privremena lozinka" value={editing.tempPassword || ""} onChange={e=>setEditing(v=>({...v, tempPassword:e.target.value}))} />
                    <div style={{display:"flex", alignItems:"center", gap:8}}>
                      <span>Status:</span>
                      <Pill active={editing.active} onClick={()=>setEditing(v=>({...v, active: !v.active}))}>
                        {editing.active ? "Aktivan" : "Neaktivan"}
                      </Pill>
                    </div>
                  </div>

                  <div style={{display:"flex", gap:10, justifyContent:"flex-end"}}>
                    <button className="btn btn--ghost" onClick={()=>setEditing(null)}>Otkaži</button>
                    <button className="btn" onClick={()=>saveEmployeeEdit(editing)}>Sačuvaj izmene</button>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <ServicePickerDrawer
            open={!!editing}
            onClose={()=>setEditing(null)}
            categories={categories}
            servicesByCat={servicesByCat}
            value={editing.serviceIds || []}
            onSave={(arr)=>setEditing(v=>({...v, serviceIds: arr}))}
          />
        </>
      )}
    </div>
  );
}