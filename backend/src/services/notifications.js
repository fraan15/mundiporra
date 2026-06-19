import { db, now } from "../db/database.js";
import { sendPushToUser } from "./push.js";

export const leaderboardRows = () => db.prepare(`
  WITH latest_finished_match AS (
    SELECT id
    FROM matches
    WHERE status='finished'
    ORDER BY match_date DESC, match_time DESC, id DESC
    LIMIT 1
  )
  SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.personal_phrase,u.avatar_filename,
    CASE WHEN u.avatar_filename IS NULL THEN NULL ELSE '/avatars/' || u.avatar_filename END avatar_url,
    COALESCE(SUM(p.total_points),0)+COALESCE(adj.adjustments,0) total_points,
    COALESCE(last_match.total_points,0) last_match_points,
    COALESCE(SUM(p.winner_points),0) winner_points,
    COALESCE(SUM(p.exact_result_points),0) exact_result_points,
    COALESCE(SUM(p.scorer_points),0) scorer_points,
    COALESCE(adj.adjustments,0) adjustments,
    COUNT(p.id) predicted_matches,
    COALESCE(SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END),0) winner_hits,
    COALESCE(SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END),0) exact_hits
    ,COALESCE(SUM(CASE WHEN p.scorer_points>0 THEN 1 ELSE 0 END),0) scorer_hits
  FROM users u LEFT JOIN predictions p ON p.user_id=u.id
  LEFT JOIN (SELECT user_id,SUM(points) adjustments FROM points_adjustments GROUP BY user_id) adj ON adj.user_id=u.id
  LEFT JOIN (
    SELECT user_id,total_points
    FROM predictions
    WHERE match_id=(SELECT id FROM latest_finished_match)
  ) last_match ON last_match.user_id=u.id
  WHERE u.active=1 AND u.role='user'
  GROUP BY u.id ORDER BY total_points DESC,exact_hits DESC,winner_hits DESC,u.username
`).all();

export function saveRankingSnapshot(date = new Date().toISOString().slice(0, 10)) {
  const save = db.prepare(`
    INSERT INTO ranking_snapshots(user_id,snapshot_date,position,points,created_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(user_id,snapshot_date) DO UPDATE SET position=excluded.position,points=excluded.points
  `);
  db.transaction(() => leaderboardRows().forEach((row, index) =>
    save.run(row.id, date, index + 1, row.total_points, now())
  ))();
}

export function scheduleDailyRankingSnapshot() {
  const runAndReschedule = () => {
    saveRankingSnapshot();
    schedule();
  };
  const schedule = () => {
    const nextRun = new Date();
    nextRun.setHours(3, 0, 5, 0);
    if (nextRun <= new Date()) nextRun.setDate(nextRun.getDate() + 1);
    const timer = setTimeout(runAndReschedule, nextRun.getTime() - Date.now());
    timer.unref();
  };
  schedule();
}

export function createNotification({
  userId, type, title, message, entityType = null, entityId = null, link = "/", eventKey = null, sendPush = true
}) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO notifications
      (user_id,type,title,message,entity_type,entity_id,link,event_key,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(userId, type, title, message, entityType, entityId, link, eventKey, now());
  if (result.changes && sendPush) void sendPushToUser(userId, { type, title, message, entityId, link, eventKey });
  return Boolean(result.changes);
}

export function notifyAll(payload) {
  const users = db.prepare("SELECT id FROM users WHERE active=1").all();
  db.transaction(() => users.forEach(({ id }) => createNotification({ ...payload, userId: id })))();
}

export function notifyAllExcept(excludedUserId, payload) {
  const users = db.prepare("SELECT id FROM users WHERE active=1 AND id<>?").all(excludedUserId);
  db.transaction(() => users.forEach(({ id }) => createNotification({ ...payload, userId: id })))();
}

export function notifyNewTopThree(beforeRows, eventKey, sendPush = true) {
  const previous = new Set(beforeRows.slice(0, 3).map((row) => row.id));
  const newcomers = [];
  leaderboardRows().slice(0, 3).forEach((row, index) => {
    if (!previous.has(row.id)) {
      newcomers.push({ ...row, position: index + 1 });
      createNotification({
        userId: row.id,
        type: "top_three",
        title: "¡Estás en el top 3!",
        message: `Has subido al puesto ${index + 1} con ${row.total_points} puntos.`,
        entityType: "leaderboard",
        link: "/clasificacion",
        eventKey: `top-three:${eventKey}:${row.id}`,
        sendPush
      });
    }
  });
  return newcomers;
}
