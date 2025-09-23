// src/pages/booking/EmployeeSelect.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
import { db } from "../../firebase";

export default function EmployeeSelect(){
  const nav = useNavigate();

  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]); // {id, name}
  const [services, setServices]   = useState([]);   // {id, name, categoryId}

  /* Učitaj zaposlene */
  useEffect(()=>{
    const q = query(collection(db,"employees"), orderBy("username"));
    return onSnapshot(q, snap=>{
      setEmployees(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
  },[]);

  /* Učitaj kategorije (za čitljiva imena) */
  useEffect(()=>{
    const q = query(collection(db,"categories"), orderBy("order"));
    return onSnapshot(q, snap=>{
      setCategories(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
  },[]);

  /* Učitaj usluge (da mapiramo serviceId → categoryId) */
  useEffect(()=>{
    const q = query(collection(db,"services"), orderBy("categoryId"), orderBy("order"));
    return onSnapshot(q, snap=>{
      setServices(snap.docs.map(d=>({ id:d.id, ...d.data() })));
    });
  },[]);

  /* Mapiranja */
  const catNameById = useMemo(()=>{
    const m = new Map();
    for (const c of categories){
      m.set(c.id, c.name || c.title || c.label || c.id);
    }
    return m;
  },[categories]);

  const serviceToCat = useMemo(()=>{
    const m = new Map();
    for (const s of services){
      if (s?.id) m.set(s.id, s.categoryId || null);
    }
    return m;
  },[services]);

  /* Podnaslov za zaposlenog – kategorije izvedene iz serviceIds */
  function buildSubtitleForEmployee(e){
    const sids = Array.isArray(e?.serviceIds) ? e.serviceIds.filter(Boolean) : [];

    if (sids.length === 0) return "Usluge nisu podešene";

    // Izvuci unikatne kategorije iz serviceIds
    const catSet = new Set();
    for (const sid of sids){
      const cid = serviceToCat.get(sid);
      if (cid) catSet.add(cid);
    }

    const catIds = Array.from(catSet);
    if (catIds.length === 0) return "Usluge nisu podešene";

    // Ako pokrivaju sve postojeće kategorije – može „Sve kategorije“
    if (categories.length > 0 && catIds.length === categories.length) {
      return "Sve kategorije";
    }

    const names = catIds
      .map(id => catNameById.get(id) || id)
      .filter(Boolean);

    const shown = names.slice(0,3).join(", ");
    const extra = names.length - 3;
    return extra > 0 ? `${shown} +${extra}` : shown;
  }

  const rows = useMemo(()=>{
    const first = [{
      value:"firstFree",
      title:"Prvi dostupan",
      subtitle:"Najbrži izbor termina",
      avatar:null,
      initials:null
    }];

    const rest  = employees.map(e=>{
      const fullName = `${e.firstName||""} ${e.lastName||""}`.trim() || e.username;
      const initials = fullName
        .split(" ")
        .map(w=>w[0]?.toUpperCase())
        .slice(0,2)
        .join("");
      return {
        value: e.username,
        title: fullName,
        subtitle: buildSubtitleForEmployee(e),
        avatar: e.photoURL || null,
        initials
      };
    });
    return [...first, ...rest];
  },[employees, categories, serviceToCat, catNameById]); // zavisi i od services/kategorija

  return (
    <div className="wrap">
      <style>{`
        .wrap{min-height:100dvh;background:#0f0f10;}
        .sheet{background:#fff;min-height:100dvh;border-top-left-radius:22px;
               border-top-right-radius:22px;padding:20px;}
        .hdr{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
        .back{appearance:none;border:0;background:transparent;font-weight:800;}
        .title{font-size:24px;font-weight:900;margin:10px 0;text-align:center;}
        .hero{width:100%;height:160px;border-radius:20px;overflow:hidden;margin-bottom:20px;}
        .hero img{width:100%;height:100%;object-fit:cover}
        .list{display:flex;flex-direction:column;gap:12px;}
        .row{display:flex;align-items:center;justify-content:space-between;
             padding:14px 16px;border:1px solid #eee;border-radius:18px;
             background:#fafafa;transition:.2s;}
        .row:hover{background:#f0f0f0;}
        .l{display:flex;align-items:center;gap:14px;}
        .av{width:48px;height:48px;border-radius:50%;overflow:hidden;
            box-shadow:0 2px 6px rgba(0,0,0,0.1);display:flex;
            align-items:center;justify-content:center;font-weight:800;font-size:16px;color:#fff;background:#111;}
        .av img{width:100%;height:100%;object-fit:cover}
        .t{display:flex;flex-direction:column;text-align:left;}
        .tt{font-weight:800;font-size:15px;}
        .st{font-size:13px;opacity:.7;}
        .chev{font-size:20px;opacity:.4;}
      `}</style>

      <div className="sheet">
        <div className="hdr">
          <button className="back" onClick={()=>nav(-1)}>← Nazad</button>
        </div>

        {/* Hero slika iznad liste */}
        <div className="hero">
          <img src="/usluge1.webp" alt="Usluga" />
        </div>

        <div className="title">Odaberite radnicu</div>

        <div className="list">
          {rows.map(r=>(
            <button
              key={r.value}
              className="row"
              onClick={()=>nav("/booking/time", { state:{ employee:r.value } })}
            >
              <div className="l">
                <div className="av">
                  {r.avatar ? (
                    <img src={r.avatar} alt="" />
                  ) : r.initials ? (
                    r.initials
                  ) : (
                    <span>👤</span>
                  )}
                </div>
                <div className="t">
                  <div className="tt">{r.title}</div>
                  <div className="st">{r.subtitle}</div>
                </div>
              </div>
              <div className="chev">›</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
