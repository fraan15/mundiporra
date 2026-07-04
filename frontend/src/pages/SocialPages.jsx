import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Calculator,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Film,
  ImagePlus,
  KeyRound,
  Goal,
  Info,
  MessageCircle,
  Minus,
  Plus,
  Save,
  Send,
  Shield,
  Star,
  Trash2,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Badges, Flag } from "../components/SportsUI";
import { KnockoutInfoDialog } from "./DashboardPage";
import { Countdown } from "../components/MatchCard";
import { StarMatchTitle } from "../components/StarMatchTitle";
import { ActivityAvatar, Avatar } from "../components/Avatar";
import { ScorerPicker } from "../components/ScorerPicker";
import { formatLocalDateTime, localMatchParts, localMatchTime } from "../utils/matchDateTime";
import { AvatarCropper } from "../components/AvatarCropper";
import { ReactionBar } from "../components/ReactionBar";
import { IMAGE_ACCEPT, inferImageType, optimizeImageForUpload, sendImage } from "../utils/imageUpload";
import { startVisiblePolling } from "../utils/visiblePolling";

const StatCards = ({ s, onPointsInfo }) => (
  <div className="profile-score-summary">
    <div className="stat-cards primary-stat-cards">
      {[
        ["Posición", `#${s.position}`],
        ["Puntos", s.total_points],
      ].map(([k, v]) => (
        <article key={k} className={k === "Puntos" ? "points-stat-card" : ""}>
          <span>{k}</span>
          <strong>{v}</strong>
          {k === "Puntos" && onPointsInfo && (
            <button
              type="button"
              className="points-info-trigger"
              aria-label="Ver de dónde salen todos los puntos"
              onClick={onPointsInfo}
            >
              <Info size={16} />
            </button>
          )}
        </article>
      ))}
    </div>
    <div className="profile-compact-stats content-card" aria-label="Resumen de pronósticos">
      {[
        ["Pronósticos", s.predicted_matches],
        ["Ganadores", s.winner_hits],
        ["Exactos", s.exact_hits],
        ["Goleadores", s.scorer_hits],
        ["Media diaria", `${s.average_points} pts`],
        ["% acierto", `${s.accuracy_percentage || 0}%`],
      ].map(([label, value]) => (
        <span key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </span>
      ))}
    </div>
  </div>
);

const liveMoment = (live, response) => {
  if (live.completed || response?.espn_completed) return "Final";
  const status = `${live.status || ""} ${live.clock || ""}`.toLowerCase();
  if (/\bht\b|half|descanso|intermedio|status_halftime/.test(status)) return "Descanso";
  return live.clock || (live.state === "pre" ? "Próximamente" : "En juego");
};
const goalSortMinute = (goal) => {
  const raw = String(goal?.display_minute || goal?.minute || "").replace(/[’']/g, "").trim();
  const match = raw.match(/(\d+)(?:\s*\+\s*(\d+))?/);
  if (!match) return -1;
  return Number(match[1]) * 100 + Number(match[2] || 0);
};
const previewWinnerLabel = (match) => {
  if (!match.prediction_id) return "Sin apuesta";
  if (match.predicted_winner === "draw") return "Empate";
  if (match.predicted_winner === "team1") return match.team1;
  if (match.predicted_winner === "team2") return match.team2;
  return "Sin apuesta";
};
const previewResultLabel = (match) => match.prediction_id
  ? `${match.predicted_team1_goals ?? 0}-${match.predicted_team2_goals ?? 0}`
  : "Sin apuesta";
const previewScorerLabel = (match) => {
  if (!match.prediction_id || !Number(match.scorer_enabled)) return "Sin apuesta";
  if (Number(match.predicted_team1_goals || 0) + Number(match.predicted_team2_goals || 0) === 0) return "Sin goleador";
  return match.predicted_scorer?.name || "Sin goleador";
};
const goalSideClass = (goal, match) => {
  const code = String(goal?.team_code || "").toUpperCase();
  if (code && code === String(match.team2_team?.fifa_code || "").toUpperCase()) return "away";
  return "home";
};

function LivePredictionPreview({ match, response, onSimulate }) {
  const live = response?.live;
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(false);
  const isPlayableLive = Boolean(live?.score && match.status !== "finished");
  useEffect(() => {
    if (!isPlayableLive) { setPreview(null); setPreviewError(false); return; }
    setPreviewError(false);
    api(`/matches/${match.id}/simulation`, {
      method: "POST",
      body: {
        result_team1: live.score.team1,
        result_team2: live.score.team2,
        scorer_ids: live.scorer_player_ids || [],
      },
    }).then(setPreview).catch(() => { setPreview(null); setPreviewError(true); });
  }, [match.id, isPlayableLive, live?.score?.team1, live?.score?.team2, JSON.stringify(live?.scorer_player_ids || [])]);
  if (!isPlayableLive) return null;
  const points = preview?.points;
  const pointRows = points ? [
    { key: "winner", label: "Ganador", pick: previewWinnerLabel(match), value: points.winner_points },
    { key: "exact", label: "Resultado", pick: previewResultLabel(match), value: points.exact_result_points },
    { key: "scorer", label: "Goleador", pick: previewScorerLabel(match), value: points.scorer_points, disabled: !Number(match.scorer_enabled) },
  ].filter((part) => !part.disabled) : [];
  return <aside className="espn-points-preview live-ticker-points detail-simulation-card">
    <button type="button" className="live-ticker-simulate" onClick={onSimulate} aria-label={`Simular marcador ESPN de ${match.team1} - ${match.team2}`}><Calculator size={16}/></button>
    <small>Si terminara así</small>
    <strong>{points ? `+${points.total_points || 0} pts` : `${live.score?.team1 ?? 0} - ${live.score?.team2 ?? 0}`}</strong>
    <div>{points ? pointRows.map((part) => <span className={Number(part.value) > 0 ? "hit" : ""} key={part.key}>{Number(part.value) > 0 ? <Check size={13}/> : <X size={13}/>}<b>{part.label}</b><small className="live-ticker-pick">Pusiste: {part.pick}</small><em>+{part.value || 0}</em></span>) : <span><Calculator size={13}/><b>{previewError ? "No se pudo calcular la preview." : "Calculando puntos..."}</b></span>}</div>
    <p>{match.team1} {live.score?.team1 ?? 0} - {live.score?.team2 ?? 0} {match.team2} · {liveMoment(live, response)}</p>
    {live.unmatched_scorers?.length > 0 && <p>Goleadores sin vincular: {live.unmatched_scorers.join(", ")}</p>}
  </aside>;
}

function LiveMatchPanel({ match, response, onSimulate }) {
  const live = response?.live;
  const goals = live?.goals || [];
  const sortedGoals = useMemo(() => goals.map((goal, index) => ({ goal, index })).sort((a, b) => goalSortMinute(a.goal) - goalSortMinute(b.goal) || a.index - b.index).map(item => item.goal), [goals]);
  if (match.status === "finished") return null;
  if (!live) return null;
  const isEspnFinal = Boolean(live.completed || response?.espn_completed);
  const isUnconfirmedFinal = isEspnFinal && match.status !== "finished";
  const statusLabel = response.stale ? "Último dato disponible" : liveMoment(live, response);
  return <section className="content-card espn-detail-card">
    <header className="espn-detail-header">
      <span className="espn-detail-header-pill source">Marcador ESPN</span>
      <span className="espn-detail-header-pill headline"><strong>{isEspnFinal ? "Resultado final" : "Marcador en vivo"}</strong>{isUnconfirmedFinal && <em>Pendiente de confirmar</em>}</span>
      <span className="espn-detail-header-pill state">{statusLabel}</span>
    </header>
    <div className="espn-detail-score"><span><Flag team={match.team1} teamData={match.team1_team}/>{match.team1}</span><strong>{live.score?.team1 ?? 0}<i>–</i>{live.score?.team2 ?? 0}</strong><span><Flag team={match.team2} teamData={match.team2_team}/>{match.team2}</span></div>
    <div className="espn-goals-list espn-goals-aligned">{sortedGoals.length ? sortedGoals.map((goal, index) => <span className={`espn-goal-line ${goalSideClass(goal, match)}`} key={goal.id || `${goal.minute}-${goal.espn_name || goal.player_name}-${index}`}>
      <time>{goal.minute || "—"}</time><i>⚽</i><strong>{goal.player_name || goal.espn_name || "Goleador sin identificar"}</strong>
    </span>) : <p>Sin goles por ahora.</p>}</div>
    <LivePredictionPreview match={match} response={response} onSimulate={onSimulate}/>
  </section>;
}

const MedalsSection = ({ badges = [], catalog = [], disputed = [] }) => (
  <section className="content-card medals-card">
    <h2>
      Medallas <small>{badges.length}</small>
    </h2>
    <Badges badges={badges} catalog={catalog} disputed={disputed} />
  </section>
);
const consumePointsReturn = () => {
  const returning = sessionStorage.getItem("returnToPointsDetail") === "1";
  if (returning) sessionStorage.removeItem("returnToPointsDetail");
  return returning;
};

const SWIPE_MIN_DISTANCE = 16;
const SWIPE_VERTICAL_TOLERANCE = 0.75;

const swipeDirection = (start, event) => {
  if (!start) return 0;
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_VERTICAL_TOLERANCE) return 0;
  return deltaX < 0 ? 1 : -1;
};

const SIMULATION_TEAM_SHORT_NAMES = {
  "Arabia Saudí": "Arabia S.",
  "Bosnia y Herzegovina": "Bosnia",
  "Corea del Sur": "Corea Sur",
  "Costa de Marfil": "C. Marfil",
  "Estados Unidos": "EE. UU.",
  "Nueva Zelanda": "N. Zelanda",
  "Países Bajos": "P. Bajos",
  "RD del Congo": "RD Congo",
  "R.D. del Congo": "RD Congo",
  "República Checa": "R. Checa",
};

const simulationTeamLabel = (team = "") => SIMULATION_TEAM_SHORT_NAMES[team] || team;

export function MatchSimulationOverlay({ match, players, user, initialLiveResponse, onClose }) {
  const [matches, setMatches] = useState([match]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchDirection, setMatchDirection] = useState(1);
  const [matchAnimation, setMatchAnimation] = useState(0);
  const [scores, setScores] = useState({ [match.id]: { g1: "0", g2: "0" } });
  const [scorerIdsByMatch, setScorerIdsByMatch] = useState({ [match.id]: [] });
  const [activeByMatch, setActiveByMatch] = useState({ [match.id]: true });
  const [simulationPlayers, setSimulationPlayers] = useState(players);
  const [simulation, setSimulation] = useState(null);
  const [simulationError, setSimulationError] = useState("");
  const [liveByMatch, setLiveByMatch] = useState({});
  const swipeRef = useRef(null);
  const orderedMatches = useMemo(() => [...matches].sort((a, b) =>
    String(b.match_date || "").localeCompare(String(a.match_date || "")) ||
    String(b.match_time || "").localeCompare(String(a.match_time || "")) ||
    Number(b.id) - Number(a.id)
  ), [matches]);
  const currentMatch = orderedMatches[Math.min(currentIndex, Math.max(orderedMatches.length - 1, 0))] || match;
  const scoringCodesFor = (item, score) => [Number(score.g1) > 0 && item.team1_team?.fifa_code, Number(score.g2) > 0 && item.team2_team?.fifa_code].filter(Boolean);
  const updateScore = (matchId, field, value) => setScores(current => ({ ...current, [matchId]: { ...(current[matchId] || { g1: "0", g2: "0" }), [field]: value } }));
  const adjustScore = (matchId, field, delta) => setScores(current => {
    const score = current[matchId] || { g1: "0", g2: "0" };
    return { ...current, [matchId]: { ...score, [field]: String(Math.max(0, Number(score[field] || 0) + delta)) } };
  });
  useEffect(() => {
    api("/dashboard").then(async data => {
      const inPlay = match.live_test_enabled ? [match] : data.in_play_matches?.length ? data.in_play_matches : [match];
      const codes = [...new Set(inPlay.flatMap(item => [item.team1_team?.fifa_code, item.team2_team?.fifa_code]).filter(Boolean))];
      const [allPlayers, ...liveResponses] = await Promise.all([
        codes.length ? api(`/players?team_fifa_codes=${codes.join(",")}`).catch(() => players) : Promise.resolve(players),
        ...inPlay.map(item => String(item.id) === String(match.id) && initialLiveResponse
          ? Promise.resolve(initialLiveResponse)
          : api(`/matches/${item.id}/live`).catch(() => null)),
      ]);
      const nextLiveByMatch = Object.fromEntries(inPlay.map((item, index) => [item.id, liveResponses[index]?.live || null]));
      const nextScores = Object.fromEntries(inPlay.map(item => {
        const live = nextLiveByMatch[item.id];
        return [item.id, live ? {
          g1: String(live.score?.team1 ?? 0),
          g2: String(live.score?.team2 ?? 0),
        } : { g1: "0", g2: "0" }];
      }));
      setMatches(inPlay);
      setSimulationPlayers(allPlayers);
      setLiveByMatch(nextLiveByMatch);
      setScores(nextScores);
      setScorerIdsByMatch(Object.fromEntries(inPlay.map(item => [item.id, nextLiveByMatch[item.id]?.scorer_player_ids || []])));
      setActiveByMatch(current => Object.fromEntries(inPlay.map(item => [item.id, current[item.id] !== undefined ? current[item.id] : true])));
    }).catch(() => setMatches([match]));
  }, [match.id]);
  useEffect(() => {
    if (currentIndex > orderedMatches.length - 1) setCurrentIndex(Math.max(orderedMatches.length - 1, 0));
  }, [orderedMatches.length, currentIndex]);
  useEffect(() => {
    const codes = [...new Set(orderedMatches.flatMap(item => [item.team1_team?.fifa_code, item.team2_team?.fifa_code]).filter(Boolean))];
    if (!codes.length) return;
    api(`/players?team_fifa_codes=${codes.join(",")}`).then(setSimulationPlayers).catch(() => setSimulationPlayers(players));
  }, [orderedMatches.map(item => item.id).join(","), players.length]);
  useEffect(() => {
    setScorerIdsByMatch(current => Object.fromEntries(Object.entries(current).map(([matchId, ids]) => {
      const item = orderedMatches.find(row => String(row.id) === String(matchId));
      const score = scores[matchId] || { g1: "0", g2: "0" };
      const validCodes = item ? scoringCodesFor(item, score) : [];
      return [matchId, ids.filter(id => simulationPlayers.some(player => player.id === id && validCodes.includes(player.team_fifa_code)))];
    })));
  }, [JSON.stringify(scores), simulationPlayers.length, orderedMatches.length]);
  useEffect(() => {
    const activeMatches = orderedMatches.filter(item => activeByMatch[item.id] !== false);
    if (!activeMatches.length) { setSimulation(null); return; }
    if (activeMatches.some(item => {
      const score = scores[item.id] || { g1: "0", g2: "0" };
      return score.g1 === "" || score.g2 === "";
    })) return;
    const timer = setTimeout(() => {
      setSimulationError("");
      api("/matches/simulation", { method: "POST", body: { matches: activeMatches.map(item => {
        const score = scores[item.id] || { g1: "0", g2: "0" };
        return { match_id: item.id, active: true, result_team1: Number(score.g1), result_team2: Number(score.g2), scorer_ids: scorerIdsByMatch[item.id] || [] };
      }) } })
        .then(setSimulation).catch(error => setSimulationError(error.message));
    }, 180);
    return () => clearTimeout(timer);
  }, [orderedMatches.map(item => item.id).join(","), JSON.stringify(scores), JSON.stringify(scorerIdsByMatch), JSON.stringify(activeByMatch)]);
  const mine = simulation?.mine,
    points = simulation?.per_match_points?.find(item => String(item.match_id) === String(currentMatch.id))?.points || { winner_points: 0, exact_result_points: 0, scorer_points: 0, total_points: 0 };
  const addScorer = (matchId, playerId) => playerId && setScorerIdsByMatch(current => ({ ...current, [matchId]: [...(current[matchId] || []), playerId] }));
  const removeScorer = (matchId, playerId) => setScorerIdsByMatch(current => ({ ...current, [matchId]: (current[matchId] || []).filter(id => id !== playerId) }));
  const moveMatch = (direction) => {
    if (orderedMatches.length < 2) return;
    setMatchDirection(direction);
    setMatchAnimation(value => value + 1);
    setCurrentIndex(index => (index + direction + orderedMatches.length) % orderedMatches.length);
  };
  const isSwipeInteractiveTarget = (target) =>
    target.closest("button,input,select,textarea,a,.horizontal-score-value,.scorer-picker-backdrop");
  const beginSwipe = (event) => {
    if (orderedMatches.length < 2) return;
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const endSwipe = (event) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start || start.pointerId !== event.pointerId || orderedMatches.length < 2) return;
    const direction = swipeDirection(start, event);
    if (direction) moveMatch(direction);
  };
  const moveSwipe = (event) => {
    const start = swipeRef.current;
    if (!start || start.pointerId !== event.pointerId || orderedMatches.length < 2) return;
    const direction = swipeDirection(start, event);
    if (!direction) return;
    event.preventDefault();
    swipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    moveMatch(direction);
  };
  const swipeStart = (event) => {
    if (isSwipeInteractiveTarget(event.target)) return;
    beginSwipe(event);
  };
  const cancelSwipe = (event) => {
    swipeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const item = currentMatch,
    itemScore = scores[item.id] || { g1: "0", g2: "0" },
    itemScorerIds = scorerIdsByMatch[item.id] || [],
    itemLive = liveByMatch[item.id],
    itemActive = activeByMatch[item.id] !== false,
    itemAvailableScorers = simulationPlayers.filter(player => scoringCodesFor(item, itemScore).includes(player.team_fifa_code) && !itemScorerIds.includes(player.id)),
    hasMultipleMatches = orderedMatches.length > 1;
  const team1Label = simulationTeamLabel(item.team1),
    team2Label = simulationTeamLabel(item.team2);
  return <div className="movement-overlay simulation-overlay" role="dialog" aria-modal="true" aria-labelledby="simulation-title">
    <section className="movement-card simulation-card">
      <header className="movement-head"><div><span><Calculator size={13}/> SIMULACIÓN PRIVADA</span><h2 id="simulation-title">Cálculo del resultado</h2></div><button onClick={onClose} aria-label="Cerrar cálculo"><X size={21}/></button></header>
      <div className="movement-scroll" onPointerDown={hasMultipleMatches ? swipeStart : undefined} onPointerMove={hasMultipleMatches ? moveSwipe : undefined} onPointerUp={hasMultipleMatches ? endSwipe : undefined} onPointerCancel={hasMultipleMatches ? cancelSwipe : undefined}>
        <p className="simulation-disclaimer">Vista informativa. Nada de lo que introduzcas aquí se guarda.</p>
        <div className="simulation-current-match">
          <strong><span title={item.team1}><Flag team={item.team1} teamData={item.team1_team}/><em>{team1Label}</em></span><b>–</b><span title={item.team2}><Flag team={item.team2} teamData={item.team2_team}/><em>{team2Label}</em></span></strong>
          <small>{localMatchParts(item,user.country_code).date} · {localMatchTime(item,user.country_code)}</small>
          {hasMultipleMatches && <label className="simulation-active-toggle" title={itemActive ? "Partido activo en la simulación" : "Partido fuera de la simulación"}><input type="checkbox" checked={itemActive} onChange={event => setActiveByMatch(current => ({ ...current, [item.id]: event.target.checked }))}/><span>{itemActive ? "Activo" : "Off"}</span></label>}
        </div>
        {itemLive && <div className="simulation-espn-prefill"><span>Precargado desde ESPN. Puedes modificarlo.</span>{itemLive.unmatched_scorers?.length > 0 && <small>Sin vincular: {itemLive.unmatched_scorers.join(", ")}.</small>}</div>}
        <div className="simulation-gesture-area">
          <article className={`${itemActive ? "simulation-match-slide active" : "simulation-match-slide inactive"} ${matchDirection < 0 ? "from-left" : "from-right"}`} key={`${item.id}-${matchAnimation}`}>
              <div className="detail-score-picker horizontal simulation-score-editor">
                <HorizontalScoreControl team={item.team1} value={itemScore.g1} onChange={value => updateScore(item.id, "g1", value)} onAdjust={delta => adjustScore(item.id, "g1", delta)}/>
                <b>–</b>
                <HorizontalScoreControl team={item.team2} value={itemScore.g2} onChange={value => updateScore(item.id, "g2", value)} onAdjust={delta => adjustScore(item.id, "g2", delta)}/>
              </div>
              {Boolean(Number(item.scorer_enabled)) && Number(itemScore.g1) + Number(itemScore.g2) > 0 && <div className="simulation-scorers scorer-pick"><strong>Goleadores que marcarían</strong><ScorerPicker players={itemAvailableScorers} value={null} onChange={playerId => addScorer(item.id, playerId)} buttonLabel="Añadir goleador" matchLabel={`${item.team1} - ${item.team2}`}/><div className="selected-scorers">{itemScorerIds.map(playerId => { const player = simulationPlayers.find(row => row.id === playerId); return player && <button type="button" key={playerId} onClick={() => removeScorer(item.id, playerId)}>{player.name} ×</button>; })}</div></div>}
          </article>
        </div>
        {simulationError && <div className="alert error">{simulationError}</div>}
        {simulation && <>
          <div className="movement-points simulation-points"><div className={Number(points?.total_points) > 0 ? "has-points" : ""}><small>Sumarías</small><strong>+{points?.total_points || 0}</strong><span>puntos</span></div><div className="movement-reasons"><small>¿Qué acertarías?</small>{[["Ganador", points?.winner_points], ["Resultado exacto", points?.exact_result_points], ["Goleador", points?.scorer_points]].map(([label, value]) => <span className={Number(value) > 0 ? "earned" : ""} key={label}>{Number(value) > 0 ? <Check size={13}/> : <X size={13}/>}<b>{label}</b><em>+{value || 0}</em></span>)}</div></div>
          {mine && <div className="movement-ranking-head"><div><small>Tu posición quedaría</small><strong>#{mine.position}</strong></div><span className={mine.movement > 0 ? "up" : mine.movement < 0 ? "down" : "same"}>{mine.movement > 0 ? <ArrowUp/> : mine.movement < 0 ? <ArrowDown/> : <ArrowRight/>}<b>{mine.movement === 0 ? "Sin cambios" : `${Math.abs(mine.movement)} ${Math.abs(mine.movement) === 1 ? "puesto" : "puestos"}`}</b></span></div>}
          <div className="movement-ranking">{simulation.ranking.map(row => <div className={row.id === user.id ? "me" : ""} key={row.id}><b>#{row.position}<i className={row.movement > 0 ? "up" : row.movement < 0 ? "down" : "same"}>{row.movement > 0 ? <ArrowUp/> : row.movement < 0 ? <ArrowDown/> : <span>=</span>}</i></b><span>{row.username}{row.id === user.id && <small>Tú</small>}</span><strong>{row.match_points > 0 && <small className="movement-rank-earned">+{row.match_points}</small>}{row.points} pts</strong></div>)}</div>
        </>}
      </div>
      {hasMultipleMatches && <footer className="movement-pagination simulation-swipe-footer" onPointerDown={beginSwipe} onPointerUp={endSwipe} onPointerCancel={() => { swipeRef.current = null; }}>
        <div aria-hidden="true">{orderedMatches.map((item, index) => <span key={item.id} className={index === currentIndex ? "active" : ""}/>)}</div>
        <span>{currentIndex + 1} / {orderedMatches.length}</span>
      </footer>}
    </section>
  </div>;
}

export function UserSettingsPage() {
  const { user: authUser, setUser } = useAuth();
  const [data, setData] = useState(null),
    [phrase, setPhrase] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [countryCode, setCountryCode] = useState("ES"),
    [saved, setSaved] = useState(false),
    [saveError, setSaveError] = useState(""),
    [passwordForm, setPasswordForm] = useState({ current_password: "", new_password: "", confirm_password: "" }),
    [passwordMessage, setPasswordMessage] = useState({ type: "", text: "" }),
    [avatarMessage, setAvatarMessage] = useState(""),
    [uploading, setUploading] = useState(false),
    [cropFile, setCropFile] = useState(null);
  const load = () =>
    api("/profile/me").then((d) => {
      setData(d);
      setPhrase(d.user.personal_phrase || "");
      setDisplayName(d.user.display_name || d.user.username);
      setCountryCode(d.user.country_code === "GB" ? "GB" : "ES");
    });
  useEffect(() => {
    load();
  }, []);
  if (!data)
    return (
      <div className="page-loader">
        <span />
      </div>
    );
  const save = async () => {
    setSaved(false);
    setSaveError("");
    try {
      const user = await api("/profile/me", {
        method: "PATCH",
        body: { display_name: displayName, personal_phrase: phrase, country_code: countryCode },
      });
      setUser((u) => ({ ...u, ...user }));
      setSaved(true);
      load();
    } catch (error) {
      setSaveError(error.message);
    }
  };
  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordMessage({ type: "", text: "" });
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMessage({ type: "error", text: "Las nuevas contraseñas no coinciden." });
      return;
    }
    try {
      await api("/profile/password", {
        method: "PATCH",
        body: {
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        },
      });
      setPasswordForm({ current_password: "", new_password: "", confirm_password: "" });
      setPasswordMessage({ type: "success", text: "Contraseña cambiada correctamente." });
    } catch (error) {
      setPasswordMessage({ type: "error", text: error.message });
    }
  };
  const changeAvatar = async (event) => {
    const input = event.currentTarget,
      file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const typeByExtension = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };
    const extension = file.name.split(".").pop()?.toLowerCase(),
      contentType = typeByExtension[extension];
    if (
      !contentType ||
      (file.type &&
        !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    ) {
      setAvatarMessage(
        `El archivo "${file.name}" no es válido. Solo se admiten imágenes JPEG, PNG o WebP.`,
      );
      return;
    }
    if (file.size === 0) {
      setAvatarMessage("El archivo seleccionado está vacío.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarMessage(
        `La imagen ocupa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo permitido es 5 MB.`,
      );
      return;
    }
    setAvatarMessage("");
    setCropFile(file);
  };
  const uploadAvatar = async (file) => {
    setUploading(true);
    setAvatarMessage("");
    try {
      const uploadUrl = new URL("/api/profile/avatar", window.location.origin);
      const response = await fetch(uploadUrl.toString(), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      const responseType = response.headers.get("content-type") || "";
      const user = responseType.includes("application/json")
        ? await response.json()
        : null;
      if (!response.ok)
        throw new Error(
          user?.error ||
            `El servidor rechazó la imagen (error ${response.status}).`,
        );
      if (!user?.avatar_url)
        throw new Error("El servidor no devolvió una foto de perfil válida.");
      setUser((current) => ({ ...current, ...user }));
      setData((current) => ({ ...current, user }));
      setCropFile(null);
      setAvatarMessage("Foto de perfil actualizada.");
    } catch (error) {
      console.error("Error al subir la foto de perfil:", error);
      setAvatarMessage(
        error instanceof TypeError || error?.name === "SyntaxError"
          ? "No se pudo enviar la imagen al servidor. Comprueba la conexión y vuelve a intentarlo."
          : error?.message || "No se pudo subir la imagen.",
      );
    } finally {
      setUploading(false);
    }
  };
  const removeAvatar = async () => {
    setUploading(true);
    setAvatarMessage("");
    try {
      const user = await api("/profile/avatar", { method: "DELETE" });
      setUser((current) => ({ ...current, ...user }));
      setData((current) => ({ ...current, user }));
      setAvatarMessage("Foto eliminada.");
    } catch (error) {
      setAvatarMessage(error.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="page">
      <section className="profile-hero">
        <div className="profile-avatar-editor">
          <Avatar user={data.user} className="profile-avatar" />
          {!authUser.is_read_only && (
            <>
              <label className="avatar-upload">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={changeAvatar}
                  disabled={uploading}
                />
                {uploading
                  ? "Procesando..."
                  : data.user.avatar_url
                    ? "Cambiar foto"
                    : "Añadir foto"}
              </label>
              {data.user.avatar_url && (
                <button
                  type="button"
                  onClick={removeAvatar}
                  disabled={uploading}
                >
                  Eliminar
                </button>
              )}
            </>
          )}
        </div>
        <div>
          <span className="eyebrow">MODIFICAR USUARIO</span>
          <h1>Tus datos</h1>
          <p>
            {data.user.display_name || data.user.username} · @{data.user.username}
          </p>
          {!authUser.is_read_only && (
            <small className="avatar-requirements">
              JPEG, PNG o WebP · máximo 5 MB · mínimo 100 × 100 px
            </small>
          )}
          {avatarMessage && (
            <small
              className={
                avatarMessage.includes("actualizada") ||
                avatarMessage.includes("eliminada")
                  ? "success-text"
                  : "error-text"
              }
            >
              {avatarMessage}
            </small>
          )}
        </div>
      </section>
      {!authUser.is_read_only && (
        <section className="content-card">
          <h2>Datos visibles</h2>
          <div className="phrase-editor">
            <label>
              Nombre visible
              <input
                minLength="2"
                maxLength="40"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nombre visible"
              />
            </label>
            <label>
              Frase visible
              <input
                maxLength="120"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="Este año gano yo."
              />
            </label>
            <label>
              País
              <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                <option value="ES">España</option>
                <option value="GB">Inglaterra</option>
              </select>
            </label>
            <button className="primary" onClick={save}>
              <Edit3 size={16} />
              Guardar
            </button>
          </div>
          <small>
            Puedes cambiar el nombre visible hasta 3 veces cada 24 horas. Tu
            usuario de acceso no cambia.
          </small>
          {saved && <small className="success-text">Perfil actualizado.</small>}
          {saveError && <small className="error-text">{saveError}</small>}
        </section>
      )}
      {!authUser.is_read_only && (
        <section className="content-card user-password-card">
          <h2>Cambiar contraseña</h2>
          <form className="password-form user-settings-password-form" onSubmit={changePassword}>
            <label>
              Contraseña actual
              <input
                required
                type="password"
                autoComplete="current-password"
                value={passwordForm.current_password}
                onChange={(event) => setPasswordForm({ ...passwordForm, current_password: event.target.value })}
              />
            </label>
            <label>
              Nueva contraseña
              <input
                required
                minLength={4}
                type="password"
                autoComplete="new-password"
                value={passwordForm.new_password}
                onChange={(event) => setPasswordForm({ ...passwordForm, new_password: event.target.value })}
              />
            </label>
            <label>
              Repetir contraseña
              <input
                required
                minLength={4}
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirm_password}
                onChange={(event) => setPasswordForm({ ...passwordForm, confirm_password: event.target.value })}
              />
            </label>
            {passwordMessage.text && <p className={`password-message ${passwordMessage.type}`}>{passwordMessage.text}</p>}
            <button className="primary" type="submit">
              <KeyRound size={16} />
              Guardar contraseña
            </button>
          </form>
        </section>
      )}
      {cropFile && (
        <AvatarCropper
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onConfirm={uploadAvatar}
        />
      )}
    </div>
  );
}
function formatStatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
  });
}
function byDateAsc(a, b) {
  return new Date(`${a.date}T12:00:00`) - new Date(`${b.date}T12:00:00`);
}
function lastFiveDays(data = []) {
  return [...data].sort(byDateAsc).slice(-5);
}
function StatsTimelineTable({ points = [], history = [], onDayClick }) {
  const pointsByDate = new Map(points.map((day) => [day.date, day]));
  const sortedHistory = [...history].sort(byDateAsc);
  const positionByDate = new Map(sortedHistory.map((day, index) => {
    const position = Number(day.position),
      previous = Number(sortedHistory[index - 1]?.position),
      change = index === 0 ? 0 : previous - position;
    return [day.date, { ...day, position, change, initial: index === 0 }];
  }));
  const rows = lastFiveDays([...new Set([...pointsByDate.keys(), ...positionByDate.keys()])].map((date) => ({ date })))
    .map(({ date }) => ({ date, points: pointsByDate.get(date), position: positionByDate.get(date) }));

  if (!rows.length) return <p className="stat-change-empty">Todavía no hay histórico diario.</p>;

  const changeLabel = (row) => {
    if (!row.position) return "—";
    if (row.position.initial) return "Inicial";
    if (row.position.change > 0) return `+${row.position.change}`;
    if (row.position.change < 0) return String(row.position.change);
    return "=";
  };

  return (
    <div className="stats-timeline-table">
      <div className="stats-timeline-head" role="row">
        <span>Día</span>
        <span>Puntos</span>
        <span>Posición</span>
        <span>Cambio</span>
      </div>
      {rows.map((row) => {
        const dayPoints = row.points ? Number(row.points.points) || 0 : null,
          positionChange = Number(row.position?.change || 0),
          state = positionChange > 0 || dayPoints > 0 ? "positive" : positionChange < 0 || dayPoints < 0 ? "negative" : "neutral";
        return (
          <button
            type="button"
            key={row.date}
            className={`stats-timeline-row ${state}`}
            onClick={onDayClick && row.points ? () => onDayClick(row.date) : undefined}
            disabled={!onDayClick || !row.points}
            aria-label={onDayClick && row.points ? `Ir al primer partido del ${formatStatDate(row.date)}` : undefined}
          >
            <span>{formatStatDate(row.date)}</span>
            <strong>{dayPoints === null ? "—" : `${dayPoints > 0 ? "+" : ""}${dayPoints} pts`}</strong>
            <b>{row.position ? `#${row.position.position}` : "—"}</b>
            <small>{changeLabel(row)}</small>
          </button>
        );
      })}
    </div>
  );
}
function StatsSections({ stats: s, history = [], onDayClick }) {
  const compactRows = [
    [
      ["Ganadores acertados", `${s.winner_percentage}%`],
      ["Resultados exactos", `${s.exact_percentage}%`],
    ],
    [
      ["Goleadores acertados", s.scorer_hits],
      ["% de acierto", `${s.accuracy_percentage || 0}%`],
    ],
    [
      ["Mejor jornada", s.best_day ? `${s.best_day.points} pts` : "—"],
      ["Peor jornada", s.worst_day ? `${s.worst_day.points} pts` : "—"],
    ],
    [
      ["Equipo más elegido", s.most_picked_team],
      ["Equipo más rentable", s.best_team],
    ],
  ];

  return (
    <>
      <div className="insight-grid">
        {[
          ["Ganadores acertados", `${s.winner_percentage}%`],
          ["Resultados exactos", `${s.exact_percentage}%`],
          ["Goleadores acertados", s.scorer_hits],
          ["% de acierto", `${s.accuracy_percentage || 0}%`],
          ["Mejor jornada", s.best_day ? `${s.best_day.points} pts` : "—"],
          ["Peor jornada", s.worst_day ? `${s.worst_day.points} pts` : "—"],
          ["Equipo más elegido", s.most_picked_team],
          ["Equipo más rentable", s.best_team],
        ].map(([k, v]) => (
          <article className="content-card" key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </article>
        ))}
      </div>
      <div className="mobile-insight-lines content-card">
        {compactRows.map((row) => (
          <div className="mobile-insight-row" key={row.map(([label]) => label).join("-")}>
            {row.map(([label, value], index) => (
              <span key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
                {index === 0 && <i aria-hidden="true">|</i>}
              </span>
            ))}
          </div>
        ))}
      </div>
      <section className="content-card stats-timeline-card">
        <h2>Resumen diario</h2>
        <StatsTimelineTable points={s.daily} history={history} onDayClick={onDayClick} />
      </section>
    </>
  );
}
export function ProfilePage() {
  const { user } = useAuth();
  return <PublicProfilePage userId={user.id} />;
}

export function PublicProfilePage({ userId }) {
  const params = useParams(),
    id = userId || params.id,
    navigate = useNavigate(),
    [data, setData] = useState(null),
    [historyPage, setHistoryPage] = useState(1),
    [pointsOpen, setPointsOpen] = useState(consumePointsReturn),
    [openMatchId, setOpenMatchId] = useState(null),
    [avatarOpen, setAvatarOpen] = useState(false),
    [scrollMatchId, setScrollMatchId] = useState(null),
    [medals, setMedals] = useState(null);
  const pageSize = 5;
  useEffect(() => {
    let ignore = false;
    setHistoryPage(1);
    setMedals(null);
    api(`/users/${id}/public`).then((profile) => {
      if (!ignore) setData(profile);
    });
    api(userId ? "/profile/me/medals" : `/users/${id}/public/medals`).then((profileMedals) => {
      if (!ignore) setMedals(profileMedals);
    });
    return () => {
      ignore = true;
    };
  }, [id]);
  const predictions = useMemo(
    () =>
      [...(data?.predictions || [])].sort((a, b) => {
        const dateCompare =
          new Date(`${b.match_date}T${b.match_time || "00:00:00"}`) -
          new Date(`${a.match_date}T${a.match_time || "00:00:00"}`);
        return dateCompare || b.id - a.id;
      }),
    [data?.predictions],
  );
  useEffect(() => {
    if (scrollMatchId === null) return;
    const target = document.getElementById(`prediction-match-${scrollMatchId}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setScrollMatchId(null);
  }, [historyPage, scrollMatchId]);
  if (!data)
    return (
      <div className="page-loader">
        <span />
      </div>
    );
  const s = data.stats,
    totalHistoryPages = Math.max(1, Math.ceil(predictions.length / pageSize)),
    visiblePredictions = predictions.slice(
      (historyPage - 1) * pageSize,
      historyPage * pageSize,
    );
  const matchDetails = new Map(
    (data.points_detail?.matches || []).map((match) => [
      Number(match.id),
      match,
    ]),
  );
  const goToDay = (date) => {
    const matchIndex = predictions.findIndex(
      (prediction) => prediction.match_date === date,
    );
    if (matchIndex < 0) return;
    setOpenMatchId(null);
    setScrollMatchId(predictions[matchIndex].id);
    setHistoryPage(Math.floor(matchIndex / pageSize) + 1);
  };
  return (
    <div className="page">
      {avatarOpen && (
        <AvatarPreview user={data.user} onClose={() => setAvatarOpen(false)} />
      )}{" "}
      {pointsOpen && (
        <PointsDetailOverlay
          detail={data.points_detail}
          username={data.user.display_name || data.user.username}
          onClose={() => setPointsOpen(false)}
        />
      )}
      <button className="back-btn" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} />
        Volver
      </button>
      <section className="profile-hero public">
        {data.user.avatar_url ? (
          <button
            type="button"
            className="profile-avatar-preview-trigger"
            onClick={() => setAvatarOpen(true)}
            aria-label={`Ampliar foto de perfil de ${data.user.display_name || data.user.username}`}
          >
            <Avatar user={data.user} className="profile-avatar" />
          </button>
        ) : (
          <Avatar user={data.user} className="profile-avatar" />
        )}
        <div>
          <span className="eyebrow">FICHA DEPORTIVA</span>
          <h1>{data.user.display_name || data.user.username}</h1>
          <small className="profile-real-username">@{data.user.username}</small>
          <blockquote>
            “{data.user.personal_phrase || "Todavía sin frase personal."}”
          </blockquote>
        </div>
        <b>#{s.position}</b>
      </section>
      <StatCards s={s} onPointsInfo={() => setPointsOpen(true)} />
      <MedalsSection badges={medals?.badges || s.badges} catalog={medals?.badge_catalog || s.badge_catalog} disputed={medals?.disputed_badges || s.disputed_badges} />
      <StatsSections stats={s} history={data.history} onDayClick={goToDay} />
      <section className="content-card">
        <h2>Historial visible</h2>
        <p className="prediction-history-hint">
          Toca un partido para desplegar toda la información de puntuación.
        </p>
        <div className="prediction-history">
          {visiblePredictions.map((p) => {
            const detail = matchDetails.get(Number(p.id));
            return (
              <PredictionHistoryRow
                key={p.id}
                prediction={p}
                detail={detail}
                open={openMatchId === p.id}
                onToggle={() =>
                  detail && setOpenMatchId(openMatchId === p.id ? null : p.id)
                }
              />
            );
          })}
        </div>
        {totalHistoryPages > 1 && (
          <nav
            className="pagination"
            aria-label="Paginación del historial visible"
          >
            <button
              disabled={historyPage === 1}
              onClick={() => {
                setHistoryPage(historyPage - 1);
                setOpenMatchId(null);
              }}
            >
              <ChevronLeft />
              Anterior
            </button>
            <span>
              Página {historyPage} de {totalHistoryPages}
            </span>
            <button
              disabled={historyPage === totalHistoryPages}
              onClick={() => {
                setHistoryPage(historyPage + 1);
                setOpenMatchId(null);
              }}
            >
              Siguiente
              <ChevronRight />
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}
function AvatarPreview({ user, onClose }) {
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const name = user.display_name || user.username;
  return (
    <div
      className="avatar-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Foto de perfil de ${name}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="avatar-preview-dialog">
        <button
          type="button"
          className="avatar-preview-close"
          onClick={onClose}
          aria-label="Cerrar foto ampliada"
        >
          <X />
        </button>
        <img src={user.avatar_url} alt={`Foto de perfil de ${name}`} />
      </div>
    </div>
  );
}
function PredictionHistoryRow({ prediction, detail, open, onToggle }) {
  const { user } = useAuth();
  const match = detail,
    p = prediction;
  if (!match) {
    const unavailableFinished = p.status === "finished";
    return (
      <article id={`prediction-match-${p.id}`} className="prediction-history-card unavailable">
        <div className="prediction-history-summary">
          <time>{p.match_date}</time>
          <strong>
            <Flag team={p.team1} />
            {p.team1}{" "}
            <b>
              {p.predicted_team1_goals}–{p.predicted_team2_goals}
            </b>{" "}
            {p.team2}
            <Flag team={p.team2} />
          </strong>
          <footer>
            <em>
              {Number(p.total_points) > 0 ? "+" : ""}
              {p.total_points} pts
            </em>
            <i className={unavailableFinished ? "finished" : "live"}>
              {unavailableFinished ? "Finalizado" : "En juego"}
            </i>
          </footer>
        </div>
      </article>
    );
  }
  const earnedRules = match.rules.filter((rule) => rule.points > 0),
    missedRules = match.rules.filter((rule) => rule.points === 0);
  const finished = p.status === "finished";
  return (
    <article id={`prediction-match-${p.id}`} className={`prediction-history-card ${open ? "open" : ""}`}>
      <button
        type="button"
        className="prediction-history-summary"
        aria-expanded={open}
        onClick={onToggle}
      >
        <time>
          {new Date(`${localMatchParts(match,user.country_code).date}T12:00:00`).toLocaleDateString(
            "es-ES",
            { weekday: "short", day: "2-digit", month: "short" },
          )}
          {match.match_time ? ` · ${localMatchTime(match,user.country_code)}` : ""}
        </time>
        <strong>
          <span>
            <Flag team={match.team1} />
            {match.team1}
          </span>
          <b>{match.result}</b>
          <span>
            {match.team2}
            <Flag team={match.team2} />
          </span>
        </strong>
        <footer>
          <em>
            {match.total_points > 0 ? "+" : ""}
            {match.total_points} puntos
          </em>
          <i className={finished ? "finished" : "live"}>
            {finished ? "Finalizado" : "En juego"}
          </i>
        </footer>
        <ChevronDown className={open ? "open" : ""} />
      </button>
      {open && (
        <div className="prediction-history-detail">
          <p className="prediction-history-pick">
            Pronóstico <strong>{match.prediction}</strong>
            <span>
              Goleador{" "}
              <strong>{match.predicted_scorer_name || "Sin goleador"}</strong>
            </span>
          </p>
          <div className="points-match-ledger">
            <span>
              Puntos antes<strong>{match.points_before}</strong>
            </span>
            <span>
              Este partido
              <strong>
                {match.total_points > 0 ? "+" : ""}
                {match.total_points}
              </strong>
            </span>
            <span>
              Puntos después<strong>{match.points_after}</strong>
            </span>
          </div>
          <div className="points-rule-grid">
            {earnedRules.map((rule) => (
              <div key={rule.label} className="earned">
                <Check size={15} />
                <strong>{rule.label}</strong>
                <span>
                  {match.multiplier > 1
                    ? `${rule.base_points} x ${match.multiplier} = ${rule.points}`
                    : `${rule.points} pts`}
                </span>
                <small>{rule.text}</small>
              </div>
            ))}
          </div>
          {earnedRules.length === 0 && (
            <p className="empty-state">No sumó puntos en este partido.</p>
          )}
          {match.is_star && (
            <p className="star-explanation">
              <Star size={15} fill="currentColor" /> Partido Estrella: aciertos
              x{match.multiplier}.
            </p>
          )}
          <p className="points-formula">
            Suma: {match.formula} puntos · Total: {match.points_after} puntos.
          </p>
          {missedRules.length > 0 && (
            <div className="missed-rules">
              <strong>Aciertos no conseguidos</strong>
              {missedRules.map((rule) => (
                <span key={rule.label}>
                  <b>{rule.label}</b>
                  {rule.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
function PointsDetailOverlay({ detail, username, onClose }) {
  const { user } = useAuth();
  const savedUi = useMemo(() => {
      try {
        return JSON.parse(sessionStorage.getItem("pointsDetailUi") || "null");
      } catch {
        return null;
      }
    }, []),
    [matchesOpen, setMatchesOpen] = useState(savedUi?.matchesOpen ?? true),
    [openMatchId, setOpenMatchId] = useState(savedUi?.openMatchId ?? null),
    [matchesPage, setMatchesPage] = useState(savedUi?.matchesPage ?? 1);
  useEffect(() => {
    sessionStorage.setItem(
      "pointsDetailUi",
      JSON.stringify({ matchesOpen, openMatchId, matchesPage }),
    );
  }, [matchesOpen, openMatchId, matchesPage]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const matches = detail?.matches || [],
    sortedMatches = [...matches].sort((a, b) => {
      const dateCompare =
        new Date(`${b.match_date}T${b.match_time || "00:00:00"}`) -
        new Date(`${a.match_date}T${a.match_time || "00:00:00"}`);
      return dateCompare || Number(b.id) - Number(a.id);
    }),
    matchesPageSize = 10,
    totalMatchesPages = Math.max(
      1,
      Math.ceil(sortedMatches.length / matchesPageSize),
    ),
    visibleMatches = sortedMatches.slice(
      (matchesPage - 1) * matchesPageSize,
      matchesPage * matchesPageSize,
    );
  const signed = (value) =>
    `${Number(value) > 0 ? "+" : ""}${Number(value) || 0}`;
  return (
    <div
      className="team-detail-overlay points-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de puntos"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="team-detail-panel points-detail-panel">
        <header className="points-detail-header">
          <div>
            <span className="eyebrow">DETALLE DE PUNTOS</span>
            <h1>{username}</h1>
            <p>
              Así se construye el total: puntos automáticos por partidos
              finalizados más ajustes manuales.
            </p>
          </div>
          <button
            className="team-detail-close points-detail-close"
            aria-label="Cerrar detalle de puntos"
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="points-ledger-summary">
          <article>
            <span>Total actual</span>
            <strong>{detail?.total_points || 0}</strong>
          </article>
          <article>
            <span>Puntos en partidos</span>
            <strong>{detail?.automatic_points || 0}</strong>
            <small>
              Ganador {detail?.winner_points || 0} · Exacto{" "}
              {detail?.exact_result_points || 0} · Goleador{" "}
              {detail?.scorer_points || 0}
            </small>
          </article>
          <article>
            <span>Ajustes</span>
            <strong>{signed(detail?.adjustment_points)}</strong>
          </article>
          <article>
            <span>Partidos revisados</span>
            <strong>{detail?.finished_matches || 0}</strong>
            <small>
              {detail?.matches_with_points || 0} con puntos ·{" "}
              {detail?.matches_without_points || 0} sin puntos
            </small>
          </article>
        </div>
        <section className="points-detail-section points-collapsible-section">
          <button
            type="button"
            className="points-section-toggle"
            aria-expanded={matchesOpen}
            onClick={() => setMatchesOpen(!matchesOpen)}
          >
            <span>
              <h2>Todos los partidos</h2>
              <small>
                {sortedMatches.length} partido
                {sortedMatches.length === 1 ? "" : "s"} revisado
                {sortedMatches.length === 1 ? "" : "s"} · del más reciente al
                más antiguo
              </small>
            </span>
            <ChevronDown className={matchesOpen ? "open" : ""} />
          </button>
          {matchesOpen &&
            (sortedMatches.length ? (
              <>
                <div className="points-match-list">
                  {visibleMatches.map((match) => (
                    <PointsMatchRow
                      key={match.id}
                      match={match}
                      open={openMatchId === match.id}
                      onToggle={() =>
                        setOpenMatchId(
                          openMatchId === match.id ? null : match.id,
                        )
                      }
                    />
                  ))}
                </div>
                {totalMatchesPages > 1 && (
                  <nav
                    className="pagination"
                    aria-label="Paginación de todos los partidos revisados"
                  >
                    <button
                      disabled={matchesPage === 1}
                      onClick={() => {
                        setMatchesPage((page) => page - 1);
                        setOpenMatchId(null);
                      }}
                    >
                      <ChevronLeft />
                      Anterior
                    </button>
                    <span>
                      Página {matchesPage} de {totalMatchesPages}
                    </span>
                    <button
                      disabled={matchesPage === totalMatchesPages}
                      onClick={() => {
                        setMatchesPage((page) => page + 1);
                        setOpenMatchId(null);
                      }}
                    >
                      Siguiente
                      <ChevronRight />
                    </button>
                  </nav>
                )}
              </>
            ) : (
              <p className="empty-state">Todavía no hay partidos revisados.</p>
            ))}
        </section>
        {detail?.adjustments?.length > 0 && (
          <section className="points-detail-section">
            <h2>Ajustes manuales</h2>
            <div className="points-adjustments">
              {detail.adjustments.map((adjustment) => (
                <article key={adjustment.id}>
                  <strong>{signed(adjustment.points)} pts</strong>
                  <span>{adjustment.reason}</span>
                  <small>
                    {formatLocalDateTime(adjustment.created_at,user.country_code)}
                    {adjustment.created_by_username
                      ? ` · ${adjustment.created_by_username}`
                      : ""}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}
function PointsMatchRow({ match, open, onToggle }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const earnedRules = match.rules.filter((rule) => rule.points > 0),
    missedRules = match.rules.filter((rule) => rule.points === 0);
  return (
    <article className="points-match-row">
      <button
        type="button"
        className="points-match-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <div className="points-match-summary">
          <header>
            <time>
              {new Date(`${localMatchParts(match,user.country_code).date}T12:00:00`).toLocaleDateString(
                "es-ES",
                {
                  weekday: "short",
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                },
              )}
              {match.match_time ? ` · ${localMatchTime(match,user.country_code)}` : ""}
            </time>
            <i className={match.status === "finished" ? "finished" : "live"}>
              {match.status === "finished" ? "Finalizado" : "En vivo"}
            </i>
          </header>
          <strong>
            <span>
              <Flag team={match.team1} />
              <em>{match.team1}</em>
            </span>
            <b>{match.result}</b>
            <span>
              <em>{match.team2}</em>
              <Flag team={match.team2} />
            </span>
          </strong>
          <footer>
            <small>Pronóstico {match.prediction}</small>
            <em>
              {match.total_points > 0 ? "+" : ""}
              {match.total_points} puntos
            </em>
          </footer>
        </div>
        <ChevronDown className={open ? "open" : ""} />
      </button>
      {open && (
        <div className="points-match-body">
          <div className="points-match-ledger">
            <span>
              Puntos antes<strong>{match.points_before}</strong>
            </span>
            <span>
              Este partido
              <strong>
                {match.total_points > 0 ? "+" : ""}
                {match.total_points}
              </strong>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem("returnToPointsDetail", "1");
                  navigate(`/match/${match.match_id}`);
                }}
                aria-label="Ver detalle del partido"
                title="Ver detalle del partido"
              >
                <Info size={15} />
              </button>
            </span>
            <span>
              Puntos después<strong>{match.points_after}</strong>
            </span>
          </div>
          <div className="points-rule-grid">
            {earnedRules.map((rule) => (
              <div key={rule.label} className="earned">
                <Check size={15} />
                <strong>{rule.label}</strong>
                <span>
                  {match.multiplier > 1
                    ? `${rule.base_points} base x ${match.multiplier} = ${rule.points}`
                    : `${rule.points} pts`}
                </span>
                <small>{rule.text}</small>
              </div>
            ))}
          </div>
          {match.is_star && (
            <p className="star-explanation">
              <Star size={15} fill="currentColor" /> Partido Estrella: todos los
              aciertos de este partido se multiplican x{match.multiplier}.
            </p>
          )}
          <p className="points-formula">
            Suma del partido: {match.formula} puntos · Total después:{" "}
            {match.points_after} puntos.
          </p>
          {missedRules.length > 0 && (
            <div className="missed-rules">
              <strong>Aciertos no conseguidos</strong>
              {missedRules.map((rule) => (
                <span key={rule.label}>
                  <b>{rule.label}</b>
                  {rule.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
function ActivityFeedItem({ item }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false),
    breakdown = item.points_breakdown;
  const finalAddends = breakdown?.rules
    ?.map((rule) => rule.earned_points)
    .join(" + ");
  return (
    <article className={open ? "activity-open" : ""}>
      <ActivityAvatar user={item} type={item.type} />
      <div>
        <span className="activity-summary">
          <strong>{item.text}</strong>
        </span>
        <span className="activity-match-row">
          <span className="activity-match">
            <Flag team={item.team1} />
            {item.team1}
            <b>vs</b>
            <Flag team={item.team2} />
            {item.team2}
          </span>
          {item.type === "points" && (
            <span className="activity-summary-actions">
              <button
                className="activity-info-button"
                aria-label={`${open ? "Ocultar" : "Ver"} desglose de puntos`}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <Info size={16} />
              </button>
              <span
                className={`points-award ${item.exact_result_points > 0 ? "exact" : ""}`}
              >
                {item.is_star ? (
                  <Star size={15} fill="currentColor" />
                ) : (
                  item.exact_result_points > 0 && (
                    <Star size={15} fill="currentColor" />
                  )
                )}
                +{item.total_points} puntos
              </span>
            </span>
          )}
        </span>
        <small>{formatLocalDateTime(item.created_at,user.country_code)}</small>
        {open && breakdown && (
          <div className="activity-breakdown">
            <strong>Desglose de puntos</strong>
            {breakdown.rules.map((rule) => (
              <span key={rule.label}>
                <b>
                  {rule.label}
                  {rule.detail && (
                    <small title={rule.detail}>({rule.detail})</small>
                  )}
                </b>
                <em>
                  {breakdown.multiplier > 1
                    ? `${rule.base_points} de ${rule.description} x ${breakdown.multiplier} = ${rule.earned_points}`
                    : `${rule.base_points} de ${rule.description} = ${rule.earned_points}`}
                </em>
              </span>
            ))}
            <p>
              Suma final:{" "}
              {breakdown.rules.length > 1 ? `${finalAddends} = ` : ""}
              {breakdown.total} puntos
            </p>
          </div>
        )}
      </div>
    </article>
  );
}
function MatchPredictionSummary({ match, user }) {
  const [open, setOpen] = useState(false);
  const total = Number(match.total_points) || 0,
    multiplier = Number(match.scoring_multiplier) || 1;
  const rules = [
    [
      "Ganador",
      "Has acertado el ganador o el empate.",
      Number(match.winner_points) || 0,
    ],
    [
      "Resultado exacto",
      "Has acertado el marcador exacto.",
      Number(match.exact_result_points) || 0,
    ],
    [
      "Goleador",
      match.predicted_scorer?.name
        ? `Has acertado el goleador: ${match.predicted_scorer.name}.`
        : "Has acertado el goleador.",
      Number(match.scorer_points) || 0,
    ],
  ].filter(([, , points]) => points > 0);
  const formula = rules.map(([, , points]) => points).join(" + ");
  if (user.is_read_only)
    return (
      <div className="locked-prediction-summary">
        <strong className="big-score prediction-score-card">
          Sin participación
        </strong>
        <p>
          Puedes ver el partido, participantes, distribución y comentarios sin
          intervenir.
        </p>
      </div>
    );
  return (
    <div className="locked-prediction-summary">
      <strong className="big-score prediction-score-card">
        {match.prediction_id ? (
          <>
            <Flag team={match.team1} teamData={match.team1_team} />
            <span>{match.predicted_team1_goals}</span>
            <i>–</i>
            <span>{match.predicted_team2_goals}</span>
            <Flag team={match.team2} teamData={match.team2_team} />
          </>
        ) : "Sin pronóstico"}
      </strong>
      {match.predicted_scorer && (
        <p className="prediction-scorer-pill">
          Goleador elegido: <b>{match.predicted_scorer.name}</b>
        </p>
      )}
      {match.status === "finished" ? (
        <>
          <button
            type="button"
            className="prediction-points-pill"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Info size={15} />
            {total > 0 ? "+" : ""}
            {total} puntos obtenidos
            <ChevronDown className={open ? "open" : ""} />
          </button>
          {open && (
            <div className="prediction-points-breakdown">
              <strong>Desglose de puntos</strong>
              {rules.length ? (
                rules.map(([label, text]) => (
                  <span key={label}>
                    <b>{label}</b>
                    <small>{text}</small>
                  </span>
                ))
              ) : (
                <p>No has sumado puntos en este partido.</p>
              )}
              {Number(match.is_star) === 1 && (
                <p>
                  <Star size={14} fill="currentColor" /> Partido Estrella: los
                  aciertos se multiplican x{multiplier}.
                </p>
              )}
              {rules.length > 0 && (
                <p>
                  Suma final: {rules.length > 1 ? `${formula} = ` : ""}
                  {total} puntos.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <p>Las apuestas de este partido están cerradas.</p>
      )}
    </div>
  );
}
export function ActivityPage() {
  const [data, setData] = useState({ items: [], page: 1, total_pages: 1 });
  const load = (page) =>
    api(`/activity?page=${page}&page_size=10`).then((response) =>
      setData(
        Array.isArray(response)
          ? { items: response, page: 1, total_pages: 1 }
          : response,
      ),
    );
  useEffect(() => {
    load(1);
  }, []);
  return (
    <div className="page narrow">
      <section className="page-heading">
        <span className="eyebrow">
          <Activity size={14} /> COMUNIDAD
        </span>
        <h1>Actividad reciente</h1>
        <p>Lo último que está pasando en la porra.</p>
      </section>
      <div className="activity-feed">
        {data.items.map((item, i) => (
          <ActivityFeedItem
            key={`${item.type}-${i}-${item.created_at}`}
            item={item}
          />
        ))}
      </div>
      {data.total_pages > 1 && (
        <nav className="pagination" aria-label="Paginación de actividad">
          <button
            disabled={data.page === 1}
            onClick={() => load(data.page - 1)}
          >
            <ChevronLeft />
            Anterior
          </button>
          <span>
            Página {data.page} de {data.total_pages}
          </span>
          <button
            disabled={data.page === data.total_pages}
            onClick={() => load(data.page + 1)}
          >
            Siguiente
            <ChevronRight />
          </button>
        </nav>
      )}
    </div>
  );
}
function HiddenDistribution({ revealAt, onReveal }) {
  const [current, setCurrent] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrent(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (current >= new Date(revealAt).getTime()) onReveal();
  }, [current, revealAt, onReveal]);
  const minutes = Math.max(
    1,
    Math.ceil((new Date(revealAt).getTime() - current) / 60000),
  );
  return (
    <div className="distribution-hidden">
      <div className="pixelated-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <strong>
        Se podrá ver en {minutes} {minutes === 1 ? "minuto" : "minutos"}
      </strong>
      <span>
        La distribución está oculta para no influir en los pronósticos.
      </span>
    </div>
  );
}
const positionNames = {
  POR: "Porteros",
  DEF: "Defensas",
  MED: "Centrocampistas",
  DEL: "Delanteros",
};
const scorerLabel = (scorer) =>
  `${scorer.name}${scorer.minute ? ` ${scorer.minute}'` : ""}`;
const winnerFromScore = (g1, g2) => {
  if (g1 === "" || g2 === "") return "";
  const team1Goals = Number(g1),
    team2Goals = Number(g2);
  if (
    !Number.isFinite(team1Goals) ||
    !Number.isFinite(team2Goals) ||
    team1Goals < 0 ||
    team2Goals < 0
  )
    return "";
  return team1Goals === team2Goals
    ? "draw"
    : team1Goals > team2Goals
      ? "team1"
      : "team2";
};
const knockoutNotice = "Partido de eliminatoria: pronóstico válido hasta 120 minutos. La tanda de penaltis no cuenta para resultado, signo ni goleadores.";
const knockoutDetails = "En las eliminatorias pronosticas el marcador al final de la prórroga, es decir, después de 90 minutos más 30 minutos extra si los hubiera. Si el partido llega a penaltis, la tanda solo decide quién avanza en el Mundial: no cambia el resultado de la porra, no cambia el signo acertado y no suma goleadores. Por ejemplo, un 1-1 tras la prórroga y victoria por penaltis sigue contando como empate 1-1 para puntuación.";
function HorizontalScoreControl({ team, teamData, value, onChange, onAdjust }) {
  const dragRef = useRef(null);
  const score = value === "" ? 0 : Number(value);
  const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;
  const maxScore = 10;
  const dragSensitivity = 1.65;
  const vibrateStep = () => {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function"
    )
      navigator.vibrate(8);
  };
  const commitFromPointer = (event) => {
    if (!dragRef.current) return;
    const { startX, startScore } = dragRef.current;
    const delta = (event.clientX - startX) / (28 * dragSensitivity);
    const nextScore = Math.min(
      maxScore,
      Math.max(0, Math.round(startScore + delta)),
    );
    if (nextScore !== dragRef.current.lastScore) {
      dragRef.current.lastScore = nextScore;
      vibrateStep();
    }
    onChange(String(nextScore));
  };
  const startDrag = (event) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startScore: safeScore,
      lastScore: safeScore,
    };
  };
  const moveDrag = (event) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    if (event.buttons !== 1 && event.pointerType === "mouse") return;
    event.preventDefault();
    commitFromPointer(event);
  };
  const endDrag = (event) => {
    if (!dragRef.current) return;
    event.stopPropagation();
    commitFromPointer(event);
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const keyDrag = (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") {
      event.preventDefault();
      onAdjust(1);
    }
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
      event.preventDefault();
      onAdjust(-1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange("0");
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(String(maxScore));
    }
  };
  return (
    <div className="vertical-score-control">
      <small className="horizontal-score-team"><Flag team={team} teamData={teamData} />{team}</small>
      <div className="horizontal-score-rail">
        <button
          type="button"
          aria-label={`Bajar goles de ${team}`}
          onClick={() => onAdjust(-1)}
        >
          <Minus />
        </button>
        <div
          className="horizontal-score-value"
          role="slider"
          tabIndex="0"
          aria-label={`Arrastrar goles pronosticados de ${team}`}
          aria-valuemin="0"
          aria-valuemax={maxScore}
          aria-valuenow={safeScore}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={(event) => {
            event.stopPropagation();
            dragRef.current = null;
          }}
          onKeyDown={keyDrag}
        >
          <strong>{value === "" ? "0" : value}</strong>
        </div>
        <button
          type="button"
          aria-label={`Subir goles de ${team}`}
          onClick={() => onAdjust(1)}
        >
          <Plus />
        </button>
      </div>
    </div>
  );
}
function MatchScorers({ match, teamName }) {
  const teamScorers = match.scorers?.team || [],
    opponentScorers = match.scorers?.opponent || [];
  if (!teamScorers.length && !opponentScorers.length) return null;
  return (
    <div className="recent-match-scorers">
      <Goal size={14} />
      <span>
        {teamScorers.length ? (
          <>
            <b>{teamName}:</b> {teamScorers.map(scorerLabel).join(", ")}
          </>
        ) : null}
        {teamScorers.length > 0 && opponentScorers.length > 0 ? " · " : ""}
        {opponentScorers.length ? (
          <>
            <b>{match.opponent}:</b>{" "}
            {opponentScorers.map(scorerLabel).join(", ")}
          </>
        ) : null}
      </span>
    </div>
  );
}
export function TeamDetailOverlay({ teamId, onClose }) {
  const [detail, setDetail] = useState(null),
    [error, setError] = useState(""),
    [recentOpen, setRecentOpen] = useState(false),
    [squadOpen, setSquadOpen] = useState(false),
    [openPositions, setOpenPositions] = useState({});
  useEffect(() => {
    setDetail(null);
    setError("");
    api(`/teams/${teamId}/detail`)
      .then(setDetail)
      .catch((err) => setError(err.message));
  }, [teamId]);
  useEffect(() => {
    setRecentOpen(false);
    setSquadOpen(false);
    setOpenPositions({});
  }, [teamId]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const age = (dob) => {
    const born = new Date(`${dob}T12:00:00`),
      today = new Date();
    let years = today.getFullYear() - born.getFullYear();
    if (today < new Date(today.getFullYear(), born.getMonth(), born.getDate()))
      years--;
    return years;
  };
  const recentMatches = (detail?.recent_matches || []).slice(0, 10);
  const topScorers = (detail?.top_scorers || []).slice(0, 3);
  return (
    <div
      className="team-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Información del equipo"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="team-detail-panel">
        {(error || !detail) && (
          <button
            className="team-detail-close"
            aria-label="Cerrar información del equipo"
            onClick={onClose}
          >
            <X />
          </button>
        )}
        {error ? (
          <div className="team-detail-loading">
            <strong>No se pudo cargar el equipo</strong>
            <span>{error}</span>
          </div>
        ) : !detail ? (
          <div className="team-detail-loading">
            <strong>Cargando selección...</strong>
          </div>
        ) : (
          <div className="team-detail-scroll">
            <header className="team-profile-header">
              <div className="team-profile-main">
                <span className="team-profile-flag">
                  <Flag team={detail.team.name} teamData={detail.team} />
                </span>
                <div>
                  <span className="eyebrow">FICHA DE SELECCIÓN</span>
                  <h1>{detail.team.name}</h1>
                  <p>
                    {detail.team.fifa_code} · Grupo{" "}
                    {detail.team.group_name || "—"} · {detail.team.confed}
                  </p>
                </div>
              </div>
              <button
                className="team-detail-close"
                aria-label="Cerrar información del equipo"
                onClick={onClose}
              >
                <X />
              </button>
            </header>
            <div className="team-stat-grid">
              {[
                ["Partidos", detail.stats.played, BarChart3],
                ["Ganados", detail.stats.won, Trophy],
                ["Empatados", detail.stats.drawn, Shield],
                ["Perdidos", detail.stats.lost, X],
                ["Goles a favor", detail.stats.goals_for, Goal],
                ["Goles en contra", detail.stats.goals_against, Goal],
                [
                  "Diferencia",
                  `${detail.stats.goal_difference > 0 ? "+" : ""}${detail.stats.goal_difference}`,
                  Activity,
                ],
                ["Victorias", `${detail.stats.win_percentage}%`, Trophy],
              ].map(([label, value, Icon]) => (
                <article key={label}>
                  <Icon size={18} />
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            {topScorers.length > 0 && (
              <section className="team-top-scorers collapsible-team-section">
                <div className="team-section-title">
                  <div>
                    <span className="eyebrow">MÁXIMOS GOLEADORES</span>
                    <h2>
                      <Goal size={21} /> Top 3 goleadores
                    </h2>
                  </div>
                </div>
                <div className="team-top-scorers-list">
                  {topScorers.map((scorer, index) => (
                    <article key={scorer.name}>
                      <span>{index + 1}</span>
                      <strong>{scorer.name}</strong>
                      <b>
                        {scorer.goals} {Number(scorer.goals) === 1 ? "gol" : "goles"}
                      </b>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {recentMatches.length > 0 && (
              <section className="team-form collapsible-team-section">
                <button
                  type="button"
                  className="team-section-title team-section-toggle"
                  aria-expanded={recentOpen}
                  onClick={() => setRecentOpen(!recentOpen)}
                >
                  <div>
                    <span className="eyebrow">ÚLTIMOS RESULTADOS</span>
                    <h2>Estado de forma</h2>
                  </div>
                  <div>
                    {recentMatches.map((match) => (
                      <b className={match.outcome} key={match.id}>
                        {match.outcome === "W"
                          ? "V"
                          : match.outcome === "D"
                            ? "E"
                            : "D"}
                      </b>
                    ))}
                    <ChevronDown className={recentOpen ? "open" : ""} />
                  </div>
                </button>
                {recentOpen && (
                  <div className="recent-team-matches">
                    {recentMatches.map((match) => (
                      <article key={match.id}>
                        <span>
                          {new Date(
                            `${match.match_date}T12:00:00`,
                          ).toLocaleDateString("es-ES", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        <div>
                          <strong>
                            {detail.team.name} {match.goals_for} –{" "}
                            {match.goals_against} {match.opponent}
                          </strong>
                          <MatchScorers
                            match={match}
                            teamName={detail.team.name}
                          />
                        </div>
                        <b className={match.outcome}>
                          {match.outcome === "W"
                            ? "Victoria"
                            : match.outcome === "D"
                              ? "Empate"
                              : "Derrota"}
                        </b>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            <section className="team-squad collapsible-team-section">
              <button
                type="button"
                className="team-section-title team-section-toggle"
                aria-expanded={squadOpen}
                onClick={() => setSquadOpen(!squadOpen)}
              >
                <div>
                  <span className="eyebrow">CONVOCATORIA</span>
                  <h2>
                    <Users size={21} /> Plantilla por posiciones
                  </h2>
                </div>
                <strong>{detail.players.length} jugadores</strong>
                <ChevronDown className={squadOpen ? "open" : ""} />
              </button>
              {squadOpen && (
                <div className="position-groups">
                  {Object.entries(positionNames).map(([code, label]) => {
                    const group = detail.players.filter(
                        (player) => player.position === code,
                      ),
                      isOpen = Boolean(openPositions[code]);
                    return (
                      group.length > 0 && (
                        <section key={code}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() =>
                              setOpenPositions((current) => ({
                                ...current,
                                [code]: !current[code],
                              }))
                            }
                          >
                            <span>{code}</span>
                            <h3>{label}</h3>
                            <b>{group.length}</b>
                            <ChevronDown className={isOpen ? "open" : ""} />
                          </button>
                          {isOpen && (
                            <div>
                              {group.map((player) => (
                                <article key={player.id}>
                                  <strong>{player.number || "—"}</strong>
                                  <div>
                                    <b>{player.name}</b>
                                    <span>
                                      {player.date_of_birth
                                        ? `${age(player.date_of_birth)} años · ${new Date(`${player.date_of_birth}T12:00:00`).toLocaleDateString("es-ES")}`
                                        : "Edad no disponible"}
                                    </span>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>
                      )
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
const comparisonStats = [
  ["Partidos", "played"],
  ["Ganados", "won"],
  ["Empatados", "drawn"],
  ["Perdidos", "lost", true],
  ["Goles a favor", "goals_for"],
  ["Goles en contra", "goals_against", true],
  ["Diferencia", "goal_difference"],
  ["Victorias", "win_percentage", false, "%"],
];
function TeamComparisonOverlay({ team1Id, team2Id, onClose }) {
  const [teams, setTeams] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    setTeams(null);
    setError("");
    Promise.all([
      api(`/teams/${team1Id}/detail`),
      api(`/teams/${team2Id}/detail`),
    ])
      .then(setTeams)
      .catch((err) => setError(err.message));
  }, [team1Id, team2Id]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const outcomeLabel = (outcome) =>
    outcome === "W" ? "V" : outcome === "D" ? "E" : "D";
  return (
    <div
      className="team-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Comparación de equipos"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="team-detail-panel comparison-panel">
        <button
          className="team-detail-close"
          aria-label="Cerrar comparación"
          onClick={onClose}
        >
          <X />
        </button>
        {error ? (
          <div className="team-detail-loading">
            <strong>No se pudo cargar la comparación</strong>
            <span>{error}</span>
          </div>
        ) : !teams ? (
          <div className="team-detail-loading">
            <strong>Comparando selecciones...</strong>
          </div>
        ) : (
          <div className="team-detail-scroll comparison-scroll">
            <header className="comparison-header">
              <span className="eyebrow">CARA A CARA</span>
              <h1>
                {teams[0].team.name} <b>VS</b> {teams[1].team.name}
              </h1>
              <p>Comparativa de estadísticas y estado de forma</p>
            </header>
            <div className="comparison-teams">
              {teams.map(({ team }) => (
                <div key={team.id}>
                  <Flag team={team.name} teamData={team} />
                  <strong>{team.name}</strong>
                  <small>
                    {team.fifa_code} · {team.confed}
                  </small>
                </div>
              ))}
            </div>
            <div className="comparison-table">
              {comparisonStats.map(
                ([label, key, lowerIsBetter = false, suffix = ""]) => {
                  const values = teams.map((team) => team.stats[key]),
                    best = lowerIsBetter
                      ? Math.min(...values)
                      : Math.max(...values);
                  const format = (value) =>
                    `${key === "goal_difference" && value > 0 ? "+" : ""}${value}${suffix}`;
                  return (
                    <div key={key}>
                      <strong
                        className={
                          values[0] === best && values[0] !== values[1]
                            ? "best"
                            : ""
                        }
                      >
                        {format(values[0])}
                      </strong>
                      <span>{label}</span>
                      <strong
                        className={
                          values[1] === best && values[0] !== values[1]
                            ? "best"
                            : ""
                        }
                      >
                        {format(values[1])}
                      </strong>
                    </div>
                  );
                },
              )}
            </div>
            <section className="comparison-form">
              <div className="team-section-title">
                <div>
                  <span className="eyebrow">ÚLTIMOS RESULTADOS</span>
                  <h2>Estado de forma</h2>
                </div>
              </div>
              <div>
                {teams.map(({ team, recent_matches }) => (
                  <article key={team.id}>
                    <strong>{team.name}</strong>
                    <span>
                      {recent_matches.length ? (
                        recent_matches.map((match) => (
                          <b
                            className={match.outcome}
                            key={match.id}
                            title={`${match.opponent}: ${match.goals_for}-${match.goals_against}`}
                          >
                            {outcomeLabel(match.outcome)}
                          </b>
                        ))
                      ) : (
                        <small>Sin partidos disputados</small>
                      )}
                    </span>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
export function MatchDetailPage() {
  const { id } = useParams(),
    navigate = useNavigate(),
    location = useLocation(),
    { user } = useAuth(),
    [data, setData] = useState(null),
    [comments, setComments] = useState([]),
    [commentsPage, setCommentsPage] = useState(1),
    [text, setText] = useState(""),
    [commentMentions, setCommentMentions] = useState([]),
    [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false),
    [gifPickerOpen, setGifPickerOpen] = useState(false),
    [gifQuery, setGifQuery] = useState(""),
    [gifType, setGifType] = useState("gif"),
    [gifItems, setGifItems] = useState([]),
    [selectedGif, setSelectedGif] = useState(null),
    [selectedImage, setSelectedImage] = useState(null),
    [imageUploading, setImageUploading] = useState(false),
    [imageViewer, setImageViewer] = useState(null),
    [gifLoading, setGifLoading] = useState(false),
    [gifError, setGifError] = useState(""),
    [gifRemaining, setGifRemaining] = useState(null),
    [error, setError] = useState(""),
    [participantsOpen, setParticipantsOpen] = useState(false),
    [selectedTeam, setSelectedTeam] = useState(null),
    [comparing, setComparing] = useState(false),
    [result, setResult] = useState({ g1: "", g2: "" }),
    [resultScorerIds, setResultScorerIds] = useState([]),
    [resultHasPenalties, setResultHasPenalties] = useState(false),
    [resultPenalties, setResultPenalties] = useState({ p1: "", p2: "" }),
    [savingResult, setSavingResult] = useState(false),
    [resultMessage, setResultMessage] = useState(""),
    [pick, setPick] = useState({
      winner: "draw",
      g1: "0",
      g2: "0",
      scorerId: null,
    }),
    [players, setPlayers] = useState([]),
    [savingPick, setSavingPick] = useState(false),
    [pickMessage, setPickMessage] = useState(""),
    [pickSavedPulse, setPickSavedPulse] = useState(0),
    [liveResponse, setLiveResponse] = useState(null),
    [espnPrefilledResult, setEspnPrefilledResult] = useState(false),
    [simulationOpen, setSimulationOpen] = useState(false),
    [knockoutInfoOpen, setKnockoutInfoOpen] = useState(false),
    [starInfoOpen, setStarInfoOpen] = useState(false);
  const hydratedPickMatchId = useRef(null), adminResultTouchedRef = useRef(false), commentFileRef = useRef(null), selectedImageRef = useRef(null);
  useEffect(() => {
    if (!starInfoOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event) => {
      if (event.key === "Escape") setStarInfoOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", close);
    };
  }, [starInfoOpen]);
  useEffect(() => { selectedImageRef.current = selectedImage; }, [selectedImage]);
  const discardCommentImage = async (image = selectedImageRef.current) => {
    if (image?.id) await api(`/comments/image/${encodeURIComponent(image.id)}`, { method: "DELETE" }).catch(() => {});
    if (image === selectedImageRef.current) { selectedImageRef.current = null; setSelectedImage(null); }
  };
  useEffect(() => () => { const image = selectedImageRef.current; if (image?.id) fetch(new URL(`/api/comments/image/${encodeURIComponent(image.id)}`, window.location.origin), { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {}); }, []);
  const uploadCommentImage = async (event) => {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file) return;
    const originalType = inferImageType(file);
    if (!originalType) { input.value = ""; alert("Este formato de imagen no es compatible."); return; }
    setImageUploading(true);
    try {
      let uploadFile = file, contentType = originalType;
      try { uploadFile = await optimizeImageForUpload(file); contentType = "image/jpeg"; } catch { /* El servidor procesa HEIC/HEIF como respaldo para iPhone. */ }
      const response = await sendImage(uploadFile, contentType, "comments"), image = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(image.error || `No se pudo procesar la imagen (HTTP ${response.status}).`);
      await discardCommentImage();
      setSelectedGif(null); selectedImageRef.current = image; setSelectedImage(image);
    } catch (uploadError) { alert(uploadError.message || "No se pudo subir la imagen."); }
    finally { input.value = ""; setImageUploading(false); }
  };
  const load = () => {
    setError("");
    return Promise.all([
      api(`/matches/${id}/detail`),
      api(`/matches/${id}/comments`),
    ])
      .then(([d, c]) => {
        setData(d);
        setComments(c);
      })
      .catch((err) => setError(err.message));
  };
  useEffect(() => {
    load();
    setCommentsPage(1);
  }, [id]);
  useEffect(() => {
    setLiveResponse(null);
    setEspnPrefilledResult(false);
    adminResultTouchedRef.current = false;
    if (!data?.match || (data.match.betting_open && !data.match.live_test_enabled)) return undefined;
    return startVisiblePolling(
      () => api(`/matches/${id}/live`).then(setLiveResponse).catch(() => {}),
      30000,
    );
  }, [id, data?.match?.betting_open, data?.match?.live_test_enabled]);
  useEffect(() => {
    const live = liveResponse?.live, match = data?.match;
    if (!(live?.completed || liveResponse?.espn_completed) || !live?.score || !match || match.status === "finished" || user.role !== "admin") return;
    if (espnPrefilledResult || adminResultTouchedRef.current) return;
    setResult({ g1: String(live.score.team1), g2: String(live.score.team2) });
    setResultScorerIds(live.scorer_player_ids || []);
    setEspnPrefilledResult(true);
  }, [liveResponse?.live?.completed, liveResponse?.espn_completed, liveResponse?.live?.score?.team1, liveResponse?.live?.score?.team2, data?.match?.id, data?.match?.status, user.role, espnPrefilledResult]);
  useEffect(() => {
    const query = text.match(/(?:^|\s)@([^\s@]{2,})$/)?.[1];
    if (!query) { setCommentMentions([]); return; }
    const timer = setTimeout(() => api(`/chat/mentions?q=${encodeURIComponent(query)}`).then(setCommentMentions).catch(() => setCommentMentions([])), 180);
    return () => clearTimeout(timer);
  }, [text]);
  const chooseCommentMention = (item) => {
    setText((value) => value.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@${item.display_name.replace(/\s+/g, "_")} `));
    setCommentMentions([]);
  };
  const commentsPerPage = 8,
    totalCommentsPages = Math.max(
      1,
      Math.ceil(comments.length / commentsPerPage),
    );
  useEffect(() => {
    setCommentsPage((page) => Math.min(page, totalCommentsPages));
  }, [totalCommentsPages]);
  useEffect(() => {
    if (data)
      setResult({
        g1: data.match.result_team1 ?? "",
        g2: data.match.result_team2 ?? "",
      });
    if (data) {
      setResultHasPenalties(data.match.penalty_team1 !== null && data.match.penalty_team2 !== null);
      setResultPenalties({
        p1: data.match.penalty_team1 ?? "",
        p2: data.match.penalty_team2 ?? "",
      });
    }
  }, [data?.match.result_team1, data?.match.result_team2, data?.match.penalty_team1, data?.match.penalty_team2]);
  useEffect(() => {
    if (data)
      setResultScorerIds(
        (data.match.actual_scorers || []).map((player) => player.id),
      );
  }, [data?.match.id, data?.match.actual_scorers]);
  useEffect(() => {
    if (data && hydratedPickMatchId.current !== data.match.id) {
      hydratedPickMatchId.current = data.match.id;
      const g1 = data.match.predicted_team1_goals ?? "0",
        g2 = data.match.predicted_team2_goals ?? "0";
      setPick({
        winner: data.match.predicted_winner || winnerFromScore(g1, g2),
        g1,
        g2,
        scorerId: data.match.predicted_scorer_id || null,
      });
    }
  }, [
    data?.match.id,
    data?.match.predicted_winner,
    data?.match.predicted_team1_goals,
    data?.match.predicted_team2_goals,
    data?.match.predicted_scorer_id,
  ]);
  const scorerEnabled = Boolean(Number(data?.match?.scorer_enabled));
  const loadPickScorers = (onlyIfEmpty = false) => {
    if (onlyIfEmpty && players.length > 0) return Promise.resolve(players);
    const currentMatch = data?.match,
      codes = [
        currentMatch?.team1_team?.fifa_code,
        currentMatch?.team2_team?.fifa_code,
      ].filter(Boolean);
    if (scorerEnabled && codes.length === 2)
      return api(`/players?team_fifa_codes=${codes.join(",")}`)
        .then(setPlayers)
        .catch(() => []);
    return Promise.resolve([]);
  };
  useEffect(() => {
    loadPickScorers();
  }, [data?.match.id, scorerEnabled]);
  const resultScoringTeamCodes = [
    Number(result.g1) > 0 && data?.match.team1_team?.fifa_code,
    Number(result.g2) > 0 && data?.match.team2_team?.fifa_code,
  ].filter(Boolean);
  const pickScoringTeamCodes = [
    Number(pick.g1) > 0 && data?.match.team1_team?.fifa_code,
    Number(pick.g2) > 0 && data?.match.team2_team?.fifa_code,
  ].filter(Boolean);
  const availablePickScorers = players.filter((player) =>
    pickScoringTeamCodes.includes(player.team_fifa_code),
  );
  useEffect(() => {
    if (players.length)
      setResultScorerIds((ids) =>
        ids.filter((id) =>
          players.some(
            (player) =>
              player.id === id &&
              resultScoringTeamCodes.includes(player.team_fifa_code),
          ),
        ),
      );
  }, [result.g1, result.g2, players.length]);
  useEffect(() => {
    if (
      players.length &&
      pick.scorerId &&
      !availablePickScorers.some((player) => player.id === pick.scorerId)
    )
      setPick((value) => ({ ...value, scorerId: null }));
  }, [pick.g1, pick.g2, players.length, pick.scorerId]);
  useEffect(() => {
    if (data && location.hash === "#comentarios")
      requestAnimationFrame(() =>
        document
          .getElementById("comentarios")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  }, [data, location.hash]);
  if (error)
    return (
      <div className="page error-page">
        <section className="content-card">
          <h1>No se pudo abrir el partido</h1>
          <p>{error}</p>
          <button
            className="primary"
            onClick={() => navigate("/partidos", { replace: true })}
          >
            <ArrowLeft size={16} />
            Volver a partidos
          </button>
        </section>
      </div>
    );
  if (!data)
    return (
      <div className="page-loader">
        <span />
      </div>
    );
  const m = data.match,
    total = data.distribution.reduce((a, x) => a + x.count, 0) || 1;
  const add = async () => {
    await api(`/matches/${id}/comments`, {
      method: "POST",
      body: { comment: text, media: selectedImage || selectedGif },
    });
    setText("");
    setSelectedGif(null);
    selectedImageRef.current = null;
    setSelectedImage(null);
    setGifPickerOpen(false);
    load();
  };
  const searchGiphy = async () => {
    if (gifQuery.trim().length < 2) return;
    setGifLoading(true);
    setGifError("");
    try {
      const response = await api(`/giphy/search?q=${encodeURIComponent(gifQuery.trim())}&type=${gifType}`);
      setGifItems(response.items);
      setGifRemaining(response.remaining);
    } catch (searchError) {
      setGifError(searchError.message);
    } finally {
      setGifLoading(false);
    }
  };
  const remove = async (cid) => {
    if (!window.confirm("¿Estás seguro de que deseas borrar el mensaje?")) return;
    await api(`/comments/${cid}`, { method: "DELETE" });
    load();
  };
  const availableResultScorers = players.filter(
    (player) =>
      resultScoringTeamCodes.includes(player.team_fifa_code) &&
      !resultScorerIds.includes(player.id),
  );
  const resultNeedsScorer =
    scorerEnabled && Number(result.g1) + Number(result.g2) > 0;
  const resultScoreIsDraw = result.g1 !== "" && result.g2 !== "" && Number(result.g1) === Number(result.g2);
  const saveResult = async () => {
    setSavingResult(true);
    setResultMessage("");
    try {
      await api(`/matches/${id}/finish`, {
        method: "POST",
        body: {
          result_team1: Number(result.g1),
          result_team2: Number(result.g2),
          scorer_ids: resultNeedsScorer ? resultScorerIds : [],
          has_penalties: resultHasPenalties,
          penalty_team1: resultHasPenalties ? Number(resultPenalties.p1) : null,
          penalty_team2: resultHasPenalties ? Number(resultPenalties.p2) : null,
        },
      });
      setResultMessage(
        "Resultado y goleadores guardados. Puntos recalculados.",
      );
      await load();
    } catch (err) {
      setResultMessage(err.message);
    } finally {
      setSavingResult(false);
    }
  };
  const updateResultScore = (field, value) => {
    adminResultTouchedRef.current = true;
    setResult((current) => {
      const next = { ...current, [field]: value };
      if (next.g1 !== "" && next.g2 !== "" && Number(next.g1) !== Number(next.g2)) {
        setResultHasPenalties(false);
        setResultPenalties({ p1: "", p2: "" });
      }
      return next;
    });
  };
  const updatePickScore = (field, value) =>
    setPick((current) => {
      const next = { ...current, [field]: value };
      const winner = winnerFromScore(next.g1, next.g2);
      return winner ? { ...next, winner } : next;
    });
  const adjustPick = (field, delta) =>
    setPick((current) => {
      const next = {
        ...current,
        [field]: String(Math.max(0, Number(current[field] || 0) + delta)),
      };
      return {
        ...next,
        winner: winnerFromScore(next.g1, next.g2) || next.winner,
      };
    });
  const savePick = async () => {
    setSavingPick(true);
    setPickMessage("");
    try {
      const savedPrediction = await api(
        m.prediction_id ? `/predictions/${m.prediction_id}` : "/predictions",
        {
          method: m.prediction_id ? "PUT" : "POST",
          body: {
            match_id: m.id,
            predicted_winner: pick.winner,
            predicted_team1_goals: Number(pick.g1),
            predicted_team2_goals: Number(pick.g2),
            predicted_scorer_id:
              Number(pick.g1) + Number(pick.g2) === 0 ? null : pick.scorerId,
          },
        },
      );
      const predictedScorer = players.find(
        (player) => String(player.id) === String(savedPrediction.predicted_scorer_id),
      );
      setData((current) =>
        current
          ? {
              ...current,
              match: {
                ...current.match,
                prediction_id: savedPrediction.id,
                predicted_winner: savedPrediction.predicted_winner,
                predicted_team1_goals: savedPrediction.predicted_team1_goals,
                predicted_team2_goals: savedPrediction.predicted_team2_goals,
                predicted_scorer_id: savedPrediction.predicted_scorer_id,
                predicted_scorer: predictedScorer
                  ? {
                      id: predictedScorer.id,
                      name: predictedScorer.name,
                      position: predictedScorer.position,
                      team_fifa_code: predictedScorer.team_fifa_code,
                    }
                  : null,
              },
            }
          : current,
      );
      setPickMessage("Resultado guardado!");
      setPickSavedPulse((value) => value + 1);
      void load();
    } catch (err) {
      setPickMessage(err.message);
    } finally {
      setSavingPick(false);
    }
  };
  const backTarget =
    location.state?.fromDashboardCalendar
      ? "/"
      : "/partidos";
  return (
    <div className="page">
      {selectedTeam && (
        <TeamDetailOverlay
          teamId={selectedTeam}
          onClose={() => setSelectedTeam(null)}
        />
      )}{" "}
      {comparing && (
        <TeamComparisonOverlay
          team1Id={m.team1_team.id}
          team2Id={m.team2_team.id}
          onClose={() => setComparing(false)}
        />
      )}
      {simulationOpen && <MatchSimulationOverlay match={data.match} players={players} user={user} initialLiveResponse={liveResponse} onClose={() => setSimulationOpen(false)}/>}
      {knockoutInfoOpen && <KnockoutInfoDialog onClose={() => setKnockoutInfoOpen(false)}/>}
      {starInfoOpen && (
        <div className="star-info-overlay" role="dialog" aria-modal="true" aria-labelledby="star-info-title" onClick={() => setStarInfoOpen(false)}>
          <div className="star-info-dialog" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="star-info-close" aria-label="Cerrar información de Partido Estrella" onClick={() => setStarInfoOpen(false)}>
              <X size={18} />
            </button>
            <span className="star-info-icon"><Star size={22} fill="currentColor" /></span>
            <h2 id="star-info-title">Partido Estrella x2</h2>
            <p>Los puntos de este partido se multiplican x2.</p>
          </div>
        </div>
      )}
      <button
        className="back-btn"
        onClick={() => navigate(backTarget, {
          replace: true,
          state: location.state?.fromDashboardCalendar ? { restoreDashboardCalendar: true } : undefined,
        })}
      >
        <ArrowLeft size={16} />
        Todos los partidos
      </button>
      <section
        className={`match-detail-hero ${m.is_star ? "star-match-detail" : ""}`}
      >
        <StarMatchTitle match={m} className="match-detail-star-title" onClick={() => setStarInfoOpen(true)} />
        {Number(m.is_knockout) === 1 && (
          <div className="match-detail-knockout-label">
            <strong>Partido de eliminatoria</strong>
            <button
              type="button"
              aria-label="Ver información de eliminatorias"
              title="Información de eliminatorias"
              onClick={() => setKnockoutInfoOpen(true)}
            >
              <Info size={15} />
            </button>
          </div>
        )}
        <div className="match-detail-meta-panels">
          <span><b>Fecha y hora</b><em>{localMatchParts(m,user.country_code).date}</em><em>{localMatchTime(m,user.country_code)}</em></span>
          <span><b>Estadio</b><em>{m.stadium || "Por confirmar"}</em></span>
        </div>
        <div>
          <button
            className="detail-team-button"
            disabled={!m.team1_team?.id}
            onClick={() => setSelectedTeam(m.team1_team?.id)}
            aria-label={`Ver información de ${m.team1}`}
          >
            <h1>
              <Flag team={m.team1} />
              {m.team1}
            </h1>
            <small aria-hidden="true">
              <Info size={15} />
            </small>
          </button>
          <button
            className="detail-versus-button"
            disabled={!m.team1_team?.id || !m.team2_team?.id}
            onClick={() => setComparing(true)}
          >
            <b>
              {m.status === "finished"
                ? `${m.result_team1} – ${m.result_team2}`
                : "VS"}
            </b>
            <small>
              <BarChart3 size={13} /> Comparar
            </small>
          </button>
          <button
            className="detail-team-button"
            disabled={!m.team2_team?.id}
            onClick={() => setSelectedTeam(m.team2_team?.id)}
            aria-label={`Ver información de ${m.team2}`}
          >
            <h1>
              <Flag team={m.team2} />
              {m.team2}
            </h1>
            <small aria-hidden="true">
              <Info size={15} />
            </small>
          </button>
        </div>
        <em>
          {m.status === "finished"
            ? "Finalizado"
            : m.betting_open
              ? "Pronósticos abiertos"
              : "Pronósticos cerrados"}
        </em>
        {m.penalty_summary && (
          <p className="penalty-summary">{m.penalty_summary.text}</p>
        )}
        {m.status === "finished" && m.actual_scorers?.length > 0 && (
          <div className="match-result-scorers">
            <strong>Goleadores</strong>
            <span>
              {m.actual_scorers.map((player) => (
                <b key={player.id}>{player.name}</b>
              ))}
            </span>
          </div>
        )}
        {m.betting_open && (
          <div className="detail-countdown">
            <Countdown date={m.effective_close_at} />
          </div>
        )}
        {user.role === "admin" && (
          <div className="hero-result-editor">
            <strong>
              {m.status === "finished"
                ? "Editar resultado del partido"
                : "Introducir resultado del partido"}
            </strong>
            {espnPrefilledResult && <div className="espn-prefill-note"><strong>Resultado precargado desde ESPN.</strong><span>Revísalo antes de guardar.</span>{liveResponse?.live?.unmatched_scorers?.length > 0 && <small>Goleadores sin vincular: {liveResponse.live.unmatched_scorers.join(", ")}. Añádelos manualmente si corresponde.</small>}</div>}
            <div className="result-inputs">
              <label>
                {m.team1}
                <input
                  aria-label={`Resultado de ${m.team1}`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={result.g1}
                  onChange={(e) => updateResultScore("g1", e.target.value)}
                />
              </label>
              <b>:</b>
              <label>
                {m.team2}
                <input
                  aria-label={`Resultado de ${m.team2}`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={result.g2}
                  onChange={(e) => updateResultScore("g2", e.target.value)}
                />
              </label>
            </div>
            {Number(m.is_knockout) === 1 && resultScoreIsDraw && (
              <div className="knockout-admin-box">
                <p>Selecciona solo goleadores hasta el 120. Los penaltis de la tanda no cuentan.</p>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={resultHasPenalties}
                    onChange={(e) => { adminResultTouchedRef.current = true; setResultHasPenalties(e.target.checked); }}
                  />
                  Tanda de penaltis
                </label>
                {resultHasPenalties && resultScoreIsDraw && (
                  <div className="penalty-inputs">
                    <label>
                      Penaltis {m.team1}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={resultPenalties.p1}
                        onChange={(e) => { adminResultTouchedRef.current = true; setResultPenalties({ ...resultPenalties, p1: e.target.value }); }}
                      />
                    </label>
                    <label>
                      Penaltis {m.team2}
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={resultPenalties.p2}
                        onChange={(e) => { adminResultTouchedRef.current = true; setResultPenalties({ ...resultPenalties, p2: e.target.value }); }}
                      />
                    </label>
                  </div>
                )}
              </div>
            )}
            {resultNeedsScorer && (
              <div className="result-scorers-editor">
                <strong>Goleadores puntuables</strong>
                <ScorerPicker
                  players={availableResultScorers}
                  value={null}
                  onChange={(playerId) => {
                    if (!playerId) return;
                    adminResultTouchedRef.current = true;
                    setResultScorerIds([...resultScorerIds, playerId]);
                  }}
                  onOpen={loadPickScorers}
                  buttonLabel="Añadir goleador"
                  matchLabel={`${m.team1} - ${m.team2}`}
                />
                <div className="selected-scorers">
                  {resultScorerIds.map((playerId) => {
                    const player =
                      players.find((row) => row.id === playerId) ||
                      m.actual_scorers?.find((row) => row.id === playerId);
                    return (
                      player && (
                        <button
                          type="button"
                          key={playerId}
                          onClick={() => {
                            adminResultTouchedRef.current = true;
                            setResultScorerIds(
                              resultScorerIds.filter(
                                (value) => value !== playerId,
                              ),
                            );
                          }}
                        >
                          {player.name} ×
                        </button>
                      )
                    );
                  })}
                </div>
                <small>
                  Selecciona cada jugador una sola vez. Los autogoles no se
                  añaden.
                </small>
              </div>
            )}
            <button
              className="primary"
              disabled={
                savingResult ||
                result.g1 === "" ||
                result.g2 === "" ||
                (resultHasPenalties && (resultPenalties.p1 === "" || resultPenalties.p2 === "" || Number(resultPenalties.p1) === Number(resultPenalties.p2))) ||
                (resultNeedsScorer && resultScorerIds.length === 0)
              }
              onClick={saveResult}
            >
              <Save size={16} />
              {savingResult ? "Guardando..." : "Guardar resultado"}
            </button>
            <small>Al guardar se recalculan automáticamente los puntos.</small>
            {resultMessage && (
              <small
                className={
                  resultMessage.startsWith("Resultado")
                    ? "success-text"
                    : "error-text"
                }
              >
                {resultMessage}
              </small>
            )}
          </div>
        )}
      </section>
      <div className="detail-grid">
        <div className="match-detail-tab-panel">
        <LiveMatchPanel match={m} response={liveResponse} onSimulate={() => setSimulationOpen(true)}/>
        <section
          className={`content-card detail-prediction ${!m.betting_open ? "detail-prediction-locked" : ""}`}
        >
          <div className="detail-prediction-heading">
            <h2>
              {user.is_read_only
                ? "Vista de espectador"
                : `Mi pronóstico${Number(m.is_knockout) === 1 ? " (a 120 mins)" : ""}`}
            </h2>
          </div>
          {m.betting_open && !user.is_read_only ? (
            <>
              <div className="detail-winner-picks">
                <button
                  className={pick.winner === "team1" ? "selected" : ""}
                  onClick={() => setPick({ ...pick, winner: "team1" })}
                >
                  <Flag team={m.team1} />
                  <span>{m.team1}</span>
                  {pick.winner === "team1" && <Check />}
                </button>
                <button
                  className={pick.winner === "draw" ? "selected" : ""}
                  onClick={() => setPick({ ...pick, winner: "draw" })}
                >
                  <b>X</b>
                  <span>Empate</span>
                  {pick.winner === "draw" && <Check />}
                </button>
                <button
                  className={pick.winner === "team2" ? "selected" : ""}
                  onClick={() => setPick({ ...pick, winner: "team2" })}
                >
                  <Flag team={m.team2} />
                  <span>{m.team2}</span>
                  {pick.winner === "team2" && <Check />}
                </button>
              </div>
              <div className="detail-score-picker horizontal">
                <HorizontalScoreControl
                  team={m.team1}
                  teamData={m.team1_team}
                  value={pick.g1}
                  onChange={(value) => updatePickScore("g1", value)}
                  onAdjust={(delta) => adjustPick("g1", delta)}
                />
                <b>:</b>
                <HorizontalScoreControl
                  team={m.team2}
                  teamData={m.team2_team}
                  value={pick.g2}
                  onChange={(value) => updatePickScore("g2", value)}
                  onAdjust={(delta) => adjustPick("g2", delta)}
                />
              </div>
              {scorerEnabled && (
                <div className="scorer-pick">
                  <strong>Goleador del partido</strong>
                  {Number(pick.g1) + Number(pick.g2) === 0 ? (
                    <div className="scorer-selected-banner readonly">
                      <div>
                        <span>Goleador elegido</span>
                        <strong>Sin goleador</strong>
                        <small>Marcador 0-0</small>
                      </div>
                    </div>
                  ) : (
                    <ScorerPicker
                      players={availablePickScorers}
                      value={pick.scorerId}
                      onChange={(scorerId) => setPick({ ...pick, scorerId })}
                      matchLabel={`${m.team1} - ${m.team2}`}
                    />
                  )}
                </div>
              )}
              <button
                className="primary detail-save-pick"
                disabled={
                  savingPick ||
                  !pick.winner ||
                  pick.g1 === "" ||
                  pick.g2 === "" ||
                  (scorerEnabled &&
                    Number(pick.g1) + Number(pick.g2) > 0 &&
                    !pick.scorerId)
                }
                onClick={savePick}
              >
                <Save size={16} />
                {savingPick
                  ? "Guardando..."
                  : m.prediction_id
                    ? "Guardar cambios"
                    : "Guardar pronóstico"}
              </button>
              {pickMessage && (
                <small
                  className={
                    pickMessage.startsWith("Resultado")
                      ? "success-text"
                      : "error-text"
                  }
                >
                  {pickMessage}
                </small>
              )}
              {pickMessage.startsWith("Resultado") && (
                <div className="saved-result-burst detail-saved-result-burst" key={pickSavedPulse} role="status" aria-live="polite">
                  <Check size={22} />
                  <strong>Resultado guardado!</strong>
                </div>
              )}
            </>
          ) : (
            <MatchPredictionSummary match={m} user={user} />
          )}
        </section>
        </div>
        <section className="content-card">
          <h2>Distribución</h2>
          {data.revealed ? (
            ["team1", "draw", "team2"].map((key) => {
              const n =
                data.distribution.find((x) => x.winner === key)?.count || 0;
              return (
                <div className="distribution" key={key}>
                  <span>
                    {key === "team1"
                      ? m.team1
                      : key === "team2"
                        ? m.team2
                        : "Empate"}
                  </span>
                  <i>
                    <b style={{ width: `${(n / total) * 100}%` }} />
                  </i>
                  <strong>{Math.round((n / total) * 100)}%</strong>
                </div>
              );
            })
          ) : (
            <HiddenDistribution
              revealAt={m.effective_close_at}
              onReveal={load}
            />
          )}
        </section>
      </div>
      <section className="content-card participants-card">
        <button
          className="participants-toggle"
          onClick={() => setParticipantsOpen(!participantsOpen)}
        >
          <h2>
            Participantes (
            {data.revealed
              ? data.participants.filter((p) => p.participating).length
              : data.participant_count || 0}
            )
          </h2>
          <span>
            {participantsOpen ? "Ocultar" : "Mostrar"}
            <ChevronDown className={participantsOpen ? "open" : ""} />
          </span>
        </button>
        {participantsOpen && (
          <div
            className={`participants ${data.revealed ? "participant-cards" : ""}`}
          >
            {data.revealed ? (
              data.participants.map((p) => (
                <ReactionBar
                  targetType="prediction"
                  targetId={p.prediction_id}
                  disabled={user.is_read_only || !p.participating}
                  own={p.id === user.id}
                  className={`participant-card ${p.participating ? "" : "participant-card-empty"}`}
                  key={p.id}
                >
                  <header>
                    <Avatar user={p} className="mini-avatar" />
                    <strong>{p.username}</strong>
                    {Boolean(p.participating) && (
                      <span
                        className={`participant-points ${Number(p.total_points) > 0 ? "has-points" : ""}`}
                      >
                        <Trophy size={14} />
                        {Number(p.total_points) > 0 ? "+" : ""}
                        {p.total_points} pts
                      </span>
                    )}
                  </header>
                  {!p.participating ? (
                    <div className="participant-empty-state">
                      <span>Sin participar</span>
                      <small>No registró pronóstico</small>
                    </div>
                  ) : (
                    <div className="participant-card-body">
                      <div className="participant-result">
                        <small>RESULTADO</small>
                        <b>
                          <Flag team={m.team1} teamData={m.team1_team} />
                          {p.predicted_team1_goals}
                          <i>–</i>
                          {p.predicted_team2_goals}
                          <Flag team={m.team2} teamData={m.team2_team} />
                        </b>
                      </div>
                      <div className="participant-scorer">
                        <Goal size={18} />
                        <span>
                          <small>GOLEADOR</small>
                          <strong>
                            {p.predicted_scorer_name || "Sin goleador"}
                          </strong>
                        </span>
                      </div>
                    </div>
                  )}
                </ReactionBar>
              ))
            ) : data.participants?.length ? (
              <>
                <p className="pending-participants-label">
                  Aún sin pronóstico ({data.participants.filter((p) => !p.participating).length})
                </p>
                {data.participants.map((p) => (
                  <div key={p.id}>
                    <strong>{p.username}</strong>
                    {p.participating && p.result_valid !== undefined ? (
                      <span className="participant-admin-checks">
                        <small
                          className={
                            p.result_valid ? "success-text" : "error-text"
                          }
                        >
                          Resultado {p.result_valid ? "válido" : "inválido"}
                        </small>
                        <small
                          className={
                            p.scorer_required
                              ? p.scorer_valid
                                ? "success-text"
                                : "error-text"
                              : "muted-text"
                          }
                        >
                          {p.scorer_required
                            ? `Goleador ${p.scorer_valid ? "válido" : "inválido"}`
                            : "Sin goleador"}
                        </small>
                      </span>
                    ) : (
                      <span
                        className={
                          p.participating
                            ? "success-text"
                            : "not-participating error-text"
                        }
                      >
                        {p.participating
                          ? "Pronóstico registrado"
                          : "Pendiente"}
                      </span>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <p>
                {data.participant_count
                  ? `Todos los usuarios han registrado su pronóstico. Las apuestas se revelarán al cierre.`
                  : "Aún no hay participantes."}
              </p>
            )}
          </div>
        )}
      </section>
      <section id="comentarios" className="content-card comments">
        <h2>
          <MessageCircle size={20} /> Comentarios
        </h2>
        {!user.is_read_only && (
          <div className="comment-composer">
            {selectedGif && (
              <div className="selected-comment-gif">
                <img src={selectedGif.preview_url || selectedGif.url} alt="GIF seleccionado" />
                <button type="button" onClick={() => setSelectedGif(null)} aria-label="Quitar GIF"><X size={15} /></button>
              </div>
            )}
            {selectedImage && (
              <div className="selected-comment-gif selected-comment-image">
                <img src={selectedImage.preview_url || selectedImage.url} alt="Foto seleccionada" />
                <button type="button" onClick={() => discardCommentImage()} aria-label="Quitar foto"><X size={15} /></button>
              </div>
            )}
            <div className="comment-form">
              <div className="comment-attachment-control">
                <button type="button" className={`comment-add-trigger ${attachmentMenuOpen ? "active" : ""}`} onClick={() => setAttachmentMenuOpen((open) => !open)} aria-label="Añadir contenido" aria-expanded={attachmentMenuOpen}>
                  <Plus size={22} />
                </button>
                {attachmentMenuOpen && <div className="comment-attachment-menu">
                  <button type="button" onClick={() => { setAttachmentMenuOpen(false); commentFileRef.current?.click(); }} disabled={imageUploading}>
                    <ImagePlus size={17} /><span>{imageUploading ? "Subiendo…" : "Foto"}</span>
                  </button>
                  <button type="button" onClick={() => { setAttachmentMenuOpen(false); setGifPickerOpen(true); }}>
                    <Film size={17} /><span>GIF / sticker</span>
                  </button>
                </div>}
              </div>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength="500"
                placeholder="Comparte tu lectura del partido…"
              />
              <input ref={commentFileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={uploadCommentImage} />
              <button className="primary comment-send-button" disabled={imageUploading || (!text.trim() && !selectedGif && !selectedImage)} onClick={add} aria-label="Enviar comentario">
                <Send size={16} />
              </button>
            </div>
            {commentMentions.length > 0 && <div className="comment-mentions chat-mentions">{commentMentions.map((item) => <button type="button" key={item.id} onClick={() => chooseCommentMention(item)}><Avatar user={{ ...item, username: item.display_name }} /><span><strong>{item.display_name}</strong><small>@{item.username}</small></span></button>)}</div>}
            {gifPickerOpen && (
              <div className="giphy-picker">
                <div className="giphy-tabs">
                  <button className={gifType === "gif" ? "active" : ""} onClick={() => setGifType("gif")}>GIF</button>
                  <button className={gifType === "sticker" ? "active" : ""} onClick={() => setGifType("sticker")}>Stickers</button>
                  <button type="button" className="giphy-close" onClick={() => setGifPickerOpen(false)} aria-label="Cerrar selector de GIF y stickers"><X size={18} /></button>
                </div>
                <form onSubmit={(event) => { event.preventDefault(); searchGiphy(); }}>
                  <input value={gifQuery} onChange={(event) => setGifQuery(event.target.value)} maxLength="50" placeholder={`Buscar ${gifType === "gif" ? "GIF" : "stickers"}…`} />
                  <button className="primary" disabled={gifLoading || gifQuery.trim().length < 2}>{gifLoading ? "…" : "Buscar"}</button>
                </form>
                {gifError && <p className="giphy-error">{gifError}</p>}
                {gifRemaining !== null && !gifError && <small>{gifRemaining} búsquedas disponibles esta hora</small>}
                <div className="giphy-results">
                  {gifItems.map((item) => (
                    <button key={item.id} type="button" onClick={() => { discardCommentImage(); setSelectedGif(item); setGifPickerOpen(false); }}>
                      <img src={item.preview_url || item.url} alt={item.title || "Resultado de GIPHY"} loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {comments
          .slice(
            (commentsPage - 1) * commentsPerPage,
            commentsPage * commentsPerPage,
          )
          .map((c) => (
          <article key={c.id}>
            <Avatar user={c} className="mini-avatar" />
            <ReactionBar targetType="match_comment" targetId={c.id} disabled={user.is_read_only} own={c.user_id === user.id} className="comment-reaction-target">
              <strong>{c.username}</strong>
              {c.comment && <p>{c.comment.split(/(@[\p{L}\p{N}_.-]+)/gu).map((part, index) => part.startsWith("@") ? <mark key={index}>{part}</mark> : part)}</p>}
              {c.media_url && (c.media_type === "image" ? <button type="button" className="comment-media-button" onClick={() => setImageViewer(c.media_url)} aria-label="Ampliar foto"><img className="comment-media image" src={c.media_preview_url || c.media_url} alt="Foto del comentario" loading="lazy" /></button> : <img className={`comment-media ${c.media_type || "gif"}`} src={c.media_url} alt={c.media_type === "sticker" ? "Sticker" : "GIF"} loading="lazy" />)}
              <small>{formatLocalDateTime(c.created_at,user.country_code)}</small>
            </ReactionBar>
            {!user.is_read_only &&
              (c.user_id === user.id || user.role === "admin") && (
                <button onClick={() => remove(c.id)}>
                  <Trash2 size={15} />
                </button>
              )}
          </article>
          ))}
        {totalCommentsPages > 1 && (
          <nav className="pagination" aria-label="Paginación de comentarios">
            <button
              type="button"
              disabled={commentsPage === 1}
              onClick={() => setCommentsPage((page) => page - 1)}
            >
              <ChevronLeft /> Anterior
            </button>
            <span>
              Página {commentsPage} de {totalCommentsPages}
            </span>
            <button
              type="button"
              disabled={commentsPage === totalCommentsPages}
              onClick={() => setCommentsPage((page) => page + 1)}
            >
              Siguiente <ChevronRight />
            </button>
          </nav>
        )}
        {imageViewer && <div className="chat-image-viewer" role="dialog" aria-modal="true" onClick={() => setImageViewer(null)}><button type="button" aria-label="Cerrar"><X /></button><img src={imageViewer} alt="Foto ampliada" /></div>}
      </section>
    </div>
  );
}
