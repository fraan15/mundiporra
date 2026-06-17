import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, Eye, Maximize2, Minimize2, Radio, Sparkles, Star } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Flag } from "../components/SportsUI";
import { StarMatchTitle } from "../components/StarMatchTitle";

const dateKey = (date) => date.toLocaleDateString("sv-SE");
const addDays = (date, days) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};
const dayTitle = (date, index) => {
  if (index === 0) return "Hoy";
  if (index === 1) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
};
const hasResult = (match) => match.result_team1 !== null && match.result_team2 !== null;
const COLLAPSED_CALENDAR_MATCH_LIMIT = 4;
const predictionScoreText = (match, emptyText) => match.prediction_id ? `${match.predicted_team1_goals} – ${match.predicted_team2_goals}` : emptyText;
const predictionScorerText = (match, user) => !user.is_read_only && Number(match.scorer_enabled) && match.prediction_id && match.predicted_scorer?.name ? `Gol: ${match.predicted_scorer.name}` : "";

function DashboardPredictionValue({ match, user, emptyText }) {
  const scorer = predictionScorerText(match, user);
  return <span className="dashboard-prediction-value">
    <strong>{user.is_read_only ? "Solo lectura" : predictionScoreText(match, emptyText)}</strong>
    {scorer && <em className="prediction-scorer" title={scorer}>{scorer}</em>}
  </span>;
}

function DashboardCalendar({ matches, expanded, onExpand, onCollapse, onOpenMatch, restoreScrollTop }) {
  const daysRef = useRef(null);
  const pointerRef = useRef(null);
  const today = new Date();
  const days = Array.from({ length: 4 }, (_, index) => {
    const date = addDays(today, index), key = dateKey(date);
    return {
      key,
      title: dayTitle(date, index),
      matches: matches.filter(match => match.match_date === key).sort((a, b) => a.match_time.localeCompare(b.match_time))
    };
  });
  const total = days.reduce((sum, day) => sum + day.matches.length, 0);
  const daysWithMatches = days.filter(day => day.matches.length);
  const visibleDays = expanded ? daysWithMatches : daysWithMatches.reduce((visible, day) => {
    const shownCount = visible.reduce((sum, visibleDay) => sum + visibleDay.visibleMatches.length, 0);
    const remaining = COLLAPSED_CALENDAR_MATCH_LIMIT - shownCount;
    if (remaining <= 0) return visible;
    const visibleMatches = day.matches.slice(0, remaining);
    return visibleMatches.length ? [...visible, { ...day, visibleMatches }] : visible;
  }, []);
  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onExpand();
    }
  };
  const saveScroll = () => {
    sessionStorage.setItem("dashboardCalendarScrollTop", String(daysRef.current?.scrollTop || 0));
    sessionStorage.setItem("dashboardCalendarExpanded", expanded ? "1" : "0");
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
    if (!expanded || restoreScrollTop === null || !daysRef.current) return;
    daysRef.current.scrollTop = restoreScrollTop;
  }, [expanded, restoreScrollTop, visibleDays.length]);

  return <section className={`dashboard-calendar ${expanded ? "expanded" : ""}`} onClick={!expanded ? onExpand : undefined} onKeyDown={!expanded ? handleKeyDown : undefined} role={!expanded ? "button" : undefined} tabIndex={!expanded ? 0 : undefined} aria-label="Ampliar calendario de partidos">
    <header>
      <div><span className="eyebrow"><CalendarDays size={14}/> CALENDARIO</span><h2>Agenda cercana</h2></div>
      {expanded ? <button className="calendar-toggle" onClick={onCollapse} aria-label="Reducir calendario" title="Reducir calendario"><Minimize2 size={15}/></button> : <span className="calendar-summary"><small>{total} partidos</small><Maximize2 size={15}/></span>}
    </header>
    <div className="calendar-days" ref={daysRef}>
      {visibleDays.length ? visibleDays.map(day => <article className="calendar-day" key={day.key}>
        <h3>{day.title}</h3>
        <div>{day.matches.length ? (expanded ? day.matches : day.visibleMatches).map(match => <button type="button" className={`calendar-match ${match.published ? "" : "unpublished"}`.trim()} key={match.id} onPointerDown={startMatchPointer} onPointerMove={moveMatchPointer} onPointerCancel={()=>{pointerRef.current=null}} onClick={event=>clickMatch(event, match)} onKeyDown={event=>openMatchOnKey(event, match)} aria-label={`Ver detalle de ${match.team1} contra ${match.team2}${match.published ? "" : ", partido oculto"}`}>
          <span className="calendar-team home"><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span>
          <b>{hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : match.match_time}</b>
          <span className="calendar-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
        </button>) : <p>No hay partidos cargados.</p>}</div>
      </article>) : <p className="empty-state">No hay partidos cargados para los próximos días.</p>}
    </div>
  </section>;
}

export function DashboardPage() {
  const [calendarReturnInfo]=useState(()=>sessionStorage.getItem("dashboardCalendarReturn")==="1"?{expanded:sessionStorage.getItem("dashboardCalendarExpanded")==="1",scrollTop:Number(sessionStorage.getItem("dashboardCalendarScrollTop")||0)}:null);
  const {user}=useAuth(),navigate=useNavigate(),location=useLocation(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[calendarMatches,setCalendarMatches]=useState([]),[calendarExpanded,setCalendarExpanded]=useState(()=>Boolean(calendarReturnInfo?.expanded)),[tick,setTick]=useState(Date.now()),[matchIndex,setMatchIndex]=useState(0),[liveMatchIndex,setLiveMatchIndex]=useState(0);
  const calendarRestoreScrollTop=calendarReturnInfo ? calendarReturnInfo.scrollTop : null;
  const swipeStart=useRef(null),liveSwipeStart=useRef(null),suppressNextClick=useRef(false),suppressLiveClick=useRef(false);
  const loadDashboard=()=>api("/dashboard").then(setData);
  useEffect(()=>{Promise.all([api("/dashboard"),api("/activity?page=1&page_size=5"),api("/dashboard/calendar")]).then(([d,a,matches])=>{setData(d);setActivity(Array.isArray(a)?a.slice(0,5):a.items);setCalendarMatches(matches)});const tickTimer=setInterval(()=>setTick(Date.now()),1000);const refreshTimer=setInterval(loadDashboard,15000);const matchesTimer=setInterval(()=>api("/dashboard/calendar").then(setCalendarMatches),30000);return()=>{clearInterval(tickTimer);clearInterval(refreshTimer);clearInterval(matchesTimer)}},[]);
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
  return <div className="page dashboard-page"><section className="hero-panel dashboard-hero"><div><span className="eyebrow"><Sparkles size={14}/> TU CENTRO DE JUEGO</span><h1>Hola, {user.username}</h1><p>{user.is_read_only?"Modo solo lectura: puedes consultar toda la porra sin participar.":s.pending?`Tienes ${s.pending} partidos pendientes de pronosticar.`:"Todo al día. A disfrutar de la jornada."}</p></div><button className="hero-rank" onClick={()=>navigate("/clasificacion")} title="Ver clasificación"><small>POSICIÓN</small><strong>#{s.position}</strong><span>{s.total_points} puntos</span></button></section>
  <div className="dashboard-overview">
  {user.role!=="admin"&&!user.is_read_only&&<button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button>}</div>
  <DashboardCalendar matches={calendarMatches} expanded={calendarExpanded} onExpand={()=>setCalendarExpanded(true)} onCollapse={(event)=>{event.stopPropagation();setCalendarExpanded(false)}} onOpenMatch={openCalendarMatch} restoreScrollTop={calendarRestoreScrollTop}/>
  {liveMatch&&<section className="live-matches-section content-card"><div className="card-title"><div><span className="eyebrow live-label"><Radio size={14}/> EN DIRECTO</span><h2>Partidos en juego</h2></div><button className="detail-icon-button" aria-label="Ver detalle del partido en juego" title="Ver detalle" onClick={()=>navigate(`/match/${liveMatch.id}`)}><Eye size={17}/></button></div><div className="live-match-carousel" onPointerDown={event=>{if(event.pointerType!=="mouse")liveSwipeStart.current={x:event.clientX,y:event.clientY}}} onPointerUp={endLiveSwipe} onPointerCancel={()=>{liveSwipeStart.current=null}}><article className={`live-match-card ${liveMatch.is_star?"star-dashboard-card live-star-card":""}`}>{Boolean(liveMatch.is_star)&&<span className="live-star-badge"><Star size={13} fill="currentColor"/> Partido Estrella <b>x2</b></span>}<div className="live-match-teams match-open-card" onClick={()=>openMatch(liveMatch,suppressLiveClick)} onKeyDown={event=>openMatchOnKey(event,liveMatch,suppressLiveClick)} role="button" tabIndex={0} aria-label={`Ver detalle de ${liveMatch.team1} contra ${liveMatch.team2}`}><div><Flag team={liveMatch.team1} teamData={liveMatch.team1_team}/><strong>{liveMatch.team1}</strong></div><span>vs</span><div><Flag team={liveMatch.team2} teamData={liveMatch.team2_team}/><strong>{liveMatch.team2}</strong></div></div><div className="live-match-info"><span><Clock3 size={16}/>Comenzó a las <strong>{liveMatch.match_time}</strong></span><span className={liveMatch.prediction_id?"has-prediction":"no-prediction"}><small>{user.is_read_only?"Participación":"Tu apuesta"}</small><DashboardPredictionValue match={liveMatch} user={user} emptyText="No apostado"/></span></div></article></div>{inPlayMatches.length>1&&<div className="match-carousel-controls live-match-carousel-controls"><button aria-label="Partido en juego anterior" onClick={()=>setLiveMatchIndex((liveMatchIndex-1+inPlayMatches.length)%inPlayMatches.length)}><ArrowLeft size={17}/></button><div>{inPlayMatches.map((match,index)=><button aria-label={`Ver partido en juego ${index+1}`} className={index===liveMatchIndex?"active":""} key={match.id} onClick={()=>setLiveMatchIndex(index)}/>)}</div><button aria-label="Partido en juego siguiente" onClick={()=>setLiveMatchIndex((liveMatchIndex+1)%inPlayMatches.length)}><ArrowRight size={17}/></button></div>}</section>}
  <div className="dashboard-grid"><section className="next-match content-card"><div className="card-title"><div><span className="eyebrow">PRÓXIMOS PARTIDOS</span><h2>Los siguientes retos</h2></div><button className="detail-icon-button" aria-label="Ver detalle del próximo partido" title="Ver detalle" onClick={()=>m&&navigate(`/match/${m.id}`)} disabled={!m}><Eye size={17}/></button></div>{m?<><div className={`next-match-swipe ${m.is_star?"star-dashboard-card":""}`} onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={()=>{swipeStart.current=null}}><StarMatchTitle match={m} className="dashboard-star-title"/><div className="next-teams match-open-card" onClick={()=>openMatch(m,suppressNextClick)} onKeyDown={event=>openMatchOnKey(event,m,suppressNextClick)} role="button" tabIndex={0} aria-label={`Ver detalle de ${m.team1} contra ${m.team2}`}><div><Flag team={m.team1} teamData={m.team1_team}/><strong>{m.team1}</strong></div><b>VS</b><div><Flag team={m.team2} teamData={m.team2_team}/><strong>{m.team2}</strong></div></div><div className={`next-match-prediction ${m.prediction_id?"has-prediction":"no-prediction"}`}><span className="prediction-label">{user.is_read_only?"Participación":"Tu apuesta"}</span><DashboardPredictionValue match={m} user={user} emptyText="Sin apuesta"/></div><div className="countdown"><Clock3 size={18}/><span>Cierra en</span><strong>{countdown}</strong></div></div>{nextMatches.length>1&&<div className="match-carousel-controls"><button aria-label="Partido anterior" onClick={()=>setMatchIndex((matchIndex-1+nextMatches.length)%nextMatches.length)}><ArrowLeft size={17}/></button><div>{nextMatches.map((match,index)=><button aria-label={`Ver partido ${index+1}`} className={index===matchIndex?"active":""} key={match.id} onClick={()=>setMatchIndex(index)}/>)}</div><button aria-label="Partido siguiente" onClick={()=>setMatchIndex((matchIndex+1)%nextMatches.length)}><ArrowRight size={17}/></button></div>}</>:<p className="empty-state">No hay próximos partidos abiertos.</p>}</section>
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,3).map((a,i)=><article key={i}><span className={`feed-icon ${a.type}`}>{a.type==="points"?"+":"⚽"}</span><div><strong className="activity-line">{a.text}{a.type==="points"&&<span className={`points-award ${a.exact_result_points>0?"exact":""}`}>{a.exact_result_points>0&&<Star size={14} fill="currentColor"/>}+{a.total_points} pts</span>}</strong><small>{new Date(a.created_at).toLocaleString("es-ES")}</small></div></article>)}</div></section></div></div>
}
