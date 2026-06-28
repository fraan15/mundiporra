import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Calculator, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Eye, Info, Medal, Radio, Sparkles, Star, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { startVisiblePolling } from "../utils/visiblePolling";
import { BadgeCatalogDialog, Flag } from "../components/SportsUI";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { ActivityAvatar } from "../components/Avatar";
import { countryTimeZone, formatLocalDateTime, localMatchDate, localMatchTime } from "../utils/matchDateTime";
import { useLiveScores } from "../hooks/useLiveScores";
import { MatchSimulationOverlay } from "./SocialPages";
import { EspnLiveScore } from "../components/EspnLiveScore";

const dateKey = (date) => date.toLocaleDateString("sv-SE");
const addDays = (date, days) => {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
};
const dayTitle = (date, offset) => {
  if (offset === -1) return "Ayer";
  if (offset === 0) return "Hoy";
  if (offset === 1) return "Mañana";
  return date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" });
};
const shortDate = (date) => date.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
const hasResult = (match) => match.result_team1 !== null && match.result_team2 !== null;
const isCalendarMatchVisible = (match, calendarKeys, countryCode) => {
  if (!match.published) return false;
  if (match.in_play) return true;
  if (match.betting_open) return true;
  return calendarKeys.has(localMatchDate(match, countryCode));
};
const normalizeCalendarResponse = (payload) => Array.isArray(payload)
  ? { calendar_today: null, matches: payload }
  : { calendar_today: payload?.calendar_today || null, matches: Array.isArray(payload?.matches) ? payload.matches : [] };
const predictionScoreText = (match, emptyText) => match.prediction_id ? `${match.predicted_team1_goals} – ${match.predicted_team2_goals}` : emptyText;
const predictionScorerText = (match, user) => !user.is_read_only && Number(match.scorer_enabled) && match.prediction_id && match.predicted_scorer?.name ? `Gol: ${match.predicted_scorer.name}` : "";
const closeText = (match, current, countryCode) => {
  if (match.status === "finished") return match.match_time ? `Finalizado · ${localMatchTime(match, countryCode)}` : "Finalizado";
  if (match.in_play) return "En juego";
  if (!match.betting_open) return "Cerrado";
  const ms = Math.max(0, new Date(match.effective_close_at) - current);
  const hours = Math.floor(ms / 3600000), minutes = Math.floor(ms % 3600000 / 60000);
  return hours >= 24 ? `Cierra en ${Math.floor(hours / 24)} día ${hours % 24} h` : `Cierra en ${hours} h ${minutes} min`;
};
const closeState = (match) => match.status === "finished" ? "finished" : match.in_play ? "playing" : match.betting_open ? "open" : "closed";

export function KnockoutInfoDialog({ onClose }) {
  const examplesRef = useRef(null);
  const [activeExample, setActiveExample] = useState(0);
  const examples = [
    ["Apuestas 1-1 y acaba 1-1 tras 120 minutos", "Aciertas empate y resultado exacto. Si luego un equipo gana en penaltis, no cambia nada para la porra."],
    ["Apuestas 2-2, acaba 2-2 en 90 minutos y 3-3 tras prórroga", "El resultado válido es 3-3. Aciertas el empate, pero no el resultado exacto."],
    ["Apuestas victoria 2-1 y el partido acaba 1-1 tras 120 minutos", "Para la porra es empate. No aciertas el signo aunque tu equipo pase en penaltis."],
    ["Apuestas 1-2 y el partido acaba 1-2 en la prórroga", "Cuenta como victoria visitante 1-2. Puedes acertar signo, resultado exacto y goleador si coincide."],
    ["Tu goleador marca en la prórroga", "Ese gol sí cuenta para el apartado de goleador."],
    ["Tu goleador marca solo en la tanda de penaltis", "Ese penalti no cuenta como gol para la porra."]
  ];

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const updateActiveExample = () => {
    const scroller = examplesRef.current;
    if (!scroller) return;
    const cards = Array.from(scroller.querySelectorAll("article"));
    if (!cards.length) return;
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    const closestIndex = cards.reduce((bestIndex, card, index) => {
      const bestCard = cards[bestIndex];
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const bestCenter = bestCard.offsetLeft + bestCard.offsetWidth / 2;
      return Math.abs(cardCenter - center) < Math.abs(bestCenter - center) ? index : bestIndex;
    }, 0);
    setActiveExample(closestIndex);
  };

  const goToExample = (index) => {
    const card = examplesRef.current?.querySelectorAll("article")[index];
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    setActiveExample(index);
  };

  return <div className="knockout-info-overlay" role="dialog" aria-modal="true" aria-labelledby="knockout-info-title" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="knockout-info-dialog">
      <header>
        <div><span className="eyebrow"><Info size={14}/> INFO ELIMINATORIAS</span><h2 id="knockout-info-title">Cómo puntúan los partidos de eliminatoria</h2></div>
        <button type="button" aria-label="Cerrar información de eliminatorias" title="Cerrar" onClick={onClose}><X size={20}/></button>
      </header>
      <div className="knockout-info-scroll">
        <section>
          <h3>Desde cuándo aplica</h3>
          <p>A partir del domingo 28/06, en el partido de las 21:00, los partidos pasan a modo eliminatoria. A nivel de apuesta, todo sigue igual: eliges marcador y goleador como hasta ahora.</p>
        </section>
        <section>
          <h3>Resultado válido para la porra</h3>
          <ul>
            <li>Cuenta el marcador final hasta los 120 minutos.</li>
            <li>Si hay prórroga, la prórroga sí cuenta para el resultado.</li>
            <li>Si después de 120 minutos el partido está empatado, para la porra cuenta como empate.</li>
            <li>La tanda de penaltis no cuenta para el resultado, no cambia el signo y no añade goles ni goleadores.</li>
          </ul>
        </section>
        <section>
          <h3>Goleadores</h3>
          <ul>
            <li>Los goles marcados durante los 90 minutos cuentan.</li>
            <li>Los goles marcados en la prórroga cuentan.</li>
            <li>Los goles de una tanda de penaltis no cuentan para el goleador.</li>
          </ul>
        </section>
        <section>
          <h3>Puntos</h3>
          <p>El sistema de puntos sigue igual: se puntúa por signo o ganador del marcador válido, por resultado exacto y por goleador. Si el partido es estrella, se aplicará el multiplicador que ya usa la porra.</p>
        </section>
        <section>
          <h3>Ejemplos rápidos</h3>
          <div className="knockout-info-examples" ref={examplesRef} aria-label="Ejemplos rápidos de eliminatorias" onScroll={updateActiveExample}>
            {examples.map(([title, text]) => <article key={title}><strong>{title}</strong><p>{text}</p></article>)}
          </div>
          <div className="knockout-info-example-hint" aria-label="Páginas de ejemplos rápidos">
            {examples.map(([title], index) => (
              <button
                type="button"
                className={index === activeExample ? "active" : ""}
                key={`knockout-example-dot-${title}`}
                aria-label={`Ver ejemplo ${index + 1}`}
                onClick={() => goToExample(index)}
              />
            ))}
          </div>
        </section>
      </div>
    </section>
  </div>;
}

const liveScoreText = (match, liveScore) => liveScore?.available && liveScore.score
  ? `${liveScore.score.team1} - ${liveScore.score.team2}`
  : hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : "VS";
const liveStatusText = (liveScore) => {
  if (!liveScore?.available) return "";
  if (liveScore.completed || liveScore.espn_completed) return "FIN";
  const status = `${liveScore.status || ""} ${liveScore.clock || ""}`.toLowerCase();
  if (/half|descanso|intermedio/.test(status)) return "DES";
  return liveScore.clock || "";
};
const liveWinner = (score) => {
  const g1 = Number(score?.team1 || 0), g2 = Number(score?.team2 || 0);
  return g1 === g2 ? "draw" : g1 > g2 ? "team1" : "team2";
};
const livePredictionChecks = (match, liveScore) => {
  if (!match.prediction_id || !liveScore?.score) return null;
  const predictedScorerId = Number(match.predicted_team1_goals) + Number(match.predicted_team2_goals) === 0
    ? "no-scorer"
    : match.predicted_scorer_id;
  const currentScorers = new Set((liveScore.scorer_player_ids || []).map(String));
  if (Number(match.scorer_enabled) && Number(liveScore.score.team1 || 0) + Number(liveScore.score.team2 || 0) === 0) currentScorers.add("no-scorer");
  return [
    { key: "winner", label: "Ganador", hit: match.predicted_winner === liveWinner(liveScore.score) },
    { key: "exact", label: "Resultado", hit: Number(match.predicted_team1_goals) === Number(liveScore.score.team1 || 0) && Number(match.predicted_team2_goals) === Number(liveScore.score.team2 || 0) },
    { key: "scorer", label: "Goleador", hit: Boolean(Number(match.scorer_enabled) && predictedScorerId && currentScorers.has(String(predictedScorerId))), disabled: !Number(match.scorer_enabled) },
  ].filter((part) => !part.disabled);
};
const predictedWinnerLabel = (match) => {
  if (!match.prediction_id) return "Sin apuesta";
  if (match.predicted_winner === "draw") return "Empate";
  if (match.predicted_winner === "team1") return match.team1;
  if (match.predicted_winner === "team2") return match.team2;
  return "Sin apuesta";
};
const predictedResultLabel = (match) => match.prediction_id
  ? `${match.predicted_team1_goals ?? 0}-${match.predicted_team2_goals ?? 0}`
  : "Sin apuesta";
const predictedScorerLabel = (match) => {
  if (!match.prediction_id || !Number(match.scorer_enabled)) return "Sin apuesta";
  if (Number(match.predicted_team1_goals || 0) + Number(match.predicted_team2_goals || 0) === 0) return "Sin goleador";
  return match.predicted_scorer?.name || "Sin goleador";
};
const goalSideClass = (goal, match) => {
  const code = String(goal?.team_code || "").toUpperCase();
  if (code && code === String(match.team2_team?.fifa_code || "").toUpperCase()) return "away";
  return "home";
};
const pairGoalsByTeam = (goals, match) => {
  const grouped = goals.reduce((acc, goal) => {
    acc[goalSideClass(goal, match)].push(goal);
    return acc;
  }, { home: [], away: [] });
  return Array.from(
    { length: Math.max(grouped.home.length, grouped.away.length) },
    (_, index) => ({ home: grouped.home[index], away: grouped.away[index] }),
  );
};
function LiveTickerPointsCard({ match, liveScore, onSimulateMatch }) {
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(false);
  const checks = livePredictionChecks(match, liveScore);
  const canPreview = Boolean(liveScore?.score);
  useEffect(() => {
    if (!canPreview) { setPreview(null); setPreviewError(false); return; }
    setPreviewError(false);
    api(`/matches/${match.id}/simulation`, {
      method: "POST",
      body: {
        result_team1: liveScore.score.team1,
        result_team2: liveScore.score.team2,
        scorer_ids: liveScore.scorer_player_ids || [],
      },
    }).then(setPreview).catch(() => { setPreview(null); setPreviewError(true); });
  }, [match.id, canPreview, liveScore?.score?.team1, liveScore?.score?.team2, JSON.stringify(liveScore?.scorer_player_ids || [])]);
  const points = preview?.points;
  const rows = points ? [
    { key: "winner", label: "Ganador", pick: predictedWinnerLabel(match), value: points.winner_points || 0 },
    { key: "exact", label: "Resultado", pick: predictedResultLabel(match), value: points.exact_result_points || 0 },
    { key: "scorer", label: "Goleador", pick: predictedScorerLabel(match), value: points.scorer_points || 0, disabled: !Number(match.scorer_enabled) },
  ].filter((part) => !part.disabled) : null;
  return <div className="espn-points-preview live-ticker-points detail-simulation-card">
    <button type="button" className="live-ticker-simulate" onClick={() => onSimulateMatch(match)} aria-label={`Abrir simulador con ${match.team1} - ${match.team2}`}>
      <Calculator size={15}/>
    </button>
    <small>Si terminara así</small>
    <strong>{points ? `+${points.total_points || 0} pts` : "Simular puntos"}</strong>
    <div>{rows?.length ? rows.map((part) => <span className={Number(part.value) > 0 ? "hit" : ""} key={part.key}>{Number(part.value) > 0 ? <CheckCircle2 size={13}/> : <X size={13}/>}<b>{part.label}</b><small className="live-ticker-pick">Pusiste: {part.pick}</small><em>+{part.value}</em></span>) : checks?.length ? checks.map((part) => <span className={part.hit ? "hit" : ""} key={part.key}>{part.hit ? <CheckCircle2 size={13}/> : <X size={13}/>}<b>{part.label}</b><small className="live-ticker-pick">Pusiste: {part.key === "winner" ? predictedWinnerLabel(match) : part.key === "exact" ? predictedResultLabel(match) : predictedScorerLabel(match)}</small><em>{previewError ? "?" : "..."}</em></span>) : <span><Calculator size={13}/><b>Usa el marcador ESPN actual</b></span>}</div>
  </div>;
}
function LiveMatchTicker({ matches, liveScores, user, onOpenMatch, onSimulateMatch }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedMatchId, setExpandedMatchId] = useState(null);
  useEffect(() => {
    setActiveIndex(0);
    setExpandedMatchId(null);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [matches.length]);
  const updateActiveIndex = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const cards = Array.from(scroller.querySelectorAll(".live-ticker-card"));
    if (!cards.length) { setActiveIndex(0); return; }
    const center = scroller.scrollLeft + scroller.clientWidth / 2;
    const next = cards.reduce((bestIndex, card, index) => {
      const bestCard = cards[bestIndex];
      const cardCenter = card.offsetLeft + card.offsetWidth / 2;
      const bestCenter = bestCard.offsetLeft + bestCard.offsetWidth / 2;
      return Math.abs(cardCenter - center) < Math.abs(bestCenter - center) ? index : bestIndex;
    }, 0);
    setActiveIndex((current) => {
      if (current !== next) {
        setExpandedMatchId((openMatchId) => openMatchId ? matches[next]?.id || openMatchId : null);
      }
      return next;
    });
  };
  const goToMatch = (index) => {
    const card = scrollRef.current?.querySelectorAll(".live-ticker-card")?.[index];
    if (card) card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setActiveIndex(index);
    setExpandedMatchId((openMatchId) => openMatchId ? matches[index]?.id || openMatchId : null);
  };
  if (!matches.length) return null;
  return <section className="live-ticker-section content-card" aria-label="Partidos en juego">
    <header className="live-ticker-header">
      <div><span className="eyebrow live-label"><Radio size={14}/> EN DIRECTO</span><h2>Partidos en juego</h2></div>
      <small>Desliza para verlos</small>
    </header>
    <div className="live-ticker-scroll" ref={scrollRef} onScroll={updateActiveIndex}>
      {matches.map((match, index) => {
        const liveScore = liveScores[match.id];
        const goalRows = pairGoalsByTeam(liveScore?.goals || [], match);
        const prediction = match.prediction_id ? predictionScoreText(match, "No apostado") : "No apostado";
        const scorer = predictionScorerText(match, user);
        const isExpanded = expandedMatchId === match.id;
        const statusText = liveStatusText(liveScore);
        return <article className={`live-ticker-card ${match.is_star ? "is-star" : ""} ${isExpanded ? "is-open" : ""}`} key={match.id}>
          <button type="button" className="live-ticker-summary" onClick={() => {
            if (activeIndex !== index) goToMatch(index);
            setExpandedMatchId(isExpanded ? null : match.id);
          }} aria-expanded={isExpanded}>
            {Boolean(match.is_star) && <span className="live-ticker-star"><Star size={12} fill="currentColor"/> x2</span>}
            <span className="live-ticker-live"><i/> ESPN</span>
            <span className="live-ticker-team home"><Flag team={match.team1} teamData={match.team1_team}/><strong>{match.team1}</strong></span>
            <span className="live-ticker-score-stack"><b>{liveScoreText(match, liveScore)}</b>{statusText && <small className={`live-ticker-minute ${statusText === "FIN" ? "is-final" : statusText === "DES" ? "is-break" : ""}`}>{statusText}</small>}</span>
            <span className="live-ticker-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
            <em>{isExpanded ? "Ocultar" : "Ver más"}</em>
          </button>
          {isExpanded && <div className="live-ticker-details">
            <div className="live-ticker-goals espn-goals-paired">
              {goalRows.length ? goalRows.map((row, rowIndex) => <div className="espn-goal-pair" key={`goal-row-${match.id}-${rowIndex}`}>
                {["home", "away"].map((side) => {
                  const goal = row[side];
                  return <span className={`espn-goal-cell ${side} ${goal ? "" : "empty"}`} key={side}>
                    {goal && <><time>{goal.minute || "—"}</time><i>⚽</i><strong>{goal.player_name || goal.espn_name || "Goleador sin identificar"}</strong></>}
                  </span>;
                })}
              </div>) : <p>Sin goles por ahora.</p>}
            </div>
            <div className="live-ticker-bet">
              <small>{user.is_read_only ? "Participación" : "Tu apuesta"}</small>
              <strong>
                {user.is_read_only ? <span>Solo lectura</span> : <>
                  <span className="live-ticker-bet-team"><Flag team={match.team1} teamData={match.team1_team}/></span>
                  <span className="live-ticker-bet-score">{prediction}</span>
                  <span className="live-ticker-bet-team"><Flag team={match.team2} teamData={match.team2_team}/></span>
                </>}
                {Boolean(match.is_star) && <em>x2</em>}
              </strong>
              {scorer ? <span>{scorer}</span> : <span>Sin goleador apostado</span>}
            </div>
            <LiveTickerPointsCard match={match} liveScore={liveScore} onSimulateMatch={onSimulateMatch}/>
            <button type="button" onClick={() => onOpenMatch(match)}><Eye size={14}/> Ver partido</button>
          </div>}
        </article>;
      })}
    </div>
    {matches.length > 1 && <div className="live-ticker-dots" aria-label={`Partido ${activeIndex + 1} de ${matches.length}`}>
      {matches.map((match, index) => <button type="button" key={`live-ticker-dot-${match.id}`} className={index === activeIndex ? "active" : ""} onClick={() => goToMatch(index)} aria-label={`Ver partido ${index + 1} de ${matches.length}`}/>)}
    </div>}
  </section>;
}

function DashboardCalendar({ matches, liveScores, calendarToday, onOpenMatch, restoreScrollTop, restoreCalendar, user, currentTime }) {
  const viewportRef = useRef(null);
  const pointerRef = useRef(null);
  const swipeRef = useRef(null);
  const [activeDayIndex, setActiveDayIndex] = useState(() => {
    if (!restoreCalendar) return 1;
    const storedIndex = Number(sessionStorage.getItem("dashboardCalendarActiveDayIndex"));
    return Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex <= 2 ? storedIndex : 1;
  });
  const dragFrameRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const localToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: countryTimeZone(user.country_code),
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(currentTime));
  const today = new Date(`${localToday}T12:00:00`);
  const calendarOffsets = [-1, 0, 1];
  const calendarDates = calendarOffsets.map(offset => addDays(today, offset));
  const calendarKeys = new Set(calendarDates.map(dateKey));
  const calendarMatches = matches.filter(match => isCalendarMatchVisible(match, calendarKeys, user.country_code));
  const days = calendarOffsets.map(offset => {
    const date = addDays(today, offset), key = dateKey(date);
    return {
      offset,
      key,
      title: dayTitle(date, offset),
      subtitle: shortDate(date),
      matches: calendarMatches.filter(match => localMatchDate(match, user.country_code) === key).sort((a, b) => localMatchTime(a, user.country_code).localeCompare(localMatchTime(b, user.country_code)))
    };
  });
  const activeDay = days[activeDayIndex] || days[1];
  const goToDay = (index) => {
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setActiveDayIndex(Math.max(0, Math.min(days.length - 1, index)));
    setDragOffset(0);
    setIsDragging(false);
  };
  const setSmoothDragOffset = (value) => {
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = requestAnimationFrame(() => {
      setDragOffset(value);
      dragFrameRef.current = null;
    });
  };
  const saveScroll = () => {
    sessionStorage.setItem("dashboardCalendarScrollTop", String(window.scrollY || 0));
    sessionStorage.setItem("dashboardCalendarActiveDayIndex", String(activeDayIndex));
    sessionStorage.setItem("dashboardCalendarActiveDateKey", activeDay?.key || "");
  };
  const openMatch = (event, match) => {
    event.stopPropagation();
    saveScroll();
    onOpenMatch(match);
  };
  const openMatchOnKey = (event, match) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openMatch(event, match);
  };
  const startMatchPointer = (event) => {
    pointerRef.current = { x: event.clientX, y: event.clientY, moved: false, blocked: false };
  };
  const moveMatchPointer = (event) => {
    if (!pointerRef.current) return;
    const deltaX = Math.abs(event.clientX - pointerRef.current.x);
    const deltaY = Math.abs(event.clientY - pointerRef.current.y);
    if (deltaX > 12 || deltaY > 12) pointerRef.current.moved = true;
  };
  const clickMatch = (event, match) => {
    if (pointerRef.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
      pointerRef.current = null;
      return;
    }
    pointerRef.current = null;
    openMatch(event, match);
  };
  const startSwipe = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    swipeRef.current = { x: event.clientX, y: event.clientY, dragging: false, vertical: false, pointerId: event.pointerId };
  };
  const moveSwipe = (event) => {
    if (!swipeRef.current) return;
    const deltaX = event.clientX - swipeRef.current.x;
    const deltaY = event.clientY - swipeRef.current.y;
    const absX = Math.abs(deltaX), absY = Math.abs(deltaY);
    if (!swipeRef.current.dragging && !swipeRef.current.vertical) {
      if (absY > 12 && absY > absX * 1.05) {
        swipeRef.current = null;
        return;
      }
      if (absX >= 26 && absX > absY * 1.25) {
        swipeRef.current.dragging = true;
        setIsDragging(true);
        viewportRef.current?.setPointerCapture?.(swipeRef.current.pointerId);
      }
    }
    if (swipeRef.current.vertical) return;
    if (swipeRef.current.dragging) {
      pointerRef.current = pointerRef.current ? { ...pointerRef.current, moved: true, blocked: true } : pointerRef.current;
      if (event.pointerType !== "mouse") {
        event.preventDefault();
        const direction = deltaX < 0 ? 1 : -1;
        const nextIndex = activeDayIndex + direction;
        swipeRef.current = null;
        setIsDragging(false);
        setDragOffset(0);
        window.setTimeout(() => { pointerRef.current = null; }, 0);
        if (nextIndex >= 0 && nextIndex < days.length) goToDay(nextIndex);
        return;
      }
      const width = viewportRef.current?.clientWidth || 1;
      const atStart = activeDayIndex === 0 && deltaX > 0;
      const atEnd = activeDayIndex === days.length - 1 && deltaX < 0;
      const resistance = atStart || atEnd ? 0.22 : 0.98;
      setSmoothDragOffset(Math.max(-width * 0.42, Math.min(width * 0.42, deltaX * resistance)));
    }
  };
  const endSwipe = (event) => {
    if (!swipeRef.current) return;
    const { x, y, dragging } = swipeRef.current;
    const deltaX = event.clientX - x, deltaY = event.clientY - y;
    swipeRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setIsDragging(false);
    setDragOffset(0);
    if (!dragging || Math.abs(deltaX) < 32 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    pointerRef.current = pointerRef.current ? { ...pointerRef.current, moved: true, blocked: true } : pointerRef.current;
    window.setTimeout(() => { pointerRef.current = null; }, 0);
    goToDay(activeDayIndex + (deltaX < 0 ? 1 : -1));
  };
  const cancelSwipe = () => {
    swipeRef.current = null;
    if (dragFrameRef.current) {
      cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    setIsDragging(false);
    setDragOffset(0);
  };
  useEffect(() => () => {
    if (dragFrameRef.current) cancelAnimationFrame(dragFrameRef.current);
  }, []);
  useEffect(() => {
    if (!restoreCalendar) return;
    const storedKey = sessionStorage.getItem("dashboardCalendarActiveDateKey");
    const storedIndex = Number(sessionStorage.getItem("dashboardCalendarActiveDayIndex"));
    const keyIndex = storedKey ? days.findIndex(day => day.key === storedKey) : -1;
    if (keyIndex >= 0) setActiveDayIndex(keyIndex);
    else if (Number.isInteger(storedIndex) && storedIndex >= 0 && storedIndex < days.length) setActiveDayIndex(storedIndex);
  }, [days[0].key, restoreCalendar]);
  useEffect(() => {
    if (restoreScrollTop === null) return;
    window.requestAnimationFrame(() => window.scrollTo({ top: restoreScrollTop, behavior: "auto" }));
  }, [restoreScrollTop]);

  return <section className="dashboard-calendar expanded" aria-label="Calendario de partidos">
    <header>
      <div><span className="eyebrow"><CalendarDays size={14}/> CALENDARIO</span></div>
    </header>
    <div className="dashboard-calendar-carousel">
      <div className="calendar-day-tabs" aria-label="Días del calendario">
        {days.map((day, index) => <button type="button" key={day.key} className={index === activeDayIndex ? "active" : ""} onClick={()=>goToDay(index)} aria-label={`Ver ${day.title}`}>
          <strong>{day.title}</strong>
          <span>{day.subtitle}</span>
        </button>)}
      </div>
      <div className="calendar-days-viewport" ref={viewportRef} onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={endSwipe} onPointerCancel={cancelSwipe}>
        <div className={`calendar-days-track ${isDragging ? "is-dragging" : "is-animating"}`} style={{ transform: `translate3d(calc(${-activeDayIndex * 100}% + ${dragOffset}px),0,0)` }}>
          {days.map((day, index) => <article className={`calendar-day-slide ${index === activeDayIndex ? "active" : ""} ${index === activeDayIndex - 1 ? "prev" : ""} ${index === activeDayIndex + 1 ? "next" : ""}`} key={day.key} aria-hidden={index !== activeDayIndex}>
            <header className="calendar-day-header">
              <h3>{day.title}</h3>
              <span>{day.matches.length ? `${day.matches.length} partido${day.matches.length === 1 ? "" : "s"}` : day.subtitle}</span>
            </header>
            <div className="calendar-day-matches">{day.matches.length ? day.matches.map(match => <button type="button" className="calendar-match" key={match.id} onPointerDown={startMatchPointer} onPointerMove={moveMatchPointer} onPointerCancel={()=>{pointerRef.current=null}} onClick={event=>clickMatch(event, match)} onKeyDown={event=>openMatchOnKey(event, match)} aria-label={`Ver detalle de ${match.team1} contra ${match.team2}`}>
          <span className="calendar-match-main">
            <span className="calendar-team home"><strong>{match.team1}</strong><Flag team={match.team1} teamData={match.team1_team}/></span>
            <b>{liveScores[match.id]?.available && liveScores[match.id]?.score ? `${liveScores[match.id].score.team1} - ${liveScores[match.id].score.team2}` : hasResult(match) ? `${match.result_team1} - ${match.result_team2}` : localMatchTime(match, user.country_code)}</b>
            <span className="calendar-team away"><Flag team={match.team2} teamData={match.team2_team}/><strong>{match.team2}</strong></span>
          </span>
          <span className="calendar-match-meta">
            <span className={`calendar-bet ${match.prediction_id ? "has-prediction" : "no-prediction"}`}>
              {user.is_read_only ? "Solo lectura" : match.prediction_id ? `Tu apuesta: ${match.predicted_team1_goals} - ${match.predicted_team2_goals}` : "Sin apuesta"}
            </span>
            {match.in_play && liveScores[match.id]?.available ? <span className="calendar-close playing calendar-live-state"><EspnLiveScore data={liveScores[match.id]}/></span> : match.in_play ? <span className="calendar-close playing calendar-live-state"><i aria-hidden="true"/>ESPN</span> : <span className={`calendar-close ${closeState(match)}`}><Clock3 size={12}/>{closeText(match, currentTime, user.country_code)}</span>}
            {(Boolean(match.is_star)||match.predicted_scorer?.name)&&<span className={`calendar-special ${match.is_star&&match.predicted_scorer?.name?"split":""}`}>
              {Boolean(match.is_star)&&<span className="calendar-star"><Star size={12} fill="currentColor"/> Estrella x2</span>}
              {match.predicted_scorer?.name&&<span className="calendar-scorer">Goleador: {match.predicted_scorer.name}</span>}
            </span>}
          </span>
        </button>) : <p className="calendar-empty-day">{day.offset === 0 || day.offset === 1 ? "No hay partidos publicados." : "No hay partidos para este día"}</p>}</div>
          </article>)}
        </div>
      </div>
      <div className="calendar-carousel-controls" aria-label="Cambiar día del calendario">
        <button type="button" className="calendar-carousel-arrow" onClick={()=>goToDay(activeDayIndex - 1)} disabled={activeDayIndex === 0} aria-label="Ir a ayer"><ChevronLeft size={18}/></button>
        <div className="calendar-carousel-dots">
          {days.map((day, index) => <button type="button" key={day.key} className={index === activeDayIndex ? "active" : ""} onClick={()=>goToDay(index)} aria-label={`Ver ${day.title}`}/>)}
        </div>
        <button type="button" className="calendar-carousel-arrow" onClick={()=>goToDay(activeDayIndex + 1)} disabled={activeDayIndex === days.length - 1} aria-label="Ir a mañana"><ChevronRight size={18}/></button>
      </div>
    </div>
  </section>;
}

export function DashboardPage() {
  const {user}=useAuth(),navigate=useNavigate(),location=useLocation(),[data,setData]=useState(null),[activity,setActivity]=useState([]),[calendarMatches,setCalendarMatches]=useState([]),[calendarToday,setCalendarToday]=useState(null),[tick,setTick]=useState(Date.now()),[knockoutInfoOpen,setKnockoutInfoOpen]=useState(false),[medalInfoOpen,setMedalInfoOpen]=useState(false),[medalData,setMedalData]=useState(null);
  const [simulationMatch,setSimulationMatch]=useState(null);
  const restoreDashboardCalendar=location.state?.restoreDashboardCalendar===true;
  const [calendarReturnInfo]=useState(()=>restoreDashboardCalendar?{scrollTop:Number(sessionStorage.getItem("dashboardCalendarScrollTop")||0)}:null);
  const calendarRestoreScrollTop=calendarReturnInfo ? calendarReturnInfo.scrollTop : null;
  const initialDashboardHydrated=useRef(false);
  const loadDashboard=()=>api("/dashboard").then((dashboard)=>{
    setData(dashboard);
    if(dashboard.calendar_today)setCalendarToday(dashboard.calendar_today);
    if(!initialDashboardHydrated.current){
      initialDashboardHydrated.current=true;
      if(Array.isArray(dashboard.activity_preview))setActivity(dashboard.activity_preview);
      if(Array.isArray(dashboard.calendar_matches))setCalendarMatches(dashboard.calendar_matches);
    }
  });
  const loadCalendar=()=>api("/dashboard/calendar").then((payload)=>{
    const calendar = normalizeCalendarResponse(payload);
    if(calendar.calendar_today)setCalendarToday(calendar.calendar_today);
    setCalendarMatches(calendar.matches);
  });
  useEffect(()=>{const tickTimer=setInterval(()=>setTick(Date.now()),1000);const stopDashboard=startVisiblePolling(loadDashboard,15000);const stopMatches=startVisiblePolling(loadCalendar,30000,{immediate:false});return()=>{clearInterval(tickTimer);stopDashboard();stopMatches()}},[]);
  const liveScores=useLiveScores([...(data?.in_play_matches||[]),...calendarMatches]);
  if(!data)return <div className="page-loader"><span/></div>;
  const s=data.summary,inPlayMatches=data.in_play_matches||[];
  const openMatch=(match, suppressRef)=>{
    if(!match||suppressRef?.current)return;
    navigate(`/match/${match.id}`);
  };
  const openMedalInfo=()=>{
    setMedalInfoOpen(true);
    if(!medalData)api("/dashboard/medals").then(setMedalData);
  };
  const openCalendarMatch=(match)=>{
    const historyState=window.history.state||{};
    window.history.replaceState({...historyState,usr:{...(historyState.usr||{}),restoreDashboardCalendar:true}},"");
    navigate(`/match/${match.id}`,{state:{fromDashboardCalendar:true}});
  };
  const openLiveSimulation=(match)=>{
    if(!match)return;
    setSimulationMatch(match);
  };
  return <div className="page dashboard-page"><section className="hero-panel dashboard-hero"><div><span className="eyebrow"><Sparkles size={14}/> TU CENTRO DE JUEGO</span><h1>Hola, {user.display_name||user.username}</h1><p>{user.is_read_only?"Modo solo lectura: puedes consultar toda la porra sin participar.":s.pending?`Tienes ${s.pending} partidos pendientes de pronosticar.`:"Todo al día. A disfrutar de la jornada."}</p></div><button className="hero-rank" onClick={()=>navigate("/clasificacion")} title="Ver clasificación"><small>POSICIÓN</small><strong>#{s.position}</strong><span>{s.total_points} puntos</span></button></section>
  {knockoutInfoOpen&&<KnockoutInfoDialog onClose={()=>setKnockoutInfoOpen(false)}/>}
  {medalInfoOpen&&<BadgeCatalogDialog catalog={medalData?.badge_catalog} disputed={medalData?.disputed_badges} onClose={()=>setMedalInfoOpen(false)}/>}
  {simulationMatch&&<MatchSimulationOverlay match={simulationMatch} players={[]} user={user} initialLiveResponse={{live:liveScores[simulationMatch.id]}} onClose={()=>setSimulationMatch(null)}/>}
  <div className="dashboard-overview">
  {user.role!=="admin"&&!user.is_read_only&&<button className={`pending-bet-banner ${s.pending>0?"has-pending":"complete"}`} onClick={()=>navigate("/partidos#upcoming")}>{s.pending>0?<AlertCircle/>:<CheckCircle2/>}<span><small>PARTIDOS PENDIENTES DE APUESTA</small><strong>{s.pending}</strong><em>{s.pending>0?"Completa tus pronósticos":"Estás al día"}</em></span><ArrowRight/></button>}</div>
  <section className="worldcup-dashboard-actions" aria-label="Información del Mundial">
    <button type="button" className="worldcup-dashboard-action knockout" onClick={()=>setKnockoutInfoOpen(true)}>
      <span className="worldcup-action-icon"><Info size={20}/></span>
      <span className="worldcup-action-copy">
        <strong>Info Playoffs</strong>
        <small>Prórroga, penaltis y puntuación</small>
      </span>
      <span className="worldcup-action-arrow"><ArrowRight size={17}/></span>
    </button>
    <button type="button" className="worldcup-dashboard-action medals" onClick={openMedalInfo}>
      <span className="worldcup-action-icon"><Medal size={20}/></span>
      <span className="worldcup-action-copy">
        <strong>Medallero</strong>
        <small>Insignias y logros de la porra</small>
      </span>
      <span className="worldcup-action-arrow"><ArrowRight size={17}/></span>
    </button>
  </section>
  <LiveMatchTicker matches={inPlayMatches} liveScores={liveScores} user={user} onOpenMatch={openMatch} onSimulateMatch={openLiveSimulation}/>
  <DashboardCalendar matches={calendarMatches} liveScores={liveScores} calendarToday={calendarToday} onOpenMatch={openCalendarMatch} restoreScrollTop={calendarRestoreScrollTop} restoreCalendar={restoreDashboardCalendar} user={user} currentTime={tick}/>
  <div className="dashboard-grid">
  <section className="content-card activity-card"><div className="card-title"><div><span className="eyebrow">COMUNIDAD</span><h2>Última actividad</h2></div><button onClick={()=>navigate("/actividad")}>Ver todo</button></div><div className="activity-feed compact">{activity.slice(0,4).map((a,i)=><article key={i}><ActivityAvatar user={a} type={a.type}/><div><strong className="activity-line">{a.text}{a.type==="points"&&<span className={`points-award ${a.exact_result_points>0?"exact":""}`}>{a.exact_result_points>0&&<Star size={14} fill="currentColor"/>}+{a.total_points} pts</span>}</strong><small>{formatLocalDateTime(a.created_at,user.country_code)}</small></div></article>)}</div></section></div></div>
}
