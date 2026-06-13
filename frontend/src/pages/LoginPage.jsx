import { useState } from "react";
import { LockKeyhole, Trophy, UserRound } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../App";

export function LoginPage() {
  const { setUser, setSettings } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setError(""); setLoading(true);
    try {
      const data = await api("/auth/login", { method: "POST", body: form });
      sessionStorage.setItem("showPendingLoginAlert", "1");
      setUser(data.user);
      const me = await api("/auth/me"); setSettings(me.settings || {});
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return <div className="login-page">
    <div className="stadium-glow"/><div className="pitch-lines"/>
    <section className="login-story">
      <span className="eyebrow">MUNDIPORRA · CAMINO A LA COPA</span>
      <h1>Pronostica el Mundial.<br/><em>Conquista la clasificación.</em></h1>
      <p>Anticipa cada marcador, suma puntos y compite por levantar la copa de tu grupo.</p>
      <div className="stat-row"><div><strong>3</strong><span>Adivinar ganador</span></div><div><strong>5</strong><span>Resultado exacto</span></div><div><strong>8</strong><span>Adivinar ambos</span></div></div>
    </section>
    <form className="login-card" onSubmit={submit}>
      <div className="trophy-icon"><Trophy/></div>
      <span className="eyebrow">BIENVENIDO</span><h2>Entra en la porra</h2><p>Usa tus credenciales para continuar.</p>
      <label>Usuario<div className="input-shell"><UserRound size={18}/><input autoFocus autoComplete="username" value={form.username} onChange={e => setForm({...form,username:e.target.value})} placeholder="Tu nombre de usuario"/></div></label>
      <label>Contraseña<div className="input-shell"><LockKeyhole size={18}/><input type="password" autoComplete="current-password" value={form.password} onChange={e => setForm({...form,password:e.target.value})} placeholder="••••••••"/></div></label>
      {error && <div className="alert error">{error}</div>}
      <button className="primary wide" disabled={loading}>{loading ? "Entrando..." : "Entrar a la porra"}</button>
    </form>
  </div>;
}
