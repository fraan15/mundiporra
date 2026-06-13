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
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const load = async () => setData(await api("/notifications"));
  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);
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
  return <div className="notifications">
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
      <span className="avatar">{user.username[0].toUpperCase()}</span>
      <span><strong>{user.username}</strong><small>{user.role === "admin" ? "Administrador" : "Participante"}</small></span>
      <ChevronDown className={open ? "open" : ""} size={15}/>
    </button>
    {open && <div className="profile-dropdown">
      {!changingPassword ? <>
        <button onClick={() => { setOpen(false); navigate("/perfil"); }}><User size={17}/><span><strong>Perfil</strong><small>Consulta tus estadísticas</small></span></button>
        <button onClick={() => { setChangingPassword(true); setMessage({ type: "", text: "" }); }}><KeyRound size={17}/><span><strong>Cambiar contraseña</strong><small>Actualiza tu clave de acceso</small></span></button>
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
function MainLayout() {
  const { user, settings } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme,setTheme]=useState(()=>localStorage.getItem("theme")||"light");
  const [pendingAlert,setPendingAlert]=useState(false);
  const [unreadChat,setUnreadChat]=useState(0);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme)},[theme]);
  useEffect(()=>{
    if(sessionStorage.getItem("showPendingLoginAlert")!=="1")return;
    sessionStorage.removeItem("showPendingLoginAlert");
    if(user.role==="admin")return;
    let timer;
    api("/dashboard").then(data=>{
      if(data.summary.pending>0){
        setPendingAlert(true);
        timer=setTimeout(()=>setPendingAlert(false),10000);
      }
    });
    return()=>clearTimeout(timer);
  },[user.role]);
  useEffect(()=>{
    const loadChatStatus=()=>api("/chat/status").then(data=>setUnreadChat(data.unread)).catch(()=>{});
    loadChatStatus();
    const timer=setInterval(loadChatStatus,10000);
    return()=>clearInterval(timer);
  },[location.pathname]);
  const items = [
    ["/", "Inicio", LayoutDashboard],
    ["/partidos", "Partidos", Trophy],
    ["/clasificacion", "Clasificación", BarChart3],
    ["/actividad", "Actividad", Activity],
    ["/chat", "Chat", MessageCircle],
    ...(user.role === "admin" ? [["/gestion", "Gestión", Shield]] : [])
  ];
  return <div className="app-shell">
    {pendingAlert&&<div className="pending-login-alert">
      <button className="pending-login-alert-link" onClick={()=>{setPendingAlert(false);navigate("/partidos#upcoming")}}>
        <span>¡Hay partidos pendientes de apuesta!</span><small>Pulsa aquí para hacer tus pronósticos</small>
      </button>
      <button className="pending-login-alert-close" aria-label="Cerrar aviso" title="Cerrar" onClick={()=>setPendingAlert(false)}><X size={19}/></button>
    </div>}
    <header className="topbar">
      <button className="brand" onClick={() => navigate("/")}>
        <span className="brand-mark"><Trophy size={20}/></span>
        <span><strong>MundiPorra</strong><small>{settings.pool_name || "La porra oficial de tu Mundial"}</small></span>
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
