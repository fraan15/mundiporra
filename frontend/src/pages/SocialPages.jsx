import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, Edit3, Goal, Info, MessageCircle, Minus, Plus, Save, Send, Shield, Star, Trash2, Trophy, Users, X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Badges, Flag } from "../components/SportsUI";
import { Countdown } from "../components/MatchCard";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { Avatar } from "../components/Avatar";
import { SearchSelect } from "../components/SearchSelect";
import { ScorerPicker } from "../components/ScorerPicker";

const StatCards=({s,onPointsInfo})=><div className="stat-cards">
  {[["Posición",`#${s.position}`],["Puntos",s.total_points],["Pronósticos",s.predicted_matches],["Ganadores",s.winner_hits],["Exactos",s.exact_hits],["Media",`${s.average_points} pts`]].map(([k,v])=><article key={k} className={k==="Puntos"?"points-stat-card":""}><span>{k}</span><strong>{v}</strong>{k==="Puntos"&&onPointsInfo&&<button type="button" className="points-info-trigger" aria-label="Ver de dónde salen todos los puntos" onClick={onPointsInfo}><Info size={16}/></button>}</article>)}
</div>;

export function ProfilePage(){
  const {user:authUser,setUser}=useAuth(); const [data,setData]=useState(null),[phrase,setPhrase]=useState(""),[saved,setSaved]=useState(false),[avatarMessage,setAvatarMessage]=useState(""),[uploading,setUploading]=useState(false),[pointsOpen,setPointsOpen]=useState(false);
  const load=()=>api("/profile/me").then(d=>{setData(d);setPhrase(d.user.personal_phrase||"")});
  useEffect(()=>{load()},[]);
  if(!data)return <div className="page-loader"><span/></div>;
  const save=async()=>{const user=await api("/profile/me",{method:"PATCH",body:{personal_phrase:phrase}});setUser(u=>({...u,...user}));setSaved(true);load()};
  const changeAvatar=async event=>{
    const input=event.currentTarget,file=input.files?.[0];input.value="";if(!file)return;
    const typeByExtension={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp"};
    const extension=file.name.split(".").pop()?.toLowerCase(),contentType=typeByExtension[extension];
    if(!contentType||file.type&&!["image/jpeg","image/png","image/webp"].includes(file.type)){setAvatarMessage(`El archivo "${file.name}" no es válido. Solo se admiten imágenes JPEG, PNG o WebP.`);return}
    if(file.size===0){setAvatarMessage("El archivo seleccionado está vacío.");return}
    if(file.size>5*1024*1024){setAvatarMessage(`La imagen ocupa ${(file.size/1024/1024).toFixed(1)} MB y el máximo permitido es 5 MB.`);return}
    setUploading(true);setAvatarMessage("");
    try{
      const uploadUrl=new URL("/api/profile/avatar",window.location.origin);
      const response=await fetch(uploadUrl.toString(),{method:"PUT",credentials:"same-origin",headers:{"Content-Type":contentType},body:file});
      const responseType=response.headers.get("content-type")||"";
      const user=responseType.includes("application/json")?await response.json():null;
      if(!response.ok)throw new Error(user?.error||`El servidor rechazó la imagen (error ${response.status}).`);
      if(!user?.avatar_url)throw new Error("El servidor no devolvió una foto de perfil válida.");
      setUser(current=>({...current,...user}));setData(current=>({...current,user}));setAvatarMessage("Foto de perfil actualizada.");
    }catch(error){
      console.error("Error al subir la foto de perfil:",error);
      setAvatarMessage(error instanceof TypeError||error?.name==="SyntaxError"
        ?"No se pudo enviar la imagen al servidor. Comprueba la conexión y vuelve a intentarlo."
        :error?.message||"No se pudo subir la imagen.");
    }finally{setUploading(false)}
  };
  const removeAvatar=async()=>{setUploading(true);setAvatarMessage("");try{const user=await api("/profile/avatar",{method:"DELETE"});setUser(current=>({...current,...user}));setData(current=>({...current,user}));setAvatarMessage("Foto eliminada.")}catch(error){setAvatarMessage(error.message)}finally{setUploading(false)}};
  const s=data.stats;
  return <div className="page"><section className="profile-hero"><div className="profile-avatar-editor"><Avatar user={data.user} className="profile-avatar"/>{!authUser.is_read_only&&<><label className="avatar-upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeAvatar} disabled={uploading}/>{uploading?"Procesando...":data.user.avatar_url?"Cambiar foto":"Añadir foto"}</label>{data.user.avatar_url&&<button type="button" onClick={removeAvatar} disabled={uploading}>Eliminar</button>}</>}</div><div><span className="eyebrow">PERFIL DE JUGADOR</span><h1>{data.user.username}</h1><p>{authUser.is_read_only?"Solo lectura":data.user.role==="admin"?"Administrador":"Participante"} · Desde {new Date(data.user.created_at).toLocaleDateString("es-ES")}</p>{!authUser.is_read_only&&<small className="avatar-requirements">JPEG, PNG o WebP · máximo 5 MB · mínimo 100 × 100 px</small>}{avatarMessage&&<small className={avatarMessage.includes("actualizada")||avatarMessage.includes("eliminada")?"success-text":"error-text"}>{avatarMessage}</small>}</div></section>
    {pointsOpen&&<PointsDetailOverlay detail={data.points_detail} username={data.user.username} onClose={()=>setPointsOpen(false)}/>}<StatCards s={s} onPointsInfo={()=>setPointsOpen(true)}/>{!authUser.is_read_only&&<section className="content-card"><h2>Mi frase</h2><div className="phrase-editor"><input maxLength="120" value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder="Este año gano yo."/><button className="primary" onClick={save}><Edit3 size={16}/>Guardar</button></div>{saved&&<small className="success-text">Frase actualizada.</small>}</section>}
    <StatsSections stats={s} history={data.history}/><section className="content-card"><h2>Medallas</h2><Badges badges={s.badges}/></section>
  </div>
}
function formatStatDate(date){return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})}
function byDateAsc(a,b){return new Date(`${a.date}T12:00:00`)-new Date(`${b.date}T12:00:00`)}
function lastFiveDays(data=[]){return [...data].sort(byDateAsc).slice(-5)}
function PointsByDay({data=[]}){
  const visibleDays=lastFiveDays(data);
  if(!visibleDays.length)return <p className="stat-change-empty">Todavía no hay puntos diarios.</p>;
  return <div className="stat-change-list">{visibleDays.map(day=>{
    const points=Number(day.points)||0,state=points>0?"positive":points<0?"negative":"neutral";
    return <article key={day.date} className={`stat-change-row ${state}`}>
      <span>{formatStatDate(day.date)}</span>
      <strong>{points>0?"+":""}{points} pts</strong>
      <small>{points>0?"Ha sumado puntos":points<0?"Ha perdido puntos":"Sin cambios"}</small>
    </article>
  })}</div>
}
function PositionEvolution({data=[]}){
  const sortedData=[...data].sort(byDateAsc);
  const changes=sortedData.map((day,index)=>({day,index,previous:Number(sortedData[index-1]?.position)}));
  const visibleDays=lastFiveDays(changes);
  if(!visibleDays.length)return <p className="stat-change-empty">Todavía no hay histórico de posición.</p>;
  return <div className="stat-change-list">{visibleDays.map(({day,index,previous})=>{
    const position=Number(day.position),change=index===0?0:previous-position,state=change>0?"positive":change<0?"negative":"neutral";
    return <article key={day.date} className={`stat-change-row ${state}`}>
      <span>{formatStatDate(day.date)}</span>
      <strong>#{position}</strong>
      <small>{index===0?"Posición inicial":change>0?`+${change} ${change===1?"puesto":"puestos"}`:change<0?`${change} ${Math.abs(change)===1?"puesto":"puestos"}`:"Sin cambios"}</small>
    </article>
  })}</div>
}
function StatsSections({stats:s,history=[]}){return <><div className="insight-grid">{[["Ganadores acertados",`${s.winner_percentage}%`],["Resultados exactos",`${s.exact_percentage}%`],["Mejor jornada",s.best_day?`${s.best_day.points} pts`:"—"],["Peor jornada",s.worst_day?`${s.worst_day.points} pts`:"—"],["Equipo más elegido",s.most_picked_team],["Equipo más rentable",s.best_team]].map(([k,v])=><article className="content-card" key={k}><span>{k}</span><strong>{v}</strong></article>)}</div><div className="chart-grid"><section className="content-card"><h2>Puntos por día</h2><PointsByDay data={s.daily}/></section><section className="content-card"><h2>Evolución de posición</h2><PositionEvolution data={history}/></section></div></>}
export function PublicProfilePage(){
  const {id}=useParams(),navigate=useNavigate(),[data,setData]=useState(null),[historyPage,setHistoryPage]=useState(1),[pointsOpen,setPointsOpen]=useState(false);
  const pageSize=5;
  useEffect(()=>{setHistoryPage(1);api(`/users/${id}/public`).then(setData)},[id]);
  const predictions=useMemo(()=>[...(data?.predictions||[])].sort((a,b)=>{
    const dateCompare=new Date(`${b.match_date}T${b.match_time||"00:00:00"}`)-new Date(`${a.match_date}T${a.match_time||"00:00:00"}`);
    return dateCompare||b.id-a.id;
  }),[data?.predictions]);
  if(!data)return <div className="page-loader"><span/></div>;const s=data.stats,totalHistoryPages=Math.max(1,Math.ceil(predictions.length/pageSize)),visiblePredictions=predictions.slice((historyPage-1)*pageSize,historyPage*pageSize);
  return <div className="page">{pointsOpen&&<PointsDetailOverlay detail={data.points_detail} username={data.user.username} onClose={()=>setPointsOpen(false)}/>}<button className="back-btn" onClick={()=>navigate(-1)}><ArrowLeft size={16}/>Volver</button><section className="profile-hero public"><Avatar user={data.user} className="profile-avatar"/><div><span className="eyebrow">FICHA DEPORTIVA</span><h1>{data.user.username}</h1><blockquote>“{data.user.personal_phrase||"Todavía sin frase personal."}”</blockquote></div><b>#{s.position}</b></section><StatCards s={s} onPointsInfo={()=>setPointsOpen(true)}/><StatsSections stats={s} history={data.history}/><section className="content-card"><h2>Medallas</h2><Badges badges={s.badges}/></section><section className="content-card"><h2>Historial visible</h2><div className="prediction-history">{visiblePredictions.map(p=><div key={p.id}><span>{p.match_date}</span><strong><Flag team={p.team1}/>{p.team1} {p.predicted_team1_goals}–{p.predicted_team2_goals} {p.team2}<Flag team={p.team2}/></strong><b>+{p.total_points}</b></div>)}</div>{totalHistoryPages>1&&<nav className="pagination" aria-label="Paginación del historial visible"><button disabled={historyPage===1} onClick={()=>setHistoryPage(historyPage-1)}><ChevronLeft/>Anterior</button><span>Página {historyPage} de {totalHistoryPages}</span><button disabled={historyPage===totalHistoryPages} onClick={()=>setHistoryPage(historyPage+1)}>Siguiente<ChevronRight/></button></nav>}</section></div>
}
function PointsDetailOverlay({detail,username,onClose}){
 const [matchesOpen,setMatchesOpen]=useState(true),[openMatchId,setOpenMatchId]=useState(null);
 useEffect(()=>{const close=event=>{if(event.key==="Escape")onClose()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[onClose]);
 const matches=detail?.matches||[],scoredMatches=matches.filter(match=>match.total_points>0),zeroMatches=matches.filter(match=>match.total_points===0);
 const signed=value=>`${Number(value)>0?"+":""}${Number(value)||0}`;
 return <div className="team-detail-overlay points-detail-overlay" role="dialog" aria-modal="true" aria-label="Detalle de puntos" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="team-detail-panel points-detail-panel">
   <header className="points-detail-header"><div><span className="eyebrow">DETALLE DE PUNTOS</span><h1>{username}</h1><p>Así se construye el total: puntos automáticos por partidos finalizados más ajustes manuales.</p></div><button className="team-detail-close points-detail-close" aria-label="Cerrar detalle de puntos" onClick={onClose}><X/></button></header>
   <div className="points-ledger-summary">
    <article><span>Total actual</span><strong>{detail?.total_points||0}</strong></article>
    <article><span>Partidos</span><strong>{detail?.automatic_points||0}</strong><small>Ganador {detail?.winner_points||0} · Exacto {detail?.exact_result_points||0} · Goleador {detail?.scorer_points||0}</small></article>
    <article><span>Ajustes</span><strong>{signed(detail?.adjustment_points)}</strong></article>
    <article><span>Con puntos</span><strong>{detail?.matches_with_points||0}/{detail?.finished_matches||0}</strong></article>
   </div>
   <section className="points-detail-section points-collapsible-section"><button type="button" className="points-section-toggle" aria-expanded={matchesOpen} onClick={()=>setMatchesOpen(!matchesOpen)}><span><h2>Partidos que han sumado</h2><small>{scoredMatches.length} partido{scoredMatches.length===1?"":"s"} con puntos</small></span><ChevronDown className={matchesOpen?"open":""}/></button>{matchesOpen&&(scoredMatches.length?<div className="points-match-list">{scoredMatches.map(match=><PointsMatchRow key={match.id} match={match} open={openMatchId===match.id} onToggle={()=>setOpenMatchId(openMatchId===match.id?null:match.id)}/>)}</div>:<p className="empty-state">Todavía no hay partidos con puntos.</p>)}</section>
   {detail?.adjustments?.length>0&&<section className="points-detail-section"><h2>Ajustes manuales</h2><div className="points-adjustments">{detail.adjustments.map(adjustment=><article key={adjustment.id}><strong>{signed(adjustment.points)} pts</strong><span>{adjustment.reason}</span><small>{new Date(adjustment.created_at).toLocaleString("es-ES")}{adjustment.created_by_username?` · ${adjustment.created_by_username}`:""}</small></article>)}</div></section>}
   {zeroMatches.length>0&&<section className="points-detail-section"><h2>Partidos revisados sin puntos</h2><div className="zero-points-list">{zeroMatches.map(match=><span key={match.id}>{match.match_date} · {match.team1} {match.result} {match.team2} · pronóstico {match.prediction}</span>)}</div></section>}
  </section>
 </div>
}
function PointsMatchRow({match,open,onToggle}){
 const earnedRules=match.rules.filter(rule=>rule.points>0),missedRules=match.rules.filter(rule=>rule.points===0);
 return <article className="points-match-row">
  <button type="button" className="points-match-toggle" aria-expanded={open} onClick={onToggle}><div><strong><Flag team={match.team1}/>{match.team1} {match.result} {match.team2}<Flag team={match.team2}/></strong><span>{new Date(`${match.match_date}T12:00:00`).toLocaleDateString("es-ES",{day:"2-digit",month:"short"})} · Pronóstico {match.prediction} · {match.predicted_winner_label}</span></div><b>+{match.total_points}</b><ChevronDown className={open?"open":""}/></button>
  {open&&<div className="points-match-body">
   <div className="points-rule-grid">{earnedRules.map(rule=><div key={rule.label} className="earned"><Check size={15}/><strong>{rule.label}</strong><span>{match.multiplier>1?`${rule.base_points} base x ${match.multiplier} = ${rule.points}`:`${rule.points} pts`}</span><small>{rule.text}</small></div>)}</div>
   {match.is_star&&<p className="star-explanation"><Star size={15} fill="currentColor"/> Partido Estrella: todos los aciertos de este partido se multiplican x{match.multiplier}.</p>}
   <p className="points-formula">Suma del partido: {match.formula} puntos.</p>
   {missedRules.length>0&&<details className="missed-rules"><summary>Aciertos no conseguidos</summary>{missedRules.map(rule=><span key={rule.label}><b>{rule.label}</b>{rule.text}</span>)}</details>}
  </div>}
 </article>
}
function ActivityFeedItem({item}){
 const [open,setOpen]=useState(false),breakdown=item.points_breakdown;
 const finalAddends=breakdown?.rules?.map(rule=>rule.earned_points).join(" + ");
 return <article className={open?"activity-open":""}>
  <span className={`feed-icon ${item.type}`}>{item.type==="points"?"+":"⚽"}</span>
  <div>
   <span className="activity-summary"><strong>{item.text}</strong></span>
   <span className="activity-match-row"><span className="activity-match"><Flag team={item.team1}/>{item.team1}<b>vs</b><Flag team={item.team2}/>{item.team2}</span>{item.type==="points"&&<span className="activity-summary-actions"><button className="activity-info-button" aria-label={`${open?"Ocultar":"Ver"} desglose de puntos`} aria-expanded={open} onClick={()=>setOpen(!open)}><Info size={16}/></button><span className={`points-award ${item.exact_result_points>0?"exact":""}`}>{item.is_star?<Star size={15} fill="currentColor"/>:item.exact_result_points>0&&<Star size={15} fill="currentColor"/>}+{item.total_points} puntos</span></span>}</span>
   <small>{new Date(item.created_at).toLocaleString("es-ES")}</small>
   {open&&breakdown&&<div className="activity-breakdown">
    <strong>Desglose de puntos</strong>
    {breakdown.rules.map(rule=><span key={rule.label}><b>{rule.label}</b><em>{breakdown.multiplier>1?`${rule.base_points} de ${rule.description} x ${breakdown.multiplier} = ${rule.earned_points}`:`${rule.base_points} de ${rule.description} = ${rule.earned_points}`}</em></span>)}
    <p>Suma final: {breakdown.rules.length>1?`${finalAddends} = `:""}{breakdown.total} puntos</p>
   </div>}
  </div>
 </article>
}
export function ActivityPage(){
 const [data,setData]=useState({items:[],page:1,total_pages:1});const load=page=>api(`/activity?page=${page}&page_size=10`).then(response=>setData(Array.isArray(response)?{items:response,page:1,total_pages:1}:response));useEffect(()=>{load(1)},[]);
 return <div className="page narrow"><section className="page-heading"><span className="eyebrow"><Activity size={14}/> COMUNIDAD</span><h1>Actividad reciente</h1><p>Lo último que está pasando en la porra.</p></section><div className="activity-feed">{data.items.map((item,i)=><ActivityFeedItem key={`${item.type}-${i}-${item.created_at}`} item={item}/>)}</div>{data.total_pages>1&&<nav className="pagination" aria-label="Paginación de actividad"><button disabled={data.page===1} onClick={()=>load(data.page-1)}><ChevronLeft/>Anterior</button><span>Página {data.page} de {data.total_pages}</span><button disabled={data.page===data.total_pages} onClick={()=>load(data.page+1)}>Siguiente<ChevronRight/></button></nav>}</div>
}
function HiddenDistribution({revealAt,onReveal}){
 const [current,setCurrent]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setCurrent(Date.now()),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>{if(current>=new Date(revealAt).getTime())onReveal()},[current,revealAt,onReveal]);
 const minutes=Math.max(1,Math.ceil((new Date(revealAt).getTime()-current)/60000));
 return <div className="distribution-hidden"><div className="pixelated-bars" aria-hidden="true"><i/><i/><i/></div><strong>Se podrá ver en {minutes} {minutes===1?"minuto":"minutos"}</strong><span>La distribución está oculta para no influir en los pronósticos.</span></div>
}
const positionNames={POR:"Porteros",DEF:"Defensas",MED:"Centrocampistas",DEL:"Delanteros"};
const scorerLabel=scorer=>`${scorer.name}${scorer.minute?` ${scorer.minute}'`:""}`;
const winnerFromScore=(g1,g2)=>{
 if(g1===""||g2==="")return "";
 const team1Goals=Number(g1),team2Goals=Number(g2);
 if(!Number.isFinite(team1Goals)||!Number.isFinite(team2Goals)||team1Goals<0||team2Goals<0)return "";
 return team1Goals===team2Goals?"draw":team1Goals>team2Goals?"team1":"team2";
};
function HorizontalScoreControl({team,value,onChange,onAdjust}){
 const dragRef=useRef(null);
 const score=value===""?0:Number(value);
 const safeScore=Number.isFinite(score)?Math.max(0,score):0;
 const maxScore=10;
 const dragSensitivity=1.65;
 const commitFromPointer=event=>{
  if(!dragRef.current)return;
  const { startX, startScore }=dragRef.current;
  const delta=(event.clientX-startX)/(28*dragSensitivity);
  const nextScore=Math.min(maxScore,Math.max(0,Math.round(startScore+delta)));
  onChange(String(nextScore));
 };
 const startDrag=event=>{
  event.stopPropagation();
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  dragRef.current={
   startX:event.clientX,
   startScore:safeScore
  };
 };
 const moveDrag=event=>{
  if(!dragRef.current)return;
  event.stopPropagation();
  if(event.buttons!==1&&event.pointerType==="mouse")return;
  event.preventDefault();
  commitFromPointer(event);
 };
 const endDrag=event=>{
  if(!dragRef.current)return;
  event.stopPropagation();
  commitFromPointer(event);
  dragRef.current=null;
  event.currentTarget.releasePointerCapture?.(event.pointerId);
 };
 const keyDrag=event=>{
  if(event.key==="ArrowUp"||event.key==="ArrowRight"){event.preventDefault();onAdjust(1)}
  if(event.key==="ArrowDown"||event.key==="ArrowLeft"){event.preventDefault();onAdjust(-1)}
  if(event.key==="Home"){event.preventDefault();onChange("0")}
  if(event.key==="End"){event.preventDefault();onChange(String(maxScore))}
 };
 return <div className="vertical-score-control">
  <small>{team}</small>
  <div className="horizontal-score-rail">
   <button type="button" aria-label={`Bajar goles de ${team}`} onClick={()=>onAdjust(-1)}><Minus/></button>
   <div className="horizontal-score-value" role="slider" tabIndex="0" aria-label={`Arrastrar goles pronosticados de ${team}`} aria-valuemin="0" aria-valuemax={maxScore} aria-valuenow={safeScore} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={event=>{event.stopPropagation();dragRef.current=null}} onKeyDown={keyDrag}>
    <strong>{value===""?"0":value}</strong>
   </div>
   <button type="button" aria-label={`Subir goles de ${team}`} onClick={()=>onAdjust(1)}><Plus/></button>
  </div>
 </div>
}
function MatchScorers({match,teamName}){
 const teamScorers=match.scorers?.team||[],opponentScorers=match.scorers?.opponent||[];
 if(!teamScorers.length&&!opponentScorers.length)return null;
 return <div className="recent-match-scorers"><Goal size={14}/><span>{teamScorers.length?<><b>{teamName}:</b> {teamScorers.map(scorerLabel).join(", ")}</>:null}{teamScorers.length>0&&opponentScorers.length>0?" · ":""}{opponentScorers.length?<><b>{match.opponent}:</b> {opponentScorers.map(scorerLabel).join(", ")}</>:null}</span></div>
}
function TeamDetailOverlay({teamId,onClose}){
 const [detail,setDetail]=useState(null),[error,setError]=useState(""),[recentOpen,setRecentOpen]=useState(false),[squadOpen,setSquadOpen]=useState(false),[openPositions,setOpenPositions]=useState({});
 useEffect(()=>{setDetail(null);setError("");api(`/teams/${teamId}/detail`).then(setDetail).catch(err=>setError(err.message))},[teamId]);
 useEffect(()=>{setRecentOpen(false);setSquadOpen(false);setOpenPositions({})},[teamId]);
 useEffect(()=>{const close=event=>{if(event.key==="Escape")onClose()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[onClose]);
 const age=dob=>{const born=new Date(`${dob}T12:00:00`),today=new Date();let years=today.getFullYear()-born.getFullYear();if(today<new Date(today.getFullYear(),born.getMonth(),born.getDate()))years--;return years};
 const recentMatches=(detail?.recent_matches||[]).slice(0,10);
 return <div className="team-detail-overlay" role="dialog" aria-modal="true" aria-label="Información del equipo" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="team-detail-panel">
   {(error||!detail)&&<button className="team-detail-close" aria-label="Cerrar información del equipo" onClick={onClose}><X/></button>}
   {error?<div className="team-detail-loading"><strong>No se pudo cargar el equipo</strong><span>{error}</span></div>:!detail?<div className="team-detail-loading"><strong>Cargando selección...</strong></div>:<>
    <header className="team-profile-header"><div className="team-profile-main"><span className="team-profile-flag">{detail.team.flag_icon}</span><div><span className="eyebrow">FICHA DE SELECCIÓN</span><h1>{detail.team.name}</h1><p>{detail.team.fifa_code} · Grupo {detail.team.group_name||"—"} · {detail.team.confed}</p></div></div><button className="team-detail-close" aria-label="Cerrar información del equipo" onClick={onClose}><X/></button></header>
    <div className="team-stat-grid">
     {[["Partidos",detail.stats.played,BarChart3],["Ganados",detail.stats.won,Trophy],["Empatados",detail.stats.drawn,Shield],["Perdidos",detail.stats.lost,X],["Goles a favor",detail.stats.goals_for,Goal],["Goles en contra",detail.stats.goals_against,Goal],["Diferencia",`${detail.stats.goal_difference>0?"+":""}${detail.stats.goal_difference}`,Activity],["Victorias",`${detail.stats.win_percentage}%`,Trophy]].map(([label,value,Icon])=><article key={label}><Icon size={18}/><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    {recentMatches.length>0&&<section className="team-form collapsible-team-section"><button type="button" className="team-section-title team-section-toggle" aria-expanded={recentOpen} onClick={()=>setRecentOpen(!recentOpen)}><div><span className="eyebrow">ÚLTIMOS RESULTADOS</span><h2>Estado de forma</h2></div><div>{recentMatches.map(match=><b className={match.outcome} key={match.id}>{match.outcome==="W"?"V":match.outcome==="D"?"E":"D"}</b>)}<ChevronDown className={recentOpen?"open":""}/></div></button>{recentOpen&&<div className="recent-team-matches">{recentMatches.map(match=><article key={match.id}><span>{new Date(`${match.match_date}T12:00:00`).toLocaleDateString("es-ES",{day:"numeric",month:"short"})}</span><div><strong>{detail.team.name} {match.goals_for} – {match.goals_against} {match.opponent}</strong><MatchScorers match={match} teamName={detail.team.name}/></div><b className={match.outcome}>{match.outcome==="W"?"Victoria":match.outcome==="D"?"Empate":"Derrota"}</b></article>)}</div>}</section>}
    <section className="team-squad collapsible-team-section"><button type="button" className="team-section-title team-section-toggle" aria-expanded={squadOpen} onClick={()=>setSquadOpen(!squadOpen)}><div><span className="eyebrow">CONVOCATORIA</span><h2><Users size={21}/> Plantilla por posiciones</h2></div><strong>{detail.players.length} jugadores</strong><ChevronDown className={squadOpen?"open":""}/></button>
     {squadOpen&&<div className="position-groups">{Object.entries(positionNames).map(([code,label])=>{const group=detail.players.filter(player=>player.position===code),isOpen=Boolean(openPositions[code]);return group.length>0&&<section key={code}><button type="button" aria-expanded={isOpen} onClick={()=>setOpenPositions(current=>({...current,[code]:!current[code]}))}><span>{code}</span><h3>{label}</h3><b>{group.length}</b><ChevronDown className={isOpen?"open":""}/></button>{isOpen&&<div>{group.map(player=><article key={player.id}><strong>{player.number||"—"}</strong><div><b>{player.name}</b><span>{player.date_of_birth?`${age(player.date_of_birth)} años · ${new Date(`${player.date_of_birth}T12:00:00`).toLocaleDateString("es-ES")}`:"Edad no disponible"}</span></div></article>)}</div>}</section>})}</div>}
    </section>
   </>}
  </section>
 </div>
}
const comparisonStats=[["Partidos","played"],["Ganados","won"],["Empatados","drawn"],["Perdidos","lost",true],["Goles a favor","goals_for"],["Goles en contra","goals_against",true],["Diferencia","goal_difference"],["Victorias","win_percentage",false,"%"]];
function TeamComparisonOverlay({team1Id,team2Id,onClose}){
 const [teams,setTeams]=useState(null),[error,setError]=useState("");
 useEffect(()=>{setTeams(null);setError("");Promise.all([api(`/teams/${team1Id}/detail`),api(`/teams/${team2Id}/detail`)]).then(setTeams).catch(err=>setError(err.message))},[team1Id,team2Id]);
 useEffect(()=>{const close=event=>{if(event.key==="Escape")onClose()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[onClose]);
 const outcomeLabel=outcome=>outcome==="W"?"V":outcome==="D"?"E":"D";
 return <div className="team-detail-overlay" role="dialog" aria-modal="true" aria-label="Comparación de equipos" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="team-detail-panel comparison-panel">
   <button className="team-detail-close" aria-label="Cerrar comparación" onClick={onClose}><X/></button>
   {error?<div className="team-detail-loading"><strong>No se pudo cargar la comparación</strong><span>{error}</span></div>:!teams?<div className="team-detail-loading"><strong>Comparando selecciones...</strong></div>:<>
    <header className="comparison-header"><span className="eyebrow">CARA A CARA</span><h1>{teams[0].team.name} <b>VS</b> {teams[1].team.name}</h1><p>Comparativa de estadísticas y estado de forma</p></header>
    <div className="comparison-teams">{teams.map(({team})=><div key={team.id}><span>{team.flag_icon}</span><strong>{team.name}</strong><small>{team.fifa_code} · {team.confed}</small></div>)}</div>
    <div className="comparison-table">{comparisonStats.map(([label,key,lowerIsBetter=false,suffix=""])=>{const values=teams.map(team=>team.stats[key]),best=lowerIsBetter?Math.min(...values):Math.max(...values);const format=value=>`${key==="goal_difference"&&value>0?"+":""}${value}${suffix}`;return <div key={key}><strong className={values[0]===best&&values[0]!==values[1]?"best":""}>{format(values[0])}</strong><span>{label}</span><strong className={values[1]===best&&values[0]!==values[1]?"best":""}>{format(values[1])}</strong></div>})}</div>
    <section className="comparison-form"><div className="team-section-title"><div><span className="eyebrow">ÚLTIMOS RESULTADOS</span><h2>Estado de forma</h2></div></div><div>{teams.map(({team,recent_matches})=><article key={team.id}><strong>{team.name}</strong><span>{recent_matches.length?recent_matches.map(match=><b className={match.outcome} key={match.id} title={`${match.opponent}: ${match.goals_for}-${match.goals_against}`}>{outcomeLabel(match.outcome)}</b>):<small>Sin partidos disputados</small>}</span></article>)}</div></section>
   </>}
  </section>
 </div>
}
export function MatchDetailPage(){
 const {id}=useParams(),navigate=useNavigate(),location=useLocation(),{user}=useAuth(),[data,setData]=useState(null),[comments,setComments]=useState([]),[text,setText]=useState(""),[error,setError]=useState(""),[participantsOpen,setParticipantsOpen]=useState(false),[selectedTeam,setSelectedTeam]=useState(null),[comparing,setComparing]=useState(false),[result,setResult]=useState({g1:"",g2:""}),[resultScorerIds,setResultScorerIds]=useState([]),[savingResult,setSavingResult]=useState(false),[resultMessage,setResultMessage]=useState(""),[pick,setPick]=useState({winner:"draw",g1:"0",g2:"0",scorerId:null}),[players,setPlayers]=useState([]),[savingPick,setSavingPick]=useState(false),[pickMessage,setPickMessage]=useState("");
 const hydratedPickMatchId=useRef(null);
 const load=()=>{setError("");return Promise.all([api(`/matches/${id}/detail`),api(`/matches/${id}/comments`)]).then(([d,c])=>{setData(d);setComments(c)}).catch(err=>setError(err.message))};
 useEffect(()=>{load()},[id]);
	 useEffect(()=>{if(data)setResult({g1:data.match.result_team1??"",g2:data.match.result_team2??""})},[data?.match.result_team1,data?.match.result_team2]);
	 useEffect(()=>{if(data)setResultScorerIds((data.match.actual_scorers||[]).map(player=>player.id))},[data?.match.id,data?.match.actual_scorers]);
	 useEffect(()=>{if(data&&hydratedPickMatchId.current!==data.match.id){hydratedPickMatchId.current=data.match.id;const g1=data.match.predicted_team1_goals??"0",g2=data.match.predicted_team2_goals??"0";setPick({winner:data.match.predicted_winner||winnerFromScore(g1,g2),g1,g2,scorerId:data.match.predicted_scorer_id||null})}},[data?.match.id,data?.match.predicted_winner,data?.match.predicted_team1_goals,data?.match.predicted_team2_goals,data?.match.predicted_scorer_id]);
	 const scorerEnabled=Boolean(Number(data?.match?.scorer_enabled));
	 useEffect(()=>{const m=data?.match,codes=[m?.team1_team?.fifa_code,m?.team2_team?.fifa_code].filter(Boolean);if(scorerEnabled&&codes.length===2)api(`/players?team_fifa_codes=${codes.join(",")}`).then(setPlayers)},[data?.match.id,scorerEnabled]);
 const resultScoringTeamCodes=[Number(result.g1)>0&&data?.match.team1_team?.fifa_code,Number(result.g2)>0&&data?.match.team2_team?.fifa_code].filter(Boolean);
 const pickScoringTeamCodes=[Number(pick.g1)>0&&data?.match.team1_team?.fifa_code,Number(pick.g2)>0&&data?.match.team2_team?.fifa_code].filter(Boolean);
 const availablePickScorers=players.filter(player=>pickScoringTeamCodes.includes(player.team_fifa_code));
 useEffect(()=>{if(players.length)setResultScorerIds(ids=>ids.filter(id=>players.some(player=>player.id===id&&resultScoringTeamCodes.includes(player.team_fifa_code))))},[result.g1,result.g2,players.length]);
 useEffect(()=>{if(players.length&&pick.scorerId&&!availablePickScorers.some(player=>player.id===pick.scorerId))setPick(value=>({...value,scorerId:null}))},[pick.g1,pick.g2,players.length,pick.scorerId]);
 useEffect(()=>{if(data&&location.hash==="#comentarios")requestAnimationFrame(()=>document.getElementById("comentarios")?.scrollIntoView({behavior:"smooth",block:"start"}))},[data,location.hash]);
 if(error)return <div className="page error-page"><section className="content-card"><h1>No se pudo abrir el partido</h1><p>{error}</p><button className="primary" onClick={()=>navigate("/partidos",{replace:true})}><ArrowLeft size={16}/>Volver a partidos</button></section></div>;if(!data)return <div className="page-loader"><span/></div>;const m=data.match,total=data.distribution.reduce((a,x)=>a+x.count,0)||1;
 const add=async()=>{await api(`/matches/${id}/comments`,{method:"POST",body:{comment:text}});setText("");load()};
 const remove=async cid=>{await api(`/comments/${cid}`,{method:"DELETE"});load()};
 const availableResultScorers=players.filter(player=>resultScoringTeamCodes.includes(player.team_fifa_code)&&!resultScorerIds.includes(player.id));
	 const resultNeedsScorer=scorerEnabled&&Number(result.g1)+Number(result.g2)>0;
 const saveResult=async()=>{setSavingResult(true);setResultMessage("");try{await api(`/matches/${id}/finish`,{method:"POST",body:{result_team1:Number(result.g1),result_team2:Number(result.g2),scorer_ids:resultNeedsScorer?resultScorerIds:[]}});setResultMessage("Resultado y goleadores guardados. Puntos recalculados.");await load()}catch(err){setResultMessage(err.message)}finally{setSavingResult(false)}};
 const updatePickScore=(field,value)=>setPick(current=>{
  const next={...current,[field]:value};
  const winner=winnerFromScore(next.g1,next.g2);
  return winner?{...next,winner}:next;
 });
 const adjustPick=(field,delta)=>setPick(current=>{
  const next={...current,[field]:String(Math.max(0,Number(current[field]||0)+delta))};
  return {...next,winner:winnerFromScore(next.g1,next.g2)||next.winner};
 });
 const savePick=async()=>{setSavingPick(true);setPickMessage("");try{await api(m.prediction_id?`/predictions/${m.prediction_id}`:"/predictions",{method:m.prediction_id?"PUT":"POST",body:{match_id:m.id,predicted_winner:pick.winner,predicted_team1_goals:Number(pick.g1),predicted_team2_goals:Number(pick.g2),predicted_scorer_id:Number(pick.g1)+Number(pick.g2)===0?null:pick.scorerId}});setPickMessage("Pronóstico guardado.");await load()}catch(err){setPickMessage(err.message)}finally{setSavingPick(false)}};
 return <div className="page">{selectedTeam&&<TeamDetailOverlay teamId={selectedTeam} onClose={()=>setSelectedTeam(null)}/>} {comparing&&<TeamComparisonOverlay team1Id={m.team1_team.id} team2Id={m.team2_team.id} onClose={()=>setComparing(false)}/>}<button className="back-btn" onClick={()=>navigate("/partidos",{replace:true})}><ArrowLeft size={16}/>Todos los partidos</button><section className={`match-detail-hero ${m.is_star?"star-match-detail":""}`}><StarMatchTitle match={m} className="match-detail-star-title"/><span>{m.match_date} · {m.match_time} · {m.stadium}</span><div><button className="detail-team-button" disabled={!m.team1_team?.id} onClick={()=>setSelectedTeam(m.team1_team?.id)} aria-label={`Ver información de ${m.team1}`}><h1><Flag team={m.team1}/>{m.team1}</h1><small aria-hidden="true"><Info size={15}/></small></button><button className="detail-versus-button" disabled={!m.team1_team?.id||!m.team2_team?.id} onClick={()=>setComparing(true)}><b>{m.status==="finished"?`${m.result_team1} – ${m.result_team2}`:"VS"}</b><small><BarChart3 size={13}/> Comparar</small></button><button className="detail-team-button" disabled={!m.team2_team?.id} onClick={()=>setSelectedTeam(m.team2_team?.id)} aria-label={`Ver información de ${m.team2}`}><h1><Flag team={m.team2}/>{m.team2}</h1><small aria-hidden="true"><Info size={15}/></small></button></div><em>{m.status==="finished"?"Finalizado":m.betting_open?"Pronósticos abiertos":"Pronósticos cerrados"}</em>{m.status==="finished"&&m.actual_scorers?.length>0&&<div className="match-result-scorers"><strong>Goleadores</strong><span>{m.actual_scorers.map(player=><b key={player.id}>{player.name}</b>)}</span></div>}{m.betting_open&&<div className="detail-countdown"><Countdown date={m.effective_close_at}/></div>}{user.role==="admin"&&<div className="hero-result-editor"><strong>{m.status==="finished"?"Editar resultado del partido":"Introducir resultado del partido"}</strong><div className="result-inputs"><label>{m.team1}<input aria-label={`Resultado de ${m.team1}`} type="number" min="0" inputMode="numeric" value={result.g1} onChange={e=>setResult({...result,g1:e.target.value})}/></label><b>:</b><label>{m.team2}<input aria-label={`Resultado de ${m.team2}`} type="number" min="0" inputMode="numeric" value={result.g2} onChange={e=>setResult({...result,g2:e.target.value})}/></label></div>{resultNeedsScorer&&<div className="result-scorers-editor"><label>Goleadores puntuables<SearchSelect items={availableResultScorers} onChange={player=>player&&setResultScorerIds([...resultScorerIds,player.id])} placeholder="Buscar y añadir jugador..." renderItem={player=><><strong>{player.name}</strong><small>{player.team_name} · {player.position}</small></>}/></label><div className="selected-scorers">{resultScorerIds.map(playerId=>{const player=players.find(row=>row.id===playerId)||m.actual_scorers?.find(row=>row.id===playerId);return player&&<button type="button" key={playerId} onClick={()=>setResultScorerIds(resultScorerIds.filter(value=>value!==playerId))}>{player.name} ×</button>})}</div><small>Selecciona cada jugador una sola vez. Los autogoles no se añaden.</small></div>}<button className="primary" disabled={savingResult||result.g1===""||result.g2===""||(resultNeedsScorer&&resultScorerIds.length===0)} onClick={saveResult}><Save size={16}/>{savingResult?"Guardando...":"Guardar resultado"}</button><small>Al guardar se recalculan automáticamente los puntos.</small>{resultMessage&&<small className={resultMessage.startsWith("Resultado")?"success-text":"error-text"}>{resultMessage}</small>}</div>}</section>
 <div className="detail-grid"><section className="content-card detail-prediction"><h2>{user.is_read_only?"Vista de espectador":"Mi pronóstico"}</h2>{m.betting_open&&!user.is_read_only?<><div className="detail-winner-picks"><button className={pick.winner==="team1"?"selected":""} onClick={()=>setPick({...pick,winner:"team1"})}><Flag team={m.team1}/><span>{m.team1}</span>{pick.winner==="team1"&&<Check/>}</button><button className={pick.winner==="draw"?"selected":""} onClick={()=>setPick({...pick,winner:"draw"})}><b>X</b><span>Empate</span>{pick.winner==="draw"&&<Check/>}</button><button className={pick.winner==="team2"?"selected":""} onClick={()=>setPick({...pick,winner:"team2"})}><Flag team={m.team2}/><span>{m.team2}</span>{pick.winner==="team2"&&<Check/>}</button></div><div className="detail-score-picker horizontal"><HorizontalScoreControl team={m.team1} value={pick.g1} onChange={value=>updatePickScore("g1",value)} onAdjust={delta=>adjustPick("g1",delta)}/><b>:</b><HorizontalScoreControl team={m.team2} value={pick.g2} onChange={value=>updatePickScore("g2",value)} onAdjust={delta=>adjustPick("g2",delta)}/></div>{scorerEnabled&&<div className="scorer-pick"><strong>Goleador del partido</strong>{Number(pick.g1)+Number(pick.g2)===0?<div className="scorer-selected-banner readonly"><div><span>Goleador elegido</span><strong>Sin goleador</strong><small>Marcador 0-0</small></div></div>:<ScorerPicker players={availablePickScorers} value={pick.scorerId} onChange={scorerId=>setPick({...pick,scorerId})} matchLabel={`${m.team1} - ${m.team2}`}/>}</div>}<button className="primary detail-save-pick" disabled={savingPick||!pick.winner||pick.g1===""||pick.g2===""||(scorerEnabled&&Number(pick.g1)+Number(pick.g2)>0&&!pick.scorerId)} onClick={savePick}><Save size={16}/>{savingPick?"Guardando...":m.prediction_id?"Guardar cambios":"Guardar pronóstico"}</button>{pickMessage&&<small className={pickMessage.startsWith("Pronóstico")?"success-text":"error-text"}>{pickMessage}</small>}</>:<><strong className="big-score">{user.is_read_only?"Sin participación":m.prediction_id?`${m.predicted_team1_goals} – ${m.predicted_team2_goals}`:"Sin pronóstico"}</strong>{!user.is_read_only&&m.predicted_scorer&&<p>Goleador elegido: {m.predicted_scorer.name}</p>}<p>{user.is_read_only?"Puedes ver el partido, participantes, distribución y comentarios sin intervenir.":m.status==="finished"?`${m.total_points||0} puntos obtenidos`:"Las apuestas de este partido están cerradas."}</p></>}</section><section className="content-card"><h2>Distribución</h2>{data.revealed?["team1","draw","team2"].map(key=>{const n=data.distribution.find(x=>x.winner===key)?.count||0;return <div className="distribution" key={key}><span>{key==="team1"?m.team1:key==="team2"?m.team2:"Empate"}</span><i><b style={{width:`${n/total*100}%`}}/></i><strong>{Math.round(n/total*100)}%</strong></div>}):<HiddenDistribution revealAt={m.effective_close_at} onReveal={load}/>}</section></div>
 <section className="content-card participants-card"><button className="participants-toggle" onClick={()=>setParticipantsOpen(!participantsOpen)}><h2>Participantes ({data.revealed?data.participants.filter(p=>p.participating).length:data.participant_count||0})</h2><span>{participantsOpen?"Ocultar":"Mostrar"}<ChevronDown className={participantsOpen?"open":""}/></span></button>{participantsOpen&&<div className="participants">{data.revealed?data.participants.map(p=><div key={p.id}><strong>{p.username}</strong>{!p.participating?<span className="not-participating error-text">Sin participar</span>:<><span className="participant-prediction"><b>{p.predicted_team1_goals}–{p.predicted_team2_goals}</b>{p.predicted_team1_goals+p.predicted_team2_goals>0&&p.predicted_scorer_name&&<small>Goleador: {p.predicted_scorer_name}</small>}</span><b>+{p.total_points}</b></>}</div>):data.participants?.length?data.participants.map(p=><div key={p.id}><strong>{p.username}</strong>{p.participating&&p.result_valid!==undefined?<span className="participant-admin-checks"><small className={p.result_valid?"success-text":"error-text"}>Resultado {p.result_valid?"válido":"inválido"}</small><small className={p.scorer_required?(p.scorer_valid?"success-text":"error-text"):"muted-text"}>{p.scorer_required?`Goleador ${p.scorer_valid?"válido":"inválido"}`:"Sin goleador"}</small></span>:<span className={p.participating?"success-text":"not-participating error-text"}>{p.participating?"Pronóstico registrado":"Sin participar"}</span>}</div>):<p>{data.participant_count?`${data.participant_count} pronóstico${data.participant_count===1?"":"s"} registrado${data.participant_count===1?"":"s"}. Los nombres y apuestas se revelarán al cierre.`:"Aún no hay participantes."}</p>}</div>}</section>
 <section id="comentarios" className="content-card comments"><h2><MessageCircle size={20}/> Comentarios</h2>{!user.is_read_only&&<div className="comment-form"><input value={text} onChange={e=>setText(e.target.value)} maxLength="500" placeholder="Comparte tu lectura del partido…"/><button className="primary" disabled={!text.trim()} onClick={add}><Send size={16}/></button></div>}{comments.map(c=><article key={c.id}><Avatar user={c} className="mini-avatar"/><div><strong>{c.username}</strong><p>{c.comment}</p><small>{new Date(c.created_at).toLocaleString("es-ES")}</small></div>{!user.is_read_only&&(c.user_id===user.id||user.role==="admin")&&<button onClick={()=>remove(c.id)}><Trash2 size={15}/></button>}</article>)}</section></div>
}
