import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { localMatchTime } from "../utils/matchDateTime";

const dayPredictionScore = (prediction) => `${prediction.predicted_team1_goals}–${prediction.predicted_team2_goals}`;
const dayPredictionScorer = (prediction) => prediction.predicted_scorer_name ? `Goleador: ${prediction.predicted_scorer_name}` : "Sin goleador";
const yesterdayKey = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toLocaleDateString("sv-SE");
};

export function HistoryPage() {
  const navigate=useNavigate();
  useEffect(()=>{navigate(`/historico/${yesterdayKey()}`,{replace:true})},[navigate]);
  return <div className="page-loader"><span/></div>;
}

export function DayHistoryPage() {
  const { user } = useAuth();
  const {date}=useParams(); const navigate=useNavigate(); const [data,setData]=useState(null); const [summary,setSummary]=useState([]);
  useEffect(()=>{Promise.all([api(`/history/day/${date}`),api(`/history/day/${date}/summary`)]).then(([d,s])=>{setData(d);setSummary(s)})},[date]);
  if(!data)return <div className="page-loader"><span/></div>;
  return <div className="page"><button className="back-btn" onClick={()=>navigate("/historico")}><ArrowLeft size={16}/>Volver al histórico</button><section className="page-heading compact"><span className="eyebrow">RESUMEN DIARIO</span><h1>{new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{weekday:"long",day:"numeric",month:"long"})}</h1></section>
    <div className="history-layout"><div className="history-matches">{data.matches.map(m=><article className="history-match" key={m.id}><div><span>{localMatchTime(m,user.country_code)} · {m.stadium}</span><strong>{m.team1} <b>{m.status==="finished"?`${m.result_team1} – ${m.result_team2}`:"vs"}</b> {m.team2}</strong><small>{user.is_read_only?"Solo lectura":m.predicted_winner?`Tu apuesta: ${m.predicted_team1_goals} – ${m.predicted_team2_goals}`:"Sin apuesta"}</small></div>{!user.is_read_only&&<em>{m.total_points||0} pts</em>}{data.predictions[m.id]&&<div className="day-reveals">{data.predictions[m.id].map((p,i)=><span className="day-reveal-prediction" key={i} title={`${p.username} · ${dayPredictionScore(p)} · ${dayPredictionScorer(p)} · ${p.total_points} pts`}><b>{p.username}</b><strong>{dayPredictionScore(p)}</strong><small>{dayPredictionScorer(p)} · {p.total_points} pts</small></span>)}</div>}</article>)}</div>
      <aside className="summary-card"><h3>Clasificación del día</h3>{summary.map((r,i)=><div key={r.username}><b>#{i+1}</b><strong>{r.username}</strong><span>{r.winner_hits} G · {r.exact_hits} E</span><em>{r.points} pts</em></div>)}</aside></div>
  </div>;
}
