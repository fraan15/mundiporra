import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, Eye, Info, Medal, Radio, Sparkles, Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { startVisiblePolling } from "../utils/visiblePolling";
import { BadgeCatalogDialog, Flag } from "../components/SportsUI";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { ActivityAvatar } from "../components/Avatar";

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
const hasResult = (match) => match.result_team1 !== null && match.result_team2 !== null;
const isCalendarMatchVisible = (match, todayKey) => {
  if (!match.published) return false;
  if (match.in_play) return true;
  if (match.betting_open) return true;
  return match.match_date === todayKey;
};
const predictionScoreText = (match, emptyText) => match.prediction_id ? `${match.predicted_team1_goals} – ${match.predicted_team2_goals}` : emptyText;
const predictionScorerText = (match, user) => !user.is_read_only && Number(match.scorer_enabled) && match.prediction_id && match.predicted_scorer?.name ? `Gol: ${match.predicted_scorer.name}` : "";
const closeText = (match, current) => {
  if (match.status === "finished") return "Finalizado";
  if (match.in_play) return "En juego";
  if (!match.betting_open) return "Cerrado";
  const ms = Math.max(0, new Date(match.effective_close_at) - current);
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms % 3600000 / 60000);
  return hours >= 24 ? `Cierra en ${Math.floor(hours / 24)} día ${hours % 24} h` : `Cierra en ${hours} h ${minutes} min`;
};
const closeState = (match) => match.status === "finished" ? "finished" : match.in_play ? "playing" : match.betting_open ? "open" : "closed";

function KnockoutInfoDialog({ onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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
          <div className="knockout-info-examples">
            <article><strong>Apuestas 1-1 y acaba 1-1 tras 120 minutos</strong><p>Aciertas empate y resultado exacto. Si luego un equipo gana en penaltis, no cambia nada para la porra.</p></article>
            <article><strong>Apuestas 2-2, acaba 2-2 en 90 minutos y 3-3 tras prórroga</strong><p>El resultado válido es 3-3. Aciertas el empate, pero no el resultado exacto.</p></article>
            <article><strong>Apuestas victoria 2-1 y el partido acaba 1-1 tras 120 minutos</strong><p>Para la porra es empate. No aciertas el signo aunque tu equipo pase en penaltis.</p></article>
            <article><strong>Apuestas 1-2 y el partido acaba 1-2 en la prórroga</strong><p>Cuenta como victoria visitante 1-2. Puedes acertar signo, resultado exacto y goleador si coincide.</p></article>
            <article><strong>Tu goleador marca en la prórroga</strong><p>Ese gol sí cuenta para el apartado de goleador.</p></article>
            <article><strong>Tu goleador marca solo en la tanda de penaltis</strong><p>Ese penalti no cuenta como gol para la porra.</p></article>
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

function DashboardCalendar({ matches, onOpenMatch, restoreScrollTop, user, currentTime }) {
  const daysRef = useRef(null);
  const pointerRef = useRef(null);
  const today = new Date(currentTime);
  const todayKey = dateKey(today);
  const calendarMatches = matches.filter(match => isCalendarMatchVisible(match, todayKey));
  const days = [-1, 0, 1, 2, 3].map(offset => {
    const date = addDays(today, offset), key = dateKey(date);
    return {
      key,
      title: dayTitle(date, offset),
      matches: calendarMatches.filter(match => match.match_date === key && (offset !== -1 || match.in_play)).sort((a, b) => a.match_time.localeCompare(b.match_time))
    };
  });
  const daysWithMatches = days.filter(day => day.matches.length);
  const saveScroll = () => {
    sessionStorage.setItem("dashboardCalendarScrollTop", String(daysRef.current?.scrollTop || 0));
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
    pointerRef.current = { x: event.clientX, y: event.clientY, moved: false };
  };
  const moveMatchPointer = (event) => {
    if (!pointerRef.current) return;
    const deltaX = Math.abs(event.clientX - pointerRef.current.x);
    const deltaY = Math.abs(event.clientY - pointerRef.current.y);
    if (deltaX > 8 || deltaY > 8) pointerRef.current.moved = true;
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
  useEffect(() => {
    if (restoreScrollTop === null || !daysRef.current) return;
    daysRef.current.scrollTop = restoreScrollTop;
  }, [restoreScrollTop, daysWithMatches.length]);

  return <section className="dashboard-calendar expanded" aria-label="Calendario de partidos">
    <header>
      <div><span className="eyebrow"><CalendarDays size={14}/> CALENDARIO</span><h2>Agenda cercana</h2></div>
    </header>
    <div className="calendar-days" ref={daysRef}>
      {daysWithMatches.length ? daysWithMatches.map(day => <article className="calendar-day" key={day.key}>
        <h3>{day.title}</h3>
        <div>{day.matches.length ? day.matches.map(match => <button type="button" className="calendar-match" key={match.id} onPointerDown={startMatchPointer} onPointerMove={moveMatchPointer} onPointerCancel={()=>{pointerRef.current=null}} onClick={event=>clickMatch(event, match)} onKeyDown={event=>openMatchOnKey(event, match)} aria-label={`Ver detalle de ${match.team1} contra ${match.team2}`}>
          <span className="calendar-match-main">
            <span className="calendar-team home"><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span>
            <b>{hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : match.match_time}</b>
            <span className="calendar-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
          </span>
          <span className="calendar-match-meta">
            <span className={`calendar-bet ${match.prediction_id ? "has-prediction" : "no-prediction"}`}>
              {user.is_read_only ? "Solo lectura" : match.prediction_id ? `Tu apuesta: ${match.predicted_team1_goals} - ${match.predicted_team2_goals}` : "Sin apuesta"}
            </span>
            <span className={`calendar-close ${closeState(match)}`}><Clock3 size={12}/>{closeText(match, currentTime)}</span>
            {(Boolean(match.is_star)||match.predicted_scorer?.name)&&<span className={`calendar-special ${match.is_star&&match.predicted_scorer?.name?"split":""}`}>
              {Boolean(match.is_star)&&<span className="calendar-star"><Star size={12} fill="currentColor"/> Estrella x2</span>}
              {match.predicted_scorer?.name&&<span className="calendar-scorer">Goleador: {match.predicted_scorer.name}</span>}
            </span>}
          </span>
        </button>) : <p>No hay partidos cargados.</p>}</div>
      </article>) : <p className="empty-state">No hay partidos cargados para los próximos días.</p>}
    </div>
  </section>;
}

export function DashboardPage() {
  const [calendarReturnInfo]=useState(()=>sessionStorage.getItem("dashboardCalendarReturn")==="1"?{scrollTop:Number(sessionStorage.getItem("dashboardCalendarScrollTop")||0)}:null);
  const {user}=useAuth(),navigate=useNavigate(),location=useLocation(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[calendarMatches,setCalendarMatches]=useState([]),[tick,setTick]=useState(Date.now()),[matchIndex,setMatchIndex]=useState(0),[liveMatchIndex,setLiveMatchIndex]=useState(0),[knockoutInfoOpen,setKnockoutInfoOpen]=useState(false),[medalInfoOpen,setMedalInfoOpen]=useState(false);
  const calendarRestoreScrollTop=calendarReturnInfo ? calendarReturnInfo.scrollTop : null;
  const swipeStart=useRef(null),liveSwipeStart=useRef(null),suppressNextClick=useRef(false),suppressLiveClick=useRef(false);
  const loadDashboard=()=>api("/dashboard").then(setData);
  useEffect(()=>{api("/activity?page=1&page_size=5").then(a=>setActivity(Array.isArray(a)?a.slice(0,5):a.items));const tickTimer=setInterval(()=>setTick(Date.now()),1000);const stopDashboard=startVisiblePolling(loadDashboard,15000);const stopMatches=startVisiblePolling(()=>api("/dashboard/calendar").then(setCalendarMatches),30000);return()=>{clearInterval(tickTimer);stopDashboard();stopMatches()}},[]);
  useEffect(()=>{if(location.pathname==="/")sessionStorage.removeItem("dashboardCalendarReturn")},[location.pathname]);
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
  const endLiveSwipe=(event)=>{
    if(!liveSwipeStart.current||inPlayMatches.length<2)return;
    const deltaX=event.clientX-liveSwipeStart.current.x,deltaY=event.clientY-liveSwipeStart.current.y;
    liveSwipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    suppressLiveClick.current=true;
    window.setTimeout(()=>{suppressLiveClick.current=false},0);
    setLiveMatchIndex(index=>(index+(deltaX<0?1:-1)+inPlayMatches.length)%inPlayMatches.length);
  };
  const openMatch=(match, suppressRef)=>{
    if(!match||suppressRef?.current)return;
    navigate(`/match/${match.id}`);
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
  {medalInfoOpen&&<BadgeCatalogDialog catalog={s.badge_catalog} disputed={s.disputed_badges} onClose={()=>setMedalInfoOpen(false)}/>}
  <div className="dashboard-overview">
  {user.role!=="admin"&&!user.is_read_only&&<button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button>}</div>
  <section className="worldcup-dashboard-actions" aria-label="Informacion del Mundial">
    <button onClick={()=>setKnockoutInfoOpen(true)}><Info size={20}/><span><strong>Info Eliminatorias</strong><small>Reglas de prórroga, penaltis y goleadores</small></span><ArrowRight size={17}/></button>
    <button onClick={()=>setMedalInfoOpen(true)}><Medal size={20}/><span><strong>Medallero</strong><small>Guía de medallas y lideratos actuales</small></span><ArrowRight size={17}/></button>
  </section>
  <DashboardCalendar matches={calendarMatches} onOpenMatch={openCalendarMatch} restoreScrollTop={calendarRestoreScrollTop} user={user} currentTime={tick}/>
              {liveMatch&&<section className="live-matches-section content-card"><div className="card-title"><div><span className="eyebrow live-label"><Radio size={14}/> EN DIRECTO</span><h2>Partidos en juego</h2></div><button className="detail-icon-button" aria-label="Ver detalle del partido en juego" title="Ver detalle" onClick={()=>navigate(`/match/${liveMatch.id}`)}><Eye size={17}/></button></div><div className="live-match-carousel" onPointerDown={event=>{if(event.pointerType!=="mouse")liveSwipeStart.current={x:event.clientX,y:event.clientY}}} onPointerUp={endLiveSwipe} onPointerCancel={()=>{liveSwipeStart.current=null}}><article className={`live-match-card ${liveMatch.is_star?"star-dashboard-card live-star-card":""}`}>{Boolean(liveMatch.is_star)&&<span className="live-star-badge"><Star size={13} fill="currentColor"/> Partido Estrella <b>x2</b></span>}<div className="live-match-teams match-open-card" onClick={()=>openMatch(liveMatch,suppressLiveClick)} onKeyDown={event=>openMatchOnKey(event,liveMatch,suppressLiveClick)} role="button" tabIndex={0} aria-label={`Ver detalle de ${liveMatch.team1} contra ${liveMatch.team2}`}><div><Flag team={liveMatch.team1} teamData={liveMatch.team1_team}/><strong>{liveMatch.team1}</strong></div><span className="live-versus"><b>VS</b><small><Clock3 size={12}/> Comenzó {liveMatch.match_time?.slice(0,5)}</small><em className="live-status-badge"><i/> Live</em></span><div><Flag team={liveMatch.team2} teamData={liveMatch.team2_team}/><strong>{liveMatch.team2}</strong></div></div><div className={`live-match-prediction ${liveMatch.prediction_id?"has-prediction":"no-prediction"}`}><span className="live-prediction-label">{user.is_read_only?"Participación":"Tu apuesta"}</span><DashboardPredictionValue match={liveMatch} user={user} emptyText="No apostado"/></div></article></div>{inPlayMatches.length>1&&<div className="match-carousel-controls live-match-carousel-controls"><button aria-label="Partido en juego anterior" onClick={()=>setLiveMatchIndex((liveMatchIndex-1+inPlayMatches.length)%inPlayMatches.length)}><ArrowLeft size={17}/></button><div>{inPlayMatches.map((match,index)=><button aria-label={`Ver partido en juego ${index+1}`} className={index===liveMatchIndex?"active":""} key={match.id} onClick={()=>setLiveMatchIndex(index)}/>)}</div><button aria-label="Partido en juego siguiente" onClick={()=>setLiveMatchIndex((liveMatchIndex+1)%inPlayMatches.length)}><ArrowRight size={17}/></button></div>}</section>}
  <div className="dashboard-grid">
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,4).map((a,i)=><article key={i}><ActivityAvatar user={a} type={a.type}/><div><strong className="activity-line">{a.text}{a.type==="points"&&<span className={`points-award ${a.exact_result_points>0?"exact":""}`}>{a.exact_result_points>0&&<Star size={14} fill="currentColor"/>}+{a.total_points} pts</span>}</strong><small>{new Date(a.created_at).toLocaleString("es-ES")}</small></div></article>)}</div></section></div></div>
}
