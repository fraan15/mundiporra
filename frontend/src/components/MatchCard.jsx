import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock3, Minus, Plus, Save, ShieldCheck, Users } from "lucide-react";
import { api } from "../api/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Flag } from "./SportsUI";
import { StarMatchTitle, StarPoints } from "./StarMatchTitle";
import { SearchSelect } from "./SearchSelect";
import { NO_SCORER, NO_SCORER_ID } from "../constants/scorers";

const statusLabel = (match) => match.status === "finished" ? "Finalizado" : match.in_play ? "En juego" : match.status === "closed" ? (match.close_reason === "automatic" ? "Cierre automático" : "Cerrado") : "Abierto";

function VerticalScoreControl({ team, value, onChange, onAdjust }) {
  const score=value===""?0:Number(value);
  const safeScore=Number.isFinite(score)?Math.max(0,score):0;
  const maxScore=10;
  const trackScore=Math.min(safeScore,maxScore);
  const commitFromPointer=event=>{
    const rect=event.currentTarget.getBoundingClientRect();
    const ratio=Math.min(1,Math.max(0,(rect.bottom-event.clientY)/rect.height));
    onChange(String(Math.round(ratio*maxScore)));
  };
  const startDrag=event=>{
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    commitFromPointer(event);
  };
  const moveDrag=event=>{
    if(event.buttons!==1&&event.pointerType==="mouse")return;
    event.preventDefault();
    commitFromPointer(event);
  };
  const keyDrag=event=>{
    if(event.key==="ArrowUp"||event.key==="ArrowRight"){event.preventDefault();onAdjust(1)}
    if(event.key==="ArrowDown"||event.key==="ArrowLeft"){event.preventDefault();onAdjust(-1)}
    if(event.key==="Home"){event.preventDefault();onChange("0")}
    if(event.key==="End"){event.preventDefault();onChange(String(maxScore))}
  };
  return <div className="vertical-score-control">
    <small>{team}</small>
    <div className="vertical-score-rail">
      <button type="button" aria-label={`Subir goles de ${team}`} onClick={()=>onAdjust(1)}><Plus/></button>
      <div className="vertical-score-value" role="slider" tabIndex="0" aria-label={`Arrastrar goles pronosticados de ${team}`} aria-valuemin="0" aria-valuemax={maxScore} aria-valuenow={safeScore} onPointerDown={startDrag} onPointerMove={moveDrag} onKeyDown={keyDrag}>
        <strong>{value===""?"0":value}</strong>
        <span className="vertical-score-track" aria-hidden="true"><i style={{bottom:`${trackScore/maxScore*100}%`}}/></span>
      </div>
      <button type="button" aria-label={`Bajar goles de ${team}`} onClick={()=>onAdjust(-1)}><Minus/></button>
    </div>
  </div>;
}

export function MatchCard({ match, onSaved, verticalScorePicker=false }) {
  const navigate=useNavigate();
  const { user } = useAuth();
  const [winner, setWinner] = useState(match.predicted_winner || "");
  const [g1, setG1] = useState(match.predicted_team1_goals ?? "");
  const [g2, setG2] = useState(match.predicted_team2_goals ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [players,setPlayers]=useState([]),[scorerId,setScorerId]=useState(match.predicted_scorer_id||null);
  useEffect(() => {
    setWinner(match.predicted_winner || ""); setG1(match.predicted_team1_goals ?? ""); setG2(match.predicted_team2_goals ?? "");
    setScorerId(match.predicted_scorer_id||null);
  }, [match]);
  useEffect(() => {
    if (g1 === "" || g2 === "") return;
    const team1Goals = Number(g1), team2Goals = Number(g2);
    if (!Number.isFinite(team1Goals) || !Number.isFinite(team2Goals) || team1Goals < 0 || team2Goals < 0) return;
    setWinner(team1Goals === team2Goals ? "draw" : team1Goals > team2Goals ? "team1" : "team2");
  }, [g1, g2]);
  const scorerEnabled=Boolean(Number(match.scorer_enabled));
  useEffect(()=>{const codes=[match.team1_team?.fifa_code,match.team2_team?.fifa_code].filter(Boolean);if(scorerEnabled&&codes.length===2)api(`/players?team_fifa_codes=${codes.join(",")}`).then(setPlayers)},[match.id,scorerEnabled,match.team1_team?.fifa_code,match.team2_team?.fifa_code]);
  const isNilNil=Number(g1)+Number(g2)===0;
  const scoringTeamCodes=[Number(g1)>0&&match.team1_team?.fifa_code,Number(g2)>0&&match.team2_team?.fifa_code].filter(Boolean);
  const availableScorers=isNilNil?[NO_SCORER]:players.filter(player=>scoringTeamCodes.includes(player.team_fifa_code));
  useEffect(()=>{if(scorerEnabled&&g1!==""&&g2!==""&&isNilNil&&scorerId!==NO_SCORER_ID)setScorerId(NO_SCORER_ID)},[g1,g2,isNilNil,scorerEnabled,scorerId]);
  useEffect(()=>{if(players.length&&scorerId&&scorerId!==NO_SCORER_ID&&!availableScorers.some(player=>String(player.id)===String(scorerId)))setScorerId(null)},[g1,g2,players.length,scorerId]);
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const body = { match_id: match.id, predicted_winner: winner, predicted_team1_goals: Number(g1), predicted_team2_goals: Number(g2), predicted_scorer_id:isNilNil?NO_SCORER_ID:scorerId };
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
      <div className="team"><span className="flag"><Flag team={match.team1} teamData={match.team1_team}/></span><strong>{match.team1}</strong></div>
      <div className="score">
        {match.status === "finished" ? <strong>{match.result_team1}<i>:</i>{match.result_team2}</strong> : <><span>GRUPO</span><b>VS</b></>}
      </div>
      <div className="team right"><span className="flag"><Flag team={match.team2} teamData={match.team2_team}/></span><strong>{match.team2}</strong></div>
    </div>
    <div className={`participation-state ${match.prediction_id?"joined":"pending"}`}>{user.is_read_only?<span><ShieldCheck size={15}/>Vista de espectador</span>:match.prediction_id?<span><ShieldCheck size={15}/>Pronóstico registrado</span>:<span><Clock3 size={15}/>Pendiente de pronóstico</span>}{match.betting_open&&<Countdown date={match.effective_close_at}/>}</div>
    {match.betting_open && !user.is_read_only ? <div className="prediction">
      <span className="section-label">1. ELIGE EL GANADOR</span>
      <div className="winner-cards">
        <button className={winner==="team1"?"selected":""} onClick={()=>setWinner("team1")}><Flag team={match.team1} teamData={match.team1_team}/><small>LOCAL</small><strong>{match.team1}</strong>{winner==="team1"&&<Check/>}</button>
        <button className={winner==="draw"?"selected":""} onClick={()=>setWinner("draw")}><span className="draw-icon">X</span><small>RESULTADO</small><strong>Empate</strong>{winner==="draw"&&<Check/>}</button>
        <button className={winner==="team2"?"selected":""} onClick={()=>setWinner("team2")}><Flag team={match.team2} teamData={match.team2_team}/><small>VISITANTE</small><strong>{match.team2}</strong>{winner==="team2"&&<Check/>}</button>
      </div>
      <span className="section-label score-label">2. MARCADOR FINAL</span>
      {verticalScorePicker
        ? <div className="detail-score-picker vertical match-score-picker-vertical"><VerticalScoreControl team={match.team1} value={g1} onChange={setG1} onAdjust={delta=>adjust(setG1,g1,delta)}/><b>:</b><VerticalScoreControl team={match.team2} value={g2} onChange={setG2} onAdjust={delta=>adjust(setG2,g2,delta)}/></div>
        : <div className="score-picker"><div><small>{match.team1}</small><span><button onClick={()=>adjust(setG1,g1,-1)}><Minus/></button><input aria-label={`Goles de ${match.team1}`} inputMode="numeric" type="number" min="0" value={g1} onChange={e=>setG1(e.target.value)}/><button onClick={()=>adjust(setG1,g1,1)}><Plus/></button></span></div><b>:</b><div><small>{match.team2}</small><span><button onClick={()=>adjust(setG2,g2,-1)}><Minus/></button><input aria-label={`Goles de ${match.team2}`} inputMode="numeric" type="number" min="0" value={g2} onChange={e=>setG2(e.target.value)}/><button onClick={()=>adjust(setG2,g2,1)}><Plus/></button></span></div></div>}
      {scorerEnabled&&<div className="scorer-pick"><span className="section-label">3. GOLEADOR DEL PARTIDO</span><SearchSelect items={availableScorers} value={scorerId} onChange={player=>setScorerId(player?.id||null)} placeholder={isNilNil?"Sin goleador":"Buscar jugador..."} label="Goleador del partido" renderItem={player=><><strong>{player.name}</strong><small>{player.team_name} · {player.position}</small></>}/></div>}
      <button className="primary save-prediction" onClick={save} disabled={saving || winner==="" || g1==="" || g2==="" || (scorerEnabled&&Number(g1)+Number(g2)>0&&!scorerId)}><Save size={17}/>{saving?"Guardando...":match.prediction_id?"Guardar cambios":"Guardar resultado"}</button>
      {message && <small className={message.includes("guardada")?"success-text":"error-text"}>{message}</small>}
    </div> : <div className="locked-prediction"><span>{user.is_read_only ? "Modo solo lectura" : "Tu apuesta"}</span><strong>{user.is_read_only ? "Sin participación" : match.predicted_winner ? `${match.team1} ${match.predicted_team1_goals} – ${match.predicted_team2_goals} ${match.team2}` : "Sin predicción"}</strong>{!user.is_read_only&&match.predicted_scorer&&<small>Goleador: {match.predicted_scorer.name}</small>}{!user.is_read_only&&match.status==="finished" && <b><StarPoints match={match} points={match.total_points}/></b>}</div>}
    <button className="reveal-toggle" onClick={toggleReveal}><span><Users size={16}/>{match.prediction_count} participantes</span><span>{match.betting_open ? "Apuestas ocultas hasta el cierre" : "Ver apuestas"}<ChevronDown className={expanded?"rotated":""} size={16}/></span></button>
    {expanded && reveal && <div className="reveal-list">{!reveal.revealed ? <p>{reveal.count ? `${reveal.count} pronóstico${reveal.count===1?"":"s"} registrado${reveal.count===1?"":"s"}. Se revelarán al cierre.` : "Aún no hay participantes."}</p> : reveal.predictions.length ? reveal.predictions.map(p=><div key={p.id}><strong>{p.username}</strong><span>{match.team1} {p.predicted_team1_goals} – {p.predicted_team2_goals} {match.team2}</span>{match.status==="finished"&&<b>{p.total_points} pts</b>}</div>) : <p>Aún no hay apuestas.</p>}</div>}
    <button className="match-detail-link" onClick={()=>navigate(`/match/${match.id}`)}><span>Ver detalles del partido<small>Estadísticas, participantes y comentarios</small></span><ChevronRight size={20}/></button>
  </article>;
}

export function Countdown({date}){const [current,setCurrent]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setCurrent(Date.now()),1000);return()=>clearInterval(timer)},[]);const ms=Math.max(0,new Date(date)-current),hours=Math.floor(ms/3600000),minutes=Math.floor(ms%3600000/60000);return <span>Cierra en {hours>=24?`${Math.floor(hours/24)} día ${hours%24} h`:`${hours} h ${minutes} min`}</span>}
