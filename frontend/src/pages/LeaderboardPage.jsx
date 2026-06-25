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

  return <div className="page leaderboard-page">
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
            <Avatar user={row} className="podium-avatar" />
            <b className="podium-rank">{index + 1}</b>
          </span>
          <span className="podium-player-info">
            <strong>{row.username}</strong>
            <span className="leaderboard-total"><em>{row.total_points}</em><LastMatchPoints points={row.last_match_points} /></span>
            <small>PTS</small>
          </span>
          <span className="podium-step" aria-hidden="true">{index + 1}</span>
        </button>)}
      </div>
    </section>
    <div className="table-card">
      <table className="leaderboard-table">
        <thead>
          <tr>
            <th className="leaderboard-position-cell">Pos.</th>
            <th className="leaderboard-user-cell">Participante</th>
            <th className="leaderboard-points-cell">Total</th>
            <th className="leaderboard-number-cell">Ganador</th>
            <th className="leaderboard-number-cell">Exacto</th>
            <th className="leaderboard-number-cell">Goleador</th>
            <th className="leaderboard-number-cell">Ajustes</th>
            <th className="leaderboard-number-cell">Pronosticos</th>
            <th className="leaderboard-hits-cell leaderboard-hits-column">Aciertos G/E/GL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => <tr className="leaderboard-row" key={row.id}>
            <td className="leaderboard-position-cell"><b><Position index={index} /></b></td>
            <td className="leaderboard-user-cell clickable-user" onClick={() => navigate(`/usuario/${row.id}`)}>
              <span className="leaderboard-user-main">
                <Avatar user={row} className="mini-avatar" />
                <span className="leaderboard-user-text">
                  <strong>{row.username}</strong>
                  <small aria-hidden={!row.personal_phrase}>{row.personal_phrase || "\u00a0"}</small>
                </span>
              </span>
            </td>
            <td className="leaderboard-points-cell">
              <span className="leaderboard-total table-total">
                <strong className="points">{row.total_points}</strong>
                <LastMatchPoints points={row.last_match_points} />
              </span>
            </td>
            <td className="leaderboard-number-cell">{row.winner_points}</td>
            <td className="leaderboard-number-cell">{row.exact_result_points}</td>
            <td className="leaderboard-number-cell">{row.scorer_points}</td>
            <td className={`leaderboard-number-cell ${row.adjustments < 0 ? "negative" : ""}`}>{row.adjustments > 0 ? "+" : ""}{row.adjustments}</td>
            <td className="leaderboard-number-cell">{row.predicted_matches}</td>
            <td className="leaderboard-hits-cell"><span className="hit"><Target size={14} />{row.winner_hits} / {row.exact_hits} / {row.scorer_hits}</span></td>
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
