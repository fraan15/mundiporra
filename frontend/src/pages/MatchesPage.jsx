import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ChevronDown, CircleDot, History } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";

const dateKey = (date) => date.toLocaleDateString("sv-SE");

export function MatchesPage() {
  const initialTab = window.location.hash === "#upcoming" ? "pending" : "matches";
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[activeTab,setActiveTab]=useState(initialTab);
  const [openSection,setOpenSection]=useState(null);
  const [carouselIndexes,setCarouselIndexes]=useState({});
  const swipeStart=useRef(null);
  const load=async()=>{setMatches(await api("/matches"));setLoading(false)};
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer)},[]);

  const now=new Date();
  const today=dateKey(now);
  const hasResult=(match)=>match.result_team1!==null&&match.result_team2!==null;
  const startedLessThan24HoursAgo=(match)=>{
    const startedAt=new Date(`${match.match_date}T${match.match_time}:00`);
    const elapsed=now-startedAt;
    return elapsed>=0&&elapsed<24*60*60*1000;
  };
  const pending=matches.filter(m=>m.betting_open&&!m.prediction_id);
  const finished=matches.filter(m=>hasResult(m)&&startedLessThan24HoursAgo(m)).reverse();
  const historical=matches.filter(m=>hasResult(m)&&!startedLessThan24HoursAgo(m)).reverse();
  const sections=[
    ["finished","Partidos terminados","Resultados de las últimas 24 horas",CheckCircle2,finished],
    ["today","Partidos pendientes hoy","La jornada en juego",CircleDot,matches.filter(m=>m.match_date===today&&!hasResult(m))],
    ["upcoming","Próximos partidos","Prepara tus siguientes pronósticos",CalendarClock,matches.filter(m=>m.match_date>today&&!hasResult(m))]
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

  const setCarouselIndex=(sectionId,index)=>setCarouselIndexes(current=>({...current,[sectionId]:index}));
  const moveCarousel=(sectionId,length,direction)=>{
    const current=carouselIndexes[sectionId]||0;
    setCarouselIndex(sectionId,(current+direction+length)%length);
  };
  const startSwipe=(event,sectionId)=>{
    if(event.pointerType==="mouse")return;
    swipeStart.current={x:event.clientX,y:event.clientY,sectionId};
  };
  const endSwipe=(event,sectionId,length)=>{
    if(!swipeStart.current||swipeStart.current.sectionId!==sectionId||length<2)return;
    const deltaX=event.clientX-swipeStart.current.x,deltaY=event.clientY-swipeStart.current.y;
    swipeStart.current=null;
    if(Math.abs(deltaX)<45||Math.abs(deltaX)<=Math.abs(deltaY))return;
    moveCarousel(sectionId,length,deltaX<0?1:-1);
  };
  const renderCarousel=(sectionId,items,options={})=>{
    const index=Math.min(carouselIndexes[sectionId]||0,items.length-1);
    const match=items[index];
    return <div className="section-match-carousel">
      <div className="section-match-swipe" onPointerDown={event=>startSwipe(event,sectionId)} onPointerUp={event=>endSwipe(event,sectionId,items.length)} onPointerCancel={()=>{swipeStart.current=null}}>
        <MatchCard key={match.id} match={match} onSaved={load} verticalScorePicker={options.verticalScorePicker||options.verticalScoreWhenOpen&&match.betting_open}/>
      </div>
      {items.length>1&&<div className="match-carousel-controls"><button aria-label={`Partido anterior de ${sectionId}`} onClick={()=>moveCarousel(sectionId,items.length,-1)}><ArrowLeft size={17}/></button><div>{items.map((item,itemIndex)=><button aria-label={`Ver partido ${itemIndex+1}`} className={itemIndex===index?"active":""} key={item.id} onClick={()=>setCarouselIndex(sectionId,itemIndex)}/>)}</div><button aria-label={`Partido siguiente de ${sectionId}`} onClick={()=>moveCarousel(sectionId,items.length,1)}><ArrowRight size={17}/></button></div>}
    </div>;
  };
  const renderTabCarousel=(sectionId,items,emptyText,options={})=><div className="match-tab-content">{items.length
    ? renderCarousel(sectionId,items,options)
    : <p className="empty-state">{emptyText}</p>}
  </div>;

  return <div className="page"><section className="page-heading"><span className="eyebrow">CALENDARIO MUNDIALISTA</span><h1>Todos los partidos</h1><p>Pronostica, consulta participantes y entra al análisis de cada encuentro.</p></section>
    <nav className="matches-tabs" aria-label="Filtros de partidos">{tabs.map(([id,label,Icon,count])=><button key={id} className={activeTab===id?"active":""} onClick={()=>selectTab(id)}><Icon size={17}/><span>{label}</span><b>{count}</b></button>)}</nav>
    {loading?<div className="skeleton-grid"><i/><i/></div>:activeTab==="matches"
      ? sections.map(([id,title,text,Icon,items])=>items.length>0&&<section id={id} className={`match-section collapsible ${id}`} key={id}><button className="section-title" onClick={()=>setOpenSection(openSection===id?null:id)}><div><span className="section-icon"><Icon size={19}/></span><div><h2>{title}</h2><p>{text}</p></div></div><div className="section-progress"><strong className={items.some(m=>m.betting_open&&!m.prediction_id)?"pending":"complete"}>{items.filter(m=>m.prediction_id).length}/{items.length}</strong><span>{items.some(m=>m.betting_open&&!m.prediction_id)?"Te falta apostar":"Completado"}</span><ChevronDown className={openSection===id?"open":""}/></div></button>{openSection===id&&renderCarousel(id,items,{verticalScoreWhenOpen:id==="today"||id==="upcoming"})}</section>)
      : activeTab==="pending"
        ? renderTabCarousel("pending-tab",pending,"No tienes partidos pendientes de participar.",{verticalScorePicker:true})
        : renderTabCarousel("history-tab",historical,"Todavía no hay partidos en el histórico.")}
  </div>;
}
