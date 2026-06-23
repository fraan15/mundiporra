import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, GitBranch, Grid3X3, ListTree, MapPin, Shield } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Flag } from "../components/SportsUI";
import "../styles/worldcup.css";

const roundLabels = {
  "Round of 32": "Dieciseisavos",
  "Round of 16": "Octavos",
  "Quarter-final": "Cuartos",
  "Quarter-finals": "Cuartos",
  "Semi-final": "Semifinales",
  "Semi-finals": "Semifinales",
  "Match for third place": "Tercer puesto",
  "Third-place match": "Tercer puesto",
  "Final": "Final"
};

const groupLabel = (name) => name?.replace("Group", "Grupo") || "Grupo";
const roundLabel = (round) => roundLabels[round] || round || "Eliminatoria";
const scoreText = (match) => match.score?.ft?.length === 2 ? `${match.score.ft[0]} - ${match.score.ft[1]}` : "VS";
const dateText = (match) => match.match_date ? new Date(`${match.match_date}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : match.source_date;
const timeText = (match) => match.match_time || match.source_time || "";
const roundOrder = ["Round of 32", "Round of 16", "Quarter-final", "Quarter-finals", "Semi-final", "Semi-finals", "Final"];
const mainBracketRounds = ["Round of 32", "Round of 16", "Quarter-final", "Quarter-finals", "Semi-final", "Semi-finals", "Final"];
const winnerRef = (value) => {
  const match = String(value || "").match(/^W(\d+)$/i);
  return match ? Number(match[1]) : null;
};
const dependencyRefs = (match) => [winnerRef(match.team1), winnerRef(match.team2)].filter(Boolean);
const sortedByReference = (items) => [...items].sort((a, b) => a.reference_id - b.reference_id);
const rankByBracketTree = (matches) => {
  const matchById = new Map(matches.map((match) => [match.reference_id, match]));
  const children = new Set(matches.flatMap(dependencyRefs));
  const roots = sortedByReference(matches)
    .filter((match) => mainBracketRounds.includes(match.round) && !children.has(match.reference_id))
    .sort((a, b) => (a.round === "Final" ? -1 : 0) - (b.round === "Final" ? -1 : 0) || a.reference_id - b.reference_id);
  const ranks = new Map();
  let rank = 0;
  const visit = (match) => {
    if (!match || ranks.has(match.reference_id)) return;
    ranks.set(match.reference_id, rank++);
    dependencyRefs(match).forEach((ref) => visit(matchById.get(ref)));
  };
  roots.forEach(visit);
  sortedByReference(matches).forEach(visit);
  return ranks;
};
const roundMeta = (round, count) => `${roundLabel(round)} - ${count} partidos`;
const teamLabel = (match, side) => {
  const name = side === 1 ? match.team1 : match.team2;
  const code = side === 1 ? match.team1_code : match.team2_code;
  return { name, code };
};

function SourceMatch({ match }) {
  if (!match) return null;
  return <article className="worldcup-source-match">
    <div className="worldcup-source-head">
      <span>#{match.reference_id}</span>
      <small>{roundLabel(match.round)}</small>
    </div>
    <div className="worldcup-source-teams">
      {[teamLabel(match, 1), teamLabel(match, 2)].map((team, index) => (
        <span key={`${match.reference_id}-${index}`}>
          <Flag team={team.name} teamData={team.code ? { fifa_code: team.code, name: team.name } : null}/>
          <strong>{team.name}</strong>
        </span>
      ))}
    </div>
  </article>;
}

function MatchOrigins({ match, matchById }) {
  const refs = dependencyRefs(match);
  if (!refs.length) return <div className="worldcup-origin-empty">Cruce definido desde la fase de grupos.</div>;
  return <div className="worldcup-origin-panel">
    <div className="worldcup-origin-title"><GitBranch size={15}/><span>Posibles equipos de la ronda anterior</span></div>
    <div className="worldcup-origin-grid">
      {refs.map((ref) => <SourceMatch key={ref} match={matchById.get(ref)}/>)}
    </div>
  </div>;
}

const buildKnockoutRounds = (matches) => {
  const bracketRank = rankByBracketTree(matches);
  const roundsByName = matches.reduce((acc, match) => {
    acc[match.round] = acc[match.round] || [];
    acc[match.round].push(match);
    return acc;
  }, {});
  return roundOrder
    .filter((round) => roundsByName[round]?.length)
    .map((round) => {
      const items = [...roundsByName[round]].sort((a, b) =>
        (bracketRank.get(a.reference_id) ?? a.reference_id + 1000) -
        (bracketRank.get(b.reference_id) ?? b.reference_id + 1000) ||
        a.reference_id - b.reference_id
      );
      return [round, items];
    });
};

function useInitialTab() {
  const location = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("tab") === "knockout" ? "knockout" : "groups";
  }, [location.search]);
}

function GroupsView({ groups }) {
  return <div className="worldcup-groups-grid">
    {groups.map((group) => (
      <section className="worldcup-group-card" key={group.name}>
        <header>
          <div><span>{groupLabel(group.name)}</span></div>
        </header>
        <div className="worldcup-table">
          <div className="worldcup-table-head"><span>Equipo</span><span>PJ</span><span>DG</span><span>PTS</span></div>
          {group.standings.map((team, index) => <div className={index === 0 ? "leader" : ""} key={team.fifa_code || team.name}>
            <span className="worldcup-team-cell"><b>{index + 1}</b><Flag team={team.name} teamData={team}/><strong>{team.name}</strong></span>
            <span>{team.played}</span>
            <span className={team.goal_difference > 0 ? "positive" : team.goal_difference < 0 ? "negative" : ""}>{team.goal_difference > 0 ? `+${team.goal_difference}` : team.goal_difference}</span>
            <span><b>{team.points}</b></span>
          </div>)}
        </div>
      </section>
    ))}
  </div>;
}

function KnockoutPanelsView({ rounds, matchById }) {
  const [activeRound, setActiveRound] = useState("");
  const [previewMatchId, setPreviewMatchId] = useState(null);
  const selectedRound = activeRound && rounds.some(([round]) => round === activeRound) ? activeRound : rounds[0]?.[0];
  const selectedItems = rounds.find(([round]) => round === selectedRound)?.[1] || [];
  useEffect(() => {
    setPreviewMatchId(null);
  }, [selectedRound]);
  return <section className="worldcup-knockout-board">
    <nav className="worldcup-round-menu" aria-label="Rondas eliminatorias">
      {rounds.map(([round, items]) => (
        <button className={round === selectedRound ? "active" : ""} key={round} onClick={() => setActiveRound(round)}>
          <span>{roundLabel(round)}</span>
          <small>{items.length}</small>
        </button>
      ))}
    </nav>
    <header className="worldcup-round-summary">
      <div>
        <span className="eyebrow"><ListTree size={14}/> {roundMeta(selectedRound, selectedItems.length)}</span>
        <h2>{roundLabel(selectedRound)}</h2>
      </div>
      <p>Abre el origen de un partido para ver qué cruces de la ronda anterior alimentan ese hueco del cuadro.</p>
    </header>
    <div className="worldcup-round-list">
      {selectedItems.map((match) => {
        const refs = dependencyRefs(match);
        const previewOpen = previewMatchId === match.reference_id;
        return <article className={`worldcup-round-match ${previewOpen ? "preview-open" : ""}`} key={match.reference_id}>
          <div className="worldcup-match-card-main">
            <div className="worldcup-match-meta"><span>#{match.reference_id}</span><time>{dateText(match)} {timeText(match)}</time></div>
            <div className="worldcup-bracket-teams">
              <span><Flag team={match.team1}/><strong>{match.team1}</strong></span>
              <b>{scoreText(match)}</b>
              <span><Flag team={match.team2}/><strong>{match.team2}</strong></span>
            </div>
            <small><MapPin size={12}/>{match.stadium?.city || match.stadium?.name || "Sede pendiente"}</small>
          </div>
          <button
            className="worldcup-origin-toggle"
            onClick={() => setPreviewMatchId(previewOpen ? null : match.reference_id)}
            aria-expanded={previewOpen}
          >
            <GitBranch size={16}/>
            {refs.length ? "Ver origen" : "Desde grupos"}
          </button>
          {previewOpen && <MatchOrigins match={match} matchById={matchById}/>}
        </article>;
      })}
    </div>
  </section>;
}

function KnockoutTreeView({ rounds }) {
  const treeRef = useRef(null);
  const wheelLockRef = useRef(false);
  const [activeRound, setActiveRound] = useState(rounds[0]?.[0] || "");
  const activeIndex = Math.max(0, rounds.findIndex(([round]) => round === activeRound));
  const previousRound = rounds[activeIndex - 1]?.[0] || null;
  const nextRound = rounds[activeIndex + 1]?.[0] || null;
  const jumpToRound = (index) => {
    const bounded = Math.max(0, Math.min(rounds.length - 1, index));
    const round = rounds[bounded]?.[0];
    const node = treeRef.current?.querySelector(`[data-round-index="${bounded}"]`);
    if (round) setActiveRound(round);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };
  const handleWheel = (event) => {
    if (Math.abs(event.deltaX) < 8 && Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    if (wheelLockRef.current) return;
    wheelLockRef.current = true;
    jumpToRound(activeIndex + (event.deltaX + event.deltaY > 0 ? 1 : -1));
    window.setTimeout(() => {
      wheelLockRef.current = false;
    }, 420);
  };
  const handleScroll = () => {
    const container = treeRef.current;
    if (!container) return;
    const sections = [...container.querySelectorAll("[data-round-index]")];
    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    const current = sections.reduce((closest, section) => {
      const sectionCenter = section.offsetLeft + section.clientWidth / 2;
      const distance = Math.abs(sectionCenter - containerCenter);
      return !closest || distance < closest.distance ? { section, distance } : closest;
    }, null);
    const index = Number(current?.section?.dataset.roundIndex);
    if (Number.isFinite(index) && rounds[index]?.[0] !== activeRound) setActiveRound(rounds[index][0]);
  };
  return <section className="worldcup-tree-mode">
    <div className="worldcup-tree-toolbar">
      <button className="worldcup-phase-side previous" disabled={!previousRound} onClick={() => jumpToRound(activeIndex - 1)}>
        {previousRound ? roundLabel(previousRound) : ""}
      </button>
      <div className="worldcup-phase-current">
        <span><ListTree size={14}/> Vista en arbol</span>
        <h2>{roundLabel(activeRound)}</h2>
      </div>
      <button className="worldcup-phase-side next" disabled={!nextRound} onClick={() => jumpToRound(activeIndex + 1)}>
        {nextRound ? roundLabel(nextRound) : ""}
      </button>
    </div>
    <div className="worldcup-tree compact" ref={treeRef} onScroll={handleScroll} onWheel={handleWheel}>
      {rounds.map(([round, items], roundIndex) => <section className={`worldcup-round ${round === activeRound ? "is-active" : ""}`} data-round-index={roundIndex} key={round}>
        <header><span>{roundLabel(round)}</span><strong>{items.length} partidos</strong></header>
        <div className="worldcup-round-stack" style={{ "--match-count": items.length }}>
          {items.map((match, matchIndex) => {
            const refs = dependencyRefs(match);
            const pairSide = matchIndex % 2 === 0 ? "pair-top" : "pair-bottom";
            const hasNextRound = roundIndex < rounds.length - 1;
            return <article className={`worldcup-bracket-match ${refs.length ? "has-parents" : ""} ${hasNextRound ? "has-next" : ""} ${pairSide}`} style={{ "--match-index": matchIndex }} key={match.reference_id}>
              <div className="worldcup-match-meta"><span>#{match.reference_id}</span><time>{dateText(match)} {timeText(match)}</time></div>
              <div className="worldcup-bracket-teams">
                <span><Flag team={match.team1}/><strong>{match.team1}</strong></span>
                <b>{scoreText(match)}</b>
                <span><Flag team={match.team2}/><strong>{match.team2}</strong></span>
              </div>
              <small><MapPin size={12}/>{match.stadium?.city || match.stadium?.name || "Sede pendiente"}</small>
            </article>;
          })}
        </div>
      </section>)}
    </div>
  </section>;
}

function KnockoutView({ matches }) {
  const [viewMode, setViewMode] = useState("panels");
  const rounds = useMemo(() => buildKnockoutRounds(matches), [matches]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.reference_id, match])), [matches]);
  return <>
    <div className="worldcup-view-switch" aria-label="Ver cuadro como">
      <span>Ver</span>
      <button className={viewMode === "tree" ? "active" : ""} onClick={() => setViewMode("tree")} aria-label="Vista en arbol">
        <ListTree size={18}/>
      </button>
      <button className={viewMode === "panels" ? "active" : ""} onClick={() => setViewMode("panels")} aria-label="Vista en paneles">
        <Grid3X3 size={18}/>
      </button>
    </div>
    {viewMode === "tree"
      ? <KnockoutTreeView rounds={rounds}/>
      : <KnockoutPanelsView rounds={rounds} matchById={matchById}/>}
  </>;
}

export function WorldCupPage() {
  const initialTab = useInitialTab();
  const navigate = useNavigate();
  const [tab, setTab] = useState(initialTab);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    let active = true;
    api("/worldcup/overview").then((payload) => {
      if (!active) return;
      setData(payload);
      setError("");
    }).catch((err) => {
      if (!active) return;
      setError(err.message);
    });
    return () => { active = false; };
  }, []);
  const syncedAt = data?.synced_at ? new Date(data.synced_at).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Pendiente";
  return <div className="page worldcup-page">
    <section className="worldcup-hero">
      <button className="back-btn" onClick={() => navigate("/")}><ChevronRight className="worldcup-back-icon" size={17}/> Volver al inicio</button>
      <div>
        <span className="eyebrow"><Shield size={14}/> MUNDIAL 2026</span>
        <h1>Grupos y eliminatorias</h1>
        <p>Consulta la situacion del torneo con datos sincronizados desde el calendario oficial que usa la porra.</p>
      </div>
      <aside><span>Fecha actualizacion</span><strong>{syncedAt}</strong></aside>
    </section>
    <div className="worldcup-tabs" role="tablist" aria-label="Vista del Mundial">
      <button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}><Grid3X3 size={17}/>Grupos</button>
      <button className={tab === "knockout" ? "active" : ""} onClick={() => setTab("knockout")}><ListTree size={17}/>Cuadro eliminatorias</button>
    </div>
    {error ? <div className="alert error">{error}</div> : !data ? <div className="page-loader"><span/></div> : tab === "groups"
      ? <GroupsView groups={data.groups || []}/>
      : <KnockoutView matches={data.knockout_matches || []}/>}
  </div>;
}
