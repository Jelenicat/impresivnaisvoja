// src/pages/Services.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  writeBatch,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Firestore:
 *  categories/{id} = { name, order, color, createdAt, updatedAt }
 *  services/{id}   = {
 *    name, categoryId, durationMin, priceRsd, order,
 *    description?,              // <= NOVO: opcioni opis
 *    createdAt, updatedAt
 *  }
 */

const DURATIONS = [15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180];
const CAT_COLORS = [
  "#ff7fb5", "#ff5fa2", "#f7b500", "#ffd166", "#06d6a0",
  "#118ab2", "#4e6cff", "#9b5de5", "#ef476f", "#8d99ae"
];

const toNum = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

/* ===== Color Dropdown (jedan kružić → panel sa 10 boja) ===== */
function ColorDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, []);

  return (
    <div className="color-dropdown" ref={ref}>
      <button
        type="button"
        className="swatch main"
        style={{ background: value }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Promeni boju kategorije"
      />
      {open && (
        <div className="dropdown-panel">
          {CAT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch ${value === c ? "active" : ""}`}
              style={{ background: c }}
              onClick={() => {
                onChange?.(c);
                setOpen(false);
              }}
              aria-label={`Boja ${c}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ===== Header kategorije ===== */
function CategoryHeader({ cat, onRename, onPickColor, onUp, onDown, onToggle, open }) {
  const [name, setName] = useState(cat.name);
  const changed = name.trim() !== cat.name;

  useEffect(() => {
    setName(cat.name);
  }, [cat.id, cat.name]);

  return (
    <div className="category-head">
      <button className="btn-ghost expand" onClick={onToggle} title={open ? "Sažmi" : "Otvori"}>
        {open ? "▾" : "▸"}
      </button>

      <input
        className="cat-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Naziv kategorije"
      />

      <div className="cat-actions">
        <ColorDropdown
          value={cat.color || CAT_COLORS[0]}
          onChange={(col) => onPickColor(cat.id, col)}
        />
        <button className="btn-ghost" onClick={onUp} title="Gore">↑</button>
        <button className="btn-ghost" onClick={onDown} title="Dole">↓</button>
        <button
          className="btn-dark"
          disabled={!changed}
          onClick={() => onRename(name.trim())}
        >
          Sačuvaj
        </button>
      </div>
    </div>
  );
}

/* ===== Red usluge ===== */
function ServiceRow({ s, categories, onSave, onMoveUp, onMoveDown, onDelete }) {
  const [form, setForm] = useState({
    name: s.name,
    durationMin: s.durationMin,
    priceRsd: s.priceRsd,
    categoryId: s.categoryId,
    description: s.description || "", // <= NOVO
  });

  useEffect(() => {
    setForm({
      name: s.name,
      durationMin: s.durationMin,
      priceRsd: s.priceRsd,
      categoryId: s.categoryId,
      description: s.description || "",
    });
  }, [s.id]);

  const changed =
    form.name !== s.name ||
    form.durationMin !== s.durationMin ||
    form.priceRsd !== s.priceRsd ||
    form.categoryId !== s.categoryId ||
    (form.description || "") !== (s.description || "");

  return (
    <div className="srv-row">
      {/* gornji red */}
      <input
        className="srv-input name"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="Naziv usluge"
      />

      <select
        className="srv-input dur"
        value={form.durationMin}
        onChange={(e) =>
          setForm((f) => ({ ...f, durationMin: toNum(e.target.value, 60) }))
        }
      >
        {DURATIONS.map((d) => (
          <option key={d} value={d}>
            {d} min
          </option>
        ))}
      </select>

      <div className="price-wrap">
        <input
          className="srv-input price"
          type="number"
          min={0}
          step={100}
          value={form.priceRsd}
          onChange={(e) =>
            setForm((f) => ({ ...f, priceRsd: toNum(e.target.value, s.priceRsd) }))
          }
          placeholder="0"
        />
        <span className="rsd">RSD</span>
      </div>

      <select
        className="srv-input cat"
        value={form.categoryId || ""}
        onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <div className="row-actions">
        <button className="btn-ghost" onClick={onMoveUp} title="Pomeri gore">↑</button>
        <button className="btn-ghost" onClick={onMoveDown} title="Pomeri dole">↓</button>
        <button
          className="btn-save"
          disabled={!changed}
          onClick={() =>
            onSave({
              ...s,
              name: form.name.trim(),
              durationMin: toNum(form.durationMin, 60),
              priceRsd: toNum(form.priceRsd, 0),
              categoryId: form.categoryId,
              description: form.description.trim(), // <= NOVO
            })
          }
        >
          Sačuvaj
        </button>
        <button
          className="btn-danger"
          title="Obriši uslugu"
          onClick={() => onDelete(s)}
        >
          Obriši
        </button>
      </div>

      {/* donji red: OPIS */}
      <textarea
        className="srv-input desc"
        rows={2}
        placeholder="Opis (opciono) – npr. šta uključuje uslugu, posebne napomene…"
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
    </div>
  );
}

/** DODAVANJE – kompletan unos (naziv, trajanje, cena, kategorija, opis) */
function AddServiceRow({ categories, defaultCategoryId, nextOrder, onAdd }) {
  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [priceRsd, setPriceRsd] = useState(""); // prazno dok ne krene unos
  const [categoryId, setCategoryId] = useState(defaultCategoryId || (categories[0]?.id ?? ""));
  const [description, setDescription] = useState(""); // <= NOVO

  useEffect(() => {
    if (!categories.find(c => c.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? "");
    }
  }, [categories, categoryId]);

  return (
    <div className="srv-row add">
      {/* gornji red */}
      <input
        className="srv-input name"
        placeholder="Naziv usluge"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <select
        className="srv-input dur"
        value={durationMin}
        onChange={(e) => setDurationMin(Number(e.target.value))}
      >
        {DURATIONS.map((d) => (
          <option key={d} value={d}>{d} min</option>
        ))}
      </select>

      <div className="price-wrap">
        <input
          className="srv-input price"
          type="number"
          min={0}
          step={100}
          placeholder="0"
          value={priceRsd}
          onChange={(e) => setPriceRsd(e.target.value)}
          onBlur={(e) => {
            if (e.target.value === "") setPriceRsd("");
          }}
        />
        <span className="rsd">RSD</span>
      </div>

      <select
        className="srv-input cat"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <div className="row-actions">
        <button
          className="btn-dark"
          onClick={() => {
            if (!name.trim() || !categoryId) return;
            onAdd({
              name: name.trim(),
              durationMin,
              priceRsd: Number(priceRsd) || 0,
              categoryId,
              description: description.trim(), // <= NOVO
              order: nextOrder,
            });
            setName("");
            setDurationMin(60);
            setPriceRsd("");
            setDescription("");
          }}
        >
          + Dodaj
        </button>
      </div>

      {/* donji red: OPIS */}
      <textarea
        className="srv-input desc"
        rows={2}
        placeholder="Opis (opciono)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </div>
  );
}

/* ===== Glavna stranica ===== */
export default function Services() {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);
  const [openCats, setOpenCats] = useState({}); // {catId: bool}
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(CAT_COLORS[0]);

  // Kategorije
  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("order"));
    return onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setCategories(arr);
      const next = {};
      // DEFAULT: ZATVORENE (prethodni izbor korisnika se poštuje)
      arr.forEach(c => { next[c.id] = openCats[c.id] ?? false; });
      setOpenCats(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Usluge
  useEffect(() => {
    const q = query(collection(db, "services"), orderBy("categoryId"), orderBy("order"));
    return onSnapshot(q, (snap) => {
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setServices(arr);
    });
  }, []);

  const servicesByCat = useMemo(() => {
    const map = new Map();
    for (const s of services) {
      const key = s.categoryId || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return map;
  }, [services]);

  async function addCategory(name) {
    const order = categories.length;
    await addDoc(collection(db, "categories"), {
      name: name.trim(),
      order,
      color: newCatColor || CAT_COLORS[0],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function renameCategory(catId, name) {
    await setDoc(
      doc(db, "categories", catId),
      { name: name.trim(), updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  async function changeCategoryColor(catId, color) {
    await setDoc(
      doc(db, "categories", catId),
      { color, updatedAt: serverTimestamp() },
      { merge: true }
    );
  }

  async function moveCategory(catId, dir) {
    const items = [...categories];
    const idx = items.findIndex((c) => c.id === catId);
    if (idx < 0) return;
    const targetIdx = idx + (dir === "up" ? -1 : 1);
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const a = items[idx];
    const b = items[targetIdx];
    const batch = writeBatch(db);
    batch.set(doc(db, "categories", a.id), { order: targetIdx }, { merge: true });
    batch.set(doc(db, "categories", b.id), { order: idx }, { merge: true });
    await batch.commit();
  }

  async function addService(payload) {
    await addDoc(collection(db, "services"), {
      ...payload,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async function saveService(next) {
    const ref = doc(db, "services", next.id);
    await setDoc(
      ref,
      {
        name: next.name,
        durationMin: next.durationMin,
        priceRsd: next.priceRsd,
        categoryId: next.categoryId,
        description: next.description || "", // <= NOVO
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // promena kategorije → stavi na kraj nove kategorije
    const original = services.find((x) => x.id === next.id);
    if (original && original.categoryId !== next.categoryId) {
      const list = services.filter((s) => s.categoryId === next.categoryId);
      const newOrder = list.length;
      await setDoc(ref, { order: newOrder }, { merge: true });
    }
  }

  async function moveServiceInCategory(categoryId, id, dir) {
    const items = services
      .filter((s) => s.categoryId === categoryId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const targetIdx = idx + (dir === "up" ? -1 : 1);
    if (targetIdx < 0 || targetIdx >= items.length) return;

    const a = items[idx];
    const b = items[targetIdx];

    const batch = writeBatch(db);
    batch.set(doc(db, "services", a.id), { order: b.order ?? targetIdx }, { merge: true });
    batch.set(doc(db, "services", b.id), { order: a.order ?? idx }, { merge: true });
    await batch.commit();
  }

  async function deleteServiceAndCompact(s) {
    const ok = window.confirm(`Obrisati uslugu "${s.name}"?`);
    if (!ok) return;

    await deleteDoc(doc(db, "services", s.id));

    const remaining = services
      .filter(x => x.categoryId === s.categoryId && x.id !== s.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const batch = writeBatch(db);
    remaining.forEach((item, i) => {
      batch.set(doc(db, "services", item.id), { order: i }, { merge: true });
    });
    await batch.commit();
  }

  return (
    <div className="services-page">
      <style>{`
        .services-page{
          min-height:100vh;
          padding: 16px clamp(10px, 4vw, 40px);
          background: #f7f4ef;
        }
        .page-title{
          font-family:"Playfair Display", serif;
          font-size: clamp(20px, 3vw, 28px);
          letter-spacing:.5px;
          margin: 8px 0 18px;
        }

        .category-card{
          background:#fff;
          border-radius:18px;
          padding: 14px;
          margin-bottom: 14px;
          box-shadow: 0 8px 24px rgba(0,0,0,.08);
          border-left: 6px solid #ddd;
        }

        .category-head{
          display:grid;
          grid-template-columns: 36px 1fr auto;
          gap: 10px;
          align-items:center;
          margin-bottom: 8px;
        }
        .btn-ghost.expand{
          width:36px; height:36px; border-radius:10px;
          border:1px solid #ddd6cc; background:#fff; cursor:pointer;
        }
        .cat-name{
          width:100%; padding:10px 12px; border-radius:12px;
          border:1px solid #e6e0d7; background:#fff; font-size:15px;
        }
        .cat-actions{ display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; align-items:center; }

        /* ====== Color Dropdown styles ====== */
        .color-dropdown { position: relative; }
        .color-dropdown .swatch{
          width: 28px; height: 28px; border-radius: 50%;
          border: none; cursor: pointer;
          box-shadow: inset 0 0 0 2px rgba(255,255,255,.9);
        }
        .color-dropdown .swatch.active {
          box-shadow: 0 0 0 2px #1f1f1f, inset 0 0 0 2px rgba(255,255,255,.9);
        }
        .color-dropdown .dropdown-panel{
          position: absolute; top: 36px; left: 0;
          background: #fff; border: 1px solid #ddd6cc; border-radius: 12px;
          padding: 6px; display: grid; grid-template-columns: repeat(5, 28px); gap: 6px;
          z-index: 20;
        }

        .srv-row{
          display:grid;
          grid-template-columns: 1fr 120px 160px 220px 1fr;
          grid-template-areas:
            "name dur price cat actions"
            "desc desc desc desc desc";
          gap: 10px;
          align-items: start;
          padding: 8px 0;
          border-top: 1px dashed #eee;
        }
        .srv-row:first-of-type{ border-top: 0; }
        .srv-row.add{ background:#faf8f5; border-radius:12px; padding:10px; }

        .srv-input{
          width:100%;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid #e6e0d7;
          background:#fff;
          font-size: 15px;
        }
        .srv-input.name{ grid-area: name; }
        .srv-input.dur{ grid-area: dur; }
        .price-wrap{ grid-area: price; position:relative; }
        .srv-input.price{ padding-right:56px; }
        .rsd{ position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#8a8378; font-size:12px; }
        .srv-input.cat{ grid-area: cat; }
        .row-actions{ grid-area: actions; display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap: wrap; }
        .srv-input.desc{
          grid-area: desc;
          resize: vertical;
          min-height: 64px;
          line-height: 1.35;
        }

        .btn-ghost{
          border:1px solid #ddd6cc; background:#fff; padding:8px 10px; border-radius:10px; cursor:pointer;
        }
        .btn-save, .btn-dark{
          border:0; background:#1f1f1f; color:#fff; padding:10px 14px; border-radius:12px; cursor:pointer;
        }
        .btn-danger{
          border:1px solid #f2c0c0;
          background:#fff;
          color:#b00020;
          padding:8px 12px;
          border-radius:10px;
          cursor:pointer;
        }
        .btn-danger:hover{ background:#ffecec; }

        .new-cat{
          display:flex; gap:10px; margin: 18px 0 24px; flex-wrap: wrap; align-items:center;
        }
        .new-cat input[type="text"]{
          flex:1; min-width: 220px; padding:10px 12px; border-radius:12px; border:1px solid #e6e0d7; background:#fff; font-size:15px;
        }

        /* TABLET / PHONE */
        @media (max-width: 900px){
          .srv-row{
            grid-template-columns: 1fr 110px 1fr;
            grid-template-areas:
              "name name name"
              "dur price price"
              "cat actions actions"
              "desc desc desc";
          }

          .row-actions .btn-ghost,
          .row-actions .btn-save,
          .row-actions .btn-dark,
          .row-actions .btn-danger{
            padding:8px 10px;
            font-size:13px;
            border-radius:10px;
          }
        }

        /* VERY SMALL PHONES */
        @media (max-width: 480px){
          .services-page{ padding:12px 10px; }
          .category-card{ padding:12px; }
          .srv-row{ gap:8px; }
          .srv-input{ font-size:14px; padding:9px 10px; }
          .rsd{ right:8px; font-size:11px; }
          .row-actions{ gap:6px; }
          .row-actions .btn-ghost,
          .row-actions .btn-save,
          .row-actions .btn-dark,
          .row-actions .btn-danger{
            padding:7px 9px;
            font-size:12px;
          }
        }
      `}</style>

      <h1 className="page-title">Usluge</h1>

      {/* Nova kategorija */}
      <div className="new-cat">
        <input
          type="text"
          placeholder="Nova kategorija (npr. Ruski manikir)"
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
        />

        {/* Izbor boje za novu kategoriju */}
        <ColorDropdown value={newCatColor} onChange={setNewCatColor} />

        <button
          className="btn-dark"
          onClick={async () => {
            const n = newCatName.trim();
            if (!n) return;
            await addCategory(n);
            setNewCatName("");
          }}
        >
          + Dodaj kategoriju
        </button>
      </div>

      {/* Kategorije */}
      {categories.length === 0 && (
        <div style={{opacity:.7}}>Nema kategorija. Dodaj prvu iznad.</div>
      )}

      {categories.map((cat) => {
        const items = servicesByCat.get(cat.id) || [];
        const open = !!openCats[cat.id];
        const color = cat.color || CAT_COLORS[0];

        return (
          <div
            key={cat.id}
            className="category-card"
            style={{ borderLeftColor: color }}
          >
            <CategoryHeader
              cat={cat}
              open={open}
              onToggle={() => setOpenCats((m) => ({ ...m, [cat.id]: !m[cat.id] }))}
              onRename={(name) => renameCategory(cat.id, name)}
              onPickColor={changeCategoryColor}
              onUp={() => moveCategory(cat.id, "up")}
              onDown={() => moveCategory(cat.id, "down")}
            />

            {open && (
              <>
                {items.map((s) => (
                  <ServiceRow
                    key={s.id}
                    s={s}
                    categories={categories}
                    onSave={saveService}
                    onMoveUp={() => moveServiceInCategory(cat.id, s.id, "up")}
                    onMoveDown={() => moveServiceInCategory(cat.id, s.id, "down")}
                    onDelete={deleteServiceAndCompact}
                  />
                ))}

                <AddServiceRow
                  categories={categories}
                  defaultCategoryId={cat.id}
                  nextOrder={items.length}
                  onAdd={addService}
                />
              </>
            )}
          </div>
        );
      })}

      {/* Nekategorizovano – za stare unose bez categoryId */}
      {(() => {
        const uncategorized = servicesByCat.get("__none__") || [];
        if (!uncategorized.length) return null;
        return (
          <div className="category-card">
            <div className="category-head">
              <div className="cat-name" style={{border:'none', padding:0}}>Nekategorizovano</div>
            </div>
            {uncategorized.map((s) => (
              <ServiceRow
                key={s.id}
                s={s}
                categories={categories}
                onSave={saveService}
                onMoveUp={() => {}}
                onMoveDown={() => {}}
                onDelete={deleteServiceAndCompact}
              />
            ))}
          </div>
        );
      })()}

    </div>
  );
}
