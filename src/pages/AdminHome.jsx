import React, { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./AdminHome.css"; // stilovi ostaju isti
import bg from "../assets/Admin.webp";

export default function AdminHome() {
  const nav = useNavigate();
  const role = localStorage.getItem("role") || "salon"; // admin | salon | employee
  const username = localStorage.getItem("username") || role;

  const items = useMemo(() => {
    if (role === "employee") {
      return [
        { label: "KALENDAR", to: "/admin/kalendar" },
        { label: "FINANSIJE", to: "/admin/finansije" },
      ];
    }

    if (role === "admin") {
      return [
        { label: "KALENDAR", to: "/admin/kalendar" },
        { label: "USLUGE", to: "/admin/usluge" },
        { label: "ZAPOSLENI", to: "/admin/zaposleni" },
        { label: "KLIJENTI", to: "/admin/klijenti" },
        { label: "SMENE", to: "/admin/smene" },
        { label: "FINANSIJE", to: "/admin/finansije" },
      ];
    }

    // role === "salon"
    return [
      { label: "KALENDAR", to: "/admin/kalendar" },
      { label: "FINANSIJE", to: "/admin/finansije" },
    ];
  }, [role]);

  function logout() {
    // UI logout
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    localStorage.removeItem("employeeId");
    nav("/");
  }

  return (
    <div className="admin-home" style={{ backgroundImage: `url(${bg})` }}>
      <div className="admin-home__buttons">
        {items.map((it) => (
          <Link key={it.label} to={it.to} className="admin-home__btn">
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}