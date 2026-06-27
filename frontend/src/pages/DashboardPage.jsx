import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Eye, Info, Medal, Radio, Sparkles, Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { startVisiblePolling } from "../utils/visiblePolling";
import { BadgeCatalogDialog, Flag } from "../components/SportsUI";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { ActivityAvatar } from "../components/Avatar";
import { countryTimeZone, formatLocalDateTime, localMatchDate, localMatchTime } from "../utils/matchDateTime";

const dateKey = (date) => date.toLocaleDateString("sv-SE");
const addDays = (date, days) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};
const dayTitle = (date, offset) => {
  if (offset === -1) return "Ayer";
  if (offset === 0) return "Hoy";
  if (offset === 1) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
};
const shortDate = (date) => date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
const hasResult = (match) => match.result_team1 !== null && match.result_team2 !== null;
const isCalendarMatchVisible = (match, calendarKeys, countryCode) => {
  if (!match.published) return false;
  if (match.in_play) return true;
  if (match.betting_open) return true;
  return calendarKeys.has(localMatchDate(match, countryCode));
};
const normalizeCalendarResponse = (payload) => Array.isArray(payload)
  ? { calendar_today: null, matches: payload }
  : { calendar_today: payload?.calendar_today || null, matches: Array.isArray(payload?.matches) ? payload.matches : [] };
const predictionScoreText = (match, emptyText) => match.prediction_id ? `${match.predicted_team1_goals} – ${match.predicted_team2_goals}` : emptyText;
const predictionScorerText = (match, user) => !user.is_read_only && Number(match.scorer_enabled) && match.prediction_id && match.predicted_scorer?.name ? `Gol: ${match.predicted_scorer.name}` : "";
const closeText = (match, current, countryCode) => {
  if (match.status === "finished") return match.match_time ? `Finalizado · ${localMatchTime(match, countryCode)}` : "Finalizado";
  if (match.in_play) return "En juego";
  if (!match.betting_open) return "Cerrado";
  const ms = Math.max(0, new Date(match.effective_close_at) - current);
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms % 3600000 / 60000);
  return hours >= 24 ? `Cierra en ${Math.floor(hours / 24)} día ${hours % 24} h` : `Cierra en ${hours} h ${minutes} min`;
};
const closeState = (match) => match.status === "finished" ? "finished" : match.in_play ? "playing" : match.betting_open ? "open" : "closed";

function KnockoutInfoDialog({ onClose }) {
  const examplesRef = useRef(null);
  const [activeExample, setActiveExample] = useState(0);
  const examples = [
    ["Apuestas 1-1 y acaba 1-1 tras 120 minutos", "Aciertas empate y resultado exacto. Si luego un equipo gana en penaltis, no cambia nada para la porra."],
    ["Apuestas 2-2, acaba 2-2 en 90 minutos y 3-3 tras prórroga", "El resultado válido es 3-3. Aciertas el empate, pero no el resultado exacto."],
    ["Apuestas victoria 2-1 y el partido acaba 1-1 tras 120 minutos", "Para la porra es empate. No aciertas el signo aunque tu equipo pase en penaltis."],
    ["Apuestas 1-2 y el partido acaba 1-2 en la prórroga", "Cuenta como victoria visitante 1-2. Puedes acertar signo, resultado exacto y goleador si coincide."],
    ["Tu goleador marca en la prórroga", "Ese gol sí cuenta para el apartado de goleador."],
    ["Tu goleador marca solo en la tanda de penaltis", "Ese penalti no cuenta como gol para la porra."]
  ];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const updateActiveExample = () => {
    const scroller = examplesRef.current;
    if (!scroller) return;
    const cards = Array.from(scroller.querySelectorAll("article"));
    if (!cards.length) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    const closestIndex = cards.reduce((bestIndex, card, index) => {
      const bestCard = cards[bestIndex];
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const bestCenter = bestCard.offsetLeft + bestCard.offsetWidth / 2;
      return Math.abs(cardCenter - center) < Math.abs(bestCenter - center) ? index : bestIndex;
    }, 0);
    setActiveExample(closestIndex);
  };

  const goToExample = (index) => {
    const card = examplesRef.current?.querySelectorAll("article")[index];
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    setActiveExample(index);
  };

  return <div className="knockout-info-overlay" role="dialog" aria-modal="true" aria-labelledby="knockout-info-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="knockout-info-dialog">
      <header>
        <div><span className="eyebrow"><Info size={14}/> INFO ELIMINATORIAS</span><h2 id="knockout-info-title">Cómo puntúan los partidos de eliminatoria</h2></div>
        <button type="button" aria-label="Cerrar información de eliminatorias" title="Cerrar" onClick={onClose}><X size={20}/></button>
      </header>
      <div className="knockout-info-scroll">
        <section>
          <h3>Desde cuándo aplica</h3>
          <p>A partir del domingo 28/06, en el partido de las 21:00, los partidos pasan a modo eliminatoria. A nivel de apuesta, todo sigue igual: eliges marcador y goleador como hasta ahora.</p>
        </section>
        <section>
          <h3>Resultado válido para la porra</h3>
          <ul>
            <li>Cuenta el marcador final hasta los 120 minutos.</li>
            <li>Si hay prórroga, la prórroga sí cuenta para el resultado.</li>
            <li>Si después de 120 minutos el partido está empatado, para la porra cuenta como empate.</li>
            <li>La tanda de penaltis no cuenta para el resultado, no cambia el signo y no añade goles ni goleadores.</li>
          </ul>
        </section>
        <section>
          <h3>Goleadores</h3>
          <ul>
            <li>Los goles marcados durante los 90 minutos cuentan.</li>
            <li>Los goles marcados en la prórroga cuentan.</li>
            <li>Los goles de una tanda de penaltis no cuentan para el goleador.</li>
          </ul>
        </section>
        <section>
          <h3>Puntos</h3>
          <p>El sistema de puntos sigue igual: se puntúa por signo o ganador del marcador válido, por resultado exacto y por goleador. Si el partido es estrella, se aplicará el multiplicador que ya usa la porra.</p>
        </section>
        <section>
          <h3>Ejemplos rápidos</h3>
          <div className="knockout-info-examples" ref={examplesRef} aria-label="Ejemplos rápidos de eliminatorias" onScroll={updateActiveExample}>
            {examples.map(([title, text]) => <article key={title}><strong>{title}</strong><p>{text}</p></article>)}
          </div>
          <div className="knockout-info-example-hint" aria-label="Páginas de ejemplos rápidos">
            {examples.map(([title], index) => (
              <button
                type="button"
                className={index === activeExample ? "active" : ""}
                key={`knockout-example-dot-${title}`}
                aria-label={`Ver ejemplo ${index + 1}`}
                onClick={() => goToExample(index)}
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  </div>;
}

function DashboardPredictionValue({ match, user, emptyText }) {
  const scorer = predictionScorerText(match, user);
  return <span className="dashboard-prediction-value">
    <strong>{user.is_read_only ? "Solo lectura" : predictionScoreText(match, emptyText)}</strong>
    {scorer && <em className="prediction-scorer" title={scorer}>{scorer}</em>}
  </span>;
}

function DashboardCalendar({ matches, calendarToday, onOpenMatch, restoreScrollTop, user, currentTime }) {
  const viewportRef = useRef(null);
  const pointerRef = useRef(null);
  const swipeRef = useRef(null);
  const [activeDayIndex, setActiveDayIndex] = useState(() => {
    if (sessionStorage.getItem("dashboardCalendarReturn") !== "1") return 1;
    const storedIndex = Number(sessionStorage.getItem("dashboardCalendarActiveDayIndex"));
    return Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex <= 2 ? storedIndex : 1;
  });
  const dragFrameRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: countryTimeZone(user.country_code),
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(currentTime));
  const today = new Date(`${localToday}T12:00:00`);
  const calendarOffsets = [-1, 0, 1];
  const calendarDates = calendarOffsets.map(offset => addDays(today, offset));
  const calendarKeys = new Set(calendarDates.map(dateKey));
  const calendarMatches = matches.filter(match => isCalendarMatchVisible(match, calendarKeys, user.country_code));
  const days = calendarOffsets.map(offset => {
    const date = addDays(today, offset), key = dateKey(date);
    return {
      offset,
      key,
      title: dayTitle(date, offset),
      subtitle: shortDate(date),
      matches: calendarMatches.filter(match => localMatchDate(match, user.country_code) === key).sort((a, b) => localMatchTime(a, user.country_code).localeCompare(localMatchTime(b, user.country_code)))
    };
  });
  const activeDay = days[activeDayIndex] || days[1];
  const goToDay = (index) => {
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setActiveDayIndex(Math.max(0, Math.min(days.length - 1, index)));
    setDragOffset(0);
    setIsDragging(false);
  };
  const setSmoothDragOffset = (value) => {
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = requestAnimationFrame(() => {
      setDragOffset(value);
      dragFrameRef.current = null;
    });
  };
  const saveScroll = () => {
    sessionStorage.setItem("dashboardCalendarScrollTop", String(window.scrollY || 0));
    sessionStorage.setItem("dashboardCalendarActiveDayIndex", String(activeDayIndex));
    sessionStorage.setItem("dashboardCalendarActiveDateKey", activeDay?.key || "");
    sessionStorage.setItem("dashboardCalendarReturn", "1");
  };
  const openMatch = (event, match) => {
    event.stopPropagation();
    saveScroll();
    onOpenMatch(match);
  };
  const openMatchOnKey = (event, match) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openMatch(event, match);
  };
  const startMatchPointer = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY, moved: false, blocked: false };
  };
  const moveMatchPointer = (event) => {
    if (!pointerRef.current) return;
    const deltaX = Math.abs(event.clientX - pointerRef.current.x);
    const deltaY = Math.abs(event.clientY - pointerRef.current.y);
    if (deltaX > 12 || deltaY > 12) pointerRef.current.moved = true;
  };
  const clickMatch = (event, match) => {
    if (pointerRef.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
      pointerRef.current = null;
      return;
    }
    pointerRef.current = null;
    openMatch(event, match);
  };
  const startSwipe = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeRef.current = { x: event.clientX, y: event.clientY, dragging: false, vertical: false, pointerId: event.pointerId };
  };
  const moveSwipe = (event) => {
    if (!swipeRef.current) return;
    const deltaX = event.clientX - swipeRef.current.x;
    const deltaY = event.clientY - swipeRef.current.y;
    const absX = Math.abs(deltaX), absY = Math.abs(deltaY);
    if (!swipeRef.current.dragging && !swipeRef.current.vertical) {
      if (absY > 14 && absY > absX * 1.05) {
        swipeRef.current = null;
        return;
      }
      if (absX > 18 && absX > absY * 1.35) {
        swipeRef.current.dragging = true;
        setIsDragging(true);
        viewportRef.current?.setPointerCapture?.(swipeRef.current.pointerId);
      }
    }
    if (swipeRef.current.vertical) return;
    if (swipeRef.current.dragging) {
      pointerRef.current = pointerRef.current ? { ...pointerRef.current, moved: true, blocked: true } : pointerRef.current;
      const width = viewportRef.current?.clientWidth || 1;
      const atStart = activeDayIndex === 0 && deltaX > 0;
      const atEnd = activeDayIndex === days.length - 1 && deltaX < 0;
      const resistance = atStart || atEnd ? 0.22 : 0.98;
      setSmoothDragOffset(Math.max(-width * 0.42, Math.min(width * 0.42, deltaX * resistance)));
    }
  };
  const endSwipe = (event) => {
    if (!swipeRef.current) return;
    const { x, y, dragging } = swipeRef.current;
    const deltaX = event.clientX - x, deltaY = event.clientY - y;
    swipeRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setIsDragging(false);
    setDragOffset(0);
    if (!dragging || Math.abs(deltaX) <= 45 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) return;
    pointerRef.current = pointerRef.current ? { ...pointerRef.current, moved: true, blocked: true } : pointerRef.current;
    window.setTimeout(() => { pointerRef.current = null; }, 0);
    goToDay(activeDayIndex + (deltaX < 0 ? 1 : -1));
  };
  const cancelSwipe = () => {
    swipeRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setIsDragging(false);
    setDragOffset(0);
  };
  useEffect(() => () => {
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
  }, []);
  useEffect(() => {
    if (sessionStorage.getItem("dashboardCalendarReturn") !== "1") return;
    const storedKey = sessionStorage.getItem("dashboardCalendarActiveDateKey");
    const storedIndex = Number(sessionStorage.getItem("dashboardCalendarActiveDayIndex"));
    const keyIndex = storedKey ? days.findIndex(day => day.key === storedKey) : -1;
    if (keyIndex >= 0) setActiveDayIndex(keyIndex);
    else if (Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < days.length) setActiveDayIndex(storedIndex);
  }, [days[0].key]);
  useEffect(() => {
    if (restoreScrollTop === null) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: restoreScrollTop, behavior: "auto" }));
  }, [restoreScrollTop]);

  return <section className="dashboard-calendar expanded" aria-label="Calendario de partidos">
    <header>
      <div><span className="eyebrow"><CalendarDays size={14}/> CALENDARIO</span></div>
    </header>
    <div className="dashboard-calendar-carousel">
      <div className="calendar-day-tabs" aria-label="Días del calendario">
        {days.map((day, index) => <button type="button" key={day.key} className={index === activeDayIndex ? "active" : ""} onClick={()=>goToDay(index)} aria-label={`Ver ${day.title}`}>
          <strong>{day.title}</strong>
          <span>{day.subtitle}</span>
        </button>)}
      </div>
      <div className="calendar-days-viewport" ref={viewportRef} onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={cancelSwipe}>
        <div className={`calendar-days-track ${isDragging ? "is-dragging" : "is-animating"}`} style={{ transform: `translate3d(calc(${-activeDayIndex * 100}% + ${dragOffset}px),0,0)` }}>
          {days.map((day, index) => <article className={`calendar-day-slide ${index === activeDayIndex ? "active" : ""} ${index === activeDayIndex - 1 ? "prev" : ""} ${index === activeDayIndex + 1 ? "next" : ""}`} key={day.key} aria-hidden={index !== activeDayIndex}>
            <header className="calendar-day-header">
              <h3>{day.title}</h3>
              <span>{day.matches.length ? `${day.matches.length} partido${day.matches.length === 1 ? "" : "s"}` : day.subtitle}</span>
            </header>
            <div className="calendar-day-matches">{day.matches.length ? day.matches.map(match => <button type="button" className="calendar-match" key={match.id} onPointerDown={startMatchPointer} onPointerMove={moveMatchPointer} onPointerCancel={()=>{pointerRef.current=null}} onClick={event=>clickMatch(event, match)} onKeyDown={event=>openMatchOnKey(event, match)} aria-label={`Ver detalle de ${match.team1} contra ${match.team2}`}>
          <span className="calendar-match-main">
            <span className="calendar-team home"><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span>
            <b>{hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : localMatchTime(match, user.country_code)}</b>
            <span className="calendar-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
          </span>
          <span className="calendar-match-meta">
            <span className={`calendar-bet ${match.prediction_id ? "has-prediction" : "no-prediction"}`}>
              {user.is_read_only ? "Solo lectura" : match.prediction_id ? `Tu apuesta: ${match.predicted_team1_goals} - ${match.predicted_team2_goals}` : "Sin apuesta"}
            </span>
            <span className={`calendar-close ${closeState(match)}`}><Clock3 size={12}/>{closeText(match, currentTime, user.country_code)}</span>
            {(Boolean(match.is_star)||match.predicted_scorer?.name)&&<span className={`calendar-special ${match.is_star&&match.predicted_scorer?.name?"split":""}`}>
              {Boolean(match.is_star)&&<span className="calendar-star"><Star size={12} fill="currentColor"/> Estrella x2</span>}
              {match.predicted_scorer?.name&&<span className="calendar-scorer">Goleador: {match.predicted_scorer.name}</span>}
            </span>}
          </span>
        </button>) : <p className="calendar-empty-day">{day.offset === 0 || day.offset === 1 ? "No hay partidos publicados." : "No hay partidos para este día"}</p>}</div>
          </article>)}
        </div>
      </div>
      <div className="calendar-carousel-controls" aria-label="Cambiar día del calendario">
        <button type="button" className="calendar-carousel-arrow" onClick={()=>goToDay(activeDayIndex - 1)} disabled={activeDayIndex === 0} aria-label="Ir a ayer"><ChevronLeft size={18}/></button>
        <div className="calendar-carousel-dots">
          {days.map((day, index) => <button type="button" key={day.key} className={index === activeDayIndex ? "active" : ""} onClick={()=>goToDay(index)} aria-label={`Ver ${day.title}`}/>)}
        </div>
        <button type="button" className="calendar-carousel-arrow" onClick={()=>goToDay(activeDayIndex + 1)} disabled={activeDayIndex === days.length - 1} aria-label="Ir a mañana"><ChevronRight size={18}/></button>
      </div>
    </div>
  </section>;
}

export function DashboardPage() {
  const [calendarReturnInfo]=useState(()=>sessionStorage.getItem("dashboardCalendarReturn")==="1"?{scrollTop:Number(sessionStorage.getItem("dashboardCalendarScrollTop")||0)}:null);
  const {user}=useAuth(),navigate=useNavigate(),location=useLocation(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[calendarMatches,setCalendarMatches]=useState([]),[calendarToday,setCalendarToday]=useState(null),[tick,setTick]=useState(Date.now()),[matchIndex,setMatchIndex]=useState(0),[liveMatchIndex,setLiveMatchIndex]=useState(0),[liveDragOffset,setLiveDragOffset]=useState(0),[isLiveDragging,setIsLiveDragging]=useState(false),[knockoutInfoOpen,setKnockoutInfoOpen]=useState(false),[medalInfoOpen,setMedalInfoOpen]=useState(false),[medalData,setMedalData]=useState(null);
  const calendarRestoreScrollTop=calendarReturnInfo ? calendarReturnInfo.scrollTop : null;
  const swipeStart=useRef(null),liveSwipeStart=useRef(null),liveDragFrame=useRef(null),suppressNextClick=useRef(false),suppressLiveClick=useRef(false),initialDashboardHydrated=useRef(false);
  const loadDashboard=()=>api("/dashboard").then((dashboard)=>{
    setData(dashboard);
    if(dashboard.calendar_today)setCalendarToday(dashboard.calendar_today);
    if(!initialDashboardHydrated.current){
      initialDashboardHydrated.current=true;
      if(Array.isArray(dashboard.activity_preview))setActivity(dashboard.activity_preview);
      if(Array.isArray(dashboard.calendar_matches))setCalendarMatches(dashboard.calendar_matches);
    }
  });
  const loadCalendar=()=>api("/dashboard/calendar").then((payload)=>{
    const calendar = normalizeCalendarResponse(payload);
    if(calendar.calendar_today)setCalendarToday(calendar.calendar_today);
    setCalendarMatches(calendar.matches);
  });
  useEffect(()=>{const tickTimer=setInterval(()=>setTick(Date.now()),1000);const stopDashboard=startVisiblePolling(loadDashboard,15000);const stopMatches=startVisiblePolling(loadCalendar,30000,{immediate:false});return()=>{clearInterval(tickTimer);stopDashboard();stopMatches()}},[]);
  useEffect(()=>{if(location.pathname==="/")sessionStorage.removeItem("dashboardCalendarReturn")},[location.pathname]);
  useEffect(()=>()=>{if(liveDragFrame.current)cancelAnimationFrame(liveDragFrame.current)},[]);
  if(!data)return <div className="page-loader"><span/></div>;
  const s=data.summary,inPlayMatches=data.in_play_matches||[],nextMatches=data.next_matches||[],m=nextMatches[matchIndex]||data.next_match,remaining=m?Math.max(0,new Date(m.effective_close_at)-tick):0;
  const countdown=remaining?`${Math.floor(remaining/86400000)}d ${Math.floor(remaining%86400000/3600000)}h ${Math.floor(remaining%3600000/60000)}m`:"Cerrado";
  const startSwipe=(event)=>{if(event.pointerType==="mouse")return;swipeStart.current={x:event.clientX,y:event.clientY}};
  const endSwipe=(event)=>{
    if(!swipeStart.current||nextMatches.length<2)return;
    const deltaX=event.clientX-swipeStart.current.x,deltaY=event.clientY-swipeStart.current.y;
    swipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    suppressNextClick.current=true;
    window.setTimeout(()=>{suppressNextClick.current=false},0);
    setMatchIndex(index=>(index+(deltaX<0?1:-1)+nextMatches.length)%nextMatches.length);
  };
  const goToLiveMatch=(index)=>{
    if(!inPlayMatches.length)return;
    if(liveDragFrame.current){
      cancelAnimationFrame(liveDragFrame.current);
      liveDragFrame.current=null;
    }
    setLiveDragOffset(0);
    setIsLiveDragging(false);
    setLiveMatchIndex((index+inPlayMatches.length)%inPlayMatches.length);
  };
  const setSmoothLiveDragOffset=(value)=>{
    if(liveDragFrame.current)cancelAnimationFrame(liveDragFrame.current);
    liveDragFrame.current=requestAnimationFrame(()=>{
      setLiveDragOffset(value);
      liveDragFrame.current=null;
    });
  };
  const startLiveSwipe=(event)=>{
    if(event.pointerType==="mouse"&&event.button!==0)return;
    if(inPlayMatches.length<2)return;
    liveSwipeStart.current={x:event.clientX,y:event.clientY,dragging:false,pointerId:event.pointerId};
  };
  const moveLiveSwipe=(event)=>{
    if(!liveSwipeStart.current||inPlayMatches.length<2)return;
    const deltaX=event.clientX-liveSwipeStart.current.x,deltaY=event.clientY-liveSwipeStart.current.y;
    const absX=Math.abs(deltaX),absY=Math.abs(deltaY);
    if(!liveSwipeStart.current.dragging){
      if(absY>12&&absY>absX*1.15){
        liveSwipeStart.current=null;
        return;
      }
      if(absX>16&&absX>absY*1.3){
        liveSwipeStart.current.dragging=true;
        setIsLiveDragging(true);
        event.currentTarget.setPointerCapture?.(liveSwipeStart.current.pointerId);
      }
    }
    if(!liveSwipeStart.current?.dragging)return;
    suppressLiveClick.current=true;
    const width=event.currentTarget.clientWidth||1;
    setSmoothLiveDragOffset(Math.max(-width*.52,Math.min(width*.52,deltaX)));
  };
  const endLiveSwipe=(event)=>{
    if(!liveSwipeStart.current)return;
    const {x,y,dragging}=liveSwipeStart.current;
    const deltaX=event.clientX-x,deltaY=event.clientY-y;
    const width=event.currentTarget.clientWidth||1;
    const threshold=Math.max(38,width*.16);
    liveSwipeStart.current=null;
    if(liveDragFrame.current){
      cancelAnimationFrame(liveDragFrame.current);
      liveDragFrame.current=null;
    }
    setLiveDragOffset(0);
    setIsLiveDragging(false);
    if(!dragging||inPlayMatches.length<2||Math.abs(deltaX)<threshold||Math.abs(deltaX)<=Math.abs(deltaY)*1.25){
      window.setTimeout(()=>{suppressLiveClick.current=false},0);
      return;
    }
    window.setTimeout(()=>{suppressLiveClick.current=false},0);
    goToLiveMatch(liveMatchIndex+(deltaX<0?1:-1));
  };
  const cancelLiveSwipe=()=>{
    liveSwipeStart.current=null;
    if(liveDragFrame.current){
      cancelAnimationFrame(liveDragFrame.current);
      liveDragFrame.current=null;
    }
    setLiveDragOffset(0);
    setIsLiveDragging(false);
    window.setTimeout(()=>{suppressLiveClick.current=false},0);
  };
  const openMatch=(match, suppressRef)=>{
    if(!match||suppressRef?.current)return;
    navigate(`/match/${match.id}`);
  };
  const openMedalInfo=()=>{
    setMedalInfoOpen(true);
    if(!medalData)api("/dashboard/medals").then(setMedalData);
  };
  const openCalendarMatch=(match)=>navigate(`/match/${match.id}`,{state:{fromDashboardCalendar:true}});
  const openMatchOnKey=(event, match, suppressRef)=>{
    if(event.key==="Enter"||event.key===" "){
      event.preventDefault();
      openMatch(match, suppressRef);
    }
  };
  const liveMatch=inPlayMatches[liveMatchIndex]||inPlayMatches[0];
  return <div className="page dashboard-page"><section className="hero-panel dashboard-hero"><div><span className="eyebrow"><Sparkles size={14}/> TU CENTRO DE JUEGO</span><h1>Hola, {user.display_name||user.username}</h1><p>{user.is_read_only?"Modo solo lectura: puedes consultar toda la porra sin participar.":s.pending?`Tienes ${s.pending} partidos pendientes de pronosticar.`:"Todo al día. A disfrutar de la jornada."}</p></div><button className="hero-rank" onClick={()=>navigate("/clasificacion")} title="Ver clasificación"><small>POSICIÓN</small><strong>#{s.position}</strong><span>{s.total_points} puntos</span></button></section>
  {knockoutInfoOpen&&<KnockoutInfoDialog onClose={()=>setKnockoutInfoOpen(false)}/>}
  {medalInfoOpen&&<BadgeCatalogDialog catalog={medalData?.badge_catalog} disputed={medalData?.disputed_badges} onClose={()=>setMedalInfoOpen(false)}/>}
  <div className="dashboard-overview">
  {user.role!=="admin"&&!user.is_read_only&&<button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button>}</div>
  <section className="worldcup-dashboard-actions" aria-label="Información del Mundial">
    <button type="button" className="worldcup-dashboard-action knockout" onClick={()=>setKnockoutInfoOpen(true)}>
      <span className="worldcup-action-icon"><Info size={20}/></span>
      <span className="worldcup-action-copy">
        <strong>Info Playoffs</strong>
        <small>Prórroga, penaltis y puntuación</small>
      </span>
      <span className="worldcup-action-arrow"><ArrowRight size={17}/></span>
    </button>
    <button type="button" className="worldcup-dashboard-action medals" onClick={openMedalInfo}>
      <span className="worldcup-action-icon"><Medal size={20}/></span>
      <span className="worldcup-action-copy">
        <strong>Medallero</strong>
        <small>Insignias y logros de la porra</small>
      </span>
      <span className="worldcup-action-arrow"><ArrowRight size={17}/></span>
    </button>
  </section>
  <DashboardCalendar matches={calendarMatches} calendarToday={calendarToday} onOpenMatch={openCalendarMatch} restoreScrollTop={calendarRestoreScrollTop} user={user} currentTime={tick}/>
              {liveMatch&&<section className="live-matches-section content-card"><div className="card-title"><div><span className="eyebrow live-label"><Radio size={14}/> EN DIRECTO</span><h2>Partidos en juego</h2><p>Sigue los encuentros activos ahora mismo</p></div><button className="detail-icon-button" aria-label="Ver detalle del partido en juego" title="Ver detalle" onClick={()=>navigate(`/match/${liveMatch.id}`)}><Eye size={17}/></button></div><div className={`live-match-carousel ${isLiveDragging?"is-dragging":""}`} onPointerDown={startLiveSwipe} onPointerMove={moveLiveSwipe} onPointerUp={endLiveSwipe} onPointerCancel={cancelLiveSwipe} onPointerLeave={event=>{if(event.pointerType==="mouse")cancelLiveSwipe()}}><div className={`live-match-track ${isLiveDragging?"is-dragging":""}`} style={{transform:`translate3d(calc(${-liveMatchIndex*100}% + ${liveDragOffset}px),0,0)`}}>{inPlayMatches.map(match=><div className="live-match-slide" key={match.id}><article className={`live-match-card ${match.is_star?"star-dashboard-card live-star-card":""}`} onClick={()=>openMatch(match,suppressLiveClick)} onKeyDown={event=>openMatchOnKey(event,match,suppressLiveClick)} role="button" tabIndex={0} aria-label={`Ver detalle de ${match.team1} contra ${match.team2}`}>{Boolean(match.is_star)&&<span className="live-star-badge"><Star size={13} fill="currentColor"/> Partido Estrella <b>x2</b></span>}<div className="live-match-teams match-open-card"><div><Flag team={match.team1} teamData={match.team1_team}/><strong>{match.team1}</strong></div><span className="live-versus"><b>VS</b><small><Clock3 size={12}/> Comenzó {localMatchTime(match,user.country_code)}</small><em className="live-status-badge"><i/> Live</em></span><div><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></div></div><div className={`live-match-prediction ${match.prediction_id?"has-prediction":"no-prediction"}`}><span className="live-prediction-label">{user.is_read_only?"Participación":"Tu apuesta"}</span><DashboardPredictionValue match={match} user={user} emptyText="No apostado"/></div></article></div>)}</div></div>{inPlayMatches.length>1&&<div className="match-carousel-controls live-match-carousel-controls"><button aria-label="Partido en juego anterior" onClick={()=>goToLiveMatch(liveMatchIndex-1)}><ArrowLeft size={17}/></button><div>{inPlayMatches.map((match,index)=><button aria-label={`Ver partido en juego ${index+1}`} className={liveMatchIndex===index?"active":""} key={match.id} onClick={()=>goToLiveMatch(index)}/>)}</div><button aria-label="Partido en juego siguiente" onClick={()=>goToLiveMatch(liveMatchIndex+1)}><ArrowRight size={17}/></button></div>}</section>}
  <div className="dashboard-grid">
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,4).map((a,i)=><article key={i}><ActivityAvatar user={a} type={a.type}/><div><strong className="activity-line">{a.text}{a.type==="points"&&<span className={`points-award ${a.exact_result_points>0?"exact":""}`}>{a.exact_result_points>0&&<Star size={14} fill="currentColor"/>}+{a.total_points} pts</span>}</strong><small>{formatLocalDateTime(a.created_at,user.country_code)}</small></div></article>)}</div></section></div></div>
}
