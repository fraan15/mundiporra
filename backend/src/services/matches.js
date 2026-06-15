import { db, logAction, now, settings } from "../db/database.js";
import { notifyAll } from "./notifications.js";
import { NO_SCORER_ID } from "./scorers.js";

export function effectiveCloseAt(match, config = settings()) {
  const minutes = Number(config.auto_close_minutes_before || 0);
  return new Date(new Date(match.auto_close_at).getTime() - minutes * 60000);
}

export function isExpired(match) {
  const config = settings();
  return !(match.status === "open" && match.close_reason === "manual") &&
    config.auto_close_enabled === "1" &&
    new Date() >= effectiveCloseAt(match, config);
}

export function autoCloseExpired() {
  const config = settings();
  if (config.auto_close_enabled !== "1") return 0;
  const open = db.prepare("SELECT * FROM matches WHERE status='open' AND COALESCE(close_reason,'')!='manual'").all();
  let count = 0;
  const close = db.transaction((match) => {
    db.prepare("UPDATE matches SET status='closed', close_reason='automatic', updated_at=? WHERE id=?")
      .run(now(), match.id);
    db.prepare("UPDATE predictions SET locked=1, updated_at=? WHERE match_id=?").run(now(), match.id);
    logAction(null, "auto_close_match", "match", match.id, `Cierre automático: ${match.team1} - ${match.team2}`, match, { ...match, status: "closed", close_reason: "automatic" });
    notifyAll({
      type: "match_closed",
      title: "Apuestas cerradas",
      message: `${match.team1} - ${match.team2} se ha cerrado automáticamente.`,
      entityType: "match",
      entityId: match.id,
      link: "/",
      eventKey: `match-closed:${match.id}`
    });
  });
  for (const match of open) {
    if (new Date() >= effectiveCloseAt(match, config)) {
      close(match);
      count += 1;
    }
  }
  return count;
}

export function calculateWinner(goals1, goals2) {
  return goals1 === goals2 ? "draw" : goals1 > goals2 ? "team1" : "team2";
}

export function recalculateMatch(matchId) {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
  if (!match || match.result_team1 === null || match.result_team2 === null) return 0;
  const config = settings();
  const winnerPoints = Number(config.winner_points || 3);
  const exactPoints = Number(config.exact_result_points || 5);
  const scorerPoints = Number(config.scorer_points || 2);
  const multiplier = match.is_star ? 2 : 1;
  const predictions = db.prepare("SELECT * FROM predictions WHERE match_id=?").all(matchId);
  const update = db.prepare(`
    UPDATE predictions SET winner_points=?, exact_result_points=?, scorer_points=?,
      total_points=?, scoring_multiplier=?, locked=1, updated_at=? WHERE id=?
  `);
  const scorerIds = new Set(db.prepare("SELECT player_id FROM match_scorers WHERE match_id=?").all(matchId).map((row) => row.player_id));
  if (match.scorer_enabled && match.result_team1 === 0 && match.result_team2 === 0) scorerIds.add(NO_SCORER_ID);
  const transaction = db.transaction(() => {
    for (const prediction of predictions) {
      const baseWinnerPoints = prediction.predicted_winner === match.winner ? winnerPoints : 0;
      const baseExactPoints = prediction.predicted_team1_goals === match.result_team1 &&
        prediction.predicted_team2_goals === match.result_team2 ? exactPoints : 0;
      const predictedScorer = prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0
        ? NO_SCORER_ID
        : prediction.predicted_scorer_id;
      const baseScorerPoints = match.scorer_enabled && predictedScorer &&
        scorerIds.has(predictedScorer) ? scorerPoints : 0;
      const wp = baseWinnerPoints * multiplier;
      const ep = baseExactPoints * multiplier;
      const sp = baseScorerPoints * multiplier;
      update.run(wp, ep, sp, wp + ep + sp, multiplier, now(), prediction.id);
    }
  });
  transaction();
  return predictions.length;
}

export function recalculateAll() {
  const matches = db.prepare("SELECT id FROM matches WHERE result_team1 IS NOT NULL AND result_team2 IS NOT NULL").all();
  return matches.reduce((total, match) => total + recalculateMatch(match.id), 0);
}
