import express from "express";
import cors from "cors";
import session from "express-session";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, initDatabase, logAction, now, settings } from "./db/database.js";
import { hydrateUser, requireAdmin, requireAuth } from "./middleware/auth.js";
import { autoCloseExpired, calculateWinner, effectiveCloseAt, isExpired, recalculateAll, recalculateMatch } from "./services/matches.js";
import { createNotification, leaderboardRows, notifyAll, notifyAllExcept, notifyNewTopThree, saveRankingSnapshot } from "./services/notifications.js";

initDatabase();
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(here, "../../frontend/dist");

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare("SELECT sess FROM sessions WHERE sid=? AND expire > ?").get(sid, now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) { callback(error); }
  }
  set(sid, sess, callback = () => {}) {
    try {
      const expire = sess.cookie?.expires ? new Date(sess.cookie.expires).toISOString() : new Date(Date.now() + 604800000).toISOString();
      db.prepare("INSERT INTO sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expire=excluded.expire")
        .run(sid, JSON.stringify(sess), expire);
      callback();
    } catch (error) { callback(error); }
  }
  destroy(sid, callback = () => {}) {
    try { db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); callback(); } catch (error) { callback(error); }
  }
}

export const app = express();
app.set("trust proxy", 1);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173,http://localhost:3001")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors((req, callback) => {
  const origin = req.get("origin");
  let originAllowed = !origin || allowedOrigins.includes(origin);

  if (origin && !originAllowed) try {
    const originUrl = new URL(origin);
    const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
    const publicHost = forwardedHost || req.get("host");
    originAllowed = originUrl.host === publicHost;
  } catch {
    originAllowed = false;
  }

  callback(null, {
    credentials: true,
    origin: originAllowed
  });
}));
app.use(express.json());
app.use((req, _res, next) => {
  const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
  req.clientIp = req.get("cf-connecting-ip") || forwarded || req.ip;
  next();
});
app.use(session({
  secret: process.env.SESSION_SECRET || "worldcup-porra-local-secret",
  resave: false,
  saveUninitialized: false,
  store: new SQLiteSessionStore(),
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(hydrateUser);
app.use("/api", (req, _res, next) => { if (!req.path.startsWith("/auth")) autoCloseExpired(); next(); });

const safeUser = (user) => user && ({ id: user.id, username: user.username, role: user.role, active: user.active, personal_phrase: user.personal_phrase || "", created_at: user.created_at });
const parseIntField = (value) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const matchPayload = (body, existing = {}) => {
  const date = body.match_date ?? existing.match_date;
  const time = body.match_time ?? existing.match_time;
  const autoClose = body.auto_close_at || new Date(`${date}T${time}:00`).toISOString();
  return {
    match_date: date, match_time: time, stadium: String(body.stadium ?? existing.stadium ?? "").trim(),
    team1: String(body.team1 ?? existing.team1 ?? "").trim(), team2: String(body.team2 ?? existing.team2 ?? "").trim(),
    auto_close_at: autoClose
  };
};
const predictionWinner = (g1, g2) => g1 === g2 ? "draw" : g1 > g2 ? "team1" : "team2";
const serializeMatch = (match) => ({ ...match, effective_close_at: effectiveCloseAt(match).toISOString(), betting_open: match.status === "open" && !isExpired(match) });

app.post("/api/auth/login", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(String(req.body.username || "").trim());
  if (!user || !user.active || user.password !== String(req.body.password || "")) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos, o cuenta desactivada." });
  }
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});
app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/auth/me", (req, res) => res.json({ user: safeUser(req.user), settings: settings(), client_ip: req.clientIp }));

app.get("/api/matches", requireAuth, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*, COUNT(bettor.id) prediction_count,
      mine.id prediction_id, mine.predicted_winner, mine.predicted_team1_goals, mine.predicted_team2_goals,
      mine.winner_points, mine.exact_result_points, mine.total_points
    FROM matches m
    LEFT JOIN predictions p ON p.match_id=m.id
    LEFT JOIN users bettor ON bettor.id=p.user_id AND bettor.role='user'
    LEFT JOIN predictions mine ON mine.match_id=m.id AND mine.user_id=?
    GROUP BY m.id ORDER BY m.match_date,m.match_time
  `).all(req.user.id);
  res.json(matches.map(serializeMatch));
});

const userStats = (userId) => {
  const leaderboard = leaderboardRows();
  const row = leaderboard.find((item) => item.id === Number(userId));
  if (!row) return null;
  const position = leaderboard.findIndex((item) => item.id === Number(userId)) + 1;
  const finished = db.prepare(`
    SELECT p.*,m.match_date,m.team1,m.team2,m.winner FROM predictions p
    JOIN matches m ON m.id=p.match_id WHERE p.user_id=? AND m.status='finished'
    ORDER BY m.match_date,m.match_time
  `).all(userId);
  const daily = db.prepare(`
    SELECT m.match_date date,COALESCE(SUM(p.total_points),0) points,
      SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END) winner_hits,
      SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END) exact_hits
    FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=? AND m.status='finished' GROUP BY m.match_date ORDER BY m.match_date
  `).all(userId);
  const picks = {};
  finished.forEach((p) => {
    const team = p.predicted_winner === "team1" ? p.team1 : p.predicted_winner === "team2" ? p.team2 : "Empate";
    picks[team] = (picks[team] || 0) + 1;
  });
  const teamPoints = {};
  finished.forEach((p) => {
    const team = p.predicted_winner === "team1" ? p.team1 : p.predicted_winner === "team2" ? p.team2 : "Empate";
    teamPoints[team] = (teamPoints[team] || 0) + p.total_points;
  });
  const maxEntry = (object) => Object.entries(object).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const badges = [];
  if (row.exact_hits >= 1) badges.push({ icon: "🥇", name: "Primer resultado exacto" });
  if (row.winner_hits >= 5) badges.push({ icon: "🔥", name: "Cazador de ganadores" });
  if (row.exact_hits >= 3) badges.push({ icon: "🎯", name: "Especialista exacto" });
  if (row.total_points >= 100) badges.push({ icon: "🏆", name: "Centenario" });
  const draws = finished.filter((p) => p.predicted_winner === "draw" && p.winner_points > 0).length;
  if (draws >= 3) badges.push({ icon: "⚽", name: "Especialista en empates" });
  return {
    ...row, position, finished_matches: finished.length,
    winner_percentage: finished.length ? Math.round(row.winner_hits / finished.length * 100) : 0,
    exact_percentage: finished.length ? Math.round(row.exact_hits / finished.length * 100) : 0,
    average_points: finished.length ? Number((row.total_points / finished.length).toFixed(1)) : 0,
    best_day: daily.sort((a,b) => b.points-a.points)[0] || null,
    worst_day: [...daily].sort((a,b) => a.points-b.points)[0] || null,
    most_picked_team: maxEntry(picks), best_team: maxEntry(teamPoints), daily, badges
  };
};

app.get("/api/dashboard", requireAuth, (req, res) => {
  saveRankingSnapshot();
  const stats = userStats(req.user.id) || {
    position: "—", total_points: 0, exact_hits: 0, winner_hits: 0,
    predicted_matches: 0, average_points: 0
  };
  const today = new Date().toISOString().slice(0, 10);
  const todayPoints = db.prepare(`
    SELECT COALESCE(SUM(p.total_points),0) points FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=? AND m.match_date=?
  `).get(req.user.id, today).points;
  const pending = db.prepare(`
    SELECT COUNT(*) count FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    WHERE m.status='open' AND m.auto_close_at>? AND p.id IS NULL
  `).get(req.user.id, now()).count;
  const nextMatches = db.prepare("SELECT * FROM matches WHERE status='open' AND auto_close_at>? ORDER BY match_date,match_time").all(now()).map(serializeMatch);
  res.json({ summary: { ...stats, today_points: todayPoints, pending }, next_match: nextMatches[0] || null, next_matches: nextMatches });
});

app.get("/api/profile/me", requireAuth, (req, res) => res.json({
  user: safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)),
  stats: userStats(req.user.id),
  history: db.prepare("SELECT snapshot_date date,position,points FROM ranking_snapshots WHERE user_id=? ORDER BY snapshot_date").all(req.user.id)
}));
app.patch("/api/profile/me", requireAuth, (req, res) => {
  const phrase = String(req.body.personal_phrase || "").trim().slice(0, 120);
  db.prepare("UPDATE users SET personal_phrase=?,updated_at=? WHERE id=?").run(phrase, now(), req.user.id);
  res.json(safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)));
});
app.patch("/api/profile/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (user.password !== currentPassword) return res.status(400).json({ error: "La contraseña actual no es correcta." });
  if (newPassword.length < 4) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 4 caracteres." });
  if (newPassword === currentPassword) return res.status(400).json({ error: "La nueva contraseña debe ser diferente a la actual." });
  db.prepare("UPDATE users SET password=?,updated_at=? WHERE id=?").run(newPassword, now(), req.user.id);
  res.json({ ok: true });
});
app.get("/api/users/:id/public", requireAuth, (req, res) => {
  saveRankingSnapshot();
  const user = db.prepare("SELECT id,username,role,personal_phrase,created_at FROM users WHERE id=? AND active=1").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  const predictions = db.prepare(`
    SELECT p.*,m.team1,m.team2,m.match_date,m.status,m.result_team1,m.result_team2
    FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=? AND (m.status!='open' OR m.auto_close_at<=?) ORDER BY m.match_date DESC,m.match_time DESC
  `).all(user.id, now());
  res.json({ user, stats: userStats(user.id), predictions, history: db.prepare("SELECT snapshot_date date,position,points FROM ranking_snapshots WHERE user_id=? ORDER BY snapshot_date").all(user.id) });
});

app.get("/api/activity", requireAuth, (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 10, 1), 30);
  const predictions = db.prepare(`
    SELECT 'prediction' type,u.username,m.team1,m.team2,p.created_at FROM predictions p
    JOIN users u ON u.id=p.user_id JOIN matches m ON m.id=p.match_id
  `).all().map((x) => ({ ...x, text: `${x.username} registró un pronóstico en ${x.team1} - ${x.team2}` }));
  const points = db.prepare(`
    SELECT 'points' type,u.username,m.team1,m.team2,p.total_points,p.updated_at created_at,p.exact_result_points
    FROM predictions p JOIN users u ON u.id=p.user_id JOIN matches m ON m.id=p.match_id
    WHERE p.total_points>0
  `).all().map((x) => ({ ...x, text: x.exact_result_points > 0 ? `${x.username} acertó un resultado exacto` : `${x.username} consiguió ${x.total_points} puntos` }));
  const items = [...predictions, ...points].sort((a,b) => b.created_at.localeCompare(a.created_at));
  const start = (page - 1) * pageSize;
  res.json({ items: items.slice(start, start + pageSize), page, page_size: pageSize, total: items.length, total_pages: Math.max(1, Math.ceil(items.length / pageSize)) });
});

app.get("/api/chat", requireAuth, (_req, res) => {
  const messages = db.prepare(`
    SELECT c.id,c.message,c.created_at,c.reply_to_id,u.id user_id,u.username,
      parent.message reply_message,parent_user.username reply_username
    FROM chat_messages c
    JOIN users u ON u.id=c.user_id
    LEFT JOIN chat_messages parent ON parent.id=c.reply_to_id
    LEFT JOIN users parent_user ON parent_user.id=parent.user_id
    ORDER BY c.created_at DESC,c.id DESC LIMIT 100
  `).all();
  res.json(messages.reverse());
});
app.post("/api/chat", requireAuth, (req, res) => {
  const message = String(req.body.message || "").trim().slice(0, 500);
  const replyToId = req.body.reply_to_id ? Number(req.body.reply_to_id) : null;
  if (!message) return res.status(400).json({ error: "Escribe un mensaje." });
  if (replyToId && !db.prepare("SELECT id FROM chat_messages WHERE id=?").get(replyToId)) {
    return res.status(400).json({ error: "El mensaje al que respondes ya no existe." });
  }
  const result = db.prepare("INSERT INTO chat_messages(user_id,reply_to_id,message,created_at) VALUES(?,?,?,?)")
    .run(req.user.id, replyToId, message, now());
  res.status(201).json({ id: result.lastInsertRowid });
});
app.get("/api/chat/status", requireAuth, (req, res) => {
  const lastRead = db.prepare("SELECT last_read_message_id FROM chat_reads WHERE user_id=?").get(req.user.id)?.last_read_message_id || 0;
  const unread = db.prepare("SELECT COUNT(*) count FROM chat_messages WHERE id>? AND user_id!=?").get(lastRead, req.user.id).count;
  res.json({ unread, last_read_message_id: lastRead });
});
app.post("/api/chat/read", requireAuth, (req, res) => {
  const lastMessageId = db.prepare("SELECT COALESCE(MAX(id),0) id FROM chat_messages").get().id;
  db.prepare(`
    INSERT INTO chat_reads(user_id,last_read_message_id,read_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id,read_at=excluded.read_at
  `).run(req.user.id, lastMessageId, now());
  res.json({ ok: true, last_read_message_id: lastMessageId });
});

app.get("/api/matches/:id/detail", requireAuth, (req, res) => {
  const match = db.prepare(`
    SELECT m.*,p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=? WHERE m.id=?
  `).get(req.user.id, req.params.id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  const open = match.status === "open" && !isExpired(match);
  const participants = db.prepare(`
    SELECT u.id,u.username,
      CASE WHEN p.id IS NULL THEN 0 ELSE 1 END participating,
      p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points
    FROM users u
    LEFT JOIN predictions p ON p.user_id=u.id AND p.match_id=?
    WHERE u.active=1 AND u.role='user'
    ORDER BY participating DESC,${open ? "u.username" : "p.total_points DESC,u.username"}
  `).all(match.id);
  const distribution = open ? [] : db.prepare(
    "SELECT predicted_winner winner,COUNT(*) count FROM predictions WHERE match_id=? GROUP BY predicted_winner"
  ).all(match.id);
  res.json({ match: serializeMatch(match), participants, revealed: !open, distribution });
});

app.get("/api/matches/:id/comments", requireAuth, (req, res) => res.json(db.prepare(`
  SELECT c.*,u.username,u.role FROM match_comments c JOIN users u ON u.id=c.user_id
  WHERE c.match_id=? ORDER BY c.created_at DESC
`).all(req.params.id)));
app.post("/api/matches/:id/comments", requireAuth, (req, res) => {
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  if (!comment) return res.status(400).json({ error: "Escribe un comentario." });
  const match = db.prepare("SELECT id,team1,team2 FROM matches WHERE id=?").get(req.params.id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  const result = db.prepare("INSERT INTO match_comments(match_id,user_id,comment,created_at,updated_at) VALUES(?,?,?,?,?)").run(req.params.id, req.user.id, comment, now(), now());
  notifyAllExcept(req.user.id, {
    type: "match_comment",
    title: "Nuevo comentario",
    message: `${req.user.username} ha comentado en ${match.team1} - ${match.team2}.`,
    entityType: "match_comment",
    entityId: result.lastInsertRowid,
    link: `/match/${match.id}#comentarios`,
    eventKey: `match-comment:${result.lastInsertRowid}`
  });
  res.status(201).json({ id: result.lastInsertRowid });
});
app.put("/api/comments/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM match_comments WHERE id=?").get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "No puedes editar este comentario." });
  db.prepare("UPDATE match_comments SET comment=?,updated_at=? WHERE id=?").run(String(req.body.comment || "").trim().slice(0,500), now(), row.id);
  res.json({ ok: true });
});
app.delete("/api/comments/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM match_comments WHERE id=?").get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "No puedes eliminar este comentario." });
  db.prepare("DELETE FROM match_comments WHERE id=?").run(row.id); res.json({ ok: true });
});

app.post("/api/matches", requireAdmin, (req, res) => {
  const data = matchPayload(req.body);
  if (!data.match_date || !data.match_time || !data.team1 || !data.team2) return res.status(400).json({ error: "Fecha, hora y equipos son obligatorios." });
  const stamp = now();
  const result = db.prepare(`INSERT INTO matches(match_date,match_time,stadium,team1,team2,status,auto_close_at,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?,?)`)
    .run(data.match_date, data.match_time, data.stadium, data.team1, data.team2, data.auto_close_at, stamp, stamp);
  const created = db.prepare("SELECT * FROM matches WHERE id=?").get(result.lastInsertRowid);
  logAction(req.user.id, "create_match", "match", created.id, "Partido creado", null, created);
  res.status(201).json(serializeMatch(created));
});

app.put("/api/matches/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  const data = matchPayload(req.body, before);
  db.prepare("UPDATE matches SET match_date=?,match_time=?,stadium=?,team1=?,team2=?,auto_close_at=?,updated_at=? WHERE id=?")
    .run(data.match_date, data.match_time, data.stadium, data.team1, data.team2, data.auto_close_at, now(), before.id);
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  logAction(req.user.id, "edit_match", "match", before.id, "Partido editado", before, after);
  res.json(serializeMatch(after));
});

app.delete("/api/matches/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  db.prepare("DELETE FROM matches WHERE id=?").run(before.id);
  logAction(req.user.id, "delete_match", "match", before.id, "Partido eliminado", before, null);
  res.json({ ok: true });
});

app.patch("/api/matches/:id/status", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  const status = req.body.status;
  if (!before || !["open", "closed", "finished"].includes(status)) return res.status(400).json({ error: "Partido o estado no válido." });
  if (status === "finished" && (before.result_team1 === null || before.result_team2 === null)) return res.status(400).json({ error: "Introduce el resultado antes de finalizar." });
  const closeReason = status === "closed" ? "manual" : status === "open" ? null : before.close_reason;
  db.prepare("UPDATE matches SET status=?,close_reason=?,updated_at=? WHERE id=?").run(status, closeReason, now(), before.id);
  db.prepare("UPDATE predictions SET locked=?,updated_at=? WHERE match_id=?").run(status === "open" ? 0 : 1, now(), before.id);
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  logAction(req.user.id, status === "closed" ? "close_match" : "edit_match", "match", before.id, `Estado cambiado a ${status}`, before, after);
  if (status === "closed" && before.status !== "closed") {
    notifyAll({
      type: "match_closed",
      title: "Apuestas cerradas",
      message: `${before.team1} - ${before.team2} se ha cerrado manualmente.`,
      entityType: "match",
      entityId: before.id,
      link: "/",
      eventKey: `match-closed:${before.id}`
    });
  }
  res.json(serializeMatch(after));
});

app.post("/api/matches/:id/finish", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  const g1 = parseIntField(req.body.result_team1), g2 = parseIntField(req.body.result_team2);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  if (g1 === null || g2 === null) return res.status(400).json({ error: "Los goles deben ser enteros positivos o cero." });
  const winner = calculateWinner(g1, g2);
  if (req.body.winner && req.body.winner !== winner) return res.status(400).json({ error: "El ganador no coincide con el marcador." });
  const leaderboardBefore = leaderboardRows();
  db.prepare("UPDATE matches SET status='finished',result_team1=?,result_team2=?,winner=?,updated_at=? WHERE id=?")
    .run(g1, g2, winner, now(), before.id);
  recalculateMatch(before.id);
  saveRankingSnapshot();
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  logAction(req.user.id, before.status === "finished" ? "edit_result" : "finish_match", "match", before.id, "Resultado guardado y puntos recalculados", before, after);
  notifyAll({
    type: "result_published",
    title: "Resultado publicado",
    message: `${before.team1} ${g1} - ${g2} ${before.team2}.`,
    entityType: "match",
    entityId: before.id,
    link: "/",
    eventKey: `result:${before.id}:${g1}-${g2}`
  });
  db.prepare("SELECT user_id,total_points FROM predictions WHERE match_id=? AND total_points>0").all(before.id)
    .forEach((prediction) => createNotification({
      userId: prediction.user_id,
      type: "points_earned",
      title: "Has sumado puntos",
      message: `Has conseguido ${prediction.total_points} puntos en ${before.team1} - ${before.team2}.`,
      entityType: "match",
      entityId: before.id,
      link: "/clasificacion",
      eventKey: `points:${before.id}:${g1}-${g2}:${prediction.total_points}`
    }));
  notifyNewTopThree(leaderboardBefore, `result:${before.id}:${g1}-${g2}`);
  res.json(serializeMatch(after));
});

app.get("/api/predictions/me", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM predictions WHERE user_id=? ORDER BY match_id").all(req.user.id));
});
app.get("/api/predictions/match/:matchId", requireAuth, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.matchId);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  const count = db.prepare(`
    SELECT COUNT(*) count FROM predictions p
    JOIN users u ON u.id=p.user_id
    WHERE p.match_id=? AND u.role='user'
  `).get(match.id).count;
  if (match.status === "open" && !isExpired(match)) {
    const participants = db.prepare(`
      SELECT u.id,u.username FROM predictions p
      JOIN users u ON u.id=p.user_id
      WHERE p.match_id=? AND u.role='user' ORDER BY u.username
    `).all(match.id);
    return res.json({ revealed: false, count, participants });
  }
  const predictions = db.prepare(`
    SELECT p.id,u.username,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,
      p.winner_points,p.exact_result_points,p.total_points
    FROM predictions p JOIN users u ON u.id=p.user_id
    WHERE p.match_id=? AND u.role='user' ORDER BY u.username
  `).all(match.id);
  res.json({ revealed: true, count, predictions });
});

function savePrediction(req, res, predictionId = null) {
  const matchId = Number(req.body.match_id);
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
  const g1 = parseIntField(req.body.predicted_team1_goals), g2 = parseIntField(req.body.predicted_team2_goals);
  const winner = req.body.predicted_winner;
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (match.status !== "open" || isExpired(match)) return res.status(409).json({ error: "Las apuestas de este partido ya están cerradas." });
  if (g1 === null || g2 === null || !["team1", "team2", "draw"].includes(winner)) return res.status(400).json({ error: "Predicción no válida." });
  if (predictionWinner(g1, g2) !== winner) return res.status(400).json({ error: "El ganador elegido no coincide con el resultado pronosticado." });
  const existing = db.prepare("SELECT * FROM predictions WHERE user_id=? AND match_id=?").get(req.user.id, matchId);
  if (predictionId && (!existing || existing.id !== Number(predictionId))) return res.status(403).json({ error: "No puedes modificar esta predicción." });
  if (existing) {
    db.prepare("UPDATE predictions SET predicted_winner=?,predicted_team1_goals=?,predicted_team2_goals=?,updated_at=? WHERE id=?")
      .run(winner, g1, g2, now(), existing.id);
    return res.json(db.prepare("SELECT * FROM predictions WHERE id=?").get(existing.id));
  }
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO predictions(user_id,match_id,predicted_winner,predicted_team1_goals,predicted_team2_goals,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(req.user.id, matchId, winner, g1, g2, stamp, stamp);
  res.status(201).json(db.prepare("SELECT * FROM predictions WHERE id=?").get(result.lastInsertRowid));
}
app.post("/api/predictions", requireAuth, (req, res) => savePrediction(req, res));
app.put("/api/predictions/:id", requireAuth, (req, res) => savePrediction(req, res, req.params.id));

app.get("/api/notifications", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?
  `).all(req.user.id, limit);
  const unread = db.prepare("SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read=0").get(req.user.id).count;
  res.json({ notifications, unread });
});
app.patch("/api/notifications/:id/read", requireAuth, (req, res) => {
  const result = db.prepare("UPDATE notifications SET read=1,read_at=? WHERE id=? AND user_id=?")
    .run(now(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Notificación no encontrada." });
  res.json({ ok: true });
});
app.post("/api/notifications/read-all", requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read=1,read_at=? WHERE user_id=? AND read=0").run(now(), req.user.id);
  res.json({ ok: true });
});

app.get("/api/leaderboard", requireAuth, (_req, res) => res.json(leaderboardRows()));
app.get("/api/leaderboard/daily", requireAuth, (_req, res) => {
  const latestDate = db.prepare("SELECT MAX(match_date) date FROM matches WHERE status='finished'").get().date;
  const rows = db.prepare(`
    SELECT u.id,u.username,u.personal_phrase,
      COALESCE(SUM(p.total_points),0) total_points,
      COALESCE(SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END),0) winner_hits,
      COALESCE(SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END),0) exact_hits
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id
      AND p.match_id IN (SELECT id FROM matches WHERE match_date=? AND status='finished')
    WHERE u.active=1 AND u.role='user'
    GROUP BY u.id ORDER BY total_points DESC,exact_hits DESC,winner_hits DESC,u.username
  `).all(latestDate);
  res.json({ date: latestDate || null, rows });
});

app.get("/api/history/days", requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT m.match_date,COUNT(*) matches_count,COALESCE(SUM(p.total_points),0) my_points
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    GROUP BY m.match_date ORDER BY m.match_date DESC
  `).all(req.user.id));
});
app.get("/api/history/day/:date", requireAuth, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*,p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    WHERE m.match_date=? ORDER BY m.match_time
  `).all(req.user.id, req.params.date).map(serializeMatch);
  const details = Object.fromEntries(matches.map((match) => {
    if (match.status === "open" && !isExpired(match)) return [match.id, null];
    return [match.id, db.prepare(`
      SELECT u.username,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points
      FROM predictions p JOIN users u ON u.id=p.user_id
      WHERE p.match_id=? AND u.role='user' ORDER BY u.username
    `).all(match.id)];
  }));
  res.json({ matches, predictions: details });
});
app.get("/api/history/day/:date/summary", requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT u.username,COALESCE(SUM(p.total_points),0) points,
      COALESCE(SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END),0) winner_hits,
      COALESCE(SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END),0) exact_hits
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id
      AND p.match_id IN (SELECT id FROM matches WHERE match_date=?)
    WHERE u.active=1 AND u.role='user'
    GROUP BY u.id ORDER BY points DESC,u.username
  `).all(req.params.date));
});

app.get("/api/users", requireAdmin, (_req, res) => res.json(db.prepare("SELECT id,username,role,active,created_at,updated_at FROM users ORDER BY username").all()));
app.post("/api/users", requireAdmin, (req, res) => {
  const username = String(req.body.username || "").trim(), password = String(req.body.password || "");
  const role = req.body.role === "admin" ? "admin" : "user";
  if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios." });
  try {
    const stamp = now();
    const result = db.prepare("INSERT INTO users(username,password,role,active,created_at,updated_at) VALUES(?,?,?,1,?,?)").run(username, password, role, stamp, stamp);
    const user = db.prepare("SELECT id,username,role,active,created_at,updated_at FROM users WHERE id=?").get(result.lastInsertRowid);
    logAction(req.user.id, "create_user", "user", user.id, "Usuario creado", null, user);
    res.status(201).json(user);
  } catch { res.status(409).json({ error: "Ese nombre de usuario ya existe." }); }
});
app.put("/api/users/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Usuario no encontrado." });
  const username = String(req.body.username ?? before.username).trim();
  const role = ["admin", "user"].includes(req.body.role) ? req.body.role : before.role;
  const password = req.body.password ? String(req.body.password) : before.password;
  try {
    db.prepare("UPDATE users SET username=?,password=?,role=?,updated_at=? WHERE id=?").run(username, password, role, now(), before.id);
    const after = db.prepare("SELECT * FROM users WHERE id=?").get(before.id);
    logAction(req.user.id, role !== before.role ? "change_role" : "edit_user", "user", before.id, "Usuario editado", safeUser(before), safeUser(after));
    res.json(safeUser(after));
  } catch { res.status(409).json({ error: "Ese nombre de usuario ya existe." }); }
});
app.patch("/api/users/:id/active", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Usuario no encontrado." });
  if (before.username.toLowerCase() === "administrador" && !req.body.active) return res.status(400).json({ error: "El administrador inicial no se puede desactivar." });
  db.prepare("UPDATE users SET active=?,updated_at=? WHERE id=?").run(req.body.active ? 1 : 0, now(), before.id);
  const after = db.prepare("SELECT * FROM users WHERE id=?").get(before.id);
  logAction(req.user.id, req.body.active ? "activate_user" : "deactivate_user", "user", before.id, "Estado de usuario modificado", safeUser(before), safeUser(after));
  res.json(safeUser(after));
});
app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Usuario no encontrado." });
  if (before.username.toLowerCase() === "administrador" || before.id === req.user.id) return res.status(400).json({ error: "Este usuario administrador no se puede eliminar." });
  db.prepare("DELETE FROM users WHERE id=?").run(before.id);
  logAction(req.user.id, "delete_user", "user", before.id, "Usuario eliminado", safeUser(before), null);
  res.json({ ok: true });
});

app.post("/api/admin/recalculate", requireAdmin, (req, res) => {
  const count = recalculateAll();
  logAction(req.user.id, "recalculate_points", "prediction", null, `Recalculadas ${count} predicciones`);
  res.json({ ok: true, recalculated: count });
});
app.post("/api/admin/recalculate/:matchId", requireAdmin, (req, res) => {
  const count = recalculateMatch(req.params.matchId);
  logAction(req.user.id, "recalculate_points", "match", Number(req.params.matchId), `Recalculadas ${count} predicciones`);
  res.json({ ok: true, recalculated: count });
});
app.get("/api/admin/points-adjustments", requireAdmin, (_req, res) => res.json(db.prepare(`
  SELECT a.*,u.username,creator.username created_by_username FROM points_adjustments a
  JOIN users u ON u.id=a.user_id JOIN users creator ON creator.id=a.created_by ORDER BY a.created_at DESC
`).all()));
app.post("/api/admin/points-adjustments", requireAdmin, (req, res) => {
  const points = Number(req.body.points), reason = String(req.body.reason || "").trim(), userId = Number(req.body.user_id);
  if (!Number.isInteger(points) || !points || !reason || !db.prepare("SELECT id FROM users WHERE id=?").get(userId)) return res.status(400).json({ error: "Usuario, puntos distintos de cero y motivo son obligatorios." });
  const leaderboardBefore = leaderboardRows();
  const result = db.prepare("INSERT INTO points_adjustments(user_id,points,reason,created_by,created_at) VALUES(?,?,?,?,?)").run(userId, points, reason, req.user.id, now());
  logAction(req.user.id, "adjust_points", "user", userId, `${points > 0 ? "+" : ""}${points} puntos: ${reason}`, null, { points, reason });
  createNotification({
    userId,
    type: "points_adjustment",
    title: "Ajuste de puntos",
    message: `${points > 0 ? "Se han añadido" : "Se han restado"} ${Math.abs(points)} puntos. Motivo: ${reason}`,
    entityType: "points_adjustment",
    entityId: Number(result.lastInsertRowid),
    link: "/clasificacion",
    eventKey: `adjustment:${result.lastInsertRowid}`
  });
  notifyNewTopThree(leaderboardBefore, `adjustment:${result.lastInsertRowid}`);
  res.status(201).json({ id: result.lastInsertRowid, user_id: userId, points, reason });
});
app.get("/api/admin/actions-log", requireAdmin, (req, res) => {
  const where = [], params = [];
  if (req.query.admin) { where.push("l.admin_user_id=?"); params.push(req.query.admin); }
  if (req.query.action_type) { where.push("l.action_type=?"); params.push(req.query.action_type); }
  if (req.query.entity_type) { where.push("l.entity_type=?"); params.push(req.query.entity_type); }
  if (req.query.date) { where.push("substr(l.created_at,1,10)=?"); params.push(req.query.date); }
  res.json(db.prepare(`
    SELECT l.*,u.username admin_username FROM admin_actions_log l LEFT JOIN users u ON u.id=l.admin_user_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.created_at DESC LIMIT 500
  `).all(...params));
});
app.post("/api/admin/auto-close-expired-matches", requireAdmin, (_req, res) => res.json({ closed: autoCloseExpired() }));
app.get("/api/admin/settings", requireAdmin, (_req, res) => res.json(settings()));
app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const allowed = ["pool_name", "winner_points", "exact_result_points", "auto_close_enabled", "auto_close_minutes_before"];
  const update = db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
  db.transaction(() => allowed.forEach((key) => { if (req.body[key] !== undefined) update.run(key, String(req.body[key]), now()); }))();
  logAction(req.user.id, "edit_settings", "settings", null, "Configuración actualizada", null, settings());
  res.json(settings());
});

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});
