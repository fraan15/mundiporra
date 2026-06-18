import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarClock, CheckCircle2, ChevronDown, CircleDot, History, X } from "lucide-react";
import { api } from "../api/client";
import { MatchCard } from "../components/MatchCard";
import { SearchSelect } from "../components/SearchSelect";
import { useAuth } from "../App";

const dateKey = (date) => date.toLocaleDateString("sv-SE");
const HISTORY_DEFAULT_LIMIT = 8;
const monthLabel = (date) => date.toLocaleDateString("es-ES",{month:"long",year:"numeric"});
const parseDate = (value) => value ? new Date(`${value}T12:00:00`) : new Date();
const addMonths = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1);

export function MatchesPage() {
  const { user } = useAuth();
  const initialTab = window.location.hash === "#upcoming" ? "pending" : "matches";
  const [matches,setMatches]=useState([]),[loading,setLoading]=useState(true),[activeTab,setActiveTab]=useState(initialTab);
  const [openSection,setOpenSection]=useState(null);
  const [carouselIndexes,setCarouselIndexes]=useState({});
  const [historyDate,setHistoryDate]=useState(""),[historyTeamId,setHistoryTeamId]=useState("");
  const [historyCalendarOpen,setHistoryCalendarOpen]=useState(false),[historyCalendarMonth,setHistoryCalendarMonth]=useState(()=>new Date());
  const historyCalendarRef=useRef(null);
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
  const pending=user.is_read_only?[]:matches.filter(m=>m.betting_open&&!m.prediction_id);
  const finished=matches.filter(m=>hasResult(m)&&startedLessThan24HoursAgo(m)).reverse();
  const historical=matches.filter(m=>hasResult(m)&&!startedLessThan24HoursAgo(m)).reverse();
  const historyTeams=useMemo(()=>{
    const teams=new Map();
    historical.forEach(match=>{
      [match.team1_team&&{...match.team1_team,name:match.team1},match.team2_team&&{...match.team2_team,name:match.team2}].filter(Boolean).forEach(team=>teams.set(String(team.id),team));
    });
    return [...teams.values()].sort((a,b)=>a.name.localeCompare(b.name,"es"));
  },[historical]);
  const filteredHistorical=historical.filter(match=>
    (!historyDate||match.match_date===historyDate)&&
    (!historyTeamId||String(match.team1_id)===String(historyTeamId)||String(match.team2_id)===String(historyTeamId))
  );
  const historyFiltersActive=Boolean(historyDate||historyTeamId);
  const visibleHistorical=historyFiltersActive?filteredHistorical:historical.slice(0,HISTORY_DEFAULT_LIMIT);
  const sections=[
    ["finished","Partidos terminados","Resultados de las últimas 24 horas",CheckCircle2,finished],
    ["today","Partidos pendientes hoy","La jornada en juego",CircleDot,matches.filter(m=>m.match_date===today&&!hasResult(m))],
    ["upcoming","Próximos partidos","Prepara tus siguientes pronósticos",CalendarClock,matches.filter(m=>m.match_date>today&&!hasResult(m))],
  ];
  const tabs=[
    ["matches","Partidos",CircleDot,matches.length],
    ["pending",user.is_read_only?"Solo lectura":"Partidos pendientes de participar",CalendarClock,pending.length],
    ["history","Histórico partidos",History,activeTab==="history"?visibleHistorical.length:historical.length]
  ];

  useEffect(()=>{setCarouselIndex("history-tab",0)},[historyDate,historyTeamId]);
  useEffect(()=>{
    const closeCalendar=(event)=>{
      if(!historyCalendarRef.current?.contains(event.target))setHistoryCalendarOpen(false);
    };
    document.addEventListener("pointerdown",closeCalendar);
    return()=>document.removeEventListener("pointerdown",closeCalendar);
  },[]);

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
  const renderHistoryCalendar=()=> {
    const monthStart=new Date(historyCalendarMonth.getFullYear(),historyCalendarMonth.getMonth(),1);
    const monthEnd=new Date(historyCalendarMonth.getFullYear(),historyCalendarMonth.getMonth()+1,0);
    const blankDays=(monthStart.getDay()+6)%7;
    const days=Array.from({length:monthEnd.getDate()},(_,index)=>new Date(historyCalendarMonth.getFullYear(),historyCalendarMonth.getMonth(),index+1));
    return <div className="history-date-picker" ref={historyCalendarRef}>
      <button type="button" className="history-date-input" onClick={()=>{setHistoryCalendarMonth(parseDate(historyDate));setHistoryCalendarOpen(!historyCalendarOpen)}}>{historyDate?parseDate(historyDate).toLocaleDateString("es-ES"):"Seleccionar fecha"}</button>
      {historyCalendarOpen&&<div className="history-calendar-popover">
        <header><button type="button" aria-label="Mes anterior" onClick={()=>setHistoryCalendarMonth(addMonths(historyCalendarMonth,-1))}><ArrowLeft size={15}/></button><strong>{monthLabel(historyCalendarMonth)}</strong><button type="button" aria-label="Mes siguiente" onClick={()=>setHistoryCalendarMonth(addMonths(historyCalendarMonth,1))}><ArrowRight size={15}/></button></header>
        <div className="history-calendar-weekdays">{["L","M","X","J","V","S","D"].map(day=><span key={day}>{day}</span>)}</div>
        <div className="history-calendar-days">{Array.from({length:blankDays},(_,index)=><i key={`blank-${index}`}/>)}{days.map(day=>{const value=dateKey(day);return <button type="button" className={value===historyDate?"active":""} key={value} onClick={()=>{setHistoryDate(value);setHistoryCalendarOpen(false)}}>{day.getDate()}</button>})}</div>
      </div>}
    </div>;
  };
  const renderHistoryFilters=()=> {
    return <section className="history-match-filters" aria-label="Filtros del histórico de partidos">
      <label><span>Fecha</span>{renderHistoryCalendar()}</label>
      <label><span>Selección</span><SearchSelect label="Buscar selección" items={historyTeams} value={historyTeamId} onChange={team=>setHistoryTeamId(team?.id||"")} placeholder="Buscar selección..." renderItem={team=><><strong>{team.flag_icon} {team.name}</strong><small>{team.fifa_code||"Selección"}</small></>}/></label>
      {historyFiltersActive&&<button type="button" className="history-clear-filters" onClick={()=>{setHistoryDate("");setHistoryTeamId("")}}><X size={16}/>Limpiar</button>}
      <small>{visibleHistorical.length} de {historical.length} partido{historical.length===1?"":"s"}</small>
    </section>;
  };

  return <div className="page"><section className="page-heading"><span className="eyebrow">CALENDARIO MUNDIALISTA</span><h1>Todos los partidos</h1><p>{user.is_read_only?"Consulta partidos, participantes y análisis de cada encuentro.":"Pronostica, consulta participantes y entra al análisis de cada encuentro."}</p></section>
    <nav className="matches-tabs" aria-label="Filtros de partidos">{tabs.map(([id,label,Icon,count])=><button key={id} className={activeTab===id?"active":""} onClick={()=>selectTab(id)}><Icon size={17}/><span>{label}</span><b>{count}</b></button>)}</nav>
    {loading?<div className="skeleton-grid"><i/><i/></div>:activeTab==="matches"
      ? sections.map(([id,title,text,Icon,items])=>items.length>0&&<section id={id} className={`match-section collapsible ${id}`} key={id}><button className="section-title" onClick={()=>setOpenSection(openSection===id?null:id)}><div><span className="section-icon"><Icon size={19}/></span><div><h2>{title}</h2><p>{text}</p></div></div><div className="section-progress"><strong className={items.some(m=>m.betting_open&&!m.prediction_id&&!user.is_read_only)?"pending":"complete"}>{user.is_read_only?items.length:items.filter(m=>m.prediction_id).length}/{items.length}</strong><span>{user.is_read_only?"Visible":items.some(m=>m.betting_open&&!m.prediction_id)?"Te falta apostar":"Completado"}</span><ChevronDown className={openSection===id?"open":""}/></div></button>{openSection===id&&renderCarousel(id,items,{verticalScoreWhenOpen:id==="today"||id==="upcoming"})}</section>)
      : activeTab==="pending"
        ? renderTabCarousel("pending-tab",pending,user.is_read_only?"El usuario de solo lectura no participa en apuestas.":"No tienes partidos pendientes de participar.",{verticalScorePicker:true})
        : <>{renderHistoryFilters()}{renderTabCarousel("history-tab",visibleHistorical,historical.length?"No hay partidos con esos filtros.":"Todavía no hay partidos en el histórico.")}</>}
  </div>;
}
