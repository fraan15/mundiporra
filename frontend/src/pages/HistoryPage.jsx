import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, ChevronRight } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";

const dayPredictionText = (prediction) => {
  const score = `${prediction.predicted_team1_goals}–${prediction.predicted_team2_goals}`;
  return prediction.predicted_scorer_name ? `${score} · Gol: ${prediction.predicted_scorer_name}` : score;
};

export function HistoryPage() {
  const { user } = useAuth();
  const [days,setDays]=useState([]); const navigate=useNavigate();
  useEffect(()=>{api("/history/days").then(setDays)},[]);
  return <div className="page"><section className="page-heading"><span className="eyebrow"><CalendarDays size={14}/> ARCHIVO DEL TORNEO</span><h1>Histórico diario</h1><p>{user.is_read_only?"Revive cada jornada y los puntos repartidos.":"Revive cada jornada, tus apuestas y los puntos repartidos."}</p></section>
    <div className="day-grid">{days.map(day=><button className="day-card" key={day.match_date} onClick={()=>navigate(`/historico/${day.match_date}`)}><div className="calendar-tile"><strong>{new Date(`${day.match_date}T12:00:00`).getDate()}</strong><span>{new Date(`${day.match_date}T12:00:00`).toLocaleDateString("es-ES",{month:"short"}).toUpperCase()}</span></div><div><strong>{new Date(`${day.match_date}T12:00:00`).toLocaleDateString("es-ES",{weekday:"long",year:"numeric"})}</strong><span>{day.matches_count} partidos{user.is_read_only?"":` · ${day.my_points} puntos ganados`}</span></div><ChevronRight/></button>)}</div>
  </div>;
}

export function DayHistoryPage() {
  const { user } = useAuth();
  const {date}=useParams(); const navigate=useNavigate(); const [data,setData]=useState(null); const [summary,setSummary]=useState([]);
  useEffect(()=>{Promise.all([api(`/history/day/${date}`),api(`/history/day/${date}/summary`)]).then(([d,s])=>{setData(d);setSummary(s)})},[date]);
  if(!data)return <div className="page-loader"><span/></div>;
  return <div className="page"><button className="back-btn" onClick={()=>navigate("/historico")}><ArrowLeft size={16}/>Volver al histórico</button><section className="page-heading compact"><span className="eyebrow">RESUMEN DIARIO</span><h1>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long"})}</h1></section>
    <div className="history-layout"><div className="history-matches">{data.matches.map(m=><article className="history-match" key={m.id}><div><span>{m.match_time} · {m.stadium}</span><strong>{m.team1} <b>{m.status==="finished"?`${m.result_team1} – ${m.result_team2}`:"vs"}</b> {m.team2}</strong><small>{user.is_read_only?"Solo lectura":m.predicted_winner?`Tu apuesta: ${m.predicted_team1_goals} – ${m.predicted_team2_goals}`:"Sin apuesta"}</small></div>{!user.is_read_only&&<em>{m.total_points||0} pts</em>}{data.predictions[m.id]&&<div className="day-reveals">{data.predictions[m.id].map((p,i)=>{const text=dayPredictionText(p);return <span key={i} title={`${p.username} · ${text} · ${p.total_points} pts`}><b>{p.username}</b> {text} · {p.total_points} pts</span>})}</div>}</article>)}</div>
      <aside className="summary-card"><h3>Clasificación del día</h3>{summary.map((r,i)=><div key={r.username}><b>#{i+1}</b><strong>{r.username}</strong><span>{r.winner_hits} G · {r.exact_hits} E</span><em>{r.points} pts</em></div>)}</aside></div>
  </div>;
}
