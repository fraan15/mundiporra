import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, CircleDot } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";

export function MatchesPage() {
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true);
  const [openSections,setOpenSections]=useState({today:false,upcoming:false,previous:false});
  const load=async()=>{setMatches(await api("/matches"));setLoading(false)};
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[]);
  const today=new Date().toLocaleDateString("sv-SE");
  const sections=[
    ["today","Partidos de hoy","La jornada en juego",CircleDot,matches.filter(m=>m.match_date===today)],
    ["upcoming","Próximos partidos","Prepara tus siguientes pronósticos",CalendarClock,matches.filter(m=>m.match_date>today)],
    ["previous","Partidos anteriores","Resultados y puntos",CheckCircle2,matches.filter(m=>m.match_date<today).reverse()]
  ];
  return <div className="page"><section className="page-heading"><span className="eyebrow">CALENDARIO MUNDIALISTA</span><h1>Todos los partidos</h1><p>Pronostica, consulta participantes y entra al análisis de cada encuentro.</p></section>
    {loading?<div className="skeleton-grid"><i/><i/></div>:sections.map(([id,title,text,Icon,items])=>items.length>0&&<section id={id} className={`match-section collapsible ${id}`} key={id}><button className="section-title" onClick={()=>setOpenSections({...openSections,[id]:!openSections[id]})}><div><span className="section-icon"><Icon size={19}/></span><div><h2>{title}</h2><p>{text}</p></div></div><div className="section-progress"><strong className={items.some(m=>m.betting_open&&!m.prediction_id)?"pending":"complete"}>{items.filter(m=>m.prediction_id).length}/{items.length}</strong><span>{items.some(m=>m.betting_open&&!m.prediction_id)?"Te falta apostar":"Completado"}</span><ChevronDown className={openSections[id]?"open":""}/></div></button>{openSections[id]&&<div className="match-grid">{items.map(m=><MatchCard key={m.id} match={m} onSaved={load}/>)}</div>}</section>)}
  </div>;
}
