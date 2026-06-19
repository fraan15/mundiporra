import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronDown, Clock3, History, Target, X } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";
import { SearchSelect } from "../components/SearchSelect";
import { Flag } from "../components/SportsUI";
import { useAuth } from "../App";

const dateKey = date => date.toLocaleDateString("sv-SE");
const hasResult = match => match.result_team1 !== null && match.result_team2 !== null;
const daysAgoKey = days => { const date=new Date(); date.setDate(date.getDate()-days); return dateKey(date); };
const dateLabel = value => {
  const date = new Date(`${value}T12:00:00`), today = new Date(), tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (value === dateKey(today)) return "Hoy";
  if (value === dateKey(tomorrow)) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" });
};

export function MatchesPage() {
  const { user } = useAuth();
  const initialView = window.location.hash === "#upcoming" ? "pending" : "today";
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[view,setView]=useState(initialView);
  const [selectedId,setSelectedId]=useState(null),[selectedTeamId,setSelectedTeamId]=useState(""),[historyDate,setHistoryDate]=useState(()=>daysAgoKey(3));
  const detailRef=useRef(null);
  const load=async()=>{setMatches(await api("/matches"));setLoading(false)};
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[]);

  const today=dateKey(new Date());
  const pending=user.is_read_only?[]:matches.filter(match=>match.betting_open&&!match.prediction_id);
  const todayMatches=matches.filter(match=>match.match_date===today);
  const upcoming=matches.filter(match=>match.match_date>today&&!hasResult(match));
  const historical=matches.filter(hasResult).sort((a,b)=>`${b.match_date}${b.match_time}`.localeCompare(`${a.match_date}${a.match_time}`));
  const teams=useMemo(()=>{
    const values=new Map();
    matches.forEach(match=>{
      if(match.team1_team)values.set(String(match.team1_team.id),{...match.team1_team,name:match.team1});
      if(match.team2_team)values.set(String(match.team2_team.id),{...match.team2_team,name:match.team2});
    });
    return [...values.values()].sort((a,b)=>a.name.localeCompare(b.name,"es"));
  },[matches]);
  const filters=[
    ["today","Hoy",CheckCircle2,todayMatches.length],
    ["upcoming","Próximos",Clock3,upcoming.length],
    ["pending",user.is_read_only?"Solo lectura":"Sin apostar",Target,pending.length],
    ["history","Histórico",History,historical.length]
  ];
  const source=view==="today"?todayMatches:view==="upcoming"?upcoming:view==="pending"?pending:historical;
  const visible=source.filter(match=>(!selectedTeamId||String(match.team1_id)===String(selectedTeamId)||String(match.team2_id)===String(selectedTeamId))&&(view!=="history"||!historyDate||match.match_date===historyDate));
  const grouped=useMemo(()=>{
    const groups=new Map();
    [...visible].sort((a,b)=>view==="history"?`${b.match_date}${b.match_time}`.localeCompare(`${a.match_date}${a.match_time}`):`${a.match_date}${a.match_time}`.localeCompare(`${b.match_date}${b.match_time}`)).forEach(match=>{
      if(!groups.has(match.match_date))groups.set(match.match_date,[]);
      groups.get(match.match_date).push(match);
    });
    return [...groups.entries()];
  },[visible,view]);
  const selected=matches.find(match=>match.id===selectedId);
  const selectView=id=>{setView(id);setSelectedId(null);if(id==="history"&&!historyDate)setHistoryDate(daysAgoKey(3));window.history.replaceState(null,"",id==="pending"?"#upcoming":window.location.pathname)};
  const openMatch=id=>{setSelectedId(current=>current===id?null:id);setTimeout(()=>detailRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),30)};

  return <div className="page matches-page-redesign">
    <section className="matches-command-header">
      <div><span className="eyebrow">CENTRO DE PARTIDOS</span><h1>Tu agenda del Mundial</h1><p>{user.is_read_only?"Todos los encuentros, resultados y datos en un solo lugar.":pending.length?`Tienes ${pending.length} pronóstico${pending.length===1?"":"s"} por completar.`:"Todo al día. Ya puedes centrarte en la jornada."}</p></div>
      {!user.is_read_only&&<div className={`matches-pulse ${pending.length?"attention":"complete"}`}><Target/><strong>{pending.length}</strong><span>sin apostar</span></div>}
    </section>

    <nav className="matches-filter-rail" aria-label="Vista de partidos">{filters.map(([id,label,Icon,count])=><button key={id} className={view===id?"active":""} onClick={()=>selectView(id)}><Icon size={16}/><span>{label}</span><b>{count}</b></button>)}</nav>

    <section className="matches-toolbar">
      <div className="matches-team-search"><SearchSelect label="Buscar selección" items={teams} value={selectedTeamId} onChange={team=>setSelectedTeamId(team?.id||"")} placeholder="Buscar selección…" renderItem={team=><><strong>{team.flag_icon} {team.name}</strong><small>{team.fifa_code||"Selección"}</small></>}/></div>
      {view==="history"&&<label className="matches-date-filter"><span>Fecha del histórico</span><input type="date" value={historyDate} aria-label="Seleccionar fecha del histórico" onChange={event=>setHistoryDate(event.target.value)}/></label>}
      {(selectedTeamId||(view==="history"&&historyDate!==daysAgoKey(3)))&&<button onClick={()=>{setSelectedTeamId("");if(view==="history")setHistoryDate(daysAgoKey(3))}}><X size={15}/> Restablecer</button>}
      <small>{visible.length} partido{visible.length===1?"":"s"}</small>
    </section>

    {loading?<div className="matches-agenda-skeleton"><i/><i/><i/></div>:grouped.length?<div className="matches-agenda">{grouped.map(([date,items])=><section className="matches-day" key={date}>
      <header><div><strong>{dateLabel(date)}</strong><span>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}</span></div><small>{items.length} encuentro{items.length===1?"":"s"}</small></header>
      <div>{items.map(match=><button type="button" className={`agenda-match-row ${selectedId===match.id?"selected":""}`} key={match.id} onClick={()=>openMatch(match.id)}>
        <span className="agenda-time"><strong>{match.match_time?.slice(0,5)}</strong><small>{match.in_play?"EN JUEGO":hasResult(match)?"FINAL":""}</small></span>
        <span className="agenda-fixture"><span><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span><b>{hasResult(match)?`${match.result_team1} — ${match.result_team2}`:"VS"}</b><span><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span></span>
        <span className={`agenda-bet-state ${match.prediction_id?"done":match.betting_open?"pending":"closed"}`}>{user.is_read_only?"Ver partido":match.prediction_id?`Tu apuesta ${match.predicted_team1_goals}–${match.predicted_team2_goals}`:match.betting_open?"Apostar ahora":hasResult(match)?"Ver resultado":"Apuestas cerradas"}</span>
        <ChevronDown size={17}/>
      </button>)}</div>
    </section>)}</div>:<div className="matches-empty"><CalendarDays/><strong>No hay partidos en esta vista</strong><span>Prueba con otro filtro o limpia la búsqueda.</span></div>}

    {selected&&<section className="matches-detail-drawer" ref={detailRef}><header><div><small>PARTIDO SELECCIONADO</small><strong>{selected.team1} · {selected.team2}</strong></div><button aria-label="Cerrar partido" onClick={()=>setSelectedId(null)}><X/></button></header><MatchCard match={selected} onSaved={load} verticalScorePicker/></section>}
  </div>;
}
