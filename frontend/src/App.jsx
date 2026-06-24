import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowDown, ArrowRight, ArrowUp, BarChart3, Bell, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Goal, House, LogOut, Megaphone, MessageCircle, Moon, Shield, Sparkles, Sun, Trophy, User, UserCog, X } from "lucide-react";
import { api } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { HistoryPage, DayHistoryPage } from "./pages/HistoryPage";
import { AdminPage } from "./pages/AdminPage";
import { MatchesPage } from "./pages/MatchesPage";
import { WorldCupPage } from "./pages/WorldCupPage";
import { ActivityPage, MatchDetailPage, ProfilePage, PublicProfilePage, UserSettingsPage } from "./pages/SocialPages";
import { ChatPage } from "./pages/ChatPage";
import { Avatar } from "./components/Avatar";
import { Flag } from "./components/SportsUI";
import { PushSettingsPage } from "./components/PushSettings";
import { startVisiblePolling } from "./utils/visiblePolling";

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function InitialLoadingScreen() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="initial-loading" role="status" aria-live="polite" aria-label="Cargando MundiPorra">
    <div className="initial-loading-glow" />
    <div className="initial-loading-content">
      <div className="initial-loading-mark"><img src="/images/mundial_2026.png" alt="" /></div>
      <div className="initial-loading-copy"><span>Loading…</span><strong>MundiPorra</strong></div>
      <div className="initial-loading-progress"><i /></div>
    </div>
  </div>;
}

function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) return <InitialLoadingScreen />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function AdminRoute() {
  const { user } = useAuth();
  return user?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
function ScrollToTopOnNavigation() {
  const location = useLocation();
  const previousKey = useRef(location.key);
  useEffect(() => {
    if (previousKey.current === location.key) return;
    previousKey.current = location.key;
    if (location.hash || location.pathname === "/chat") return;
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  }, [location.hash, location.key, location.pathname]);
  return null;
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
function NewsDrawer({ open, items, unreadCount, onClose, onMarkRead, onMarkAllRead }) {
  const swipeRef = useRef(null);
  const start = (event) => {
    if (event.pointerType === "mouse") return;
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };
  const end = (event) => {
    if (!swipeRef.current) return;
    const deltaX = event.clientX - swipeRef.current.x;
    const deltaY = event.clientY - swipeRef.current.y;
    swipeRef.current = null;
    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (deltaX < 0) onClose();
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="news-drawer-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="news-drawer" aria-label="Novedades" onPointerDown={start} onPointerUp={end} onPointerCancel={() => { swipeRef.current = null; }}>
      <header>
        <div><span className="eyebrow"><Megaphone size={14}/> NOVEDADES</span><h2>Últimas noticias</h2></div>
        <button type="button" aria-label="Cerrar novedades" title="Cerrar" onClick={onClose}><X size={18}/></button>
      </header>
      {unreadCount > 0 && <div className="news-drawer-tools"><button className="news-read-all" type="button" onClick={onMarkAllRead}>Marcar todas como leídas</button></div>}
      <div className="news-drawer-list">
        {items.length ? items.map((item) => <article key={item.id} className={item.read ? "read" : "unread"}>
          <div className="news-item-meta"><time>{new Date(item.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>{!item.read && <span>Nueva</span>}</div>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
          {!item.read && <button type="button" onClick={() => onMarkRead(item.id)}>Marcar como leída</button>}
        </article>) : <p className="empty-state">Todavía no hay novedades publicadas.</p>}
      </div>
    </aside>
  </div>;
}

function ProfileMenu({ unreadNews = 0, onOpenNews }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const toggle = () => {
    setOpen(value => !value);
  };
  const signOut = async () => {
    setOpen(false);
    await logout();
    navigate("/login", { replace: true });
  };
  return <div className="profile-menu" ref={menuRef}>
    <button className="profile-shortcut" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
      <span className="profile-avatar-wrap"><Avatar user={user}/>{unreadNews > 0 && <i className="profile-news-dot" aria-label={`${unreadNews} novedades pendientes`}/>}</span>
      <span><strong>{user.display_name||user.username}</strong><small>{user.is_read_only ? "Solo lectura" : user.role === "admin" ? "Administrador" : "Participante"}</small></span>
      <ChevronDown className={open ? "open" : ""} size={15}/>
    </button>
    {open && <div className="profile-dropdown">
      <>
        <button className={unreadNews > 0 ? "has-news-dot" : ""} onClick={() => { setOpen(false); onOpenNews(); }}><span className="profile-dropdown-icon"><Megaphone size={17}/>{unreadNews > 0 && <i className="profile-news-dot" aria-label={`${unreadNews} novedades pendientes`}/>}</span><span><strong>Novedades</strong><small>{unreadNews > 0 ? `${unreadNews} sin leer` : "Últimos avisos publicados"}</small></span></button>
        <button onClick={() => { setOpen(false); navigate("/perfil"); }}><User size={17}/><span><strong>Perfil</strong><small>Consulta tus estadísticas</small></span></button>
        <button onClick={() => { setOpen(false); navigate("/mundial"); }}><Goal size={17}/><span><strong>Mundial</strong><small>Información equipos mundial</small></span></button>
        {!user.is_read_only && <button onClick={() => { setOpen(false); navigate("/notificaciones"); }}><Bell size={17}/><span><strong>Notificaciones</strong><small>Configura los avisos push</small></span></button>}
        {!user.is_read_only && <button onClick={() => { setOpen(false); navigate("/modificar-usuario"); }}><UserCog size={17}/><span><strong>Modificar usuario</strong><small>Datos visibles y contraseña</small></span></button>}
        <button className="sign-out" onClick={signOut}><LogOut size={17}/><span><strong>Cerrar sesión</strong><small>Volver a la pantalla de acceso</small></span></button>
      </>
    </div>}
  </div>;
}
function TodayMatchesTicker({ fallback }) {
  const [matches, setMatches] = useState([]);
  const trackRef = useRef(null);
  const location = useLocation();
  useEffect(() => {
    let active = true;
    const load = () => api("/matches/today").then(data => {
      if (!active) return;
      setMatches(data
        .filter(match => match.result_team1 === null && match.result_team2 === null)
        .sort((a, b) => a.match_time.localeCompare(b.match_time)));
    }).catch(() => {});
    const stopPolling = startVisiblePolling(load, 30000);
    return () => {
      active = false;
      stopPolling();
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
function MovementSummaryPanel({ enabled = true }) {
  const [summaries,setSummaries]=useState([]);
  const [index,setIndex]=useState(0);
  const touchStart=useRef(null);
  const rankingRef=useRef(null);
  useEffect(()=>{
    if(!summaries.length)return;
    const scrollY=window.scrollY;
    const bodyStyles={overflow:document.body.style.overflow,position:document.body.style.position,top:document.body.style.top,width:document.body.style.width};
    const htmlOverflow=document.documentElement.style.overflow;
    document.documentElement.style.overflow="hidden";
    Object.assign(document.body.style,{overflow:"hidden",position:"fixed",top:`-${scrollY}px`,width:"100%"});
    return()=>{
      document.documentElement.style.overflow=htmlOverflow;
      Object.assign(document.body.style,bodyStyles);
      window.scrollTo(0,scrollY);
    };
  },[summaries.length]);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      const mine=rankingRef.current?.querySelector(".me");
      if(mine)rankingRef.current.scrollTop=mine.offsetTop-rankingRef.current.offsetTop-rankingRef.current.clientHeight/2+mine.clientHeight/2;
    });
    return()=>cancelAnimationFrame(frame);
  },[index,summaries.length]);
  useEffect(()=>{
    let active=true;
    const load=()=>api("/movement-summaries/pending").then(data=>{
      if(!active)return;
      setSummaries(current=>current.length?current:(data.summaries||[]));
    }).catch(()=>{});
    const stopPolling=startVisiblePolling(load,15000);
    const onVisible=()=>{if(!document.hidden)load()};
    window.addEventListener("focus",load);
    window.addEventListener("pageshow",load);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{active=false;stopPolling();window.removeEventListener("focus",load);window.removeEventListener("pageshow",load);document.removeEventListener("visibilitychange",onVisible)};
  },[]);
  const close=async()=>{
    const current=summaries;
    setSummaries([]);
    try{await api("/movement-summaries/seen",{method:"POST",body:{ids:current.map(item=>item.id)}})}
    catch{setSummaries(current)}
  };
  if(!enabled||!summaries.length)return null;
  const item=summaries[index];
  const prediction=item.prediction;
  const movement=Number(item.ranking.movement||0);
  const go=delta=>setIndex(value=>Math.max(0,Math.min(summaries.length-1,value+delta)));
  const reasons=prediction?[{
    label:"Ganador",points:prediction.winner_points
  },{label:"Resultado exacto",points:prediction.exact_result_points},{label:"Goleador",points:prediction.scorer_points}]:[];
  return <div className="movement-overlay" role="dialog" aria-modal="true" aria-labelledby="movement-title">
    <section className="movement-card" onTouchStart={event=>{touchStart.current={x:event.touches[0].clientX,y:event.touches[0].clientY}}} onTouchEnd={event=>{if(!touchStart.current)return;const dx=event.changedTouches[0].clientX-touchStart.current.x,dy=event.changedTouches[0].clientY-touchStart.current.y;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.35)go(dx<0?1:-1);touchStart.current=null}}>
      <header className="movement-head"><div><span><Sparkles size={13}/> TU JORNADA</span><h2 id="movement-title">Resumen movimientos</h2></div><button onClick={close} aria-label="Cerrar resumen"><X size={21}/></button></header>
      <div className="movement-scroll">
        <div className="movement-match-meta"><time>{new Date(`${item.match.date}T12:00:00`).toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long"})} · {item.match.time}</time>{item.match.is_star&&<b>PARTIDO ESTRELLA ×2</b>}</div>
        <div className="movement-score"><span><Flag team={item.match.team1}/>{item.match.team1}</span><strong>{item.match.result_team1}<i>–</i>{item.match.result_team2}</strong><span><Flag team={item.match.team2}/>{item.match.team2}</span></div>
        <div className="movement-scorers"><Goal size={15}/><span>Goleadores</span><strong>{item.match.scorers.length?item.match.scorers.join(", "):"Sin goleadores"}</strong></div>
        <div className="movement-my-pick"><small>Tu pronóstico</small>{prediction?<><strong><Flag team={item.match.team1}/>{prediction.predicted_team1_goals} – {prediction.predicted_team2_goals}<Flag team={item.match.team2}/></strong><span><Goal size={14}/>{prediction.predicted_scorer_name||"Sin goleador elegido"}</span></>:<p>No realizaste una apuesta para este partido.</p>}</div>
        <div className="movement-points"><div className={Number(item.points)>0?"has-points":""}><small>Has sumado</small><strong>+{item.points}</strong><span>puntos</span></div><div className="movement-reasons"><small>¿Por qué?</small>{prediction?<>{reasons.map(reason=><span className={Number(reason.points)>0?"earned":""} key={reason.label}>{Number(reason.points)>0?<Check size={13}/>:<X size={13}/>}<b>{reason.label}</b><em>+{reason.points||0}</em></span>)}{Number(prediction.scoring_multiplier)>1&&<span className="earned"><Sparkles size={13}/><b>Multiplicador estrella</b><em>×{prediction.scoring_multiplier}</em></span>}</>:<p>No registraste pronóstico para este partido.</p>}</div></div>
        <div className="movement-ranking-head"><div><small>Tu posición ahora</small><strong>#{item.ranking.position}</strong></div><span className={movement>0?"up":movement<0?"down":"same"}>{movement>0?<ArrowUp/>:movement<0?<ArrowDown/>:<ArrowRight/>}<b>{movement===0?"Sin cambios":`${Math.abs(movement)} ${Math.abs(movement)===1?"puesto":"puestos"}`}</b></span></div>
        <div className="movement-ranking" ref={rankingRef}>{item.ranking.context.map(row=>{const rankMovement=Number(row.movement||0),matchPoints=Number(row.match_points||0);return <div className={row.is_me?"me":""} key={row.id}><b>#{row.position}<i className={rankMovement>0?"up":rankMovement<0?"down":"same"}>{rankMovement>0?<ArrowUp/>:rankMovement<0?<ArrowDown/>:<span>=</span>}</i></b><span>{row.username}{row.is_me&&<small>Tú</small>}</span><strong>{matchPoints>0&&<small className="movement-rank-earned">+{matchPoints}</small>}{row.points} pts</strong></div>})}</div>
      </div>
      {summaries.length>1&&<footer className="movement-pagination"><button disabled={index===0} onClick={()=>go(-1)} aria-label="Partido anterior"><ChevronLeft size={19}/></button><div>{summaries.map((_,dot)=><button key={dot} className={dot===index?"active":""} onClick={()=>setIndex(dot)} aria-label={`Ver resumen ${dot+1}`}/>)}</div><span>{index+1} de {summaries.length}</span><button disabled={index===summaries.length-1} onClick={()=>go(1)} aria-label="Partido siguiente"><ChevronRight size={19}/></button></footer>}
    </section>
  </div>;
}
function MainLayout() {
  const { user, settings } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [theme,setTheme]=useState(()=>localStorage.getItem("theme")||"light");
  const [pendingAlert,setPendingAlert]=useState(false);
  const [unreadChat,setUnreadChat]=useState(0);
  const [newsOpen,setNewsOpen]=useState(false);
  const [newsData,setNewsData]=useState({items:[],unread_count:0});
  const [adminMessage,setAdminMessage]=useState(null);
  const [messageError,setMessageError]=useState("");
  const [answering,setAnswering]=useState(false);
  const [navExpanded,setNavExpanded]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme)},[theme]);
  useEffect(()=>{
    let lastY=window.scrollY;
    let ticking=false;
    let restTimer;
    const onScroll=()=>{
      if(ticking)return;
      ticking=true;
      window.requestAnimationFrame(()=>{
        const currentY=window.scrollY;
        if(currentY>lastY&&currentY>20)setNavExpanded(true);
        lastY=currentY;
        ticking=false;
        window.clearTimeout(restTimer);
        restTimer=window.setTimeout(()=>setNavExpanded(false),260);
      });
    };
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>{
      window.removeEventListener("scroll",onScroll);
      window.clearTimeout(restTimer);
    };
  },[]);
  useEffect(()=>{
    let frame;
    const repairMobileNav=()=>{
      if(!window.matchMedia("(max-width: 800px)").matches)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const nav=document.querySelector(".main-nav");
        if(!nav)return;
        const viewportHeight=Math.round(window.visualViewport?.height||window.innerHeight);
        nav.style.setProperty("--visual-viewport-height",`${viewportHeight}px`);
        nav.dataset.viewportRepair=String(Date.now());
      });
    };
    repairMobileNav();
    window.addEventListener("focus",repairMobileNav);
    window.addEventListener("pageshow",repairMobileNav);
    window.addEventListener("orientationchange",repairMobileNav);
    document.addEventListener("visibilitychange",repairMobileNav);
    window.visualViewport?.addEventListener("resize",repairMobileNav);
    window.visualViewport?.addEventListener("scroll",repairMobileNav);
    return()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener("focus",repairMobileNav);
      window.removeEventListener("pageshow",repairMobileNav);
      window.removeEventListener("orientationchange",repairMobileNav);
      document.removeEventListener("visibilitychange",repairMobileNav);
      window.visualViewport?.removeEventListener("resize",repairMobileNav);
      window.visualViewport?.removeEventListener("scroll",repairMobileNav);
    };
  },[]);
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
    return startVisiblePolling(loadChatStatus,10000);
  },[location.pathname]);
  const loadNews=()=>api("/news").then(result=>setNewsData(Array.isArray(result)?{items:result,unread_count:result.length}:result)).catch(()=>{});
  useEffect(()=>startVisiblePolling(loadNews,60000),[]);
  const loadAdminMessage=()=>api("/admin-messages/pending").then(data=>setAdminMessage(data.message)).catch(()=>{});
  useEffect(()=>{
    if(user.role==="admin"||user.is_read_only)return;
    return startVisiblePolling(loadAdminMessage,15000);
  },[user.role,user.is_read_only]);
  const answerAdminMessage=async optionId=>{
    setAnswering(true);setMessageError("");
    try{
      await api(`/admin-messages/${adminMessage.id}/respond`,{method:"POST",body:optionId?{option_id:optionId}:{}});
      await loadAdminMessage();
    }catch(error){setMessageError(error.message)}
    finally{setAnswering(false)}
  };
  const markNewsRead=async id=>{
    await api(`/news/${id}/read`,{method:"POST"});
    setNewsData(current=>({
      items:current.items.map(item=>item.id===id?{...item,read:true,read_at:new Date().toISOString()}:item),
      unread_count:Math.max(0,current.unread_count-1)
    }));
  };
  const markAllNewsRead=async()=>{
    await api("/news/read-all",{method:"POST"});
    setNewsData(current=>({
      items:current.items.map(item=>({...item,read:true,read_at:item.read_at||new Date().toISOString()})),
      unread_count:0
    }));
  };
  const items = [
    ["/", "Inicio", House],
    ["/partidos", "Partidos", Trophy],
    ["/clasificacion", "Clasificación", BarChart3],
    ["/actividad", "Actividad", Activity],
    ["/chat", "Chat", MessageCircle],
    ...(user.role === "admin" ? [["/gestion", "Gestión", Shield]] : [])
  ];
  return <div className="app-shell">
    <ScrollToTopOnNavigation/>
    <NewsDrawer open={newsOpen} items={newsData.items} unreadCount={newsData.unread_count} onClose={()=>setNewsOpen(false)} onMarkRead={markNewsRead} onMarkAllRead={markAllNewsRead}/>
    <MovementSummaryPanel enabled={!adminMessage}/>
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
      <div className="user-area"><button className="icon-btn" title="Cambiar tema" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>{theme==="dark"?<Sun size={18}/>:<Moon size={18}/>}</button><NotificationsBell/><ProfileMenu unreadNews={newsData.unread_count} onOpenNews={()=>setNewsOpen(true)}/></div>
    </header>
    <nav className={`main-nav app-bottom-nav bottom-nav-glass${navExpanded?" is-expanded":""}`} style={{ "--nav-items": items.length }}>{items.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to==="/"} className={({isActive})=>isActive?"active":""}><span className="nav-icon"><Icon size={18}/>{to==="/chat"&&unreadChat>0&&<i className="chat-unread-dot" aria-label={`${unreadChat} mensajes sin leer`}/>}</span><span>{label}</span></NavLink>)}</nav>
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
        <Route path="mundial" element={<WorldCupPage/>}/>
        <Route path="match/:id" element={<MatchDetailPage/>}/>
        <Route path="clasificacion" element={<LeaderboardPage/>}/>
        <Route path="perfil" element={<ProfilePage/>}/>
        <Route path="modificar-usuario" element={<UserSettingsPage/>}/>
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
