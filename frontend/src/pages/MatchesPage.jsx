import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ChevronDown, CircleDot, History } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";

const dateKey = (date) => date.toLocaleDateString("sv-SE");

export function MatchesPage() {
  const initialTab = window.location.hash === "#upcoming" ? "pending" : "matches";
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[activeTab,setActiveTab]=useState(initialTab);
  const [openSections,setOpenSections]=useState({today:false,upcoming:false,previous:false});
  const load=async()=>{setMatches(await api("/matches"));setLoading(false)};
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[]);

  const now=new Date();
  const today=dateKey(now);
  const yesterdayDate=new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate()-1);
  const yesterday=dateKey(yesterdayDate);
  const pending=matches.filter(m=>m.betting_open&&!m.prediction_id);
  const historical=matches.filter(m=>m.status==="finished"&&m.match_date<yesterday).reverse();
  const sections=[
    ["today","Partidos de hoy","La jornada en juego",CircleDot,matches.filter(m=>m.match_date===today)],
    ["upcoming","Próximos partidos","Prepara tus siguientes pronósticos",CalendarClock,matches.filter(m=>m.match_date>today)],
    ["previous","Partidos anteriores","Resultados y puntos",CheckCircle2,matches.filter(m=>m.match_date<today).reverse()]
  ];
  const tabs=[
    ["matches","Partidos",CircleDot,matches.length],
    ["pending","Partidos pendientes de participar",CalendarClock,pending.length],
    ["history","Histórico partidos",History,historical.length]
  ];

  const selectTab=(id)=>{
    setActiveTab(id);
    window.history.replaceState(null,"",id==="pending"?"#upcoming":window.location.pathname);
  };

  const renderGrid=(items,emptyText)=><div className="match-tab-content">{items.length
    ? <div className="match-grid">{items.map(m=><MatchCard key={m.id} match={m} onSaved={load}/>)}</div>
    : <p className="empty-state">{emptyText}</p>}
  </div>;

  return <div className="page"><section className="page-heading"><span className="eyebrow">CALENDARIO MUNDIALISTA</span><h1>Todos los partidos</h1><p>Pronostica, consulta participantes y entra al análisis de cada encuentro.</p></section>
    <nav className="matches-tabs" aria-label="Filtros de partidos">{tabs.map(([id,label,Icon,count])=><button key={id} className={activeTab===id?"active":""} onClick={()=>selectTab(id)}><Icon size={17}/><span>{label}</span><b>{count}</b></button>)}</nav>
    {loading?<div className="skeleton-grid"><i/><i/></div>:activeTab==="matches"
      ? sections.map(([id,title,text,Icon,items])=>items.length>0&&<section id={id} className={`match-section collapsible ${id}`} key={id}><button className="section-title" onClick={()=>setOpenSections({...openSections,[id]:!openSections[id]})}><div><span className="section-icon"><Icon size={19}/></span><div><h2>{title}</h2><p>{text}</p></div></div><div className="section-progress"><strong className={items.some(m=>m.betting_open&&!m.prediction_id)?"pending":"complete"}>{items.filter(m=>m.prediction_id).length}/{items.length}</strong><span>{items.some(m=>m.betting_open&&!m.prediction_id)?"Te falta apostar":"Completado"}</span><ChevronDown className={openSections[id]?"open":""}/></div></button>{openSections[id]&&<div className="match-grid">{items.map(m=><MatchCard key={m.id} match={m} onSaved={load}/>)}</div>}</section>)
      : activeTab==="pending"
        ? renderGrid(pending,"No tienes partidos pendientes de participar.")
        : renderGrid(historical,"Todavía no hay partidos en el histórico.")}
  </div>;
}
