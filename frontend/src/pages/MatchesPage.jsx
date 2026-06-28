import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Goal, History, Target, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SearchSelect } from "../components/SearchSelect";
import { Flag } from "../components/SportsUI";
import { useAuth } from "../App";
import { startVisiblePolling } from "../utils/visiblePolling";
import { localMatchDate, localMatchTime } from "../utils/matchDateTime";
import { useLiveScores } from "../hooks/useLiveScores";

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
  const [selectedTeamId,setSelectedTeamId]=useState(initialView==="history"?(savedState?.selectedTeamId||""):""),[historyDate,setHistoryDate]=useState(savedState?.historyDate||yesterdayKey());
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
    ["today","Hoy","Partidos de hoy",CheckCircle2,counts.today],
    ["upcoming","Próximos","Por jugar",Clock3,counts.upcoming],
    ["pending",user.is_read_only?"Solo lectura":"Sin apostar",user.is_read_only?"Consulta":"Pendientes",Target,pendingCount],
    ["history","Histórico","Finalizados",History,counts.history]
  ];
  const visible=matches.filter(match=>!selectedTeamId||String(match.team1_id)===String(selectedTeamId)||String(match.team2_id)===String(selectedTeamId));
  const liveScores=useLiveScores(visible);
  const grouped=useMemo(()=>{
    const groups=new Map();
    [...visible].sort((a,b)=>{
      const aLocal=`${localMatchDate(a,user.country_code)}${localMatchTime(a,user.country_code)}`;
      const bLocal=`${localMatchDate(b,user.country_code)}${localMatchTime(b,user.country_code)}`;
      return view==="history"?bLocal.localeCompare(aLocal):aLocal.localeCompare(bLocal);
    }).forEach(match=>{
      const groupDate=localMatchDate(match,user.country_code);
      if(!groups.has(groupDate))groups.set(groupDate,[]);
      groups.get(groupDate).push(match);
    });
    return [...groups.entries()];
  },[visible,view,today,user.country_code]);
  const selectView=id=>{setView(id);if(id!=="history")setSelectedTeamId("");if(id==="history"&&!historyDate)setHistoryDate(yesterdayKey());window.history.replaceState(null,"",id==="pending"?"#upcoming":window.location.pathname)};
  const openMatch=id=>{sessionStorage.setItem("matchesPageReturn",JSON.stringify({view,selectedTeamId,historyDate,scrollY:window.scrollY}));navigate(`/match/${id}`,{state:{fromMatchesPage:true}})};

  return <div className="page matches-page-redesign">
    <section className="matches-command-header">
      <div><span className="eyebrow">CENTRO DE PARTIDOS</span><h1>Tu agenda del Mundial</h1></div>
      {!user.is_read_only&&<div className={`matches-pulse ${pendingCount?"attention":"complete"}`}><Target/><strong>{pendingCount}</strong><span>sin apostar</span></div>}
    </section>

    <nav className="matches-filter-rail" aria-label="Vista de partidos">{filters.map(([id,label,description,Icon,count])=><button key={id} className={view===id?"active":""} onClick={()=>selectView(id)}><span className="filter-card-icon"><Icon size={16}/></span><span className="filter-card-copy"><span>{label}</span><small>{description}</small></span><b>{count}</b></button>)}</nav>

    {view==="history"&&<section className="matches-toolbar">
      <div className="matches-team-search"><SearchSelect label="Buscar selección" items={teams} value={selectedTeamId} onChange={team=>setSelectedTeamId(team?.id||"")} placeholder="Buscar selección…" renderItem={team=><><strong><Flag team={team.name} teamData={team}/>{team.name}</strong><small>{team.fifa_code||"Selección"}</small></>}/></div>
      <label className="matches-date-filter"><span>Fecha del histórico</span><input type="date" value={historyDate} aria-label="Seleccionar fecha del histórico" onChange={event=>setHistoryDate(event.target.value)}/></label>
      {(selectedTeamId||historyDate!==yesterdayKey())&&<button onClick={()=>{setSelectedTeamId("");setHistoryDate(yesterdayKey())}}><X size={15}/> Restablecer</button>}
    </section>}

    {loading?<div className="matches-agenda-skeleton"><i/><i/><i/></div>:grouped.length?<div className="matches-agenda">{grouped.map(([date,items])=><section className="matches-day" key={date}>
      <header><div><strong>{dateLabel(date)}</strong><span>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}</span></div><small>{items.length} encuentro{items.length===1?"":"s"}</small></header>
      <div>{items.map(match=>{const liveScore=liveScores[match.id];const showEspn=liveScore?.available&&liveScore.score&&!hasResult(match);const espnFinal=showEspn&&(liveScore.completed||liveScore.espn_completed);return <button type="button" className="agenda-match-row" key={match.id} onClick={()=>openMatch(match.id)}>
        <span className="agenda-time">{showEspn?<><strong className={espnFinal?"espn-final":"espn-live-dot"}>{espnFinal?"FIN":""}</strong><small className={espnFinal?"espn-final-source":"live"}>ESPN</small></>:<><strong>{hasResult(match)?"FIN":localMatchTime(match,user.country_code)}</strong><small className={hasResult(match)?"":"upcoming"}>{hasResult(match)?"FINAL":"PRÓXIMAMENTE"}</small></>}</span>
        <span className="agenda-fixture"><span><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span><b>{liveScore?.available&&liveScore.score?`${liveScore.score.team1} — ${liveScore.score.team2}`:hasResult(match)?`${match.result_team1} — ${match.result_team2}`:"VS"}</b><span><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span></span>
        <span className="agenda-match-actions"><span className={`agenda-bet-state ${match.prediction_id?"done":match.betting_open?"pending":"closed"}`}>{user.is_read_only?"Ver partido":match.prediction_id?`Tu apuesta ${match.predicted_team1_goals}–${match.predicted_team2_goals}`:match.betting_open?"Apostar ahora":hasResult(match)?"Ver resultado":"Apuestas cerradas"}</span>{!user.is_read_only&&match.prediction_id&&match.predicted_scorer?.name&&<span className="agenda-scorer-tag"><Goal size={13}/>{match.predicted_scorer.name}</span>}</span>
      </button>})}</div>
    </section>)}</div>:<div className="matches-empty"><CalendarDays/><strong>No hay partidos en esta vista</strong><span>Prueba con otro filtro o limpia la búsqueda.</span></div>}

  </div>;
}
