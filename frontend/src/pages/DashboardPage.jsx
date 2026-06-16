import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Clock3, Maximize2, Minimize2, Radio, Sparkles, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";
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

function DashboardCalendar({ matches, expanded, onExpand, onCollapse }) {
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
  const visibleDays = expanded ? days : days.filter(day => day.matches.length).slice(0, 2);
  const handleKeyDown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onExpand();
    }
  };

  return <section className={`dashboard-calendar ${expanded ? "expanded" : ""}`} onClick={!expanded ? onExpand : undefined} onKeyDown={!expanded ? handleKeyDown : undefined} role={!expanded ? "button" : undefined} tabIndex={!expanded ? 0 : undefined} aria-label="Ampliar calendario de partidos">
    <header>
      <div><span className="eyebrow"><CalendarDays size={14}/> CALENDARIO</span><h2>Agenda cercana</h2></div>
      {expanded ? <button className="calendar-toggle" onClick={onCollapse} aria-label="Reducir calendario" title="Reducir calendario"><Minimize2 size={15}/></button> : <span className="calendar-summary"><small>{total} partidos</small><Maximize2 size={15}/></span>}
    </header>
    <div className="calendar-days">
      {visibleDays.length ? visibleDays.map(day => <article className="calendar-day" key={day.key}>
        <h3>{day.title}</h3>
        <div>{day.matches.length ? day.matches.slice(0, expanded ? undefined : 2).map(match => <div className="calendar-match" key={match.id}>
          <span className="calendar-team home"><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span>
          <b>{hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : match.match_time}</b>
          <span className="calendar-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
          {!match.published && <em>Oculto</em>}
        </div>) : <p>No hay partidos cargados.</p>}</div>
      </article>) : <p className="empty-state">No hay partidos cargados para los próximos días.</p>}
    </div>
  </section>;
}

export function DashboardPage() {
  const {user}=useAuth(),navigate=useNavigate(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[calendarMatches,setCalendarMatches]=useState([]),[calendarExpanded,setCalendarExpanded]=useState(false),[tick,setTick]=useState(Date.now()),[matchIndex,setMatchIndex]=useState(0),[liveMatchIndex,setLiveMatchIndex]=useState(0);
  const swipeStart=useRef(null),liveSwipeStart=useRef(null);
  const loadDashboard=()=>api("/dashboard").then(setData);
  useEffect(()=>{Promise.all([api("/dashboard"),api("/activity?page=1&page_size=5"),api("/matches")]).then(([d,a,matches])=>{setData(d);setActivity(Array.isArray(a)?a.slice(0,5):a.items);setCalendarMatches(matches)});const tickTimer=setInterval(()=>setTick(Date.now()),1000);const refreshTimer=setInterval(loadDashboard,15000);const matchesTimer=setInterval(()=>api("/matches").then(setCalendarMatches),30000);return()=>{clearInterval(tickTimer);clearInterval(refreshTimer);clearInterval(matchesTimer)}},[]);
  if(!data)return <div className="page-loader"><span/></div>;
  const s=data.summary,inPlayMatches=data.in_play_matches||[],nextMatches=data.next_matches||[],m=nextMatches[matchIndex]||data.next_match,remaining=m?Math.max(0,new Date(m.effective_close_at)-tick):0;
  const countdown=remaining?`${Math.floor(remaining/86400000)}d ${Math.floor(remaining%86400000/3600000)}h ${Math.floor(remaining%3600000/60000)}m`:"Cerrado";
  const startSwipe=(event)=>{if(event.pointerType==="mouse")return;swipeStart.current={x:event.clientX,y:event.clientY}};
  const endSwipe=(event)=>{
    if(!swipeStart.current||nextMatches.length<2)return;
    const deltaX=event.clientX-swipeStart.current.x,deltaY=event.clientY-swipeStart.current.y;
    swipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    setMatchIndex(index=>(index+(deltaX<0?1:-1)+nextMatches.length)%nextMatches.length);
  };
  const endLiveSwipe=(event)=>{
    if(!liveSwipeStart.current||inPlayMatches.length<2)return;
    const deltaX=event.clientX-liveSwipeStart.current.x,deltaY=event.clientY-liveSwipeStart.current.y;
    liveSwipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    setLiveMatchIndex(index=>(index+(deltaX<0?1:-1)+inPlayMatches.length)%inPlayMatches.length);
  };
  const liveMatch=inPlayMatches[liveMatchIndex]||inPlayMatches[0];
  return <div className="page dashboard-page"><section className="hero-panel dashboard-hero"><div><span className="eyebrow"><Sparkles size={14}/> TU CENTRO DE JUEGO</span><h1>Hola, {user.username}</h1><p>{s.pending?`Tienes ${s.pending} partidos pendientes de pronosticar.`:"Todo al día. A disfrutar de la jornada."}</p></div><button className="hero-rank" onClick={()=>navigate("/clasificacion")} title="Ver clasificación"><small>POSICIÓN</small><strong>#{s.position}</strong><span>{s.total_points} puntos</span></button></section>
  <div className="dashboard-overview">
  {user.role!=="admin"&&<button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button>}</div>
  <DashboardCalendar matches={calendarMatches} expanded={calendarExpanded} onExpand={()=>setCalendarExpanded(true)} onCollapse={(event)=>{event.stopPropagation();setCalendarExpanded(false)}}/>
  {liveMatch&&<section className="live-matches-section content-card"><div className="card-title"><div><span className="eyebrow live-label"><Radio size={14}/> EN DIRECTO</span><h2>Partidos en juego</h2></div><button onClick={()=>navigate(`/match/${liveMatch.id}`)}>Ver detalle <ArrowRight size={16}/></button></div><div className="live-match-carousel" onPointerDown={event=>{if(event.pointerType!=="mouse")liveSwipeStart.current={x:event.clientX,y:event.clientY}}} onPointerUp={endLiveSwipe} onPointerCancel={()=>{liveSwipeStart.current=null}}><article className={`live-match-card ${liveMatch.is_star?"star-dashboard-card live-star-card":""}`}>{Boolean(liveMatch.is_star)&&<span className="live-star-badge"><Star size={13} fill="currentColor"/> Partido Estrella <b>x2</b></span>}<div className="live-match-teams"><div><Flag team={liveMatch.team1} teamData={liveMatch.team1_team}/><strong>{liveMatch.team1}</strong></div><span>vs</span><div><Flag team={liveMatch.team2} teamData={liveMatch.team2_team}/><strong>{liveMatch.team2}</strong></div></div><div className="live-match-info"><span><Clock3 size={16}/>Comenzó a las <strong>{liveMatch.match_time}</strong></span><span className={liveMatch.prediction_id?"has-prediction":"no-prediction"}><small>Tu apuesta</small><strong>{liveMatch.prediction_id?`${liveMatch.predicted_team1_goals} – ${liveMatch.predicted_team2_goals}`:"No apostado"}</strong></span></div></article></div>{inPlayMatches.length>1&&<div className="match-carousel-controls live-match-carousel-controls"><button aria-label="Partido en juego anterior" onClick={()=>setLiveMatchIndex((liveMatchIndex-1+inPlayMatches.length)%inPlayMatches.length)}><ArrowLeft size={17}/></button><div>{inPlayMatches.map((match,index)=><button aria-label={`Ver partido en juego ${index+1}`} className={index===liveMatchIndex?"active":""} key={match.id} onClick={()=>setLiveMatchIndex(index)}/>)}</div><button aria-label="Partido en juego siguiente" onClick={()=>setLiveMatchIndex((liveMatchIndex+1)%inPlayMatches.length)}><ArrowRight size={17}/></button></div>}</section>}
  <div className="dashboard-grid"><section className="next-match content-card"><div className="card-title"><div><span className="eyebrow">PRÓXIMOS PARTIDOS</span><h2>Los siguientes retos</h2></div><button onClick={()=>m&&navigate(`/match/${m.id}`)}>Ver detalle <ArrowRight size={16}/></button></div>{m?<><div className={`next-match-swipe ${m.is_star?"star-dashboard-card":""}`} onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={()=>{swipeStart.current=null}}><StarMatchTitle match={m} className="dashboard-star-title"/><div className="next-teams"><div><Flag team={m.team1} teamData={m.team1_team}/><strong>{m.team1}</strong></div><b>VS</b><div><Flag team={m.team2} teamData={m.team2_team}/><strong>{m.team2}</strong></div></div><div className={`next-match-prediction ${m.prediction_id?"has-prediction":"no-prediction"}`}><span>Tu apuesta</span><strong>{m.prediction_id?`${m.predicted_team1_goals} – ${m.predicted_team2_goals}`:"Sin apuesta"}</strong></div><div className="countdown"><Clock3 size={18}/><span>Cierra en</span><strong>{countdown}</strong></div></div>{nextMatches.length>1&&<div className="match-carousel-controls"><button aria-label="Partido anterior" onClick={()=>setMatchIndex((matchIndex-1+nextMatches.length)%nextMatches.length)}><ArrowLeft size={17}/></button><div>{nextMatches.map((match,index)=><button aria-label={`Ver partido ${index+1}`} className={index===matchIndex?"active":""} key={match.id} onClick={()=>setMatchIndex(index)}/>)}</div><button aria-label="Partido siguiente" onClick={()=>setMatchIndex((matchIndex+1)%nextMatches.length)}><ArrowRight size={17}/></button></div>}</>:<p className="empty-state">No hay próximos partidos abiertos.</p>}</section>
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,3).map((a,i)=><article key={i}><span className={`feed-icon ${a.type}`}>{a.type==="points"?"+":"⚽"}</span><div><strong>{a.text}</strong><small>{new Date(a.created_at).toLocaleString("es-ES")}</small></div>{a.type==="points"&&<span className={`points-award ${a.exact_result_points>0?"exact":""}`}>{a.exact_result_points>0&&<Star size={14} fill="currentColor"/>}+{a.total_points} pts</span>}</article>)}</div></section></div></div>
}
