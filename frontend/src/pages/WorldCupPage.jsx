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

const compactRoundLabel = (round) => {
  const label = roundLabel(round);
  if (label === "Semifinales") return "Semis";
  if (label === "Dieciseisavos") return "Diec...";
  return label;
};
const desktopRoundLabel = (round) => {
  const label = roundLabel(round);
  return label === "Semifinales" ? "Semis" : label;
};

const mobileBracketMetrics = {
  cardWidth: 260,
  cardHeight: 112,
  roundWidth: 282,
  activeGap: 32,
  topPadding: 36,
  sidePadding: 16
};

const explicitNextMatchId = (match) => match.nextMatchId || match.next_match_id || match.nextReferenceId || null;
const feedsInto = (sourceMatch, targetMatch) =>
  explicitNextMatchId(sourceMatch) === targetMatch.reference_id ||
  dependencyRefs(targetMatch).includes(sourceMatch.reference_id);
const getCompressionFactor = (activeRoundIndex) => {
  if (activeRoundIndex <= 1) return 1;
  if (activeRoundIndex === 2) return 0.88;
  if (activeRoundIndex === 3) return 0.8;
  return 0.82;
};

const buildMobileProjectedLayout = (activeRoundIndex, rounds) => {
  const { cardWidth, cardHeight, roundWidth, activeGap, topPadding, sidePadding } = mobileBracketMetrics;
  const visibleRoundIndexes = [activeRoundIndex - 1, activeRoundIndex, activeRoundIndex + 1]
    .filter((index) => index >= 0 && index < rounds.length);
  const visibleRoundSet = new Set(visibleRoundIndexes);
  const localIndexByRound = new Map(visibleRoundIndexes.map((roundIndex, localIndex) => [roundIndex, localIndex]));
  const activeLocalIndex = localIndexByRound.get(activeRoundIndex) ?? 0;
  const positionById = new Map();
  const getItems = (roundIndex) => rounds[roundIndex]?.[1] || [];
  const activeItems = rounds[activeRoundIndex]?.[1] || [];
  const baseGap = 18;
  const baseStep = cardHeight + baseGap;

  const setPosition = (match, roundIndex, matchIndex, centerY) => {
    const localIndex = localIndexByRound.get(roundIndex);
    if (localIndex === undefined) return;
    const left = sidePadding + localIndex * roundWidth;
    const top = centerY - cardHeight / 2;
    positionById.set(match.reference_id, { left, top, centerY, round: match.round, roundIndex, matchIndex });
  };

  const previousRoundIndex = activeRoundIndex - 1;
  if (visibleRoundSet.has(previousRoundIndex)) {
    const previousItems = getItems(previousRoundIndex);
    previousItems.forEach((match, matchIndex) => {
      const centerY = topPadding + matchIndex * baseStep + cardHeight / 2;
      setPosition(match, previousRoundIndex, matchIndex, centerY);
    });

    activeItems.forEach((activeMatch) => {
      const feeders = previousItems.filter((previousMatch) => feedsInto(previousMatch, activeMatch));
      const feederPositions = feeders
        .map((feeder) => positionById.get(feeder.reference_id))
        .filter(Boolean);
      const centerY = feederPositions.length
        ? feederPositions.reduce((sum, position) => sum + position.centerY, 0) / feederPositions.length
        : topPadding + activeItems.indexOf(activeMatch) * baseStep + cardHeight / 2;
      setPosition(activeMatch, activeRoundIndex, activeItems.indexOf(activeMatch), centerY);
    });
  } else {
    activeItems.forEach((match, matchIndex) => {
      const centerY = topPadding + matchIndex * (cardHeight + activeGap) + cardHeight / 2;
      setPosition(match, activeRoundIndex, matchIndex, centerY);
    });
  }

  const nextRoundIndex = activeRoundIndex + 1;
  if (visibleRoundSet.has(nextRoundIndex)) {
    const nextItems = getItems(nextRoundIndex);
    nextItems.forEach((nextMatch, nextMatchIndex) => {
      const feederPositions = activeItems
        .filter((activeMatch) => feedsInto(activeMatch, nextMatch))
        .map((feeder) => positionById.get(feeder.reference_id))
        .filter(Boolean);
      if (!feederPositions.length) return;
      const centerY = feederPositions.reduce((sum, position) => sum + position.centerY, 0) / feederPositions.length;
      setPosition(nextMatch, nextRoundIndex, nextMatchIndex, centerY);
    });
  }

  const allPositions = [...positionById.values()];
  const minTop = allPositions.length ? Math.min(...allPositions.map((position) => position.top)) : topPadding;
  const shiftY = topPadding - minTop;
  positionById.forEach((position) => {
    position.top += shiftY;
    position.centerY += shiftY;
  });

  const activePositions = activeItems
    .map((match) => positionById.get(match.reference_id))
    .filter(Boolean);
  const compression = getCompressionFactor(activeRoundIndex);
  if (activePositions.length && compression < 1) {
    const anchorY = Math.min(...activePositions.map((position) => position.centerY));
    positionById.forEach((position) => {
      position.centerY = anchorY + (position.centerY - anchorY) * compression;
      position.top = position.centerY - cardHeight / 2;
    });
    const compressedPositions = [...positionById.values()];
    const compressedMinTop = compressedPositions.length ? Math.min(...compressedPositions.map((position) => position.top)) : topPadding;
    const compressedShiftY = topPadding - compressedMinTop;
    positionById.forEach((position) => {
      position.top += compressedShiftY;
      position.centerY += compressedShiftY;
    });
  }

  const ensureMinimumGap = (roundIndex) => {
    const items = getItems(roundIndex)
      .map((match) => positionById.get(match.reference_id))
      .filter(Boolean)
      .sort((a, b) => a.centerY - b.centerY);
    const minStep = cardHeight + 14;
    for (let index = 1; index < items.length; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      const diff = current.centerY - previous.centerY;
      if (diff < minStep) {
        const delta = minStep - diff;
        current.centerY += delta;
        current.top = current.centerY - cardHeight / 2;
      }
    }
  };
  visibleRoundIndexes.forEach(ensureMinimumGap);

  const linePaths = [];
  visibleRoundIndexes.forEach((roundIndex) => {
    getItems(roundIndex).forEach((sourceMatch) => {
      const source = positionById.get(sourceMatch.reference_id);
      if (!source) return;
      const targetMatch = getItems(roundIndex + 1).find((candidate) => feedsInto(sourceMatch, candidate));
      const target = targetMatch ? positionById.get(targetMatch.reference_id) : null;
      if (!target || !visibleRoundSet.has(target.roundIndex)) return;
      const startX = source.left + cardWidth;
      const startY = source.centerY;
      const endX = target.left;
      const endY = target.centerY;
      const midX = startX + (endX - startX) / 2;
      linePaths.push(`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`);
    });
  });

  const positions = [...positionById.values()];
  const maxBottom = positions.length ? Math.max(...positions.map((position) => position.top + cardHeight)) : topPadding + cardHeight;
  const width = sidePadding * 2 + visibleRoundIndexes.length * roundWidth - (roundWidth - cardWidth);
  const height = maxBottom + 80;

  if (import.meta.env.DEV) {
    const usedCenters = new Map();
    positionById.forEach((position, id) => {
      const key = Math.round(position.centerY);
      if (usedCenters.has(key)) console.warn("OVERLAP CENTER", key, usedCenters.get(key), id);
      usedCenters.set(key, id);
    });
    console.log("MOBILE LAYOUT", {
      activeRoundIndex,
      visibleRoundIndexes,
      activeLocalIndex,
      activeMatches: activeItems.map((match) => ({
        id: match.reference_id,
        position: positionById.get(match.reference_id)
      })),
      width,
      height
    });
  }

  return {
    positionById,
    linePaths,
    visibleRoundIndexes,
    activeLocalIndex,
    width,
    height
  };
};

const desktopBracketMetrics = {
  cardWidth: 220,
  cardHeight: 88,
  roundWidth: 270,
  baseGap: 20,
  topPadding: 52,
  sidePadding: 20
};

const buildDesktopKnockoutLayout = (rounds) => {
  const { cardWidth, cardHeight, roundWidth, baseGap, topPadding, sidePadding } = desktopBracketMetrics;
  const baseStep = cardHeight + baseGap;
  const positionById = new Map();
  const getItems = (roundIndex) => rounds[roundIndex]?.[1] || [];

  rounds.forEach(([round, items], roundIndex) => {
    const previousItems = getItems(roundIndex - 1);
    items.forEach((match, matchIndex) => {
      const left = sidePadding + roundIndex * roundWidth;
      let centerY = topPadding + matchIndex * baseStep + cardHeight / 2;
      if (roundIndex > 0) {
        const feeders = previousItems
          .filter((previousMatch) => feedsInto(previousMatch, match))
          .map((previousMatch) => positionById.get(previousMatch.reference_id))
          .filter(Boolean);
        if (feeders.length) {
          centerY = feeders.reduce((sum, position) => sum + position.centerY, 0) / feeders.length;
        }
      }
      positionById.set(match.reference_id, {
        left,
        top: centerY - cardHeight / 2,
        centerY,
        round,
        roundIndex,
        matchIndex
      });
    });
  });

  const linePaths = [];
  rounds.forEach(([, items], roundIndex) => {
    const nextItems = getItems(roundIndex + 1);
    items.forEach((sourceMatch) => {
      const source = positionById.get(sourceMatch.reference_id);
      const targetMatch = nextItems.find((candidate) => feedsInto(sourceMatch, candidate));
      const target = targetMatch ? positionById.get(targetMatch.reference_id) : null;
      if (!source || !target) return;
      const startX = source.left + cardWidth;
      const startY = source.centerY;
      const endX = target.left;
      const endY = target.centerY;
      const midX = startX + (endX - startX) / 2;
      linePaths.push(`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`);
    });
  });

  const positions = [...positionById.values()];
  const maxBottom = positions.length ? Math.max(...positions.map((position) => position.top + cardHeight)) : topPadding + cardHeight;
  return {
    positionById,
    linePaths,
    width: sidePadding * 2 + (rounds.length - 1) * roundWidth + cardWidth,
    height: maxBottom + 40
  };
};

function BracketCompactCard({ match }) {
  const scores = match.score?.ft?.length === 2 ? match.score.ft : null;
  const winnerIndex = scores
    ? scores[0] === scores[1] ? null : (scores[0] > scores[1] ? 0 : 1)
    : null;
  const teams = [
    { name: match.team1, code: match.team1_code, score: scores?.[0] ?? "-" },
    { name: match.team2, code: match.team2_code, score: scores?.[1] ?? "-" }
  ];
  const status = scores ? "Final" : `${dateText(match)} ${timeText(match)}`.trim();
  return <article className="bracket-compact-card">
    {teams.map((team, index) => (
      <div className={`team-row ${winnerIndex === index ? "is-winner" : winnerIndex !== null ? "is-loser" : ""}`} key={`${match.reference_id}-${index}`}>
        <div className="team-info">
          <span className="team-flag"><Flag team={team.name} teamData={team.code ? { fifa_code: team.code, name: team.name } : null}/></span>
          <span className="team-name">{team.name}</span>
        </div>
        <strong className="team-score">{team.score}</strong>
      </div>
    ))}
    <div className="match-status">#{match.reference_id} · {status || match.stadium?.city || "Pendiente"}</div>
  </article>;
}

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
    <div className="worldcup-round-content">
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
    </div>
  </section>;
}

function DesktopKnockoutTree({ rounds }) {
  const layout = useMemo(() => buildDesktopKnockoutLayout(rounds), [rounds]);
  return <section className="desktop-bracket-scroll" aria-label="Arbol completo de eliminatorias">
    <div
      className="desktop-bracket-board"
      style={{
        "--desktop-bracket-width": `${layout.width}px`,
        "--desktop-bracket-height": `${layout.height}px`
      }}
    >
      <svg className="desktop-bracket-lines" aria-hidden="true" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
        {layout.linePaths.map((path, index) => <path d={path} key={`${path}-${index}`}/>)}
      </svg>
      {rounds.map(([round], roundIndex) => (
        <div
          className="desktop-bracket-round-label"
          key={round}
          style={{ left: desktopBracketMetrics.sidePadding + roundIndex * desktopBracketMetrics.roundWidth }}
        >
          {desktopRoundLabel(round)}
        </div>
      ))}
      {rounds.flatMap(([round, items]) => items.map((match) => {
        const position = layout.positionById.get(match.reference_id);
        if (!position) return null;
        return <article
          className="desktop-bracket-match"
          data-match-id={match.reference_id}
          data-round={round}
          data-match-index={position.matchIndex}
          key={match.reference_id}
          style={{ left: position.left, top: position.top, width: desktopBracketMetrics.cardWidth }}
        >
          <BracketCompactCard match={match}/>
        </article>;
      }))}
    </div>
  </section>;
}

function KnockoutTreeView({ rounds }) {
  const treeRef = useRef(null);
  const mobileModeRef = useRef(null);
  const mobileScrollDebounceRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const [activeRound, setActiveRound] = useState(rounds[0]?.[0] || "");
  const [isMobileTree, setIsMobileTree] = useState(false);
  const [isPhaseTransitioning, setIsPhaseTransitioning] = useState(false);
  const activeIndex = Math.max(0, rounds.findIndex(([round]) => round === activeRound));
  const activeItems = rounds[activeIndex]?.[1] || [];
  const previousRound = rounds[activeIndex - 1]?.[0] || null;
  const nextRound = rounds[activeIndex + 1]?.[0] || null;
  const mobileLayout = useMemo(() => buildMobileProjectedLayout(activeIndex, rounds), [activeIndex, rounds]);
  const getMobileTargetLeft = () => {
    const container = treeRef.current;
    if (!container) return 0;
    const activeColumnLeft = mobileBracketMetrics.sidePadding + mobileLayout.activeLocalIndex * mobileBracketMetrics.roundWidth;
    const centeredLeft = activeColumnLeft - (container.clientWidth - mobileBracketMetrics.cardWidth) / 2;
    const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    return Math.max(0, Math.min(centeredLeft, maxLeft));
  };
  const jumpToRound = (index) => {
    const bounded = Math.max(0, Math.min(rounds.length - 1, index));
    const round = rounds[bounded]?.[0];
    if (isMobileTree) {
      if (round) setActiveRound(round);
      return;
    }
    const node = treeRef.current?.querySelector(`[data-round-index="${bounded}"]`);
    if (round) setActiveRound(round);
    node?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };
  const handleScroll = () => {
    const container = treeRef.current;
    if (!container) return;
    if (isMobileTree) {
      if (programmaticScrollRef.current) return;
      window.clearTimeout(mobileScrollDebounceRef.current);
      mobileScrollDebounceRef.current = window.setTimeout(() => {
        const localIndex = Math.round(
          (container.scrollLeft + (container.clientWidth - mobileBracketMetrics.cardWidth) / 2 - mobileBracketMetrics.sidePadding) /
          mobileBracketMetrics.roundWidth
        );
        const nextRoundIndex = mobileLayout.visibleRoundIndexes[localIndex];
        if (Number.isFinite(nextRoundIndex) && rounds[nextRoundIndex]?.[0] !== activeRound) {
          setActiveRound(rounds[nextRoundIndex][0]);
        }
      }, 70);
      return;
    }
  };
  useEffect(() => () => window.clearTimeout(mobileScrollDebounceRef.current), []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const syncMobile = () => setIsMobileTree(media.matches);
    syncMobile();
    media.addEventListener("change", syncMobile);
    return () => media.removeEventListener("change", syncMobile);
  }, []);
  useEffect(() => {
    if (!isMobileTree) return;
    setIsPhaseTransitioning(true);
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const left = getMobileTargetLeft();
        programmaticScrollRef.current = true;
        mobileModeRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
        treeRef.current?.scrollTo({ left, top: 0, behavior: "auto" });
        window.setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 110);
        window.setTimeout(() => {
          setIsPhaseTransitioning(false);
        }, 160);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, isMobileTree, mobileLayout.activeLocalIndex, mobileLayout.width, mobileLayout.height]);
  const visibleRounds = isMobileTree
    ? mobileLayout.visibleRoundIndexes.map((roundIndex) => ({
        roundIndex,
        round: rounds[roundIndex]?.[0],
        matches: rounds[roundIndex]?.[1] || []
      }))
    : rounds.map(([round, matches], roundIndex) => ({ roundIndex, round, matches }));
  const toolbar = <div className="worldcup-tree-toolbar">
    <button className="worldcup-phase-side previous" disabled={!previousRound} onClick={() => jumpToRound(activeIndex - 1)}>
      {previousRound ? compactRoundLabel(previousRound) : ""}
    </button>
    <div className="worldcup-phase-current">
      <h2>{roundLabel(activeRound)}</h2>
      <small>{activeItems.length} partidos</small>
    </div>
    <button className="worldcup-phase-side next" disabled={!nextRound} onClick={() => jumpToRound(activeIndex + 1)}>
      {nextRound ? compactRoundLabel(nextRound) : ""}
    </button>
  </div>;
  if (isMobileTree) {
    return <section className={`worldcup-tree-mode mobile-bracket-mode ${isPhaseTransitioning ? "is-phase-transitioning" : ""}`} ref={mobileModeRef}>
      {toolbar}
      <div
        className="mobile-bracket-scroll"
        ref={treeRef}
        onScroll={handleScroll}
      >
        <div
          className="mobile-bracket-board"
          style={{
            "--mobile-bracket-width": `${mobileLayout.width}px`,
            "--mobile-bracket-height": `${mobileLayout.height}px`
          }}
        >
          <svg className="mobile-bracket-lines" aria-hidden="true" width={mobileLayout.width} height={mobileLayout.height} viewBox={`0 0 ${mobileLayout.width} ${mobileLayout.height}`}>
            {mobileLayout.linePaths.map((path, index) => <path d={path} key={`${path}-${index}`}/>)}
          </svg>
          {visibleRounds.map(({ round, roundIndex }, localIndex) => {
            return (
            <section
              className="mobile-bracket-round"
              data-mobile-round-index={roundIndex}
              key={round}
              style={{ left: mobileBracketMetrics.sidePadding + localIndex * mobileBracketMetrics.roundWidth }}
            >
              <span>{compactRoundLabel(round)}</span>
            </section>
          );
          })}
          {visibleRounds.flatMap(({ matches: items }) => items.map((match) => {
            const position = mobileLayout.positionById.get(match.reference_id);
            if (!position) return null;
            const nextRoundItems = rounds[position.roundIndex + 1]?.[1] || [];
            const nextMatch = nextRoundItems.find((candidate) => dependencyRefs(candidate).includes(match.reference_id));
            return <article
              className="mobile-bracket-match"
              data-match-id={match.reference_id}
              data-next-match-id={nextMatch?.reference_id || ""}
              data-round={position.round}
              data-match-index={position.matchIndex}
              key={match.reference_id}
              style={{ left: position.left, top: position.top, width: mobileBracketMetrics.cardWidth }}
            >
              <BracketCompactCard match={match}/>
            </article>;
          }))}
        </div>
      </div>
    </section>;
  }
  return <DesktopKnockoutTree rounds={rounds}/>;
}

function KnockoutView({ matches }) {
  const [viewMode, setViewMode] = useState("tree");
  const rounds = useMemo(() => buildKnockoutRounds(matches), [matches]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.reference_id, match])), [matches]);
  if (!rounds.length) {
    return <div className="worldcup-origin-empty">No hay eliminatorias disponibles.</div>;
  }
  return <div className="worldcup-knockout-view">
    <div className="worldcup-view-switch worldcup-view-switch-wide" aria-label="Ver cuadro como">
      <button className={viewMode === "panels" ? "active" : ""} onClick={() => setViewMode("panels")}>
        Modo panel
      </button>
      <button className={viewMode === "tree" ? "active" : ""} onClick={() => setViewMode("tree")}>
        Modo arbol
      </button>
    </div>
    {viewMode === "tree"
      ? <KnockoutTreeView rounds={rounds}/>
      : <KnockoutPanelsView rounds={rounds} matchById={matchById}/>}
  </div>;
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
      <button className={tab === "knockout" ? "active" : ""} onClick={() => setTab("knockout")}><ListTree size={17}/><span className="desktop-label">Cuadro eliminatorias</span><span className="mobile-label">Eliminatorias</span></button>
    </div>
    {error ? <div className="alert error">{error}</div> : !data ? <div className="page-loader"><span/></div> : tab === "groups"
      ? <GroupsView groups={data.groups || []}/>
      : <KnockoutView matches={data.knockout_matches || []}/>}
  </div>;
}
