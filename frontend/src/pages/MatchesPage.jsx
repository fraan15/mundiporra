import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, Clock3, History, Search, Target, X } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";
import { Flag } from "../components/SportsUI";
import { useAuth } from "../App";

const dateKey = date => date.toLocaleDateString("sv-SE");
const hasResult = match => match.result_team1 !== null && match.result_team2 !== null;
const dateLabel = value => {
  const date = new Date(`${value}T12:00:00`), today = new Date(), tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (value === dateKey(today)) return "Hoy";
  if (value === dateKey(tomorrow)) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" });
};

export function MatchesPage() {
  const { user } = useAuth();
  const initialView = window.location.hash === "#upcoming" ? "pending" : "all";
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[view,setView]=useState(initialView);
  const [selectedId,setSelectedId]=useState(null),[query,setQuery]=useState(""),[historyDate,setHistoryDate]=useState("");
  const detailRef=useRef(null);
  const load=async()=>{setMatches(await api("/matches"));setLoading(false)};
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[]);

  const today=dateKey(new Date());
  const pending=user.is_read_only?[]:matches.filter(match=>match.betting_open&&!match.prediction_id);
  const todayMatches=matches.filter(match=>match.match_date===today);
  const upcoming=matches.filter(match=>match.match_date>today&&!hasResult(match));
  const historical=matches.filter(hasResult).sort((a,b)=>`${b.match_date}${b.match_time}`.localeCompare(`${a.match_date}${a.match_time}`));
  const filters=[
    ["all","Agenda",CalendarDays,matches.length],
    ["today","Hoy",CheckCircle2,todayMatches.length],
    ["upcoming","Por venir",Clock3,upcoming.length],
    ["pending",user.is_read_only?"Solo lectura":"Sin apostar",Target,pending.length],
    ["history","Histórico",History,historical.length]
  ];
  const source=view==="today"?todayMatches:view==="upcoming"?upcoming:view==="pending"?pending:view==="history"?historical:matches;
  const normalizedQuery=query.trim().toLocaleLowerCase("es");
  const visible=source.filter(match=>(!normalizedQuery||`${match.team1} ${match.team2} ${match.stadium||""}`.toLocaleLowerCase("es").includes(normalizedQuery))&&(!historyDate||match.match_date===historyDate));
  const grouped=useMemo(()=>{
    const groups=new Map();
    [...visible].sort((a,b)=>view==="history"?`${b.match_date}${b.match_time}`.localeCompare(`${a.match_date}${a.match_time}`):`${a.match_date}${a.match_time}`.localeCompare(`${b.match_date}${b.match_time}`)).forEach(match=>{
      if(!groups.has(match.match_date))groups.set(match.match_date,[]);
      groups.get(match.match_date).push(match);
    });
    return [...groups.entries()];
  },[visible,view]);
  const selected=matches.find(match=>match.id===selectedId);
  const selectView=id=>{setView(id);setSelectedId(null);setHistoryDate("");window.history.replaceState(null,"",id==="pending"?"#upcoming":window.location.pathname)};
  const openMatch=id=>{setSelectedId(current=>current===id?null:id);setTimeout(()=>detailRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),30)};

  return <div className="page matches-page-redesign">
    <section className="matches-command-header">
      <div><span className="eyebrow">CENTRO DE PARTIDOS</span><h1>Tu agenda del Mundial</h1><p>{user.is_read_only?"Todos los encuentros, resultados y datos en un solo lugar.":pending.length?`Tienes ${pending.length} pronóstico${pending.length===1?"":"s"} por completar.`:"Todo al día. Ya puedes centrarte en la jornada."}</p></div>
      {!user.is_read_only&&<div className={`matches-pulse ${pending.length?"attention":"complete"}`}><Target/><strong>{pending.length}</strong><span>sin apostar</span></div>}
    </section>

    <nav className="matches-filter-rail" aria-label="Vista de partidos">{filters.map(([id,label,Icon,count])=><button key={id} className={view===id?"active":""} onClick={()=>selectView(id)}><Icon size={16}/><span>{label}</span><b>{count}</b></button>)}</nav>

    <section className="matches-toolbar">
      <label><Search size={17}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar selección o estadio…"/></label>
      {view==="history"&&<label className="matches-date-filter"><span>Fecha</span><input type="date" value={historyDate} onChange={event=>setHistoryDate(event.target.value)}/></label>}
      {(query||historyDate)&&<button onClick={()=>{setQuery("");setHistoryDate("")}}><X size={15}/> Limpiar</button>}
      <small>{visible.length} partido{visible.length===1?"":"s"}</small>
    </section>

    {loading?<div className="matches-agenda-skeleton"><i/><i/><i/></div>:grouped.length?<div className="matches-agenda">{grouped.map(([date,items])=><section className="matches-day" key={date}>
      <header><div><strong>{dateLabel(date)}</strong><span>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}</span></div><small>{items.length} encuentro{items.length===1?"":"s"}</small></header>
      <div>{items.map(match=><button type="button" className={`agenda-match-row ${selectedId===match.id?"selected":""} ${match.betting_open&&!match.prediction_id&&!user.is_read_only?"needs-bet":""}`} key={match.id} onClick={()=>openMatch(match.id)}>
        <span className="agenda-time"><strong>{match.match_time?.slice(0,5)}</strong><small>{match.in_play?"EN JUEGO":hasResult(match)?"FINAL":""}</small></span>
        <span className="agenda-fixture"><span><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span><b>{hasResult(match)?`${match.result_team1} — ${match.result_team2}`:"VS"}</b><span><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span></span>
        <span className={`agenda-bet-state ${match.prediction_id?"done":match.betting_open?"pending":"closed"}`}>{user.is_read_only?"Ver partido":match.prediction_id?`Tu apuesta ${match.predicted_team1_goals}–${match.predicted_team2_goals}`:match.betting_open?"Apostar ahora":hasResult(match)?"Ver resultado":"Apuestas cerradas"}</span>
        <ChevronDown size={17}/>
      </button>)}</div>
    </section>)}</div>:<div className="matches-empty"><CalendarDays/><strong>No hay partidos en esta vista</strong><span>Prueba con otro filtro o limpia la búsqueda.</span></div>}

    {selected&&<section className="matches-detail-drawer" ref={detailRef}><header><div><small>PARTIDO SELECCIONADO</small><strong>{selected.team1} · {selected.team2}</strong></div><button aria-label="Cerrar partido" onClick={()=>setSelectedId(null)}><X/></button></header><MatchCard match={selected} onSaved={load} verticalScorePicker/></section>}
  </div>;
}
