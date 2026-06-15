import { useEffect, useState } from "react";
import { Activity, ArrowLeft, BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, Edit3, Goal, MessageCircle, Minus, Plus, Save, Send, Shield, Star, Trash2, Trophy, Users, X } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Badges, Flag, MiniChart } from "../components/SportsUI";
import { Countdown } from "../components/MatchCard";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { Avatar } from "../components/Avatar";
import { SearchSelect } from "../components/SearchSelect";

const StatCards=({s})=><div className="stat-cards">
  {[["Posición",`#${s.position}`],["Puntos",s.total_points],["Pronósticos",s.predicted_matches],["Ganadores",s.winner_hits],["Exactos",s.exact_hits],["Media",`${s.average_points} pts`]].map(([k,v])=><article key={k}><span>{k}</span><strong>{v}</strong></article>)}
</div>;

export function ProfilePage(){
  const {setUser}=useAuth(); const [data,setData]=useState(null),[phrase,setPhrase]=useState(""),[saved,setSaved]=useState(false),[avatarMessage,setAvatarMessage]=useState(""),[uploading,setUploading]=useState(false);
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
  return <div className="page"><section className="profile-hero"><div className="profile-avatar-editor"><Avatar user={data.user} className="profile-avatar"/><label className="avatar-upload"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={changeAvatar} disabled={uploading}/>{uploading?"Procesando...":data.user.avatar_url?"Cambiar foto":"Añadir foto"}</label>{data.user.avatar_url&&<button type="button" onClick={removeAvatar} disabled={uploading}>Eliminar</button>}</div><div><span className="eyebrow">PERFIL DE JUGADOR</span><h1>{data.user.username}</h1><p>{data.user.role==="admin"?"Administrador":"Participante"} · Desde {new Date(data.user.created_at).toLocaleDateString("es-ES")}</p><small className="avatar-requirements">JPEG, PNG o WebP · máximo 5 MB · mínimo 100 × 100 px</small>{avatarMessage&&<small className={avatarMessage.includes("actualizada")||avatarMessage.includes("eliminada")?"success-text":"error-text"}>{avatarMessage}</small>}</div></section>
    <StatCards s={s}/><section className="content-card"><h2>Mi frase</h2><div className="phrase-editor"><input maxLength="120" value={phrase} onChange={e=>setPhrase(e.target.value)} placeholder="Este año gano yo."/><button className="primary" onClick={save}><Edit3 size={16}/>Guardar</button></div>{saved&&<small className="success-text">Frase actualizada.</small>}</section>
    <StatsSections stats={s} history={data.history}/><section className="content-card"><h2>Medallas</h2><Badges badges={s.badges}/></section>
  </div>
}
function StatsSections({stats:s,history=[]}){return <><div className="insight-grid">{[["Ganadores acertados",`${s.winner_percentage}%`],["Resultados exactos",`${s.exact_percentage}%`],["Mejor jornada",s.best_day?`${s.best_day.points} pts`:"—"],["Peor jornada",s.worst_day?`${s.worst_day.points} pts`:"—"],["Equipo más elegido",s.most_picked_team],["Equipo más rentable",s.best_team]].map(([k,v])=><article className="content-card" key={k}><span>{k}</span><strong>{v}</strong></article>)}</div><div className="chart-grid"><section className="content-card"><h2>Puntos por día</h2><MiniChart data={s.daily}/></section><section className="content-card"><h2>Evolución de posición</h2><MiniChart data={history} field="position" inverse/></section></div></>}
export function PublicProfilePage(){
  const {id}=useParams(),navigate=useNavigate(),[data,setData]=useState(null);useEffect(()=>{api(`/users/${id}/public`).then(setData)},[id]);
  if(!data)return <div className="page-loader"><span/></div>;const s=data.stats;
  return <div className="page"><button className="back-btn" onClick={()=>navigate(-1)}><ArrowLeft size={16}/>Volver</button><section className="profile-hero public"><Avatar user={data.user} className="profile-avatar"/><div><span className="eyebrow">FICHA DEPORTIVA</span><h1>{data.user.username}</h1><blockquote>“{data.user.personal_phrase||"Todavía sin frase personal."}”</blockquote></div><b>#{s.position}</b></section><StatCards s={s}/><StatsSections stats={s} history={data.history}/><section className="content-card"><h2>Medallas</h2><Badges badges={s.badges}/></section><section className="content-card"><h2>Historial visible</h2><div className="prediction-history">{data.predictions.map(p=><div key={p.id}><span>{p.match_date}</span><strong><Flag team={p.team1}/>{p.team1} {p.predicted_team1_goals}–{p.predicted_team2_goals} {p.team2}<Flag team={p.team2}/></strong><b>+{p.total_points}</b></div>)}</div></section></div>
}
export function ActivityPage(){
 const [data,setData]=useState({items:[],page:1,total_pages:1});const load=page=>api(`/activity?page=${page}&page_size=10`).then(response=>setData(Array.isArray(response)?{items:response,page:1,total_pages:1}:response));useEffect(()=>{load(1)},[]);
 return <div className="page narrow"><section className="page-heading"><span className="eyebrow"><Activity size={14}/> COMUNIDAD</span><h1>Actividad reciente</h1><p>Lo último que está pasando en la porra.</p></section><div className="activity-feed">{data.items.map((item,i)=><article key={`${item.type}-${i}-${item.created_at}`}><span className={`feed-icon ${item.type}`}>{item.type==="points"?"+":"⚽"}</span><div><strong>{item.text}</strong><small>{new Date(item.created_at).toLocaleString("es-ES")}</small></div>{item.type==="points"&&<span className={`points-award ${item.exact_result_points>0?"exact":""}`}>{item.exact_result_points>0&&<Star size={15} fill="currentColor"/>}+{item.total_points} puntos</span>}</article>)}</div>{data.total_pages>1&&<nav className="pagination" aria-label="Paginación de actividad"><button disabled={data.page===1} onClick={()=>load(data.page-1)}><ChevronLeft/>Anterior</button><span>Página {data.page} de {data.total_pages}</span><button disabled={data.page===data.total_pages} onClick={()=>load(data.page+1)}>Siguiente<ChevronRight/></button></nav>}</div>
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
function MatchScorers({match,teamName}){
 const teamScorers=match.scorers?.team||[],opponentScorers=match.scorers?.opponent||[];
 if(!teamScorers.length&&!opponentScorers.length)return null;
 return <div className="recent-match-scorers"><Goal size={14}/><span>{teamScorers.length?<><b>{teamName}:</b> {teamScorers.map(scorerLabel).join(", ")}</>:null}{teamScorers.length&&opponentScorers.length?" · ":""}{opponentScorers.length?<><b>{match.opponent}:</b> {opponentScorers.map(scorerLabel).join(", ")}</>:null}</span></div>
}
function TeamDetailOverlay({teamId,onClose}){
 const [detail,setDetail]=useState(null),[error,setError]=useState("");
 useEffect(()=>{setDetail(null);setError("");api(`/teams/${teamId}/detail`).then(setDetail).catch(err=>setError(err.message))},[teamId]);
 useEffect(()=>{const close=event=>{if(event.key==="Escape")onClose()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[onClose]);
 const age=dob=>{const born=new Date(`${dob}T12:00:00`),today=new Date();let years=today.getFullYear()-born.getFullYear();if(today<new Date(today.getFullYear(),born.getMonth(),born.getDate()))years--;return years};
 return <div className="team-detail-overlay" role="dialog" aria-modal="true" aria-label="Información del equipo" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="team-detail-panel">
   <button className="team-detail-close" aria-label="Cerrar información del equipo" onClick={onClose}><X/></button>
   {error?<div className="team-detail-loading"><strong>No se pudo cargar el equipo</strong><span>{error}</span></div>:!detail?<div className="team-detail-loading"><strong>Cargando selección...</strong></div>:<>
    <header className="team-profile-header"><span className="team-profile-flag">{detail.team.flag_icon}</span><div><span className="eyebrow">FICHA DE SELECCIÓN</span><h1>{detail.team.name}</h1><p>{detail.team.fifa_code} · Grupo {detail.team.group_name||"—"} · {detail.team.confed}</p></div></header>
    <div className="team-stat-grid">
     {[["Partidos",detail.stats.played,BarChart3],["Ganados",detail.stats.won,Trophy],["Empatados",detail.stats.drawn,Shield],["Perdidos",detail.stats.lost,X],["Goles a favor",detail.stats.goals_for,Goal],["Goles en contra",detail.stats.goals_against,Goal],["Diferencia",`${detail.stats.goal_difference>0?"+":""}${detail.stats.goal_difference}`,Activity],["Victorias",`${detail.stats.win_percentage}%`,Trophy]].map(([label,value,Icon])=><article key={label}><Icon size={18}/><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    {detail.recent_matches.length>0&&<section className="team-form"><div className="team-section-title"><div><span className="eyebrow">ÚLTIMOS RESULTADOS</span><h2>Estado de forma</h2></div><div>{detail.recent_matches.map(match=><b className={match.outcome} key={match.id}>{match.outcome==="W"?"V":match.outcome==="D"?"E":"D"}</b>)}</div></div><div className="recent-team-matches">{detail.recent_matches.map(match=><article key={match.id}><span>{new Date(`${match.match_date}T12:00:00`).toLocaleDateString("es-ES",{day:"numeric",month:"short"})}</span><div><strong>{detail.team.name} {match.goals_for} – {match.goals_against} {match.opponent}</strong><MatchScorers match={match} teamName={detail.team.name}/></div><b className={match.outcome}>{match.outcome==="W"?"Victoria":match.outcome==="D"?"Empate":"Derrota"}</b></article>)}</div></section>}
    <section className="team-squad"><div className="team-section-title"><div><span className="eyebrow">CONVOCATORIA</span><h2><Users size={21}/> Plantilla por posiciones</h2></div><strong>{detail.players.length} jugadores</strong></div>
     <div className="position-groups">{Object.entries(positionNames).map(([code,label])=>{const group=detail.players.filter(player=>player.position===code);return group.length>0&&<section key={code}><header><span>{code}</span><h3>{label}</h3><b>{group.length}</b></header><div>{group.map(player=><article key={player.id}><strong>{player.number||"—"}</strong><div><b>{player.name}</b><span>{player.date_of_birth?`${age(player.date_of_birth)} años · ${new Date(`${player.date_of_birth}T12:00:00`).toLocaleDateString("es-ES")}`:"Edad no disponible"}</span></div></article>)}</div></section>})}</div>
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
 const {id}=useParams(),navigate=useNavigate(),location=useLocation(),{user}=useAuth(),[data,setData]=useState(null),[comments,setComments]=useState([]),[text,setText]=useState(""),[error,setError]=useState(""),[participantsOpen,setParticipantsOpen]=useState(false),[selectedTeam,setSelectedTeam]=useState(null),[comparing,setComparing]=useState(false),[result,setResult]=useState({g1:"",g2:""}),[resultScorerIds,setResultScorerIds]=useState([]),[savingResult,setSavingResult]=useState(false),[resultMessage,setResultMessage]=useState(""),[pick,setPick]=useState({winner:"",g1:"",g2:"",scorerId:null}),[players,setPlayers]=useState([]),[savingPick,setSavingPick]=useState(false),[pickMessage,setPickMessage]=useState("");
 const load=()=>{setError("");return Promise.all([api(`/matches/${id}/detail`),api(`/matches/${id}/comments`)]).then(([d,c])=>{setData(d);setComments(c)}).catch(err=>setError(err.message))};
 useEffect(()=>{load()},[id]);
 useEffect(()=>{if(data)setResult({g1:data.match.result_team1??"",g2:data.match.result_team2??""})},[data?.match.result_team1,data?.match.result_team2]);
 useEffect(()=>{if(data)setResultScorerIds((data.match.actual_scorers||[]).map(player=>player.id))},[data?.match.id,data?.match.actual_scorers]);
 useEffect(()=>{if(data)setPick({winner:data.match.predicted_winner||"",g1:data.match.predicted_team1_goals??"",g2:data.match.predicted_team2_goals??"",scorerId:data.match.predicted_scorer_id||null})},[data?.match.prediction_id,data?.match.predicted_winner,data?.match.predicted_team1_goals,data?.match.predicted_team2_goals,data?.match.predicted_scorer_id]);
 useEffect(()=>{const m=data?.match,codes=[m?.team1_team?.fifa_code,m?.team2_team?.fifa_code].filter(Boolean);if(m?.scorer_enabled&&codes.length===2)api(`/players?team_fifa_codes=${codes.join(",")}`).then(setPlayers)},[data?.match.id]);
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
 const resultNeedsScorer=m.scorer_enabled&&Number(result.g1)+Number(result.g2)>0;
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
 return <div className="page">{selectedTeam&&<TeamDetailOverlay teamId={selectedTeam} onClose={()=>setSelectedTeam(null)}/>} {comparing&&<TeamComparisonOverlay team1Id={m.team1_team.id} team2Id={m.team2_team.id} onClose={()=>setComparing(false)}/>}<button className="back-btn" onClick={()=>navigate("/partidos",{replace:true})}><ArrowLeft size={16}/>Todos los partidos</button><section className={`match-detail-hero ${m.is_star?"star-match-detail":""}`}><StarMatchTitle match={m} className="match-detail-star-title"/><span>{m.match_date} · {m.match_time} · {m.stadium}</span><div><button className="detail-team-button" disabled={!m.team1_team?.id} onClick={()=>setSelectedTeam(m.team1_team?.id)}><h1><Flag team={m.team1}/>{m.team1}</h1><small><Users size={14}/> Ver equipo y plantilla</small></button><button className="detail-versus-button" disabled={!m.team1_team?.id||!m.team2_team?.id} onClick={()=>setComparing(true)}><b>{m.status==="finished"?`${m.result_team1} – ${m.result_team2}`:"VS"}</b><small><BarChart3 size={13}/> Comparar</small></button><button className="detail-team-button" disabled={!m.team2_team?.id} onClick={()=>setSelectedTeam(m.team2_team?.id)}><h1>{m.team2}<Flag team={m.team2}/></h1><small><Users size={14}/> Ver equipo y plantilla</small></button></div><em>{m.status==="finished"?"Finalizado":m.betting_open?"Pronósticos abiertos":"Pronósticos cerrados"}</em>{m.status==="finished"&&m.actual_scorers?.length>0&&<div className="match-result-scorers"><strong>Goleadores</strong><span>{m.actual_scorers.map(player=><b key={player.id}>{player.name}</b>)}</span></div>}{m.betting_open&&<div className="detail-countdown"><Countdown date={m.effective_close_at}/></div>}{user.role==="admin"&&<div className="hero-result-editor"><strong>{m.status==="finished"?"Editar resultado del partido":"Introducir resultado del partido"}</strong><div className="result-inputs"><label>{m.team1}<input aria-label={`Resultado de ${m.team1}`} type="number" min="0" inputMode="numeric" value={result.g1} onChange={e=>setResult({...result,g1:e.target.value})}/></label><b>:</b><label>{m.team2}<input aria-label={`Resultado de ${m.team2}`} type="number" min="0" inputMode="numeric" value={result.g2} onChange={e=>setResult({...result,g2:e.target.value})}/></label></div>{resultNeedsScorer&&<div className="result-scorers-editor"><label>Goleadores puntuables<SearchSelect items={availableResultScorers} onChange={player=>player&&setResultScorerIds([...resultScorerIds,player.id])} placeholder="Buscar y añadir jugador..." renderItem={player=><><strong>{player.name}</strong><small>{player.team_name} · {player.position}</small></>}/></label><div className="selected-scorers">{resultScorerIds.map(playerId=>{const player=players.find(row=>row.id===playerId)||m.actual_scorers?.find(row=>row.id===playerId);return player&&<button type="button" key={playerId} onClick={()=>setResultScorerIds(resultScorerIds.filter(value=>value!==playerId))}>{player.name} ×</button>})}</div><small>Selecciona cada jugador una sola vez. Los autogoles no se añaden.</small></div>}<button className="primary" disabled={savingResult||result.g1===""||result.g2===""||(resultNeedsScorer&&resultScorerIds.length===0)} onClick={saveResult}><Save size={16}/>{savingResult?"Guardando...":"Guardar resultado"}</button><small>Al guardar se recalculan automáticamente los puntos.</small>{resultMessage&&<small className={resultMessage.startsWith("Resultado")?"success-text":"error-text"}>{resultMessage}</small>}</div>}</section>
 <div className="detail-grid"><section className="content-card detail-prediction"><h2>Mi pronóstico</h2>{m.betting_open?<><div className="detail-winner-picks"><button className={pick.winner==="team1"?"selected":""} onClick={()=>setPick({...pick,winner:"team1"})}><Flag team={m.team1}/><span>{m.team1}</span>{pick.winner==="team1"&&<Check/>}</button><button className={pick.winner==="draw"?"selected":""} onClick={()=>setPick({...pick,winner:"draw"})}><b>X</b><span>Empate</span>{pick.winner==="draw"&&<Check/>}</button><button className={pick.winner==="team2"?"selected":""} onClick={()=>setPick({...pick,winner:"team2"})}><Flag team={m.team2}/><span>{m.team2}</span>{pick.winner==="team2"&&<Check/>}</button></div><div className="detail-score-picker"><div><small>{m.team1}</small><span><button onClick={()=>adjustPick("g1",-1)}><Minus/></button><input aria-label={`Goles pronosticados de ${m.team1}`} type="number" min="0" inputMode="numeric" value={pick.g1} onChange={e=>updatePickScore("g1",e.target.value)}/><button onClick={()=>adjustPick("g1",1)}><Plus/></button></span></div><b>:</b><div><small>{m.team2}</small><span><button onClick={()=>adjustPick("g2",-1)}><Minus/></button><input aria-label={`Goles pronosticados de ${m.team2}`} type="number" min="0" inputMode="numeric" value={pick.g2} onChange={e=>updatePickScore("g2",e.target.value)}/><button onClick={()=>adjustPick("g2",1)}><Plus/></button></span></div></div>{m.scorer_enabled&&<div className="scorer-pick"><strong>Goleador del partido</strong>{Number(pick.g1)+Number(pick.g2)===0?<small>No se elige goleador para un 0-0.</small>:<SearchSelect items={availablePickScorers} value={pick.scorerId} onChange={player=>setPick({...pick,scorerId:player?.id||null})} placeholder="Buscar jugador..." renderItem={player=><><strong>{player.name}</strong><small>{player.team_name} · {player.position}</small></>}/>}</div>}<button className="primary detail-save-pick" disabled={savingPick||!pick.winner||pick.g1===""||pick.g2===""||(m.scorer_enabled&&Number(pick.g1)+Number(pick.g2)>0&&!pick.scorerId)} onClick={savePick}><Save size={16}/>{savingPick?"Guardando...":m.prediction_id?"Guardar cambios":"Guardar pronóstico"}</button>{pickMessage&&<small className={pickMessage.startsWith("Pronóstico")?"success-text":"error-text"}>{pickMessage}</small>}</>:<><strong className="big-score">{m.prediction_id?`${m.predicted_team1_goals} – ${m.predicted_team2_goals}`:"Sin pronóstico"}</strong>{m.predicted_scorer&&<p>Goleador elegido: {m.predicted_scorer.name}</p>}<p>{m.status==="finished"?`${m.total_points||0} puntos obtenidos`:"Las apuestas de este partido están cerradas."}</p></>}</section><section className="content-card"><h2>Distribución</h2>{data.revealed?["team1","draw","team2"].map(key=>{const n=data.distribution.find(x=>x.winner===key)?.count||0;return <div className="distribution" key={key}><span>{key==="team1"?m.team1:key==="team2"?m.team2:"Empate"}</span><i><b style={{width:`${n/total*100}%`}}/></i><strong>{Math.round(n/total*100)}%</strong></div>}):<HiddenDistribution revealAt={m.effective_close_at} onReveal={load}/>}</section></div>
 <section className="content-card participants-card"><button className="participants-toggle" onClick={()=>setParticipantsOpen(!participantsOpen)}><h2>Participantes ({data.revealed?data.participants.filter(p=>p.participating).length:data.participant_count||0})</h2><span>{participantsOpen?"Ocultar":"Mostrar"}<ChevronDown className={participantsOpen?"open":""}/></span></button>{participantsOpen&&<div className="participants">{data.revealed?data.participants.map(p=><div key={p.id}><strong>{p.username}</strong>{!p.participating?<span className="not-participating error-text">Sin participar</span>:<><span className="participant-prediction"><b>{p.predicted_team1_goals}–{p.predicted_team2_goals}</b>{p.predicted_team1_goals+p.predicted_team2_goals>0&&p.predicted_scorer_name&&<small>Goleador: {p.predicted_scorer_name}</small>}</span><b>+{p.total_points}</b></>}</div>):<p>{data.participant_count?`${data.participant_count} pronóstico${data.participant_count===1?"":"s"} registrado${data.participant_count===1?"":"s"}. Los nombres y apuestas se revelarán al cierre.`:"Aún no hay participantes."}</p>}</div>}</section>
 <section id="comentarios" className="content-card comments"><h2><MessageCircle size={20}/> Comentarios</h2><div className="comment-form"><input value={text} onChange={e=>setText(e.target.value)} maxLength="500" placeholder="Comparte tu lectura del partido…"/><button className="primary" disabled={!text.trim()} onClick={add}><Send size={16}/></button></div>{comments.map(c=><article key={c.id}><Avatar user={c} className="mini-avatar"/><div><strong>{c.username}</strong><p>{c.comment}</p><small>{new Date(c.created_at).toLocaleString("es-ES")}</small></div>{(c.user_id===user.id||user.role==="admin")&&<button onClick={()=>remove(c.id)}><Trash2 size={15}/></button>}</article>)}</section></div>
}
