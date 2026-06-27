import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowDown, ArrowRight, ArrowUp, BarChart3, Bell, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Goal, Grid3X3, House, ListTree, LogOut, Medal, Megaphone, MessageCircle, Moon, Shield, Sparkles, Sun, Trophy, User, UserCog, X } from "lucide-react";
import { api } from "./api/client";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { HistoryPage, DayHistoryPage } from "./pages/HistoryPage";
import { AdminPage } from "./pages/AdminPage";
import { MatchesPage } from "./pages/MatchesPage";
import { WorldCupRedirect } from "./pages/WorldCupPage";
import { GroupsPage } from "./pages/GroupsPage";
import { KnockoutPage } from "./pages/KnockoutPage";
import { MedalsPage } from "./pages/MedalsPage";
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
function notificationTypeLabel(type) {
  const labels = {
    match_closed: "Partido",
    match_available: "Partido",
    match_reminder: "Recordatorio",
    result_published: "Resultado",
    points_earned: "Puntos",
    top_three: "Podio",
    points_adjustment: "Ajuste",
    match_comment: "Comentario",
    match_mention: "Mención",
    chat: "Chat",
    chat_reply: "Chat",
    chat_mention: "Mención",
    mention: "Mención",
    reaction: "Reacción"
  };
  return labels[type] || "Aviso";
}
function NotificationTypeIcon({ type, size = 15 }) {
  if (type === "points_earned" || type === "points_adjustment") return <Activity size={size} />;
  if (type === "top_three") return <Trophy size={size} />;
  if (type === "match_comment" || type === "chat" || type === "chat_reply" || type === "chat_mention") return <MessageCircle size={size} />;
  if (type === "match_mention" || type === "mention") return <Megaphone size={size} />;
  if (type === "match_closed" || type === "match_available" || type === "match_reminder" || type === "result_published") return <Goal size={size} />;
  return <Bell size={size} />;
}
function formatNotificationDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function NotificationsBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notificationsRef = useRef(null);
  const notificationSwipeRef = useRef(null);
  const notificationSwipeListenersRef = useRef(null);
  const suppressNotificationClickRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [swipe, setSwipe] = useState({ id: null, offset: 0, ready: false });
  const [dismissing, setDismissing] = useState({});
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
    if (!open) return undefined;
    const close = (event) => {
      if (!notificationsRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
      cleanupNotificationSwipeListeners();
      notificationSwipeRef.current = null;
      setSwipe({ id: null, offset: 0, ready: false });
    };
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const allowPanelScroll = (event) => {
      const list = event.target.closest?.(".notifications-list");
      return Boolean(
        list
        && notificationsRef.current?.contains(list)
        && list.scrollHeight > list.clientHeight + 1
      );
    };
    const stopBackgroundScroll = (event) => {
      if (!allowPanelScroll(event)) event.preventDefault();
    };
    const stopKeyboardScroll = (event) => {
      const scrollKeys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "];
      if (!scrollKeys.includes(event.key) || allowPanelScroll(event)) return;
      event.preventDefault();
    };
    document.addEventListener("wheel", stopBackgroundScroll, { passive: false });
    document.addEventListener("touchmove", stopBackgroundScroll, { passive: false });
    document.addEventListener("keydown", stopKeyboardScroll);
    return () => {
      document.removeEventListener("wheel", stopBackgroundScroll);
      document.removeEventListener("touchmove", stopBackgroundScroll);
      document.removeEventListener("keydown", stopKeyboardScroll);
    };
  }, [open]);
  if (user.is_read_only) return null;
  const read = async (notification) => {
    if (!notification.read) await api(`/notifications/${notification.id}/read`, { method: "PATCH" });
    setOpen(false);
    await load();
    if (notification.link) navigate(notification.link);
  };
  const markRead = async (notification) => {
    if (notification.read || dismissing[notification.id]) return;
    setSwipe({ id: null, offset: 0, ready: false });
    setDismissing((current) => ({ ...current, [notification.id]: true }));
    window.setTimeout(() => {
      setData((current) => ({
        notifications: current.notifications.map((item) => item.id === notification.id ? { ...item, read: true, read_at: new Date().toISOString() } : item),
        unread: Math.max(0, current.unread - 1)
      }));
    }, 220);
    try {
      await api(`/notifications/${notification.id}/read`, { method: "PATCH" });
      await load();
    } catch (error) {
      setDismissing((current) => {
        const next = { ...current };
        delete next[notification.id];
        return next;
      });
      await load().catch(() => {});
    }
  };
  const readAll = async () => {
    await api("/notifications/read-all", { method: "POST" });
    await load();
  };
  const cleanupNotificationSwipeListeners = () => {
    const listeners = notificationSwipeListenersRef.current;
    if (!listeners) return;
    document.removeEventListener("pointermove", listeners.move);
    document.removeEventListener("pointerup", listeners.end);
    document.removeEventListener("pointercancel", listeners.end);
    notificationSwipeListenersRef.current = null;
  };
  const startNotificationSwipe = (event, notification) => {
    if (notification.read || dismissing[notification.id] || event.button > 0 || event.target.closest(".notification-read-button")) return;
    cleanupNotificationSwipeListeners();
    notificationSwipeRef.current = { id: notification.id, pointerId: event.pointerId, notification, x: event.clientX, y: event.clientY, lastX: event.clientX, lastTime: performance.now(), velocity: 0, horizontal: null, moved: false, ready: false };
    const move = (moveEvent) => moveNotificationSwipe(moveEvent);
    const end = (endEvent) => endNotificationSwipe(endEvent);
    notificationSwipeListenersRef.current = { move, end };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  };
  const moveNotificationSwipe = (event) => {
    const state = notificationSwipeRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const deltaX = event.clientX - state.x;
    const deltaY = event.clientY - state.y;
    if (state.horizontal === null && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 7) state.horizontal = Math.abs(deltaX) > Math.abs(deltaY) * 1.1;
    if (!state.horizontal) return;
    event.preventDefault();
    suppressNotificationClickRef.current = true;
    state.moved = true;
    const now = performance.now();
    const elapsed = Math.max(1, now - state.lastTime);
    state.velocity = (event.clientX - state.lastX) / elapsed;
    state.lastX = event.clientX;
    state.lastTime = now;
    const offset = deltaX < 0 ? Math.max(-118, deltaX) : Math.min(18, deltaX * 0.22);
    state.ready = offset < -58 || (offset < -34 && state.velocity < -0.55);
    setSwipe({ id: state.id, offset, ready: state.ready });
  };
  const endNotificationSwipe = (event) => {
    const state = notificationSwipeRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    cleanupNotificationSwipeListeners();
    notificationSwipeRef.current = null;
    if (state.ready) {
      markRead(state.notification);
      window.setTimeout(() => { suppressNotificationClickRef.current = false; }, 80);
      return;
    }
    setSwipe({ id: null, offset: 0, ready: false });
    if (state.moved) window.setTimeout(() => { suppressNotificationClickRef.current = false; }, 80);
  };
  const visibleNotifications = data.notifications.filter((item) => !item.read);
  const unreadLabel = data.unread === 1 ? "1 notificación sin leer" : `${data.unread} notificaciones sin leer`;
  return <div className="notifications" ref={notificationsRef}>
    <button className={`bell-btn ${data.unread > 0 ? "has-unread" : ""}`} title="Notificaciones" aria-label={`Notificaciones, ${unreadLabel}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      <Bell size={20}/>{data.unread > 0 && <span className="bell-btn-badge">{data.unread > 9 ? "9+" : data.unread}</span>}
    </button>
    {open && <div className="notifications-panel" role="dialog" aria-label="Notificaciones">
      <div className="notifications-head">
        <div className="notifications-title-mark"><Bell size={18}/></div>
        <div className="notifications-summary"><strong>Notificaciones</strong><small>{data.unread} sin leer</small></div>
        <button className="notifications-close" type="button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={18}/></button>
      </div>
      {data.unread > 0 && <button className="read-all" onClick={readAll}><CheckCheck size={15}/>Marcar todo como leído</button>}
      <div className="notifications-list">{visibleNotifications.length ? visibleNotifications.map((item) => {
        const isSwiping = swipe.id === item.id;
        const swipeOffset = isSwiping ? swipe.offset : 0;
        const isDismissing = Boolean(dismissing[item.id]);
        return <div key={item.id} className={`notification-swipe-row ${isSwiping ? "swiping" : ""} ${isSwiping && swipe.ready ? "ready" : ""} ${isDismissing ? "dismissing" : ""}`} onPointerDown={(event) => startNotificationSwipe(event, item)}>
          <div className="notification-swipe-action" aria-hidden="true"><Check size={18}/><span>Leída</span></div>
          <div className="notification-swipe-card" style={{ transform: `translateX(${swipeOffset}px)` }}>
            <button className={`notification-item ${item.read ? "read" : "unread"}`} aria-label={`${item.title}. ${item.message}. ${notificationTypeLabel(item.type)}. ${item.read ? "Leída" : "Sin leer"}`} onClick={(event) => { if (suppressNotificationClickRef.current) { event.preventDefault(); suppressNotificationClickRef.current = false; return; } read(item); }}>
              <span className={`notification-type ${item.type}`} aria-hidden="true"><span className={`notification-dot ${item.type}`}><NotificationTypeIcon type={item.type}/></span></span>
              <span className="notification-content">
                <span className="notification-meta"><em>{notificationTypeLabel(item.type)}</em><small>{formatNotificationDate(item.created_at)}</small></span>
                <strong>{item.title}</strong>
                <span className="notification-message">{item.message}</span>
              </span>
            </button>
            <button className="notification-read-button" type="button" aria-label={`Marcar como leída: ${item.title}`} title="Marcar como leída" onClick={(event) => { event.stopPropagation(); markRead(item); }}><Check size={17}/></button>
          </div>
        </div>;
      }) : <div className="empty-notifications"><Bell size={24}/><strong>Todo al día</strong><span>No tienes notificaciones pendientes.</span></div>}</div>
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
  const location = useLocation();
  const menuRef = useRef(null);
  const swipeRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
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
  const closeMenu = () => {
    setOpen(false);
    setClosing(false);
    setDragging(false);
    setDragX(0);
    swipeRef.current = null;
  };
  const closeMenuWithSlide = () => {
    setClosing(true);
    setDragging(false);
    setDragX(0);
    window.setTimeout(closeMenu, 180);
  };
  const startSwipe = (event) => {
    if (event.pointerType === "mouse") return;
    swipeRef.current = { x: event.clientX, y: event.clientY, t: performance.now(), dx: 0 };
    setClosing(false);
  };
  const moveSwipe = (event) => {
    if (!swipeRef.current) return;
    const deltaX = event.clientX - swipeRef.current.x;
    const deltaY = event.clientY - swipeRef.current.y;
    if (!dragging && Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
    if (!dragging && Math.abs(deltaY) > Math.abs(deltaX)) {
      swipeRef.current = null;
      return;
    }
    const nextX = Math.max(0, deltaX);
    swipeRef.current.dx = nextX;
    setDragging(true);
    setDragX(nextX);
  };
  const endSwipe = () => {
    if (!swipeRef.current) return;
    const finalX = swipeRef.current.dx || 0;
    const elapsed = Math.max(1, performance.now() - swipeRef.current.t);
    const velocity = finalX / elapsed;
    swipeRef.current = null;
    if (finalX > 54 || (finalX > 24 && velocity > 0.45)) {
      closeMenuWithSlide();
      return;
    }
    setDragging(false);
    setDragX(0);
  };
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
  useEffect(() => {
    document.body.classList.toggle("profile-menu-open", open);
    document.documentElement.classList.toggle("profile-menu-open", open);
    return () => {
      document.body.classList.remove("profile-menu-open");
      document.documentElement.classList.remove("profile-menu-open");
    };
  }, [open]);
  const signOut = async () => {
    closeMenu();
    await logout();
    navigate("/login", { replace: true });
  };
  const roleLabel = user.is_read_only ? "Solo lectura" : user.role === "admin" ? "Administrador" : "Participante";
  const drawerClassName = `profile-side-drawer${dragging ? " is-dragging" : ""}${closing ? " is-closing" : ""}`;
  const drawerStyle = dragX > 0 ? { transform: `translate3d(${dragX}px,0,0)` } : undefined;
  const goTo = (path) => {
    closeMenu();
    navigate(path);
  };
  const openNews = () => {
    closeMenu();
    onOpenNews();
  };
  const isActiveRoute = (path) => path === "/" ? location.pathname === "/" : location.pathname === path || location.pathname.startsWith(`${path}/`);
  const mainItems = [
    { label: "Inicio", path: "/", Icon: House },
    { label: "Partidos", path: "/partidos", Icon: Trophy },
    { label: "Medallero", path: "/medallero", Icon: Medal },
    { label: "Grupos", path: "/grupos", Icon: Grid3X3 },
    { label: "Eliminatorias", path: "/eliminatorias", Icon: ListTree },
    { label: "Chat", path: "/chat", Icon: MessageCircle }
  ];
  const secondaryItems = [
    { label: "Novedades", Icon: Megaphone, onClick: openNews, badge: unreadNews > 0 ? (unreadNews > 9 ? "9+" : unreadNews) : null, badgeLabel: `${unreadNews} novedades pendientes` },
    ...(!user.is_read_only ? [
      { label: "Ajustes Notificaciones", path: "/notificaciones", Icon: Bell },
      { label: "Modificar usuario", path: "/modificar-usuario", Icon: UserCog }
    ] : [])
  ];
  return <div className="profile-menu" ref={menuRef}>
    <button className="profile-shortcut" aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
      <span className="profile-avatar-wrap"><Avatar user={user}/>{unreadNews > 0 && <i className="profile-news-dot" aria-label={`${unreadNews} novedades pendientes`}/>}</span>
      <span><strong>{user.display_name||user.username}</strong><small>{roleLabel}</small></span>
      <ChevronDown className={open ? "open" : ""} size={15}/>
    </button>
    {open && <div className="profile-side-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
      <aside className={drawerClassName} style={drawerStyle} role="dialog" aria-modal="true" aria-label="Menú de perfil" onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={endSwipe}>
        <header className="profile-side-header">
          <button className="profile-side-close" type="button" aria-label="Cerrar menú" title="Cerrar" onClick={closeMenu}><X size={20}/></button>
          <div className="profile-side-avatar-row">
            <button className="profile-side-avatar-button" type="button" aria-label="Ver perfil" title="Ver perfil" onClick={() => goTo("/perfil")}>
              <Avatar user={user} className="profile-side-avatar"/>
            </button>
            <button className="profile-side-view-profile" type="button" onClick={() => goTo("/perfil")}>
              Perfil
            </button>
          </div>
          <button className="profile-side-identity-button" type="button" onClick={() => goTo("/perfil")}>
            <h2>{user.display_name||user.username}</h2>
            <div className="profile-side-meta">
              <p>@{user.username}</p>
              <span className="profile-side-role">{roleLabel}</span>
            </div>
          </button>
        </header>
        <div className="profile-side-content">
          <nav className="profile-side-nav profile-side-main-nav" aria-label="Navegación principal de perfil">
            {mainItems.map(({ label, path, Icon }) => <button
              type="button"
              className={`profile-side-nav-button ${isActiveRoute(path) ? "active" : ""}`}
              aria-current={isActiveRoute(path) ? "page" : undefined}
              key={path}
              onClick={() => goTo(path)}
            >
              <Icon size={25}/><span>{label}</span>
            </button>)}
          </nav>
          <section className="profile-side-secondary-section">
            <nav className="profile-side-secondary-nav" aria-label="Opciones secundarias">
              {secondaryItems.map(({ label, path, Icon, onClick, badge, badgeLabel }) => <button
                type="button"
                className={`profile-side-secondary-button ${path && isActiveRoute(path) ? "active" : ""}`}
                aria-current={path && isActiveRoute(path) ? "page" : undefined}
                key={label}
                onClick={onClick || (() => goTo(path))}
              >
                <Icon size={20}/><span>{label}</span>{badge && <b className="profile-side-news-badge" aria-label={badgeLabel}>{badge}</b>}
              </button>)}
            </nav>
          </section>
        </div>
        <footer className="profile-side-footer">
          <button className="profile-side-logout" onClick={signOut}><LogOut size={22}/><span>Cerrar sesión</span></button>
        </footer>
      </aside>
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
      <div className="movement-scroll" key={item.id}>
        <div className="movement-match-meta"><time>{new Date(`${item.match.date}T12:00:00`).toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long"})} · {item.match.time}</time>{item.match.is_star&&<b>PARTIDO ESTRELLA ×2</b>}</div>
        <div className="movement-score"><span><Flag team={item.match.team1}/>{item.match.team1}</span><strong>{item.match.result_team1}<i>–</i>{item.match.result_team2}</strong><span><Flag team={item.match.team2}/>{item.match.team2}</span></div>
        <div className="movement-scorers"><Goal size={15}/><span>Goleadores</span><strong>{item.match.scorers.length?item.match.scorers.join(", "):"Sin goleadores"}</strong></div>
        <div className="movement-my-pick"><small>Tu pronóstico</small>{prediction?<><strong><Flag team={item.match.team1}/>{prediction.predicted_team1_goals} – {prediction.predicted_team2_goals}<Flag team={item.match.team2}/></strong><span><Goal size={14}/>{prediction.predicted_scorer_name||"Sin goleador elegido"}</span></>:<p>No realizaste una apuesta para este partido.</p>}</div>
        <div className="movement-points"><div className={Number(item.points)>0?"has-points":""}><small>Has sumado</small><strong>+{item.points}</strong><span>puntos</span></div><div className="movement-reasons"><small>¿Por qué?</small>{prediction?<>{reasons.map(reason=><span className={Number(reason.points)>0?"earned":""} key={reason.label}>{Number(reason.points)>0?<Check size={13}/>:<X size={13}/>}<b>{reason.label}</b><em>+{reason.points||0}</em></span>)}{Number(prediction.scoring_multiplier)>1&&<span className="earned"><Sparkles size={13}/><b>Multiplicador estrella</b><em>×{prediction.scoring_multiplier}</em></span>}</>:<p>No registraste pronóstico para este partido.</p>}</div></div>
        <div className="movement-ranking-head"><div><small>Tu posición ahora</small><strong>#{item.ranking.position}</strong></div><span className={movement>0?"up":movement<0?"down":"same"}>{movement>0?<ArrowUp/>:movement<0?<ArrowDown/>:<ArrowRight/>}<b>{movement===0?"Sin cambios":`${Math.abs(movement)} ${Math.abs(movement)===1?"puesto":"puestos"}`}</b></span></div>
        <div className="movement-ranking" ref={rankingRef}>{item.ranking.context.map(row=>{const rankMovement=Number(row.movement||0),matchPoints=Number(row.is_me?item.points:row.match_points||0);return <div className={row.is_me?"me":""} key={row.id}><b>#{row.position}<i className={rankMovement>0?"up":rankMovement<0?"down":"same"}>{rankMovement>0?<ArrowUp/>:rankMovement<0?<ArrowDown/>:<span>=</span>}</i></b><span>{row.username}{row.is_me&&<small>Tú</small>}</span><strong>{matchPoints>0&&<small className="movement-rank-earned">+{matchPoints}</small>}{row.points} pts</strong></div>})}</div>
      </div>
      {summaries.length>1&&<footer className="movement-pagination"><button disabled={index===0} onClick={()=>go(-1)} aria-label="Partido anterior"><ChevronLeft size={19}/></button><div>{summaries.map((_,dot)=><button key={dot} className={dot===index?"active":""} onClick={()=>setIndex(dot)} aria-label={`Ver resumen ${dot+1}`}/>)}</div><span>{index+1} de {summaries.length}</span><button disabled={index===summaries.length-1} onClick={()=>go(1)} aria-label="Partido siguiente"><ChevronRight size={19}/></button></footer>}
    </section>
  </div>;
}
function MainLayout() {
  const { user, settings } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isChatRoute = location.pathname === "/chat";
  const [theme,setTheme]=useState(()=>localStorage.getItem("theme")||"light");
  const [pendingAlert,setPendingAlert]=useState(false);
  const [unreadChat,setUnreadChat]=useState(0);
  const [newsOpen,setNewsOpen]=useState(false);
  const [newsData,setNewsData]=useState({items:[],unread_count:0});
  const [adminMessage,setAdminMessage]=useState(null);
  const [messageError,setMessageError]=useState("");
  const [answering,setAnswering]=useState(false);
  const [navExpanded,setNavExpanded]=useState(false);
  const navExpandedRef=useRef(false);
  const navRef=useRef(null);
  const navItemRefs=useRef([]);
  const dragStateRef=useRef(null);
  const suppressNavClickRef=useRef(false);
  const isNavDraggingRef=useRef(false);
  const lastViewportHeightRef=useRef(0);
  const [bubble,setBubble]=useState({x:0,width:58,height:52});
  const [isNavDragging,setIsNavDragging]=useState(false);
  useEffect(()=>{document.documentElement.dataset.theme=theme;localStorage.setItem("theme",theme)},[theme]);
  useEffect(()=>{isNavDraggingRef.current=isNavDragging},[isNavDragging]);
  const setNavExpandedSafe=useCallback(value=>{
    if(navExpandedRef.current===value)return;
    navExpandedRef.current=value;
    setNavExpanded(value);
  },[]);
  useEffect(()=>{
    let lastY=window.scrollY;
    let ticking=false;
    let restTimer;
    const onScroll=()=>{
      if(ticking)return;
      ticking=true;
      window.requestAnimationFrame(()=>{
        const currentY=window.scrollY;
        const delta=currentY-lastY;
        if(!isNavDraggingRef.current&&delta>4&&currentY>20)setNavExpandedSafe(true);
        lastY=currentY;
        ticking=false;
        window.clearTimeout(restTimer);
        restTimer=window.setTimeout(()=>setNavExpandedSafe(false),220);
      });
    };
    window.addEventListener("scroll",onScroll,{passive:true});
    return()=>{
      window.removeEventListener("scroll",onScroll);
      window.clearTimeout(restTimer);
    };
  },[setNavExpandedSafe]);
  useEffect(()=>{
    let frame;
    const repairMobileNav=()=>{
      if(!window.matchMedia("(max-width: 800px)").matches)return;
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        const nav=document.querySelector(".main-nav");
        if(!nav)return;
        const viewportHeight=Math.round(window.visualViewport?.height||window.innerHeight);
        if(Math.abs(viewportHeight-lastViewportHeightRef.current)<1)return;
        lastViewportHeightRef.current=viewportHeight;
        nav.style.setProperty("--visual-viewport-height",`${viewportHeight}px`);
      });
    };
    repairMobileNav();
    window.addEventListener("focus",repairMobileNav);
    window.addEventListener("pageshow",repairMobileNav);
    window.addEventListener("orientationchange",repairMobileNav);
    document.addEventListener("visibilitychange",repairMobileNav);
    window.visualViewport?.addEventListener("resize",repairMobileNav);
    return()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener("focus",repairMobileNav);
      window.removeEventListener("pageshow",repairMobileNav);
      window.removeEventListener("orientationchange",repairMobileNav);
      document.removeEventListener("visibilitychange",repairMobileNav);
      window.visualViewport?.removeEventListener("resize",repairMobileNav);
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
    ["/clasificacion", "Ranking", BarChart3],
    ["/actividad", "Actividad", Activity],
    ["/chat", "Chat", MessageCircle],
    ...(user.role === "admin" ? [["/gestion", "Gestión", Shield]] : [])
  ];
  const activeNavIndex=items.findIndex(([to])=>to==="/" ? location.pathname==="/" : location.pathname===to || location.pathname.startsWith(`${to}/`));
  const clamp=(value,min,max)=>Math.min(Math.max(value,min),max);
  const getBubbleForIndex=useCallback(index=>{
    const item=navItemRefs.current[index];
    if(!item)return null;
    const x=Math.round(item.offsetLeft);
    const width=Math.round(item.offsetWidth);
    const height=Math.round(item.offsetHeight);
    return {x,width,height};
  },[]);
  const updateBubble=useCallback(next=>{
    if(!next)return;
    setBubble(current=>{
      if(Math.abs(current.x-next.x)<1&&Math.abs(current.width-next.width)<1&&Math.abs(current.height-next.height)<1)return current;
      return next;
    });
  },[]);
  const setBubbleXDom=useCallback(x=>{
    navRef.current?.style.setProperty("--bubble-x",`${Math.round(x)}px`);
  },[]);
  const moveBubbleToActive=useCallback(()=>{
    if(activeNavIndex<0)return;
    const nextBubble=getBubbleForIndex(activeNavIndex);
    updateBubble(nextBubble);
  },[activeNavIndex,getBubbleForIndex,updateBubble]);
  useLayoutEffect(()=>{
    if(isNavDragging)return;
    moveBubbleToActive();
  },[isNavDragging,items.length,location.pathname,moveBubbleToActive]);
  useEffect(()=>{
    const reposition=()=>moveBubbleToActive();
    window.addEventListener("resize",reposition);
    window.addEventListener("orientationchange",reposition);
    window.visualViewport?.addEventListener("resize",reposition);
    return()=>{
      window.removeEventListener("resize",reposition);
      window.removeEventListener("orientationchange",reposition);
      window.visualViewport?.removeEventListener("resize",reposition);
    };
  },[moveBubbleToActive]);
  const getNearestNavIndex=useCallback((x,width)=>{
    const bubbleCenter=x+width/2;
    let nearestIndex=-1;
    let nearestDistance=Infinity;
    navItemRefs.current.forEach((item,index)=>{
      if(!item)return;
      const itemCenter=item.offsetLeft+item.offsetWidth/2;
      const distance=Math.abs(itemCenter-bubbleCenter);
      if(distance<nearestDistance){
        nearestDistance=distance;
        nearestIndex=index;
      }
    });
    const nearestItem=navItemRefs.current[nearestIndex];
    if(!nearestItem)return -1;
    const threshold=Math.max(24,nearestItem.offsetWidth*.46);
    return nearestDistance<=threshold ? nearestIndex : -1;
  },[]);
  const handleNavPointerDown=event=>{
    if(event.button!==undefined&&event.button!==0)return;
    const nav=navRef.current;
    if(!nav||activeNavIndex<0||!window.matchMedia("(max-width: 800px)").matches)return;
    dragStateRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,startBubbleX:bubble.x,currentBubbleX:bubble.x,bubbleWidth:bubble.width,hasMoved:false};
  };
  const handleNavPointerMove=event=>{
    const drag=dragStateRef.current;
    const nav=navRef.current;
    if(!drag||drag.pointerId!==event.pointerId||!nav)return;
    const deltaX=event.clientX-drag.startX;
    const deltaY=event.clientY-drag.startY;
    let startedDrag=false;
    if(!drag.hasMoved){
      if(Math.abs(deltaY)>8&&Math.abs(deltaY)>Math.abs(deltaX)){
        dragStateRef.current=null;
        return;
      }
      if(Math.abs(deltaX)<=8||Math.abs(deltaX)<=Math.abs(deltaY)*1.25)return;
      drag.hasMoved=true;
      suppressNavClickRef.current=true;
      setIsNavDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      startedDrag=true;
    }
    event.preventDefault();
    const nextX=clamp(drag.startBubbleX+deltaX,0,Math.max(0,nav.offsetWidth-drag.bubbleWidth));
    drag.currentBubbleX=nextX;
    if(startedDrag)setBubble(current=>({...current,x:Math.round(nextX)}));
    setBubbleXDom(nextX);
  };
  const finishNavDrag=event=>{
    const drag=dragStateRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    dragStateRef.current=null;
    if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture?.(event.pointerId);
    if(!drag.hasMoved){
      setIsNavDragging(false);
      return;
    }
    event.preventDefault();
    setIsNavDragging(false);
    window.setTimeout(()=>{suppressNavClickRef.current=false;},0);
    const nearestIndex=getNearestNavIndex(drag.currentBubbleX,drag.bubbleWidth);
    if(nearestIndex>=0&&nearestIndex!==activeNavIndex){
      navigate(items[nearestIndex][0]);
      return;
    }
    setBubble(current=>({...current,x:Math.round(drag.currentBubbleX)}));
    moveBubbleToActive();
  };
  const handleNavClickCapture=event=>{
    if(!suppressNavClickRef.current)return;
    event.preventDefault();
    event.stopPropagation();
  };
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
    {!isChatRoute&&<nav ref={navRef} className={`main-nav app-bottom-nav bottom-nav-glass${navExpanded?" is-expanded":""}${isNavDragging?" is-dragging":""}`} style={{ "--nav-items": items.length, "--bubble-x": `${bubble.x}px`, "--bubble-width": `${bubble.width}px`, "--bubble-height": `${bubble.height}px` }} onPointerDown={handleNavPointerDown} onPointerMove={handleNavPointerMove} onPointerUp={finishNavDrag} onPointerCancel={finishNavDrag} onClickCapture={handleNavClickCapture}>
      {activeNavIndex>=0&&<span className="bottom-nav-bubble" aria-hidden="true"/>}
      {items.map(([to, label, Icon],index) => <NavLink ref={node=>{navItemRefs.current[index]=node;}} key={to} to={to} end={to==="/"} aria-label={label} title={label} className={({isActive})=>isActive?"active":""}><span className="nav-icon"><Icon size={18}/>{to==="/chat"&&unreadChat>0&&<i className="chat-unread-dot" aria-label={`${unreadChat} mensajes sin leer`}/>}</span><span className="nav-label">{label}</span></NavLink>)}
    </nav>}
    <main className={isChatRoute ? "chat-main" : ""}><Outlet /></main>
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
        <Route path="mundial" element={<WorldCupRedirect/>}/>
        <Route path="grupos" element={<GroupsPage/>}/>
        <Route path="eliminatorias" element={<KnockoutPage/>}/>
        <Route path="match/:id" element={<MatchDetailPage/>}/>
        <Route path="clasificacion" element={<LeaderboardPage/>}/>
        <Route path="medallero" element={<MedalsPage/>}/>
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
