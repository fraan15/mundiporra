import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Activity, BarChart3, Bell, CheckCheck, ChevronDown, KeyRound, LayoutDashboard, LogOut, MessageCircle, Moon, Shield, Sun, Trophy, User, X } from "lucide-react";
import { api } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { HistoryPage, DayHistoryPage } from "./pages/HistoryPage";
import { AdminPage } from "./pages/AdminPage";
import { MatchesPage } from "./pages/MatchesPage";
import { ActivityPage, MatchDetailPage, ProfilePage, PublicProfilePage } from "./pages/SocialPages";
import { ChatPage } from "./pages/ChatPage";
import { Avatar } from "./components/Avatar";
import { PushSettingsPage } from "./components/PushSettings";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loader"><span /></div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function AdminRoute() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
function NotificationsBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notificationsRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const load = async () => setData(await api("/notifications"));
  useEffect(() => {
    if (user.is_read_only) return;
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [user.is_read_only]);
  useEffect(() => setOpen(false), [location.pathname, location.search, location.hash]);
  useEffect(() => {
    const close = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  if (user.is_read_only) return null;
  const read = async (notification) => {
    if (!notification.read) await api(`/notifications/${notification.id}/read`, { method: "PATCH" });
    setOpen(false);
    await load();
    if (notification.link) navigate(notification.link);
  };
  const readAll = async () => {
    await api("/notifications/read-all", { method: "POST" });
    await load();
  };
  return <div className="notifications" ref={notificationsRef}>
    <button className="bell-btn" title="Notificaciones" onClick={() => setOpen(!open)}>
      <Bell size={20}/>{data.unread > 0 && <span>{data.unread > 9 ? "9+" : data.unread}</span>}
    </button>
    {open && <div className="notifications-panel">
      <div className="notifications-head"><div><strong>Notificaciones</strong><small>{data.unread} sin leer</small></div><button onClick={() => setOpen(false)}><X size={18}/></button></div>
      {data.unread > 0 && <button className="read-all" onClick={readAll}><CheckCheck size={15}/>Marcar todo como leído</button>}
      <div className="notifications-list">{data.notifications.length ? data.notifications.map((item) =>
        <button key={item.id} className={item.read ? "" : "unread"} onClick={() => read(item)}>
          <span className={`notification-dot ${item.type}`}/><div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></div>
        </button>
      ) : <p className="empty-notifications">Todavía no hay notificaciones.</p>}</div>
    </div>}
  </div>;
}
function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [message, setMessage] = useState({ type: "", text: "" });
  useEffect(() => {
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const toggle = () => {
    setOpen(value => !value);
    setChangingPassword(false);
    setMessage({ type: "", text: "" });
  };
  const changePassword = async (event) => {
    event.preventDefault();
    if (form.new_password !== form.confirm_password) {
      setMessage({ type: "error", text: "Las nuevas contraseñas no coinciden." });
      return;
    }
    try {
      await api("/profile/password", {
        method: "PATCH",
        body: { current_password: form.current_password, new_password: form.new_password }
      });
      setForm({ current_password: "", new_password: "", confirm_password: "" });
      setMessage({ type: "success", text: "Contraseña cambiada correctamente." });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  };
  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };
  return <div className="profile-menu" ref={menuRef}>
    <button className="profile-shortcut" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
      <Avatar user={user}/>
      <span><strong>{user.username}</strong><small>{user.is_read_only ? "Solo lectura" : user.role === "admin" ? "Administrador" : "Participante"}</small></span>
      <ChevronDown className={open ? "open" : ""} size={15}/>
    </button>
    {open && <div className="profile-dropdown">
      {!changingPassword ? <>
        <button onClick={() => { setOpen(false); navigate("/perfil"); }}><User size={17}/><span><strong>Perfil</strong><small>Consulta tus estadísticas</small></span></button>
        {!user.is_read_only && <button onClick={() => { setOpen(false); navigate("/notificaciones"); }}><Bell size={17}/><span><strong>Notificaciones</strong><small>Configura los avisos push</small></span></button>}
        {!user.is_read_only && <button onClick={() => { setChangingPassword(true); setMessage({ type: "", text: "" }); }}><KeyRound size={17}/><span><strong>Cambiar contraseña</strong><small>Actualiza tu clave de acceso</small></span></button>}
        <button className="sign-out" onClick={signOut}><LogOut size={17}/><span><strong>Cerrar sesión</strong><small>Volver a la pantalla de acceso</small></span></button>
      </> : <form className="password-form" onSubmit={changePassword}>
        <div className="password-form-head"><div><strong>Cambiar contraseña</strong><small>Mínimo 4 caracteres</small></div><button type="button" onClick={() => setChangingPassword(false)}><X size={17}/></button></div>
        <label>Contraseña actual<input required type="password" autoComplete="current-password" value={form.current_password} onChange={event => setForm({...form,current_password:event.target.value})}/></label>
        <label>Nueva contraseña<input required minLength={4} type="password" autoComplete="new-password" value={form.new_password} onChange={event => setForm({...form,new_password:event.target.value})}/></label>
        <label>Repetir contraseña<input required minLength={4} type="password" autoComplete="new-password" value={form.confirm_password} onChange={event => setForm({...form,confirm_password:event.target.value})}/></label>
        {message.text && <p className={`password-message ${message.type}`}>{message.text}</p>}
        <button className="primary" type="submit">Guardar contraseña</button>
      </form>}
    </div>}
  </div>;
}
function TodayMatchesTicker({ fallback }) {
  const [matches, setMatches] = useState([]);
  const trackRef = useRef(null);
  const location = useLocation();
  useEffect(() => {
    let active = true;
    const load = () => api("/matches").then(data => {
      if (!active) return;
      const today = new Date().toLocaleDateString("sv-SE");
      setMatches(data
        .filter(match => match.match_date === today && match.result_team1 === null && match.result_team2 === null)
        .sort((a, b) => a.match_time.localeCompare(b.match_time)));
    }).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let frame;
    const resumeAnimation = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const animation = trackRef.current?.getAnimations().find(item => item.animationName === "today-matches-scroll");
        if (!animation) return;
        const currentTime = animation.currentTime;
        animation.cancel();
        if (currentTime !== null) animation.currentTime = currentTime;
        animation.play();
      });
    };
    const resumeWhenVisible = () => {
      if (!document.hidden) resumeAnimation();
    };

    resumeAnimation();
    window.addEventListener("focus", resumeAnimation);
    window.addEventListener("pageshow", resumeAnimation);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("focus", resumeAnimation);
      window.removeEventListener("pageshow", resumeAnimation);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [location.key, matches.length]);

  if (!matches.length) return <small>{fallback}</small>;
  const items = matches.map(match => `${match.team1} - ${match.team2} ${match.match_time}`);
  const group = (key) => <span className="today-matches-group" aria-hidden={key === "copy"} key={key}>
    {items.map((text, index) => <span className="today-match-item" key={`${key}-${index}`}>{text}</span>)}
  </span>;
  return <small className="today-matches-ticker" aria-label={`Partidos de hoy: ${items.join(", ")}`}>
    <span ref={trackRef} className="today-matches-track" style={{ "--ticker-duration": `${Math.max(18, items.length * 11)}s` }}>{group("main")}{group("copy")}</span>
  </small>;
}
function MainLayout() {
  const { user, settings } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme,setTheme]=useState(()=>localStorage.getItem("theme")||"light");
  const [pendingAlert,setPendingAlert]=useState(false);
  const [unreadChat,setUnreadChat]=useState(0);
  const [adminMessage,setAdminMessage]=useState(null);
  const [messageError,setMessageError]=useState("");
  const [answering,setAnswering]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme)},[theme]);
  useEffect(()=>{
    if(sessionStorage.getItem("showPendingLoginAlert")!=="1")return;
    sessionStorage.removeItem("showPendingLoginAlert");
    if(user.role==="admin"||user.is_read_only)return;
    let timer;
    api("/dashboard").then(data=>{
      if(data.summary.pending>0){
        setPendingAlert(true);
        timer=setTimeout(()=>setPendingAlert(false),10000);
      }
    });
    return()=>clearTimeout(timer);
  },[user.role,user.is_read_only]);
  useEffect(()=>{
    const loadChatStatus=()=>api("/chat/status").then(data=>setUnreadChat(data.unread)).catch(()=>{});
    loadChatStatus();
    const timer=setInterval(loadChatStatus,10000);
    return()=>clearInterval(timer);
  },[location.pathname]);
  const loadAdminMessage=()=>api("/admin-messages/pending").then(data=>setAdminMessage(data.message)).catch(()=>{});
  useEffect(()=>{
    if(user.role==="admin"||user.is_read_only)return;
    loadAdminMessage();
    const timer=setInterval(loadAdminMessage,15000);
    return()=>clearInterval(timer);
  },[user.role,user.is_read_only]);
  const answerAdminMessage=async optionId=>{
    setAnswering(true);setMessageError("");
    try{
      await api(`/admin-messages/${adminMessage.id}/respond`,{method:"POST",body:optionId?{option_id:optionId}:{}});
      await loadAdminMessage();
    }catch(error){setMessageError(error.message)}
    finally{setAnswering(false)}
  };
  const items = [
    ["/", "Inicio", LayoutDashboard],
    ["/partidos", "Partidos", Trophy],
    ["/clasificacion", "Clasificación", BarChart3],
    ["/actividad", "Actividad", Activity],
    ["/chat", "Chat", MessageCircle],
    ...(user.role === "admin" ? [["/gestion", "Gestión", Shield]] : [])
  ];
  return <div className="app-shell">
    {adminMessage&&<div className="mandatory-message-overlay" role="dialog" aria-modal="true" aria-labelledby="mandatory-message-title">
      <section className="mandatory-message-card">
        <div className="mandatory-message-content">
          <span className="eyebrow">{adminMessage.type==="poll"?"ENCUESTA DE ADMINISTRACIÓN":"MENSAJE DE ADMINISTRACIÓN"}</span>
          <h2 id="mandatory-message-title">{adminMessage.title}</h2>
          <p>{adminMessage.body}</p>
          {messageError&&<div className="alert error">{messageError}</div>}
        </div>
        <div className="mandatory-message-actions">
          {adminMessage.type==="poll"
            ?adminMessage.options.map(option=><button disabled={answering} className="poll-answer" key={option.id} onClick={()=>answerAdminMessage(option.id)}>{option.label}</button>)
            :<button disabled={answering} className="primary wide" onClick={()=>answerAdminMessage()}>{answering?"Guardando...":"He leído el mensaje"}</button>}
        </div>
        <small>Debes {adminMessage.type==="poll"?"responder":"confirmar la lectura"} para continuar.</small>
      </section>
    </div>}
    {pendingAlert&&<div className="pending-login-alert">
      <button className="pending-login-alert-link" onClick={()=>{setPendingAlert(false);navigate("/partidos#upcoming")}}>
        <span>¡Hay partidos pendientes de apuesta!</span><small>Pulsa aquí para hacer tus pronósticos</small>
      </button>
      <button className="pending-login-alert-close" aria-label="Cerrar aviso" title="Cerrar" onClick={()=>setPendingAlert(false)}><X size={19}/></button>
    </div>}
    <header className="topbar">
      <button className="brand" onClick={() => navigate("/")}>
        <span className="brand-mark"><img src="/images/mundial_2026.png" alt="" /></span>
        <span className="brand-copy"><strong>MundiPorra</strong><TodayMatchesTicker fallback={settings.pool_name || "MUNDIPORRA"}/></span>
      </button>
      <div className="user-area"><button className="icon-btn" title="Cambiar tema" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button><NotificationsBell/><ProfileMenu/></div>
    </header>
    <nav className="main-nav" style={{ "--nav-items": items.length }}>{items.map(([to, label, Icon]) => <button key={to} className={location.pathname === to || (to !== "/" && location.pathname.startsWith(to)) ? "active" : ""} onClick={() => navigate(to)}><span className="nav-icon"><Icon size={18}/>{to==="/chat"&&unreadChat>0&&<i className="chat-unread-dot" aria-label={`${unreadChat} mensajes sin leer`}/>}</span><span>{label}</span></button>)}</nav>
    <main><Outlet /></main>
  </div>;
}

export function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const refreshAuth = async () => {
    try { const data = await api("/auth/me"); setUser(data.user); setSettings(data.settings || {}); }
    finally { setLoading(false); }
  };
  useEffect(() => { refreshAuth(); }, []);
  const logout = async () => { await api("/auth/logout", { method: "POST" }); setUser(null); };
  return <AuthContext.Provider value={{ user, settings, loading, setUser, setSettings, refreshAuth, logout }}>
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace/> : <LoginPage/>}/>
      <Route element={<ProtectedRoute/>}><Route element={<MainLayout/>}>
        <Route index element={<DashboardPage/>}/>
        <Route path="partidos" element={<MatchesPage/>}/>
        <Route path="match/:id" element={<MatchDetailPage/>}/>
        <Route path="clasificacion" element={<LeaderboardPage/>}/>
        <Route path="perfil" element={<ProfilePage/>}/>
        <Route path="notificaciones" element={<PushSettingsPage/>}/>
        <Route path="chat" element={<ChatPage/>}/>
        <Route path="usuario/:id" element={<PublicProfilePage/>}/>
        <Route path="actividad" element={<ActivityPage/>}/>
        <Route path="historico" element={<HistoryPage/>}/>
        <Route path="historico/:date" element={<DayHistoryPage/>}/>
        <Route element={<AdminRoute/>}><Route path="gestion" element={<AdminPage/>}/></Route>
      </Route></Route>
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  </AuthContext.Provider>;
}
