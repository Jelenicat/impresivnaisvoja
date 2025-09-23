import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Splash() {
  const nav = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => nav("/home"), 1500);
    return () => clearTimeout(t);
  }, [nav]);

  return (
    <div className="splash">
      <div className="wordmark">impresivnaisvoja</div>
    </div>
  );
}
