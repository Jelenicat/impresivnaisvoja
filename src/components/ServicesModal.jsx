// src/components/ServicesModal.jsx
import React, { useEffect, useState, useMemo } from "react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export default function ServicesModal({ open, onClose }) {
  const [categories, setCategories] = useState([]);
  const [services, setServices] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "categories"), orderBy("order"));
    return onSnapshot(q, snap => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, "services"), orderBy("categoryId"), orderBy("order"));
    return onSnapshot(q, snap => {
      setServices(snap.docs.map(d => ({ id: d.id, ...d.data() })));
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

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: "600px", width: "90%" }}>
        <h3>Usluge salona</h3>

        {categories.map(cat => (
          <div key={cat.id} style={{ marginBottom: "16px" }}>
            <h4 style={{ color: cat.color || "#333" }}>{cat.name}</h4>
            <ul style={{ paddingLeft: "18px" }}>
              {(servicesByCat.get(cat.id) || []).map(s => (
                <li key={s.id}>
                  {s.name}
                  {s.description && (
                    <p style={{ fontSize: "14px", color: "#555", margin: "4px 0" }}>
                      {s.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="actions">
          <button className="btn btn-dark" onClick={onClose}>Zatvori</button>
        </div>
      </div>
    </div>
  );
}
