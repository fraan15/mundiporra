import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Goal, History, Target, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SearchSelect } from "../components/SearchSelect";
import { Flag } from "../components/SportsUI";
import { useAuth } from "../App";
import { startVisiblePolling } from "../utils/visiblePolling";

const dateKey = date => date.toLocaleDateString("sv-SE");
const hasResult = match => match.result_team1 !== null && match.result_team2 !== null;
const daysAgoKey = days => { const date=new Date(); date.setDate(date.getDate()-days); return dateKey(date); };
const yesterdayKey = () => daysAgoKey(1);
const dateLabel = value => {
  const date = new Date(`${value}T12:00:00`), today = new Date(), tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (value === dateKey(today)) return "Hoy";
  if (value === dateKey(tomorrow)) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long" });
};

export function MatchesPage() {
  const { user } = useAuth();
  const navigate=useNavigate();
  const savedState=useRef((()=>{try{return JSON.parse(sessionStorage.getItem("matchesPageReturn")||"null")}catch{return null}})()).current;
  const initialView = savedState?.view || (window.location.hash === "#upcoming" ? "pending" : "today");
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[view,setView]=useState(initialView);
  const [counts,setCounts]=useState({today:0,upcoming:0,pending:0,history:0});
  const [selectedTeamId,setSelectedTeamId]=useState(savedState?.selectedTeamId||""),[historyDate,setHistoryDate]=useState(savedState?.historyDate||yesterdayKey());
  const load=async()=>{
    const path=view==="history"?`/matches/view/history?date=${encodeURIComponent(historyDate||yesterdayKey())}`:`/matches/view/${view}`;
    const [summary,data]=await Promise.all([api("/matches/summary"),api(path)]);
    setCounts(summary);
    setMatches(data);
    setLoading(false);
  };
  useEffect(()=>{setLoading(true);return startVisiblePolling(load,30000)},[view,historyDate]);
  useEffect(()=>{if(loading||!savedState)return;requestAnimationFrame(()=>window.scrollTo({top:savedState.scrollY||0,behavior:"auto"}));sessionStorage.removeItem("matchesPageReturn")},[loading,savedState]);

  const today=dateKey(new Date());
  const pendingCount=user.is_read_only?0:counts.pending;
  const teams=useMemo(()=>{
    const values=new Map();
    matches.forEach(match=>{
      if(match.team1_team)values.set(String(match.team1_team.id),{...match.team1_team,name:match.team1});
      if(match.team2_team)values.set(String(match.team2_team.id),{...match.team2_team,name:match.team2});
    });
    return [...values.values()].sort((a,b)=>a.name.localeCompare(b.name,"es"));
  },[matches]);
  const filters=[
    ["today","Hoy",CheckCircle2,counts.today],
    ["upcoming","Próximos",Clock3,counts.upcoming],
    ["pending",user.is_read_only?"Solo lectura":"Sin apostar",Target,pendingCount],
    ["history","Histórico",History,counts.history]
  ];
  const visible=matches.filter(match=>!selectedTeamId||String(match.team1_id)===String(selectedTeamId)||String(match.team2_id)===String(selectedTeamId));
  const grouped=useMemo(()=>{
    const groups=new Map();
    [...visible].sort((a,b)=>view==="history"?`${b.match_date}${b.match_time}`.localeCompare(`${a.match_date}${a.match_time}`):`${a.match_date}${a.match_time}`.localeCompare(`${b.match_date}${b.match_time}`)).forEach(match=>{
      const groupDate=view==="today"&&match.in_play?today:match.match_date;
      if(!groups.has(groupDate))groups.set(groupDate,[]);
      groups.get(groupDate).push(match);
    });
    return [...groups.entries()];
  },[visible,view,today]);
  const selectView=id=>{setView(id);if(id==="history"&&!historyDate)setHistoryDate(yesterdayKey());window.history.replaceState(null,"",id==="pending"?"#upcoming":window.location.pathname)};
  const openMatch=id=>{sessionStorage.setItem("matchesPageReturn",JSON.stringify({view,selectedTeamId,historyDate,scrollY:window.scrollY}));navigate(`/match/${id}`,{state:{fromMatchesPage:true}})};

  return <div className="page matches-page-redesign">
    <section className="matches-command-header">
      <div><span className="eyebrow">CENTRO DE PARTIDOS</span><h1>Tu agenda del Mundial</h1><p>{user.is_read_only?"Todos los encuentros, resultados y datos en un solo lugar.":pendingCount?`Tienes ${pendingCount} pronóstico${pendingCount===1?"":"s"} por completar.`:"Todo al día. Ya puedes centrarte en la jornada."}</p></div>
      {!user.is_read_only&&<div className={`matches-pulse ${pendingCount?"attention":"complete"}`}><Target/><strong>{pendingCount}</strong><span>sin apostar</span></div>}
    </section>

    <nav className="matches-filter-rail" aria-label="Vista de partidos">{filters.map(([id,label,Icon,count])=><button key={id} className={view===id?"active":""} onClick={()=>selectView(id)}><Icon size={16}/><span>{label}</span><b>{count}</b></button>)}</nav>

    <section className="matches-toolbar">
      <div className="matches-team-search"><SearchSelect label="Buscar selección" items={teams} value={selectedTeamId} onChange={team=>setSelectedTeamId(team?.id||"")} placeholder="Buscar selección…" renderItem={team=><><strong>{team.flag_icon} {team.name}</strong><small>{team.fifa_code||"Selección"}</small></>}/></div>
      {view==="history"&&<label className="matches-date-filter"><span>Fecha del histórico</span><input type="date" value={historyDate} aria-label="Seleccionar fecha del histórico" onChange={event=>setHistoryDate(event.target.value)}/></label>}
      {(selectedTeamId||(view==="history"&&historyDate!==yesterdayKey()))&&<button onClick={()=>{setSelectedTeamId("");if(view==="history")setHistoryDate(yesterdayKey())}}><X size={15}/> Restablecer</button>}
      <small>{visible.length} partido{visible.length===1?"":"s"}</small>
    </section>

    {loading?<div className="matches-agenda-skeleton"><i/><i/><i/></div>:grouped.length?<div className="matches-agenda">{grouped.map(([date,items])=><section className="matches-day" key={date}>
      <header><div><strong>{dateLabel(date)}</strong><span>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}</span></div><small>{items.length} encuentro{items.length===1?"":"s"}</small></header>
      <div>{items.map(match=><button type="button" className="agenda-match-row" key={match.id} onClick={()=>openMatch(match.id)}>
        <span className="agenda-time"><strong>{match.match_time?.slice(0,5)}</strong><small className={match.in_play?"live":hasResult(match)?"":"upcoming"}>{match.in_play?"LIVE":hasResult(match)?"FINAL":"PRÓXIMAMENTE"}</small></span>
        <span className="agenda-fixture"><span><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span><b>{hasResult(match)?`${match.result_team1} — ${match.result_team2}`:"VS"}</b><span><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span></span>
        <span className="agenda-match-actions"><span className={`agenda-bet-state ${match.prediction_id?"done":match.betting_open?"pending":"closed"}`}>{user.is_read_only?"Ver partido":match.prediction_id?`Tu apuesta ${match.predicted_team1_goals}–${match.predicted_team2_goals}`:match.betting_open?"Apostar ahora":hasResult(match)?"Ver resultado":"Apuestas cerradas"}</span>{!user.is_read_only&&match.prediction_id&&match.predicted_scorer?.name&&<span className="agenda-scorer-tag"><Goal size={13}/>{match.predicted_scorer.name}</span>}</span>
      </button>)}</div>
    </section>)}</div>:<div className="matches-empty"><CalendarDays/><strong>No hay partidos en esta vista</strong><span>Prueba con otro filtro o limpia la búsqueda.</span></div>}

  </div>;
}
