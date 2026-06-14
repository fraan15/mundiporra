import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock3, Minus, Plus, Save, ShieldCheck, Users } from "lucide-react";
import { api } from "../api/client";
import { useNavigate } from "react-router-dom";
import { Flag } from "./SportsUI";
import { StarMatchTitle, StarPoints } from "./StarMatchTitle";

const statusLabel = (match) => match.status === "finished" ? "Finalizado" : match.in_play ? "En juego" : match.status === "closed" ? (match.close_reason === "automatic" ? "Cierre automático" : "Cerrado") : "Abierto";

export function MatchCard({ match, onSaved }) {
  const navigate=useNavigate();
  const [winner, setWinner] = useState(match.predicted_winner || "");
  const [g1, setG1] = useState(match.predicted_team1_goals ?? "");
  const [g2, setG2] = useState(match.predicted_team2_goals ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setWinner(match.predicted_winner || ""); setG1(match.predicted_team1_goals ?? ""); setG2(match.predicted_team2_goals ?? ""); }, [match]);
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const body = { match_id: match.id, predicted_winner: winner, predicted_team1_goals: Number(g1), predicted_team2_goals: Number(g2) };
      await api(match.prediction_id ? `/predictions/${match.prediction_id}` : "/predictions", { method: match.prediction_id ? "PUT" : "POST", body });
      setMessage("Predicción guardada"); onSaved();
    } catch (error) { setMessage(error.message); } finally { setSaving(false); }
  };
  const toggleReveal = async () => {
    if (!expanded && !reveal) setReveal(await api(`/predictions/match/${match.id}`));
    setExpanded(!expanded);
  };
  const date = new Date(`${match.match_date}T${match.match_time}:00`);
  const adjust = (setter, value, delta) => setter(String(Math.max(0, Number(value || 0) + delta)));
  return <article className={`match-card ${match.status} ${match.in_play?"in-play":""} ${match.is_star?"star-match-card":""}`}>
    <div className="match-head">
      <div><span className={`status ${match.in_play?"in-play":match.status}`}>{statusLabel(match)}</span><strong>{date.toLocaleDateString("es-ES",{weekday:"short",day:"numeric",month:"short"})}</strong><span><Clock3 size={14}/>{match.match_time}</span></div>
      <span>{match.stadium}</span>
    </div>
    <StarMatchTitle match={match} className="match-card-star-title"/>
    <div className="versus">
      <div className="team"><span className="flag"><Flag team={match.team1}/></span><strong>{match.team1}</strong></div>
      <div className="score">
        {match.status === "finished" ? <strong>{match.result_team1}<i>:</i>{match.result_team2}</strong> : <><span>GRUPO</span><b>VS</b></>}
      </div>
      <div className="team right"><span className="flag"><Flag team={match.team2}/></span><strong>{match.team2}</strong></div>
    </div>
    <div className={`participation-state ${match.prediction_id?"joined":"pending"}`}>{match.prediction_id?<span><ShieldCheck size={15}/>Pronóstico registrado</span>:<span><Clock3 size={15}/>Pendiente de pronóstico</span>}{match.betting_open&&<Countdown date={match.effective_close_at}/>}</div>
    {match.betting_open ? <div className="prediction">
      <span className="section-label">1. ELIGE EL GANADOR</span>
      <div className="winner-cards">
        <button className={winner==="team1"?"selected":""} onClick={()=>setWinner("team1")}><Flag team={match.team1}/><small>LOCAL</small><strong>{match.team1}</strong>{winner==="team1"&&<Check/>}</button>
        <button className={winner==="draw"?"selected":""} onClick={()=>setWinner("draw")}><span className="draw-icon">X</span><small>RESULTADO</small><strong>Empate</strong>{winner==="draw"&&<Check/>}</button>
        <button className={winner==="team2"?"selected":""} onClick={()=>setWinner("team2")}><Flag team={match.team2}/><small>VISITANTE</small><strong>{match.team2}</strong>{winner==="team2"&&<Check/>}</button>
      </div>
      <span className="section-label score-label">2. MARCADOR FINAL</span>
      <div className="score-picker"><div><small>{match.team1}</small><span><button onClick={()=>adjust(setG1,g1,-1)}><Minus/></button><input aria-label={`Goles de ${match.team1}`} inputMode="numeric" type="number" min="0" value={g1} onChange={e=>setG1(e.target.value)}/><button onClick={()=>adjust(setG1,g1,1)}><Plus/></button></span></div><b>:</b><div><small>{match.team2}</small><span><button onClick={()=>adjust(setG2,g2,-1)}><Minus/></button><input aria-label={`Goles de ${match.team2}`} inputMode="numeric" type="number" min="0" value={g2} onChange={e=>setG2(e.target.value)}/><button onClick={()=>adjust(setG2,g2,1)}><Plus/></button></span></div></div>
      <button className="primary save-prediction" onClick={save} disabled={saving || winner==="" || g1==="" || g2===""}><Save size={17}/>{saving?"Guardando...":match.prediction_id?"Guardar cambios":"Guardar resultado"}</button>
      {message && <small className={message.includes("guardada")?"success-text":"error-text"}>{message}</small>}
    </div> : <div className="locked-prediction"><span>Tu apuesta</span><strong>{match.predicted_winner ? `${match.team1} ${match.predicted_team1_goals} – ${match.predicted_team2_goals} ${match.team2}` : "Sin predicción"}</strong>{match.status==="finished" && <b><StarPoints match={match} points={match.total_points}/></b>}</div>}
    <button className="reveal-toggle" onClick={toggleReveal}><span><Users size={16}/>{match.prediction_count} participantes</span><span>{match.betting_open ? "Apuestas ocultas hasta el cierre" : "Ver apuestas"}<ChevronDown className={expanded?"rotated":""} size={16}/></span></button>
    {expanded && reveal && <div className="reveal-list">{!reveal.revealed ? reveal.participants?.length ? reveal.participants.map(p=><div key={p.id}><strong>{p.username}</strong><span><ShieldCheck size={14}/> Participando</span></div>) : <p>Aún no hay participantes.</p> : reveal.predictions.length ? reveal.predictions.map(p=><div key={p.id}><strong>{p.username}</strong><span>{match.team1} {p.predicted_team1_goals} – {p.predicted_team2_goals} {match.team2}</span>{match.status==="finished"&&<b>{p.total_points} pts</b>}</div>) : <p>Aún no hay apuestas.</p>}</div>}
    <button className="match-detail-link" onClick={()=>navigate(`/match/${match.id}`)}><span>Ver detalles del partido<small>Estadísticas, participantes y comentarios</small></span><ChevronRight size={20}/></button>
  </article>;
}

export function Countdown({date}){const [current,setCurrent]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setCurrent(Date.now()),1000);return()=>clearInterval(timer)},[]);const ms=Math.max(0,new Date(date)-current),hours=Math.floor(ms/3600000),minutes=Math.floor(ms%3600000/60000);return <span>Cierra en {hours>=24?`${Math.floor(hours/24)} día ${hours%24} h`:`${hours} h ${minutes} min`}</span>}
