import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Flag } from "../components/SportsUI";

export function DashboardPage() {
  const {user}=useAuth(),navigate=useNavigate(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[tick,setTick]=useState(Date.now()),[matchIndex,setMatchIndex]=useState(0);
  const swipeStart=useRef(null);
  useEffect(()=>{Promise.all([api("/dashboard"),api("/activity?page=1&page_size=5")]).then(([d,a])=>{setData(d);setActivity(Array.isArray(a)?a.slice(0,5):a.items)});const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer)},[]);
  if(!data)return <div className="page-loader"><span/></div>;
  const s=data.summary,nextMatches=data.next_matches||[],m=nextMatches[matchIndex]||data.next_match,remaining=m?Math.max(0,new Date(m.effective_close_at)-tick):0;
  const countdown=remaining?`${Math.floor(remaining/86400000)}d ${Math.floor(remaining%86400000/3600000)}h ${Math.floor(remaining%3600000/60000)}m`:"Cerrado";
  const startSwipe=(event)=>{if(event.pointerType==="mouse")return;swipeStart.current={x:event.clientX,y:event.clientY}};
  const endSwipe=(event)=>{
    if(!swipeStart.current||nextMatches.length<2)return;
    const deltaX=event.clientX-swipeStart.current.x,deltaY=event.clientY-swipeStart.current.y;
    swipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    setMatchIndex(index=>(index+(deltaX<0?1:-1)+nextMatches.length)%nextMatches.length);
  };
  return <div className="page"><section className="hero-panel dashboard-hero"><div><span className="eyebrow"><Sparkles size={14}/> TU CENTRO DE JUEGO</span><h1>Hola, {user.username}</h1><p>{s.pending?`Tienes ${s.pending} partidos pendientes de pronosticar.`:"Todo al día. A disfrutar de la jornada."}</p></div><div className="hero-rank"><small>POSICIÓN</small><strong>#{s.position}</strong><span>{s.total_points} puntos</span></div></section>
  <div className="dashboard-overview"><div className="dashboard-stats">{[["Puntos totales",s.total_points],["Exactos",s.exact_hits],["Ganadores",s.winner_hits],["Posición",`#${s.position}`]].map(([k,v])=><article key={k}><span>{k}</span><strong>{v}</strong></article>)}</div>
  <button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button></div>
  <div className="dashboard-grid"><section className="next-match content-card"><div className="card-title"><div><span className="eyebrow">PRÓXIMOS PARTIDOS</span><h2>Los siguientes retos</h2></div><button onClick={()=>m&&navigate(`/match/${m.id}`)}>Ver detalle <ArrowRight size={16}/></button></div>{m?<><div className="next-match-swipe" onPointerDown={startSwipe} onPointerUp={endSwipe} onPointerCancel={()=>{swipeStart.current=null}}><div className="next-teams"><div><Flag team={m.team1}/><strong>{m.team1}</strong></div><b>VS</b><div><Flag team={m.team2}/><strong>{m.team2}</strong></div></div><div className="countdown"><Clock3 size={18}/><span>Cierra en</span><strong>{countdown}</strong></div></div>{nextMatches.length>1&&<div className="match-carousel-controls"><button aria-label="Partido anterior" onClick={()=>setMatchIndex((matchIndex-1+nextMatches.length)%nextMatches.length)}><ArrowLeft size={17}/></button><div>{nextMatches.map((match,index)=><button aria-label={`Ver partido ${index+1}`} className={index===matchIndex?"active":""} key={match.id} onClick={()=>setMatchIndex(index)}/>)}</div><button aria-label="Partido siguiente" onClick={()=>setMatchIndex((matchIndex+1)%nextMatches.length)}><ArrowRight size={17}/></button></div>}</>:<p className="empty-state">No hay próximos partidos abiertos.</p>}</section>
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,3).map((a,i)=><article key={i}><span className={`feed-icon ${a.type}`}>{a.type==="points"?"+":"⚽"}</span><div><strong>{a.text}</strong><small>{new Date(a.created_at).toLocaleString("es-ES")}</small></div></article>)}</div></section></div></div>
}
