import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Grid3X3, ListTree, MapPin, Shield } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Flag } from "../components/SportsUI";
import "../styles/worldcup.css";

const roundLabels = {
  "Round of 32": "Dieciseisavos",
  "Round of 16": "Octavos",
  "Quarter-finals": "Cuartos",
  "Semi-finals": "Semifinales",
  "Third-place match": "Tercer puesto",
  "Final": "Final"
};

const groupLabel = (name) => name?.replace("Group", "Grupo") || "Grupo";
const roundLabel = (round) => roundLabels[round] || round || "Eliminatoria";
const scoreText = (match) => match.score?.ft?.length === 2 ? `${match.score.ft[0]} - ${match.score.ft[1]}` : "VS";
const dateText = (match) => match.match_date ? new Date(`${match.match_date}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "short" }) : match.source_date;
const timeText = (match) => match.match_time || match.source_time || "";
const roundOrder = ["Round of 32", "Round of 16", "Quarter-finals", "Semi-finals", "Final", "Third-place match"];
const winnerRef = (value) => {
  const match = String(value || "").match(/^W(\d+)$/i);
  return match ? Number(match[1]) : null;
};
const dependencyRefs = (match) => [winnerRef(match.team1), winnerRef(match.team2)].filter(Boolean);

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

function KnockoutView({ matches }) {
  const roundsByName = matches.reduce((acc, match) => {
    acc[match.round] = acc[match.round] || [];
    acc[match.round].push(match);
    return acc;
  }, {});
  const rounds = roundOrder
    .filter((round) => roundsByName[round]?.length)
    .map((round) => [round, [...roundsByName[round]].sort((a, b) => a.reference_id - b.reference_id)]);
  return <div className="worldcup-tree">
    {rounds.map(([round, items]) => <section className="worldcup-round" key={round}>
      <header><span>{roundLabel(round)}</span><strong>{items.length} partidos</strong></header>
      <div>
        {items.map((match) => {
          const refs = dependencyRefs(match);
          return <article className={`worldcup-bracket-match ${refs.length ? "has-parents" : ""}`} key={match.reference_id}>
          {refs.length > 0 && <div className="worldcup-parent-refs" aria-label={`Sale de los partidos ${refs.join(" y ")}`}>{refs.map((ref) => <span key={ref}>#{ref}</span>)}</div>}
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
      <button className={tab === "knockout" ? "active" : ""} onClick={() => setTab("knockout")}><ListTree size={17}/>Cuadro eliminatorias</button>
    </div>
    {error ? <div className="alert error">{error}</div> : !data ? <div className="page-loader"><span/></div> : tab === "groups"
      ? <GroupsView groups={data.groups || []}/>
      : <KnockoutView matches={data.knockout_matches || []}/>}
  </div>;
}
