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
      <span className="eyebrow"><Trophy size={14} /> CLASIFICACION GENERAL</span>
      <h1>La carrera por la copa</h1>
      <p>Ranking global y perfiles de cada participante.</p>
    </section>
    <section className="ranking-block">
      <div className="ranking-heading">
        <div><span className="eyebrow">CLASIFICACION GENERAL</span><h2>Podio del Mundial</h2></div>
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
            <th>Pronosticos</th>
            <th className="leaderboard-hits-column">Aciertos G/E/GL</th>
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
            <td className="leaderboard-hits-column"><span className="hit"><Target size={14} />{row.winner_hits} / {row.exact_hits} / {row.scorer_hits}</span></td>
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

function LeaderCup() {
  return <img className="leader-cup" src="/images/iconomundial.png" alt="Lider" />;
}

function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : name.slice(0, 2)).toUpperCase();
}
