import { useEffect, useState } from "react";
import { Target, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Avatar } from "../components/Avatar";

export function LeaderboardPage() {
  const [rows, setRows] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api("/leaderboard").then(setRows);
  }, []);

  return <div className="page">
    <section className="page-heading">
      <span className="eyebrow"><Trophy size={14} /> CLASIFICACIÓN GENERAL</span>
      <h1>La carrera por la copa</h1>
      <p>Ranking global y perfiles de cada participante.</p>
    </section>
    <section className="ranking-block">
      <div className="ranking-heading">
        <div><span className="eyebrow">CLASIFICACIÓN GENERAL</span><h2>Podio del Mundial</h2></div>
        <span>Acumulado total</span>
      </div>
      <div className="podium">
        {rows.slice(0, 3).map((row, index) => <button
          onClick={() => navigate(`/usuario/${row.id}`)}
          key={row.id}
          className={`podium-card place-${index + 1}`}
          aria-label={`Ver perfil de ${row.username}, puesto ${index + 1}`}
        >
          <span className="podium-crown">{index === 0 && <LeaderCup />}</span>
          <span className="podium-orbit">
            <span className="podium-initials">{initials(row.username)}</span>
            <b className="podium-rank">{index + 1}</b>
          </span>
          <strong>{row.username}</strong>
          <span className="leaderboard-total"><em>{row.total_points}</em><LastMatchPoints points={row.last_match_points} /></span>
          <small>PTS</small>
          <span className="podium-step" aria-hidden="true">{index + 1}</span>
        </button>)}
      </div>
    </section>
    <div className="export-actions">
      <button onClick={() => exportRows(rows, "csv")}>Exportar CSV</button>
      <button onClick={() => exportRows(rows, "excel")}>Exportar Excel</button>
    </div>
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Pos.</th>
            <th>Participante</th>
            <th>Total</th>
            <th>Ganador</th>
            <th>Exacto</th>
            <th>Goleador</th>
            <th>Ajustes</th>
            <th>Pronósticos</th>
            <th>Aciertos G/E/GL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id}>
            <td><b><Position index={index} /></b></td>
            <td className="clickable-user" onClick={() => navigate(`/usuario/${row.id}`)}>
              <Avatar user={row} className="mini-avatar" />
              <strong>{row.username}</strong>
              {row.personal_phrase && <small>{row.personal_phrase}</small>}
            </td>
            <td>
              <span className="leaderboard-total table-total">
                <strong className="points">{row.total_points}</strong>
                <LastMatchPoints points={row.last_match_points} />
              </span>
            </td>
            <td>{row.winner_points}</td>
            <td>{row.exact_result_points}</td>
            <td>{row.scorer_points}</td>
            <td className={row.adjustments < 0 ? "negative" : ""}>{row.adjustments > 0 ? "+" : ""}{row.adjustments}</td>
            <td>{row.predicted_matches}</td>
            <td><span className="hit"><Target size={14} />{row.winner_hits} / {row.exact_hits} / {row.scorer_hits}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}

function LastMatchPoints({ points = 0 }) {
  const value = Number(points) || 0;
  if (!value) return null;
  return <small className="last-match-points">+{value}</small>;
}

function Position({ index }) {
  return <>#{index + 1}</>;
}

function LeaderCup({ compact = false }) {
  return <img className={`leader-cup${compact ? " compact" : ""}`} src="/images/iconomundial.png" alt="Líder" />;
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}

function exportRows(rows, type) {
  const separator = type === "csv" ? ";" : "\t";
  const text = [
    ["Posición", "Usuario", "Puntos", "Aciertos ganador", "Exactos", "Goleadores"],
    ...rows.map((row, index) => [index + 1, row.username, row.total_points, row.winner_hits, row.exact_hits, row.scorer_hits])
  ].map((row) => row.join(separator)).join("\n");
  const blob = new Blob([`\uFEFF${text}`], { type: type === "csv" ? "text/csv" : "application/vnd.ms-excel" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `clasificacion.${type === "csv" ? "csv" : "xls"}`;
  link.click();
  URL.revokeObjectURL(link.href);
}
