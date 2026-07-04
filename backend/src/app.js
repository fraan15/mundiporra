import express from "express";
import cors from "cors";
import session from "express-session";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import convertHeic from "heic-convert";
import { db, initDatabase, logAction, now, settings } from "./db/database.js";
import { READ_ONLY_USER, hydrateUser, requireAdmin, requireAuth, requireWritableUser } from "./middleware/auth.js";
import { autoCloseExpired, calculateWinner, effectiveCloseAt, isExpired, recalculateAll, recalculateMatch, scheduleMatchCloseBackup } from "./services/matches.js";
import { createNotification, leaderboardRows, notifyAll, notifyAllExcept, notifyNewTopThree, saveRankingSnapshot } from "./services/notifications.js";
import { NO_SCORER, NO_SCORER_ID, parseScorerList, parseScorerSelection, serializeActualScorers, serializePredictedScorer } from "./services/scorers.js";
import { loadWorldCupReference, normalizePlayerName, syncWorldCupReference, teamReferenceStats, worldCupOverview } from "./services/worldcupReference.js";
import { getPushPreferences, pushConfigured, savePushSubscription, sendPushToUser, vapidPublicKey } from "./services/push.js";
import { espnEventMatches, getEspnEventById, getEspnLiveMatch } from "./services/espnLive.js";
import { espnMappingStatus, syncEspnMappings } from "./services/espnMapping.js";

initDatabase();
const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(here, "../../frontend/dist");
const avatarsDir = path.resolve(here, "../data/avatars");
const chatMediaDir = process.env.CHAT_MEDIA_DIR
  ? path.resolve(process.env.CHAT_MEDIA_DIR)
  : path.resolve(here, "../data/chat-media");
fs.mkdirSync(avatarsDir, { recursive: true });
fs.mkdirSync(chatMediaDir, { recursive: true });
let heicConversionActive = false;

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
app.use("/avatars", express.static(avatarsDir, { immutable: true, maxAge: "1y", fallthrough: false }));
app.use("/chat-media", express.static(chatMediaDir, { immutable: true, maxAge: "1y", fallthrough: false }));
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

const avatarUrl = (user) => user?.avatar_filename ? `/avatars/${user.avatar_filename}` : null;
const removeChatMediaFiles = (token) => {
  if (!/^(chat|comment)-\d+-\d+-[a-z0-9]+$/.test(token)) return;
  for (const suffix of [".webp", "-thumb.webp"]) fs.rm(path.join(chatMediaDir, `${token}${suffix}`), { force: true }, () => {});
};
const cleanAbandonedChatMedia = async () => {
  const referenced = new Set([...db.prepare("SELECT media_id FROM chat_messages WHERE media_provider='local' AND media_id IS NOT NULL").all(), ...db.prepare("SELECT media_id FROM match_comments WHERE media_provider='local' AND media_id IS NOT NULL").all()].map((item) => item.media_id));
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of await fs.promises.readdir(chatMediaDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".webp")) continue;
    const token = entry.name.replace(/-thumb\.webp$|\.webp$/, "");
    if (referenced.has(token)) continue;
    const stat = await fs.promises.stat(path.join(chatMediaDir, entry.name));
    if (stat.mtimeMs < cutoff) await fs.promises.rm(path.join(chatMediaDir, entry.name), { force: true });
  }
};
const safeUser = (user) => user && ({ id: user.id, username: user.username, display_name: user.display_name || user.username, role: user.role, active: user.active, is_read_only: Boolean(user.is_read_only), personal_phrase: user.personal_phrase || "", country_code: user.country_code === "GB" ? "GB" : "ES", avatar_url: avatarUrl(user), created_at: user.created_at });
const giphySearchLimit = Math.max(1, Number(process.env.GIPHY_SEARCHES_PER_USER_HOUR || 10));
const giphySearchWindows = new Map();
const giphySearchCache = new Map();
const GIPHY_WINDOW_MS = 60 * 60 * 1000;
const GIPHY_CACHE_MS = 10 * 60 * 1000;
const validGiphyUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "giphy.com" || url.hostname.endsWith(".giphy.com"));
  } catch { return false; }
};
const parseIntField = (value) => {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  return Number(value);
};
const MATCH_TIME_ZONE = "Europe/Madrid";
const madridDateTimeToIso = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  const target = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MATCH_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  });
  let instant = target;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value: part }) => [type, part]));
    const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instant += target - represented;
  }
  return new Date(instant).toISOString();
};
const normalizeMatchInstant = (value) => {
  try {
    const normalized = madridDateTimeToIso(String(value || "").trim());
    return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
  } catch {
    return null;
  }
};
const dateInTimeZone = (date = new Date(), timeZone = MATCH_TIME_ZONE) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const scoringTeamIds = (match, team1Goals, team2Goals) => [
  team1Goals > 0 ? match.team1_id : null,
  team2Goals > 0 ? match.team2_id : null
].filter(Boolean);
const unresolvedWorldCupTeam = (team) => !team?.fifa_code && /^(?:[123][A-L](?:\/[A-L])*|[WL]\d+)$/i.test(String(team?.source_name || team?.name_es || "").trim());
const parseOptionalPenalty = (value) => value === undefined || value === null || value === "" ? null : parseIntField(value);
const penaltySummary = (match) => {
  if (!Number(match.is_knockout) || match.result_team1 === null || match.result_team2 === null ||
      Number(match.result_team1) !== Number(match.result_team2) ||
      match.penalty_team1 === null || match.penalty_team2 === null) return null;
  const p1 = Number(match.penalty_team1), p2 = Number(match.penalty_team2);
  if (!Number.isInteger(p1) || !Number.isInteger(p2) || p1 === p2) return null;
  return {
    winner: p1 > p2 ? "team1" : "team2",
    winner_name: p1 > p2 ? match.team1 : match.team2,
    score: `${p1}-${p2}`,
    text: `Tras penaltis: gana ${p1 > p2 ? match.team1 : match.team2} ${p1}-${p2}`
  };
};
const settingBooleanValue = (value) => value === true || value === 1 || value === "1" ? "1" : "0";
const requestBoolean = (value) => value === true || value === 1 || value === "1";
const hasOwnGoalFlag = (value) => value === true || value === 1 || value === "1";
const matchPayload = (body, existing = {}) => {
  const date = body.match_date ?? existing.match_date;
  const time = body.match_time ?? existing.match_time;
  const autoClose = normalizeMatchInstant(body.auto_close_at || `${date}T${time}:00`);
  return {
    match_date: date, match_time: time,
    team1_id: body.team1_id === undefined ? existing.team1_id : Number(body.team1_id),
    team2_id: body.team2_id === undefined ? existing.team2_id : Number(body.team2_id),
    team1: String(body.team1 ?? existing.team1 ?? "").trim(),
    team2: String(body.team2 ?? existing.team2 ?? "").trim(),
    stadium_id: body.stadium_id === undefined ? existing.stadium_id : body.stadium_id ? Number(body.stadium_id) : null,
    auto_close_at: autoClose,
    force_published: body.force_published === undefined ? Number(existing.force_published || 0) : body.force_published ? 1 : 0,
    is_star: body.is_star === undefined ? Number(existing.is_star || 0) : body.is_star ? 1 : 0,
    is_knockout: body.is_knockout === undefined ? Number(existing.is_knockout || 0) : requestBoolean(body.is_knockout) ? 1 : 0,
    scorer_enabled: body.scorer_enabled === undefined
      ? Number(existing.id ? existing.scorer_enabled : body.team1_id && body.team2_id ? 1 : 0)
      : body.scorer_enabled ? 1 : 0
  };
};
const predictionWinner = (g1, g2) => g1 === g2 ? "draw" : g1 > g2 ? "team1" : "team2";
const predictionValidation = (match, prediction) => {
  if (!prediction?.id) return { result_valid: false, scorer_required: false, scorer_valid: false };
  const g1 = Number(prediction.predicted_team1_goals);
  const g2 = Number(prediction.predicted_team2_goals);
  const resultValid = Number.isInteger(g1) && g1 >= 0 &&
    Number.isInteger(g2) && g2 >= 0 &&
    ["team1", "team2", "draw"].includes(prediction.predicted_winner) &&
    predictionWinner(g1, g2) === prediction.predicted_winner;
  const scorerRequired = Boolean(Number(match.scorer_enabled));
  let scorerValid = !scorerRequired;
  if (scorerRequired && resultValid) {
    if (g1 + g2 === 0) {
      scorerValid = !prediction.predicted_scorer_id;
    } else if (prediction.predicted_scorer_id) {
      const allowedTeamIds = scoringTeamIds(match, g1, g2);
      scorerValid = Boolean(db.prepare(`
        SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
        WHERE p.id=? AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
      `).get(prediction.predicted_scorer_id, ...allowedTeamIds));
    }
  }
  return { result_valid: resultValid, scorer_required: scorerRequired, scorer_valid: scorerValid };
};
const matchStartsAt = (match) => new Date(normalizeMatchInstant(`${match.match_date}T${match.match_time}:00`));
const matchPublishesAt = (match) => new Date(matchStartsAt(match).getTime() - 24 * 60 * 60 * 1000);
const isMatchPublished = (match, current = new Date()) => Boolean(match.force_published) || current >= matchPublishesAt(match);
const canAccessMatch = (req, match) => req.user.role === "admin" || isMatchPublished(match);
const ALLOWED_REACTION_EMOJIS = ["❤️", "😂", "🔥", "🤡", "👀", "😭", "👏"];
const REACTION_TARGET_TYPES = new Set(["prediction", "match_comment"]);
const emptyReactionSummary = () => Object.fromEntries(ALLOWED_REACTION_EMOJIS.map((emoji) => [emoji, { count: 0, reacted: false }]));
const reactionSummary = (targetType, targetId, userId) => {
  const summary = emptyReactionSummary();
  db.prepare(`
    SELECT r.emoji,r.user_id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename
    FROM reactions r JOIN users u ON u.id=r.user_id
    WHERE r.target_type=? AND r.target_id=? ORDER BY r.created_at,u.username
  `).all(targetType, targetId).forEach((row) => {
    if (!summary[row.emoji]) return;
    summary[row.emoji].count += 1;
    summary[row.emoji].reacted ||= row.user_id === userId;
    summary[row.emoji].users ||= [];
    summary[row.emoji].users.push({ id: row.user_id, username: row.username, avatar_url: avatarUrl(row) });
  });
  Object.values(summary).forEach((reaction) => { reaction.users ||= []; });
  return summary;
};
const reactionTarget = (req, targetType, targetId) => {
  if (targetType === "prediction") return db.prepare(`
    SELECT p.id,p.user_id target_user_id,m.id target_match_id,m.* FROM predictions p JOIN matches m ON m.id=p.match_id WHERE p.id=?
  `).get(targetId);
  if (targetType === "match_comment") return db.prepare(`
    SELECT c.id,c.user_id target_user_id,m.id target_match_id,m.* FROM match_comments c JOIN matches m ON m.id=c.match_id WHERE c.id=?
  `).get(targetId);
  return null;
};
const validateReactionTarget = (req, targetType, targetId) => {
  const target = reactionTarget(req, targetType, targetId);
  if (!target || !canAccessMatch(req, target)) return { status: 404, error: "Objetivo no encontrado." };
  if (targetType === "prediction" && target.status === "open" && !isExpired(target)) {
    return { status: 403, error: "Las apuestas todavía no se han revelado." };
  }
  return { target };
};
const isMatchInPlay = (match, current = new Date()) => {
  if (match.status === "finished") return false;
  const startedAt = matchStartsAt(match);
  return current >= startedAt;
};
const rowsById = (table, ids, columns = "*") => {
  const uniqueIds = [...new Set(ids.filter(Boolean).map(Number))];
  if (!uniqueIds.length) return new Map();
  const rows = db.prepare(`SELECT ${columns} FROM ${table} WHERE id IN (${uniqueIds.map(() => "?").join(",")})`).all(...uniqueIds);
  return new Map(rows.map((row) => [row.id, row]));
};
const serializeMatches = (matches) => {
  if (!matches.length) return [];
  const teams = rowsById("teams", matches.flatMap((match) => [match.team1_id, match.team2_id]));
  const stadiums = rowsById("stadiums", matches.map((match) => match.stadium_id));
  const predictedScorers = rowsById(
    "players",
    matches.map((match) => match.predicted_scorer_id),
    "id,name,position,team_fifa_code"
  );
  const matchIds = matches.map((match) => match.id);
  const scorerRows = db.prepare(`
    SELECT ms.match_id,p.id,p.name,p.position,p.team_fifa_code
    FROM match_scorers ms JOIN players p ON p.id=ms.player_id
    WHERE ms.match_id IN (${matchIds.map(() => "?").join(",")})
    ORDER BY p.name
  `).all(...matchIds);
  const scorersByMatch = new Map();
  scorerRows.forEach(({ match_id, ...player }) => {
    if (!scorersByMatch.has(match_id)) scorersByMatch.set(match_id, []);
    scorersByMatch.get(match_id).push(player);
  });
  return matches.map((match) => ({
    ...match,
    team1_team: teams.get(match.team1_id) || null,
    team2_team: teams.get(match.team2_id) || null,
    stadium_info: stadiums.get(match.stadium_id) || null,
    predicted_scorer: serializePredictedScorer(match, predictedScorers.get(match.predicted_scorer_id)),
    actual_scorers: serializeActualScorers(match, scorersByMatch.get(match.id) || []),
    penalty_summary: penaltySummary(match),
    published: isMatchPublished(match),
    publishes_at: matchPublishesAt(match).toISOString(),
    effective_close_at: effectiveCloseAt(match).toISOString(),
    betting_open: isMatchPublished(match) && match.status === "open" && !isExpired(match) && !isMatchInPlay(match),
    in_play: isMatchInPlay(match)
  }));
};
const serializeMatch = (match) => serializeMatches([match])[0];

const matchListSelect = `
  SELECT m.*, COUNT(bettor.id) prediction_count,
    mine.id prediction_id, mine.predicted_winner, mine.predicted_team1_goals, mine.predicted_team2_goals,
    mine.predicted_scorer_id,mine.winner_points, mine.exact_result_points,mine.scorer_points,mine.total_points
  FROM matches m
  LEFT JOIN predictions p ON p.match_id=m.id
  LEFT JOIN users bettor ON bettor.id=p.user_id AND bettor.role='user'
  LEFT JOIN predictions mine ON mine.match_id=m.id AND mine.user_id=?
`;
const matchListRows = (userId, where = "", params = []) => db.prepare(`
  ${matchListSelect}
  ${where}
  GROUP BY m.id ORDER BY m.match_date,m.match_time
`).all(userId, ...params);
const matchListForUser = (req, where = "", params = []) =>
  matchListRows(req.user.id, where, params).filter((match) => canAccessMatch(req, match));
const isBettingOpenForMatch = (match) => isMatchPublished(match) && match.status === "open" && !isExpired(match) && !isMatchInPlay(match);

const dashboardCalendarMatches = (matches, today = dateInTimeZone(new Date(), MATCH_TIME_ZONE)) => {
  const yesterday = addDays(today, -1);
  const later = addDays(today, 1);
  return matches.filter((match) =>
    match.match_date === today ||
    match.match_date === yesterday ||
    (match.status !== "finished" && match.match_date > today && match.match_date <= later) ||
    isBettingOpenForMatch(match)
  );
};

const activityBaseSql = `
  SELECT * FROM (
    SELECT 'prediction' type,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename,m.team1,m.team2,NULL total_points,
      p.created_at,NULL winner_points,NULL exact_result_points,NULL scorer_points,p.id event_id,m.is_star,1 scoring_multiplier,
      NULL predicted_scorer_name
    FROM predictions p
    JOIN users u ON u.id=p.user_id
    JOIN matches m ON m.id=p.match_id
    UNION ALL
    SELECT 'points' type,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename,m.team1,m.team2,p.total_points,
      p.updated_at created_at,p.winner_points,p.exact_result_points,p.scorer_points,p.id event_id,m.is_star,p.scoring_multiplier,
      CASE
        WHEN p.predicted_team1_goals=0 AND p.predicted_team2_goals=0 THEN 'Sin goleador'
        ELSE player.name
      END predicted_scorer_name
    FROM predictions p
    JOIN users u ON u.id=p.user_id
    JOIN matches m ON m.id=p.match_id
    LEFT JOIN players player ON player.id=p.predicted_scorer_id
    WHERE p.total_points>0
  )
`;

const activityPointLabel = (points) => `${points} ${points === 1 ? "punto" : "puntos"}`;
const activityPointsBreakdown = (item) => {
  if (item.type !== "points") return null;
  const multiplier = Number(item.scoring_multiplier || 1);
  const rules = [
    ["Ganador", "acierto de ganador", Number(item.winner_points || 0), null],
    ["Resultado exacto", "acierto exacto", Number(item.exact_result_points || 0), null],
    ["Goleador", "goleador", Number(item.scorer_points || 0), item.predicted_scorer_name]
  ].filter(([, , points]) => points > 0);
  const baseRules = rules.map(([label, description, points, detail]) => ({
    label,
    detail,
    description,
    points,
    base_points: points / multiplier,
    earned_points: points
  }));
  const baseTotal = baseRules.reduce((total, rule) => total + rule.base_points, 0);
  return {
    is_star: Boolean(item.is_star),
    multiplier,
    base_total: baseTotal,
    total: Number(item.total_points || 0),
    rules: baseRules,
    formula: multiplier > 1
      ? `(${baseRules.map((rule) => rule.base_points).join(" + ")}) x ${multiplier} = ${item.total_points}`
      : `${baseTotal} = ${item.total_points}`
  };
};
const activityPointsText = (item) => {
  const hits = [
    Number(item.winner_points || 0) > 0 && "ganador",
    Number(item.exact_result_points || 0) > 0 && "resultado exacto",
    Number(item.scorer_points || 0) > 0 && "goleador"
  ].filter(Boolean);
  const hitText = hits.length ? ` por acertar ${hits.join(" + ")}` : "";
  return `${item.username} ganó ${activityPointLabel(item.total_points)}${item.is_star ? " en Partido Estrella" : ""}${hitText}`;
};
const serializeActivityItems = (items) => items.map((item) => ({
  ...item,
  avatar_url: avatarUrl(item),
  text: item.type === "points"
    ? activityPointsText(item)
    : `${item.username} registró un pronóstico en ${item.team1} - ${item.team2}`,
  points_breakdown: activityPointsBreakdown(item)
}));
const activityPage = (page, pageSize) => {
  const limitedActivitySql = `
    SELECT * FROM (${activityBaseSql})
    ORDER BY created_at DESC,event_id DESC
    LIMIT 50
  `;
  const total = db.prepare(`SELECT COUNT(*) total FROM (${limitedActivitySql})`).get().total;
  const items = db.prepare(`
    SELECT * FROM (${limitedActivitySql})
    ORDER BY created_at DESC,event_id DESC
    LIMIT ? OFFSET ?
  `).all(pageSize, (page - 1) * pageSize);
  return {
    items: serializeActivityItems(items),
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize))
  };
};

const selectedMatchEntities = (data) => {
  const team1 = data.team1_id ? db.prepare("SELECT * FROM teams WHERE id=?").get(data.team1_id) : null;
  const team2 = data.team2_id ? db.prepare("SELECT * FROM teams WHERE id=?").get(data.team2_id) : null;
  const stadium = data.stadium_id ? db.prepare("SELECT * FROM stadiums WHERE id=?").get(data.stadium_id) : null;
  return { team1, team2, stadium };
};

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (username.toLowerCase() === READ_ONLY_USER.username && password === (process.env.READ_ONLY_PASSWORD || "mundial2026")) {
    req.session.userId = null;
    req.session.readOnlyUser = true;
    return res.json({ user: safeUser(READ_ONLY_USER) });
  }
  const user = db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(username);
  if (!user || !user.active || user.password !== password) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos, o cuenta desactivada." });
  }
  req.session.readOnlyUser = false;
  req.session.userId = user.id;
  res.json({ user: safeUser(user) });
});
app.post("/api/auth/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/auth/me", (req, res) => res.json({ user: safeUser(req.user), settings: settings(), client_ip: req.clientIp }));

app.get("/api/teams", requireAuth, (req, res) => {
  const search = String(req.query.search || "").trim();
  res.json(search
    ? db.prepare("SELECT * FROM teams WHERE name LIKE ? COLLATE NOCASE OR fifa_code LIKE ? COLLATE NOCASE ORDER BY name LIMIT 30").all(`%${search}%`, `%${search}%`)
    : db.prepare("SELECT * FROM teams ORDER BY group_name,name").all());
});
app.get("/api/teams/:id/detail", requireAuth, (req, res) => {
  const team = db.prepare("SELECT * FROM teams WHERE id=?").get(req.params.id);
  if (!team) return res.status(404).json({ error: "Equipo no encontrado." });
  const players = db.prepare(`
    SELECT id,name,number,position,date_of_birth FROM players WHERE team_fifa_code=?
    ORDER BY CASE position WHEN 'POR' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MED' THEN 3 WHEN 'DEL' THEN 4 ELSE 5 END,number,name
  `).all(team.fifa_code);
  const storedMatches = db.prepare(`
    SELECT id,match_date,match_time,result_team1,result_team2,team1,team2,team1_id,team2_id
    FROM matches WHERE (team1_id=? OR team2_id=?) AND result_team1 IS NOT NULL AND result_team2 IS NOT NULL
    ORDER BY match_date DESC,match_time DESC
  `).all(team.id, team.id);
  const storedMatchIds = storedMatches.map((match) => match.id);
  const scorerRows = storedMatchIds.length ? db.prepare(`
    SELECT ms.match_id,p.name,p.team_fifa_code
    FROM match_scorers ms JOIN players p ON p.id=ms.player_id
    WHERE ms.match_id IN (${storedMatchIds.map(() => "?").join(",")})
    ORDER BY p.name
  `).all(...storedMatchIds) : [];
  const scorersByMatch = new Map();
  scorerRows.forEach(({ match_id, ...scorer }) => {
    if (!scorersByMatch.has(match_id)) scorersByMatch.set(match_id, []);
    scorersByMatch.get(match_id).push(scorer);
  });
  const manualStats = storedMatches.reduce((summary, match) => {
    const home = match.team1_id === team.id;
    const goalsFor = home ? match.result_team1 : match.result_team2;
    const goalsAgainst = home ? match.result_team2 : match.result_team1;
    summary.played++;
    summary.goals_for += goalsFor;
    summary.goals_against += goalsAgainst;
    if (goalsFor > goalsAgainst) summary.won++;
    else if (goalsFor < goalsAgainst) summary.lost++;
    else summary.drawn++;
    return summary;
  }, { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 });
  manualStats.goal_difference = manualStats.goals_for - manualStats.goals_against;
  manualStats.points = manualStats.won * 3 + manualStats.drawn;
  manualStats.win_percentage = manualStats.played ? Math.round(manualStats.won / manualStats.played * 100) : 0;
  const manualRecentMatches = storedMatches.slice(0, 10).map((match) => {
    const home = match.team1_id === team.id;
    const goals_for = home ? match.result_team1 : match.result_team2;
    const goals_against = home ? match.result_team2 : match.result_team1;
    const matchScorers = scorersByMatch.get(match.id) || [];
    return { ...match, opponent: home ? match.team2 : match.team1, goals_for, goals_against,
      scorers: {
        team: matchScorers.filter((scorer) => scorer.team_fifa_code === team.fifa_code).map(({ name }) => ({ name, minute: "" })),
        opponent: matchScorers.filter((scorer) => scorer.team_fifa_code !== team.fifa_code).map(({ name }) => ({ name, minute: "" }))
      },
      outcome: goals_for > goals_against ? "W" : goals_for < goals_against ? "L" : "D" };
  });
  const manualTopScorers = [...scorerRows
    .filter((scorer) => scorer.team_fifa_code === team.fifa_code)
    .reduce((scorers, scorer) => {
      const current = scorers.get(scorer.name) || { name: scorer.name, goals: 0 };
      current.goals += 1;
      scorers.set(scorer.name, current);
      return scorers;
    }, new Map()).values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "es"))
    .slice(0, 3);
  const playerNames = new Map(players.map((player) => [normalizePlayerName(player.name), player.name]));
  const reference = teamReferenceStats(team, playerNames);
  res.json({
    team,
    stats: reference?.stats || manualStats,
    players,
    recent_matches: reference?.recent_matches || manualRecentMatches,
    top_scorers: reference?.top_scorers || manualTopScorers,
    stats_source: reference?.source || "manual_results",
    stats_synced_at: reference?.synced_at || null
  });
});
app.get("/api/players", requireAuth, (req, res) => {
  const codes = String(req.query.team_fifa_codes || req.query.team_fifa_code || "").split(",").map((code) => code.trim()).filter(Boolean);
  const search = String(req.query.search || "").trim();
  const where = [], params = [];
  if (codes.length) { where.push(`p.team_fifa_code IN (${codes.map(() => "?").join(",")})`); params.push(...codes); }
  if (search) { where.push("p.name LIKE ? COLLATE NOCASE"); params.push(`%${search}%`); }
  res.json(db.prepare(`
    SELECT p.*,t.name team_name,t.flag_icon FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.name,p.number,p.name LIMIT 100
  `).all(...params));
});
app.get("/api/stadiums", requireAuth, (req, res) => {
  const search = String(req.query.search || "").trim();
  res.json(search
    ? db.prepare("SELECT * FROM stadiums WHERE name LIKE ? COLLATE NOCASE OR city LIKE ? COLLATE NOCASE ORDER BY name LIMIT 30").all(`%${search}%`, `%${search}%`)
    : db.prepare("SELECT * FROM stadiums ORDER BY name").all());
});

app.get("/api/matches", requireAuth, (req, res) => {
  autoCloseExpired();
  res.json(serializeMatches(matchListForUser(req)));
});

app.get("/api/matches/summary", requireAuth, (req, res) => {
  autoCloseExpired();
  const today = dateInTimeZone(new Date(), MATCH_TIME_ZONE);
  const matches = matchListForUser(req, "WHERE m.match_date>=? OR m.status='open'", [today]);
  const visible = serializeMatches(matches);
  res.json({
    today: visible.filter((match) => match.match_date === today).length,
    upcoming: visible.filter((match) => match.match_date !== today && match.status !== "finished" && !match.in_play).length,
    pending: req.user.is_read_only ? 0 : visible.filter((match) => match.betting_open && !match.prediction_id).length,
    history: db.prepare("SELECT COUNT(*) count FROM matches WHERE status='finished'").get().count
  });
});

app.get("/api/matches/today", requireAuth, (req, res) => {
  autoCloseExpired();
  const today = dateInTimeZone(new Date(), MATCH_TIME_ZONE);
  const matches = matchListForUser(req, "WHERE m.match_date=? AND m.status!='finished'", [today]);
  res.json(serializeMatches(matches));
});

app.get("/api/matches/view/:view", requireAuth, (req, res) => {
  autoCloseExpired();
  const today = dateInTimeZone(new Date(), MATCH_TIME_ZONE);
  const view = req.params.view;
  if (view === "today") {
    return res.json(serializeMatches(matchListForUser(req, "WHERE m.match_date=?", [today])));
  }
  if (view === "upcoming") {
    const current = new Date();
    const matches = matchListForUser(req, "WHERE m.status!='finished' AND m.match_date>=? AND m.match_date<>?", [today, today])
      .filter((match) => !isMatchInPlay(match, current) && matchStartsAt(match) > current);
    return res.json(serializeMatches(matches));
  }
  if (view === "pending") {
    const matches = req.user.is_read_only ? [] : matchListForUser(req, "WHERE m.status='open'")
      .filter((match) => isBettingOpenForMatch(match) && !match.prediction_id);
    return res.json(serializeMatches(matches));
  }
  if (view === "history") {
    const date = String(req.query.date || "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0];
    if (!date) return res.status(400).json({ error: "Fecha de histórico no válida." });
    const matches = matchListForUser(req, "WHERE m.match_date=? AND m.status='finished'", [date]);
    return res.json(serializeMatches(matches));
  }
  res.status(404).json({ error: "Vista de partidos no encontrada." });
});

app.get("/api/admin/matches", requireAdmin, (req, res) => {
  const pageSize = Math.min(Math.max(Number.parseInt(req.query.page_size, 10) || 10, 1), 50);
  const requestedPage = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const filter = ["upcoming", "open", "closed", "finished"].includes(req.query.filter) ? req.query.filter : "all";
  const where = filter === "upcoming"
    ? "WHERE status IN ('open','closed')"
    : filter === "all" ? "" : "WHERE status=?";
  const params = filter === "all" || filter === "upcoming" ? [] : [filter];
  const total = db.prepare(`SELECT COUNT(*) count FROM matches ${where}`).get(...params).count;
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(requestedPage, totalPages);
  const matches = db.prepare(`
    SELECT * FROM matches ${where}
    ORDER BY
      CASE WHEN status='finished' THEN 1 ELSE 0 END,
      CASE WHEN status='finished' THEN match_date END DESC,
      CASE WHEN status='finished' THEN match_time END DESC,
      CASE WHEN status!='finished' THEN match_date END ASC,
      CASE WHEN status!='finished' THEN match_time END ASC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);
  res.json({
    matches: serializeMatches(matches),
    pagination: { page, page_size: pageSize, total, total_pages: totalPages },
    filter
  });
});

app.get("/api/admin/match-reference", requireAdmin, (req, res) => {
  const requestedDate = String(req.query.date || "").trim();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : dateInTimeZone();
  const to = addDays(from, 7);
  const catalog = loadWorldCupReference();
  const teams = new Map(db.prepare("SELECT id,fifa_code,name FROM teams").all().map((team) => [team.fifa_code, team]));
  const stadiums = new Map(db.prepare("SELECT id,name,city FROM stadiums").all().map((stadium) => [`${stadium.name}\n${stadium.city}`, stadium]));
  const existingMatches = db.prepare(`
    SELECT id,match_date,match_time,team1_id,team2_id,team1,team2,status
    FROM matches WHERE match_date BETWEEN ? AND ?
  `).all(from, to);
  const matches = catalog.matches
    .filter((match) => match.match_date >= from && match.match_date <= to)
    .map((match) => {
      const team1 = teams.get(match.team1.fifa_code) || null;
      const team2 = teams.get(match.team2.fifa_code) || null;
      const stadium = stadiums.get(`${match.stadium.name}\n${match.stadium.city}`) || null;
      const existing = team1 && team2 ? existingMatches.find((row) =>
        row.match_date === match.match_date &&
        ((row.team1_id === team1.id && row.team2_id === team2.id) ||
          (row.team1_id === team2.id && row.team2_id === team1.id))
      ) : null;
      const missing = [
        !team1 && {
          type: unresolvedWorldCupTeam(match.team1) ? "unresolved_team" : "team",
          label: match.team1.name_es
        },
        !team2 && {
          type: unresolvedWorldCupTeam(match.team2) ? "unresolved_team" : "team",
          label: match.team2.name_es
        },
        !stadium && { type: "stadium", label: match.stadium.name || match.stadium.city }
      ].filter(Boolean);
      return {
        reference_id: match.reference_id,
        round: match.round?.replace(/^Matchday /, "Jornada "),
        is_knockout: Boolean(match.is_knockout),
        group: match.group?.replace(/^Group /, "Grupo ") || null,
        match_date: match.match_date,
        match_time: match.match_time,
        starts_at: match.starts_at,
        team1: team1 || { id: null, name: match.team1.name_es },
        team2: team2 || { id: null, name: match.team2.name_es },
        stadium: stadium || { id: null, name: match.stadium.name, city: match.stadium.city },
        existing_match: existing,
        selectable: true,
        complete: missing.length === 0,
        missing
      };
    });
  res.json({ from, to, timezone: catalog.display_timezone, matches });
});

const emptyMedals = { badges: [], badge_catalog: [], disputed_badges: [] };
const POINT_BADGE_TIERS = [
  { threshold: 100, level: 1, order: 50, icon: "🏆", name: "Centenario", description: () => "Ha llegado a 100 puntos acumulados o más." },
  { threshold: 200, level: 2, order: 50, icon: "💎", name: "Ritmo de podio", description: () => "Ha llegado a 200 puntos acumulados o más." },
  { threshold: 300, level: 3, order: 50, icon: "🏛️", name: "Aspirante a leyenda", description: () => "Ha llegado a 300 puntos acumulados o más." },
  { threshold: 375, level: 4, order: 50, icon: "🚀", name: "Temporada de élite", description: () => "Ha llegado a 375 puntos acumulados o más." }
];
const POINT_MILESTONE_THRESHOLDS = [50, 100, 150, 200, 250, 300, 350, 375];
const userStats = (userId, { includeMedals = false } = {}) => {
  const leaderboard = leaderboardRows();
  const row = leaderboard.find((item) => item.id === Number(userId));
  if (!row) return null;
  const badgeGroups = [
    { group: "exact", value: Number(row.exact_hits || 0), title: "Resultados exactos", tiers: [
      { threshold: 1, level: 1, order: 10, icon: "🥇", name: "Primer exacto", description: () => "Ha acertado su primer resultado exacto." },
      { threshold: 3, level: 2, order: 10, icon: "🎯", name: "Especialista exacto", description: () => "Ha conseguido 3 resultados exactos o más." },
      { threshold: 10, level: 3, order: 10, icon: "🏹", name: "Cazador exacto", description: () => "Ha conseguido 10 resultados exactos o más." },
      { threshold: 30, level: 4, order: 10, icon: "🧠", name: "Maestro exactos", description: () => "Ha conseguido 30 resultados exactos o más." },
      { threshold: 50, level: 5, order: 10, icon: "🌟", name: "Dios exactos", description: () => "Ha conseguido 50 resultados exactos o más." }
    ] },
    { group: "winner", value: Number(row.winner_hits || 0), title: "Ganadores acertados", tiers: [
      { threshold: 5, level: 1, order: 20, icon: "🔥", name: "Especialista en ganadores", description: () => "Ha acertado el ganador de 5 partidos o más." },
      { threshold: 15, level: 2, order: 20, icon: "🧭", name: "Cazador de ganadores", description: () => "Ha acertado el ganador de 15 partidos o más." },
      { threshold: 35, level: 3, order: 20, icon: "🦅", name: "Maestro de ganadores", description: () => "Ha acertado el ganador de 35 partidos o más." },
      { threshold: 60, level: 4, order: 20, icon: "⚡", name: "Dios de ganadores", description: () => "Ha acertado el ganador de 60 partidos o más." }
    ] },
    { group: "scorer", value: Number(row.scorer_hits || 0), title: "Goleadores acertados", tiers: [
      { threshold: 3, level: 1, order: 30, icon: "👟", name: "Especialista goleador", description: () => "Ha acertado 3 goleadores o más." },
      { threshold: 10, level: 2, order: 30, icon: "🥾", name: "Cazador goleador", description: () => "Ha acertado 10 goleadores o más." },
      { threshold: 25, level: 3, order: 30, icon: "⚽", name: "Maestro goleador", description: () => "Ha acertado 25 goleadores o más." },
      { threshold: 40, level: 4, order: 30, icon: "💫", name: "Dios goleador", description: () => "Ha acertado 40 goleadores o más." }
    ] },
    { group: "draw", value: 0, title: "Empates acertados", tiers: [
      { threshold: 3, level: 1, order: 40, icon: "🤝", name: "Especialista en empates", description: () => "Ha acertado 3 empates o más." },
      { threshold: 8, level: 2, order: 40, icon: "🧲", name: "Cazador de empates", description: () => "Ha acertado 8 empates o más." },
      { threshold: 15, level: 3, order: 40, icon: "🪄", name: "Maestro de empates", description: () => "Ha acertado 15 empates o más." },
      { threshold: 25, level: 4, order: 40, icon: "♾️", name: "Dios de empates", description: () => "Ha acertado 25 empates o más." }
    ] },
    { group: "points", value: Number(row.total_points || 0), title: "Puntos acumulados", tiers: POINT_BADGE_TIERS },
    { group: "participation", value: Number(row.predicted_matches || 0), title: "Partidos participados", tiers: [
      { threshold: 10, level: 1, order: 60, icon: "📋", name: "Constante", description: () => "Ha participado en 10 partidos finalizados o más." },
      { threshold: 30, level: 2, order: 60, icon: "🗓️", name: "Fijo en la porra", description: () => "Ha participado en 30 partidos finalizados o más." },
      { threshold: 60, level: 3, order: 60, icon: "🧱", name: "Incombustible", description: () => "Ha participado en 60 partidos finalizados o más." },
      { threshold: 100, level: 4, order: 60, icon: "🫡", name: "Leyenda constante", description: () => "Ha participado en 100 partidos finalizados o más." }
    ] }
  ];
  const tierBadge = (value, group, tiers) => {
    const tier = [...tiers].reverse().find((item) => value >= item.threshold);
    return tier ? {
      icon: tier.icon,
      name: tier.name,
      kind: `tier ${group} tier-${tier.level}`,
      group,
      level: tier.level,
      order: tier.order,
      value,
      tiers: tiers.map((item) => ({ ...item, achieved: value >= item.threshold })),
      description: tier.description(value)
    } : null;
  };
  const position = leaderboard.findIndex((item) => item.id === Number(userId)) + 1;
  const buildDynamicBadges = () => {
    const awards = new Map(leaderboard.map((item) => [item.id, []]));
    const add = (id, badge) => awards.get(id)?.push(badge);
    const pointRows = db.prepare(`
      SELECT p.user_id,p.total_points,m.id match_id,m.match_date,m.match_time
      FROM predictions p JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
      WHERE m.status='finished' AND u.active=1 AND u.role='user'
      ORDER BY m.match_date,m.match_time,m.id,p.user_id
    `).all();
    const totals = new Map(leaderboard.map((item) => [item.id, 0]));
    const thresholdWinners = new Map();
    for (let index = 0; index < pointRows.length;) {
      const matchId = pointRows[index].match_id;
      const matchRows = [];
      while (index < pointRows.length && pointRows[index].match_id === matchId) matchRows.push(pointRows[index++]);

      for (const prediction of matchRows) {
        totals.set(prediction.user_id,
          (totals.get(prediction.user_id) || 0) + Number(prediction.total_points || 0));
      }
      for (const threshold of POINT_MILESTONE_THRESHOLDS) {
        if (thresholdWinners.has(threshold)) continue;
        const winners = matchRows
          .filter((prediction) => (totals.get(prediction.user_id) || 0) >= threshold)
          .map((prediction) => prediction.user_id);
        if (winners.length) thresholdWinners.set(threshold, winners);
      }
    }
    for (const [threshold, winnerIds] of thresholdWinners) winnerIds.forEach((winnerId) => add(winnerId, {
      icon: "🏁", name: `Primero en ${threshold} puntos`, kind: "milestone",
      group: "record", level: POINT_MILESTONE_THRESHOLDS.indexOf(threshold) + 1, order: 80 + POINT_MILESTONE_THRESHOLDS.indexOf(threshold),
      description: `Fue de los primeros jugadores en alcanzar ${threshold} puntos acumulados.`
    }));

    const dailyRecords = db.prepare(`
      SELECT p.user_id,m.match_date,SUM(p.total_points) points
      FROM predictions p JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
      WHERE m.status='finished' AND u.active=1 AND u.role='user'
      GROUP BY p.user_id,m.match_date ORDER BY points DESC,p.user_id
    `).all();
    const dailyRecord = Number(dailyRecords[0]?.points || 0);
    if (dailyRecord > 0) dailyRecords.filter((item) => Number(item.points) === dailyRecord).forEach((item) =>
      add(item.user_id, { icon: "⚡", name: `Récord diario · ${dailyRecord} pts`, kind: "record", group: "record", level: 9, order: 79, disputed: true, description: `Tiene la mejor jornada registrada, con ${dailyRecord} puntos en un solo día.` })
    );

    const addStatLeader = ({ rows, field, icon, name, level, order, description }) => {
      const best = Number(rows[0]?.[field] || 0);
      if (best <= 0) return;
      rows.filter((item) => Number(item[field]) === best).forEach((item) =>
        add(item.user_id, { icon, name: `${name} · ${best}`, kind: "leader", group: "leader", level, order, description: description(best) })
      );
    };

    addStatLeader({
      rows: db.prepare(`
        SELECT p.user_id,COUNT(*) exacts FROM predictions p
        JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
        WHERE m.status='finished' AND p.exact_result_points>0 AND u.active=1 AND u.role='user'
        GROUP BY p.user_id ORDER BY exacts DESC,p.user_id
      `).all(),
      field: "exacts",
      icon: "🎯",
      name: "Rey del exacto",
      level: 8,
      order: 86,
      description: (best) => `Es quien más resultados exactos acumula: ${best}.`
    });

    addStatLeader({
      rows: db.prepare(`
        SELECT p.user_id,COUNT(*) signs FROM predictions p
        JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
        WHERE m.status='finished' AND p.winner_points>0 AND u.active=1 AND u.role='user'
        GROUP BY p.user_id ORDER BY signs DESC,p.user_id
      `).all(),
      field: "signs",
      icon: "✅",
      name: "Rey del signo",
      level: 8,
      order: 87,
      description: (best) => `Es quien más signos acertados acumula: ${best}.`
    });

    addStatLeader({
      rows: db.prepare(`
        SELECT p.user_id,COUNT(*) scorers FROM predictions p
        JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
        WHERE m.status='finished' AND p.scorer_points>0 AND u.active=1 AND u.role='user'
        GROUP BY p.user_id ORDER BY scorers DESC,p.user_id
      `).all(),
      field: "scorers",
      icon: "⚽",
      name: "Rey del goleador",
      level: 8,
      order: 88,
      description: (best) => `Es quien más goleadores acertados acumula: ${best}.`
    });

    const drawLeaders = db.prepare(`
      SELECT p.user_id,COUNT(*) draws FROM predictions p
      JOIN matches m ON m.id=p.match_id JOIN users u ON u.id=p.user_id
      WHERE m.status='finished' AND p.predicted_winner='draw' AND p.winner_points>0 AND u.active=1 AND u.role='user'
      GROUP BY p.user_id ORDER BY draws DESC,p.user_id
    `).all();
    const mostDraws = Number(drawLeaders[0]?.draws || 0);
    if (mostDraws > 0) drawLeaders.filter((item) => Number(item.draws) === mostDraws).forEach((item) =>
      add(item.user_id, { icon: "🤝", name: `Rey del empate · ${mostDraws}`, kind: "leader", group: "leader", level: 8, order: 89, description: `Es quien más empates acertados acumula: ${mostDraws}.` })
    );

    const topRows = db.prepare(`
      SELECT user_id,COUNT(*) snapshots
      FROM ranking_snapshots s
      JOIN users u ON u.id=s.user_id
      WHERE s.position=1 AND u.active=1 AND u.role='user'
      GROUP BY user_id ORDER BY snapshots DESC,user_id
    `).all();
    const topSnapshots = Number(topRows[0]?.snapshots || 0);
    if (topSnapshots > 0) topRows.filter((item) => Number(item.snapshots) === topSnapshots).forEach((item) =>
      add(item.user_id, { icon: "👑", name: "Más tiempo en top 1", kind: "leader", group: "leader", level: 9, order: 90, description: `Es quien más veces aparece como líder en el histórico de clasificación: ${topSnapshots} ${topSnapshots === 1 ? "día" : "días"}.` })
    );

    const lastRows = db.prepare(`
      SELECT s.user_id,COUNT(*) snapshots
      FROM ranking_snapshots s
      JOIN users u ON u.id=s.user_id
      JOIN (
        SELECT snapshot_date,MAX(position) last_position
        FROM ranking_snapshots
        GROUP BY snapshot_date
      ) last_by_day ON last_by_day.snapshot_date=s.snapshot_date AND last_by_day.last_position=s.position
      WHERE u.active=1 AND u.role='user'
      GROUP BY s.user_id ORDER BY snapshots DESC,s.user_id
    `).all();
    const lastSnapshots = Number(lastRows[0]?.snapshots || 0);
    if (lastSnapshots > 0) lastRows.filter((item) => Number(item.snapshots) === lastSnapshots).forEach((item) =>
      add(item.user_id, { icon: "🪵", name: "Más tiempo en último puesto", kind: "leader", group: "leader", level: 1, order: 92, description: `Es quien más veces aparece cerrando la clasificación en el histórico: ${lastSnapshots} ${lastSnapshots === 1 ? "día" : "días"}.` })
    );

    if (leaderboard.length) add(leaderboard.at(-1).id, { icon: "🤖", name: "Medalla del bot", kind: "leader", group: "leader", level: 1, order: 93, description: "Ocupa actualmente el último puesto de la clasificación." });
    return awards;
  };
  const finished = db.prepare(`
    SELECT p.*,m.match_date,m.team1,m.team2,m.winner,m.scorer_enabled FROM predictions p
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
  const draws = finished.filter((p) => p.predicted_winner === "draw" && p.winner_points > 0).length;
  const buildMedals = () => {
    const dynamicBadges = buildDynamicBadges();
    const groupsWithValues = badgeGroups.map((badgeGroup) =>
      badgeGroup.group === "draw" ? { ...badgeGroup, value: draws } : badgeGroup
    );
    const badgeTiers = groupsWithValues.map(({ value, group, tiers }) => tierBadge(value, group, tiers)).filter(Boolean);
    const badges = badgeTiers.sort((a, b) => a.order - b.order || b.level - a.level);
    badges.push(...(dynamicBadges.get(Number(userId)) || []));
    const disputedBadges = Array.from(dynamicBadges.entries()).flatMap(([holderId, holderBadges]) => {
      const holder = leaderboard.find((item) => item.id === holderId);
      return holderBadges.filter((badge) => badge.disputed || badge.kind === "leader").map((badge) => ({ ...badge, holder_id: holderId, holder: holder?.username || "Jugador" }));
    }).reduce((items, badge) => {
      const key = `${badge.name}-${badge.description}`;
      const existing = items.get(key);
      if (existing) {
        existing.holders.push(badge.holder);
        existing.achieved ||= badge.holder_id === Number(userId);
      } else {
        items.set(key, {
          icon: badge.icon,
          name: badge.name,
          kind: badge.kind,
          group: badge.group,
          level: badge.level,
          order: badge.order,
          description: badge.description,
          holders: [badge.holder],
          achieved: badge.holder_id === Number(userId)
        });
      }
      return items;
    }, new Map());
    const badgeCatalog = groupsWithValues.map(({ group, title, value, tiers }) => ({
      group, title, value, order: tiers[0]?.order || 99,
      tiers: tiers.map((tier) => ({ ...tier, achieved: value >= tier.threshold, description: tier.description(value) }))
    })).sort((a, b) => a.order - b.order);
    return {
      badges,
      badge_catalog: badgeCatalog,
      disputed_badges: Array.from(disputedBadges.values()).sort((a, b) =>
        Number(a.order ?? 99) - Number(b.order ?? 99) ||
        Number(b.level ?? 0) - Number(a.level ?? 0) ||
        String(a.name).localeCompare(String(b.name), "es")
      )
    };
  };
  const medals = includeMedals ? buildMedals() : emptyMedals;
  const scorerOpportunities = finished.filter((prediction) => Number(prediction.scorer_enabled)).length;
  const accuracyHits = Number(row.winner_hits || 0) + Number(row.exact_hits || 0) + Number(row.scorer_hits || 0);
  const accuracyOpportunities = (finished.length * 2) + scorerOpportunities;
  return {
    ...row, position, finished_matches: finished.length,
    winner_percentage: finished.length ? Math.round(row.winner_hits / finished.length * 100) : 0,
    exact_percentage: finished.length ? Math.round(row.exact_hits / finished.length * 100) : 0,
    accuracy_percentage: accuracyOpportunities ? Math.round(accuracyHits / accuracyOpportunities * 100) : 0,
    average_points: finished.length ? Number((row.total_points / finished.length).toFixed(1)) : 0,
    best_day: daily.sort((a,b) => b.points-a.points)[0] || null,
    worst_day: [...daily].sort((a,b) => a.points-b.points)[0] || null,
    most_picked_team: maxEntry(picks), best_team: maxEntry(teamPoints), daily, ...medals
  };
};

const pointsDetail = (userId, stats) => {
  const predictions = db.prepare(`
    SELECT p.id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,
      p.winner_points,p.exact_result_points,p.scorer_points,p.total_points,p.scoring_multiplier,
      p.predicted_scorer_id,player.name predicted_scorer_name,
      m.id match_id,m.team1,m.team2,m.match_date,m.match_time,m.status,m.winner,
      m.result_team1,m.result_team2,m.is_star,m.scorer_enabled
    FROM predictions p
    JOIN matches m ON m.id=p.match_id
    LEFT JOIN players player ON player.id=p.predicted_scorer_id
    WHERE p.user_id=? AND m.status='finished'
    ORDER BY m.match_date DESC,m.match_time DESC,m.id DESC
  `).all(userId);
  const adjustments = db.prepare(`
    SELECT a.id,a.points,a.reason,a.created_at,COALESCE(NULLIF(u.display_name,''),u.username) created_by_username
    FROM points_adjustments a
    LEFT JOIN users u ON u.id=a.created_by
    WHERE a.user_id=?
    ORDER BY a.created_at DESC,a.id DESC
  `).all(userId);
  const winnerLabel = (prediction, match) => {
    if (prediction === "draw") return "Empate";
    if (prediction === "team1") return match.team1;
    if (prediction === "team2") return match.team2;
    return "Sin ganador";
  };
  const rule = (label, points, explanation, matched) => ({
    label,
    points: Number(points || 0),
    base_points: Number(points || 0) / Number(explanation.multiplier || 1),
    matched,
    text: explanation.text
  });
  const matchRows = predictions.map((match) => {
    const multiplier = Number(match.scoring_multiplier || 1);
    const rules = [
      rule("Ganador", match.winner_points, {
        multiplier,
        text: match.winner_points > 0
          ? `Acerto el signo: ${winnerLabel(match.predicted_winner, match)}.`
          : `No acerto el signo. Pronostico ${winnerLabel(match.predicted_winner, match)} y salio ${winnerLabel(match.winner, match)}.`
      }, Number(match.winner_points || 0) > 0),
      rule("Resultado exacto", match.exact_result_points, {
        multiplier,
        text: match.exact_result_points > 0
          ? `Acerto el marcador exacto ${match.result_team1}-${match.result_team2}.`
          : `Pronostico ${match.predicted_team1_goals}-${match.predicted_team2_goals}; resultado real ${match.result_team1}-${match.result_team2}.`
      }, Number(match.exact_result_points || 0) > 0),
      rule("Goleador", match.scorer_points, {
        multiplier,
        text: !match.scorer_enabled
          ? "Este partido no tenia puntuacion de goleador."
          : match.scorer_points > 0
            ? `Acerto el goleador elegido: ${match.predicted_scorer_name || "Sin goleador"}.`
            : `No sumo por goleador${match.predicted_scorer_name ? ` con ${match.predicted_scorer_name}` : ""}.`
      }, Number(match.scorer_points || 0) > 0)
    ];
    const baseTotal = rules.reduce((total, item) => total + item.base_points, 0);
    return {
      id: match.id,
      match_id: match.match_id,
      team1: match.team1,
      team2: match.team2,
      match_date: match.match_date,
      match_time: match.match_time,
      status: match.status,
      result: `${match.result_team1}-${match.result_team2}`,
      prediction: `${match.predicted_team1_goals}-${match.predicted_team2_goals}`,
      predicted_winner_label: winnerLabel(match.predicted_winner, match),
      real_winner_label: winnerLabel(match.winner, match),
      predicted_scorer_name: match.predicted_scorer_name,
      is_star: Boolean(match.is_star),
      multiplier,
      base_total: baseTotal,
      total_points: Number(match.total_points || 0),
      rules,
      formula: multiplier > 1 ? `${baseTotal} base x ${multiplier} = ${match.total_points}` : `${baseTotal} = ${match.total_points}`
    };
  });
  const automaticTotal = matchRows.reduce((total, match) => total + match.total_points, 0);
  let runningMatchPoints = 0;
  [...matchRows]
    .sort((a, b) => {
      const dateCompare = new Date(`${a.match_date}T${a.match_time || "00:00:00"}`) - new Date(`${b.match_date}T${b.match_time || "00:00:00"}`);
      return dateCompare || Number(a.match_id) - Number(b.match_id);
    })
    .forEach((match) => {
      match.points_before = runningMatchPoints;
      runningMatchPoints += match.total_points;
      match.points_after = runningMatchPoints;
    });
  const adjustmentTotal = adjustments.reduce((total, adjustment) => total + Number(adjustment.points || 0), 0);
  return {
    total_points: Number(stats?.total_points || 0),
    automatic_points: automaticTotal,
    adjustment_points: adjustmentTotal,
    winner_points: Number(stats?.winner_points || 0),
    exact_result_points: Number(stats?.exact_result_points || 0),
    scorer_points: Number(stats?.scorer_points || 0),
    matches_with_points: matchRows.filter((match) => match.total_points > 0).length,
    matches_without_points: matchRows.filter((match) => match.total_points === 0).length,
    finished_matches: matchRows.length,
    matches: matchRows,
    adjustments
  };
};

app.get("/api/dashboard", requireAuth, (req, res) => {
  autoCloseExpired();
  const stats = userStats(req.user.id) || {
    position: "—", total_points: 0, exact_hits: 0, winner_hits: 0,
    predicted_matches: 0, average_points: 0
  };
  const today = dateInTimeZone(new Date(), MATCH_TIME_ZONE);
  const todayPoints = db.prepare(`
    SELECT COALESCE(SUM(p.total_points),0) points FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=? AND m.match_date=?
  `).get(req.user.id, today).points;
  const current = new Date();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const relevantMatches = matchListForUser(req, "WHERE (m.match_date BETWEEN ? AND ?) OR m.status!='finished'", [yesterday, tomorrow]);
  const inPlaySource = relevantMatches
    .filter((match) => match.status !== "finished" && match.match_date <= today && isMatchInPlay(match, current));
  const futureSource = relevantMatches
    .filter((match) => match.status !== "finished" && match.match_date >= today)
    .filter((match) => !isMatchInPlay(match, current) && matchStartsAt(match) > current);
  const pending = req.user.is_read_only ? 0 : relevantMatches
    .filter((match) => match.status === "open")
    .filter((match) => isBettingOpenForMatch(match) && !match.prediction_id).length;
  const inPlayMatches = serializeMatches(inPlaySource);
  const nextMatches = serializeMatches(futureSource);
  res.json({
    summary: { ...stats, today_points: todayPoints, pending },
    in_play_matches: inPlayMatches,
    next_match: nextMatches[0] || null,
    next_matches: nextMatches,
    activity_preview: activityPage(1, 5).items,
    calendar_today: today,
    calendar_matches: serializeMatches(dashboardCalendarMatches(relevantMatches, today))
  });
});

app.get("/api/dashboard/medals", requireAuth, (req, res) => {
  const stats = userStats(req.user.id, { includeMedals: true });
  res.json(stats ? {
    badges: stats.badges,
    badge_catalog: stats.badge_catalog,
    disputed_badges: stats.disputed_badges
  } : emptyMedals);
});

app.get("/api/dashboard/calendar", requireAuth, (req, res) => {
  autoCloseExpired();
  const today = dateInTimeZone(new Date(), MATCH_TIME_ZONE);
  const yesterday = addDays(today, -1);
  const later = addDays(today, 1);
  const candidates = matchListForUser(req, "WHERE (m.match_date BETWEEN ? AND ?) OR m.status='open'", [yesterday, later]);
  const matches = dashboardCalendarMatches(candidates, today);
  res.json({
    calendar_today: today,
    matches: serializeMatches(matches)
  });
});

app.get("/api/news", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.id,n.title,n.body,n.created_at,n.updated_at,
      r.read_at,
      COALESCE(NULLIF(u.display_name,''),u.username) created_by_name
    FROM news_items n LEFT JOIN users u ON u.id=n.created_by
    LEFT JOIN news_reads r ON r.news_id=n.id AND r.user_id=?
    WHERE n.published=1
    ORDER BY n.created_at DESC,n.id DESC
    LIMIT 30
  `).all(req.user.id);
  res.json({
    items: rows.map((row) => ({ ...row, read: Boolean(row.read_at) })),
    unread_count: rows.filter((row) => !row.read_at).length
  });
});

app.post("/api/news/:id/read", requireAuth, (req, res) => {
  const item = db.prepare("SELECT id FROM news_items WHERE id=? AND published=1").get(req.params.id);
  if (!item) return res.status(404).json({ error: "Novedad no encontrada." });
  db.prepare(`
    INSERT INTO news_reads(news_id,user_id,read_at) VALUES(?,?,?)
    ON CONFLICT(news_id,user_id) DO UPDATE SET read_at=excluded.read_at
  `).run(item.id, req.user.id, now());
  res.json({ ok: true });
});

app.post("/api/news/read-all", requireAuth, (req, res) => {
  const stamp = now();
  const rows = db.prepare("SELECT id FROM news_items WHERE published=1").all();
  const insert = db.prepare(`
    INSERT INTO news_reads(news_id,user_id,read_at) VALUES(?,?,?)
    ON CONFLICT(news_id,user_id) DO UPDATE SET read_at=excluded.read_at
  `);
  db.transaction(() => rows.forEach((item) => insert.run(item.id, req.user.id, stamp)))();
  res.json({ ok: true, count: rows.length });
});

app.get("/api/worldcup/overview", requireAuth, (_req, res) => {
  try {
    res.json(worldCupOverview());
  } catch {
    res.status(503).json({ error: "La informacion del Mundial aun no esta sincronizada." });
  }
});

app.get("/api/profile/me", requireAuth, (req, res) => {
  const stats = userStats(req.user.id) || {
    position: "—", total_points: 0, predicted_matches: 0, winner_hits: 0, exact_hits: 0,
    scorer_hits: 0, average_points: 0, winner_percentage: 0, exact_percentage: 0,
    accuracy_percentage: 0, best_day: null,
    worst_day: null, most_picked_team: "—", best_team: "—", daily: [], badges: []
  };
  res.json({
    user: req.user.is_read_only ? safeUser(req.user) : safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)),
    stats,
    points_detail: pointsDetail(req.user.id, stats),
    history: db.prepare("SELECT snapshot_date date,position,points FROM ranking_snapshots WHERE user_id=? ORDER BY snapshot_date").all(req.user.id)
  });
});
app.get("/api/profile/me/medals", requireAuth, (req, res) => {
  const stats = userStats(req.user.id, { includeMedals: true });
  res.json(stats ? {
    badges: stats.badges,
    badge_catalog: stats.badge_catalog,
    disputed_badges: stats.disputed_badges
  } : emptyMedals);
});
app.patch("/api/profile/me", requireAuth, requireWritableUser, (req, res) => {
  const phrase = String(req.body.personal_phrase || "").trim().slice(0, 120);
  const current = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  const displayName = req.body.display_name === undefined ? current.display_name : String(req.body.display_name).trim();
  const validatedDisplayName = displayName || current.username;
  const countryCode = req.body.country_code === undefined ? current.country_code || "ES" : String(req.body.country_code).toUpperCase();
  if (!["ES", "GB"].includes(countryCode)) {
    return res.status(400).json({ error: "Selecciona un país válido." });
  }
  if (validatedDisplayName.length < 2 || validatedDisplayName.length > 40 || /[\x00-\x1F\x7F]/.test(validatedDisplayName)) {
    return res.status(400).json({ error: "El nombre visible debe tener entre 2 y 40 caracteres y no contener saltos de línea." });
  }
  const changed = displayName !== current.display_name;
  if (changed) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const count = db.prepare("SELECT COUNT(*) count FROM display_name_changes WHERE user_id=? AND changed_at>=?").get(req.user.id, since).count;
    if (count >= 3) return res.status(429).json({ error: "Has alcanzado el límite de 3 cambios de nombre en 24 horas." });
  }
  const stamp = now();
  db.transaction(() => {
    db.prepare("UPDATE users SET display_name=?,personal_phrase=?,country_code=?,updated_at=? WHERE id=?").run(displayName, phrase, countryCode, stamp, req.user.id);
    if (changed) db.prepare("INSERT INTO display_name_changes(user_id,previous_name,new_name,changed_at) VALUES(?,?,?,?)").run(req.user.id, current.display_name || current.username, displayName, stamp);
  })();
  res.json(safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)));
});
app.put(
  "/api/profile/avatar",
  requireAuth,
  requireWritableUser,
  express.raw({ type: "*/*", limit: "5mb" }),
  async (req, res, next) => {
    try {
      await cleanAbandonedChatMedia();
      const contentType = String(req.get("content-type") || "").split(";")[0].toLowerCase();
      const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (!allowedTypes.has(contentType)) {
        return res.status(415).json({
          error: `Tipo de archivo no válido (${contentType || "desconocido"}). Usa una imagen JPEG, PNG o WebP.`
        });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "El archivo está vacío. Selecciona una imagen JPEG, PNG o WebP." });
      }
      const image = sharp(req.body, { failOn: "warning", limitInputPixels: 40_000_000 });
      const metadata = await image.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format)) {
        return res.status(415).json({ error: "El contenido del archivo no corresponde a una imagen JPEG, PNG o WebP válida." });
      }
      if (!metadata.width || !metadata.height) {
        return res.status(400).json({ error: "No se han podido leer las dimensiones de la imagen." });
      }
      if (metadata.width < 100 || metadata.height < 100) {
        return res.status(400).json({ error: "La imagen es demasiado pequeña. Debe medir al menos 100 × 100 píxeles." });
      }
      if (metadata.width * metadata.height > 40_000_000) {
        return res.status(400).json({ error: "La imagen tiene demasiada resolución. El máximo permitido es de 40 megapíxeles." });
      }
      if ((metadata.pages || 1) > 1) {
        return res.status(400).json({ error: "No se permiten imágenes animadas. Selecciona una imagen estática." });
      }
      const filename = `user-${req.user.id}-${Date.now()}.webp`;
      await image.rotate().resize(400, 400, { fit: "cover", position: "attention" }).webp({ quality: 82 })
        .toFile(path.join(avatarsDir, filename));

      const current = db.prepare("SELECT avatar_filename FROM users WHERE id=?").get(req.user.id);
      db.prepare("UPDATE users SET avatar_filename=?,updated_at=? WHERE id=?").run(filename, now(), req.user.id);
      if (current?.avatar_filename && current.avatar_filename !== filename) {
        fs.rm(path.join(avatarsDir, path.basename(current.avatar_filename)), { force: true }, () => {});
      }
      res.json(safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)));
    } catch (error) {
      if (error?.name === "InputBufferError" || error?.message?.includes("unsupported image format")) {
        return res.status(400).json({ error: "El archivo está dañado, incompleto o no contiene una imagen compatible." });
      }
      if (error?.message?.includes("Input image exceeds pixel limit")) {
        return res.status(400).json({ error: "La imagen tiene demasiada resolución. El máximo permitido es de 40 megapíxeles." });
      }
      next(error);
    }
  }
);

app.delete("/api/chat/image/:token", requireAuth, requireWritableUser, (req, res) => {
  const token = String(req.params.token || "");
  if (!token.startsWith(`chat-${req.user.id}-`) || !/^chat-\d+-\d+-[a-z0-9]+$/.test(token)) return res.status(400).json({ error: "Imagen no válida." });
  if (db.prepare("SELECT id FROM chat_messages WHERE media_provider='local' AND media_id=?").get(token)) return res.status(409).json({ error: "La imagen ya pertenece a un mensaje." });
  removeChatMediaFiles(token);
  res.json({ ok: true });
});
app.delete("/api/profile/avatar", requireAuth, requireWritableUser, (req, res) => {
  const current = db.prepare("SELECT avatar_filename FROM users WHERE id=?").get(req.user.id);
  db.prepare("UPDATE users SET avatar_filename=NULL,updated_at=? WHERE id=?").run(now(), req.user.id);
  if (current?.avatar_filename) {
    fs.rm(path.join(avatarsDir, path.basename(current.avatar_filename)), { force: true }, () => {});
  }
  res.json(safeUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)));
});
app.patch("/api/profile/password", requireAuth, requireWritableUser, (req, res) => {
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
  const user = db.prepare("SELECT id,username,display_name,role,personal_phrase,avatar_filename,created_at FROM users WHERE id=? AND active=1").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  const predictions = db.prepare(`
    SELECT p.*,m.team1,m.team2,m.match_date,m.status,m.result_team1,m.result_team2
    FROM predictions p JOIN matches m ON m.id=p.match_id
    WHERE p.user_id=? AND (m.status!='open' OR m.auto_close_at<=?) ORDER BY m.match_date DESC,m.match_time DESC
  `).all(user.id, now());
  const stats = userStats(user.id);
  res.json({ user: { ...user, avatar_url: avatarUrl(user) }, stats, points_detail: pointsDetail(user.id, stats), predictions, history: db.prepare("SELECT snapshot_date date,position,points FROM ranking_snapshots WHERE user_id=? ORDER BY snapshot_date").all(user.id) });
});
app.get("/api/users/:id/public/medals", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(req.params.id);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado." });
  const stats = userStats(user.id, { includeMedals: true });
  res.json(stats ? {
    badges: stats.badges,
    badge_catalog: stats.badge_catalog,
    disputed_badges: stats.disputed_badges
  } : emptyMedals);
});

app.get("/api/activity", requireAuth, (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.page_size) || 10, 1), 30);
  res.json(activityPage(page, pageSize));
});

app.get("/api/chat/mentions", requireAuth, (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 50);
  if (query.length < 2) return res.json([]);
  const like = `%${query}%`;
  const users = db.prepare(`
    SELECT id,username,COALESCE(NULLIF(display_name,''),username) display_name,avatar_filename
    FROM users WHERE active=1 AND (username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE)
    ORDER BY CASE WHEN username LIKE ? COLLATE NOCASE OR display_name LIKE ? COLLATE NOCASE THEN 0 ELSE 1 END,
      display_name COLLATE NOCASE LIMIT 8
  `).all(like, like, `${query}%`, `${query}%`);
  res.json(users.map((item) => ({ ...item, avatar_url: avatarUrl(item) })));
});

const chatImageChunks = new Map();
const processChatImage = async (req, res, next, body, contentType, scope = "chat") => {
    try {
      const heic = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]).has(contentType);
      if ((!heic && !new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) || !Buffer.isBuffer(body) || !body.length) {
        return res.status(415).json({ error: "Selecciona una imagen JPEG, PNG, WebP, HEIC o HEIF válida." });
      }
      if (heic && heicConversionActive) return res.status(503).json({ error: "Se está procesando otra foto HEIC. Inténtalo de nuevo en unos segundos." });
      let imageBuffer = body;
      if (heic) {
        heicConversionActive = true;
        try {
          imageBuffer = Buffer.from(await convertHeic({ buffer: body, format: "JPEG", quality: 0.88 }));
        } catch {
          return res.status(400).json({ error: "No se pudo leer la foto HEIC/HEIF. Puede estar dañada o usar una variante no compatible." });
        } finally {
          heicConversionActive = false;
        }
      }
      const source = sharp(imageBuffer, { failOn: "warning", limitInputPixels: 60_000_000 }).rotate();
      const metadata = await source.metadata();
      if (!metadata.width || !metadata.height || (metadata.pages || 1) > 1) return res.status(400).json({ error: "La imagen no es válida o es animada." });
      if (metadata.width * metadata.height > 60_000_000) return res.status(400).json({ error: "La imagen supera el máximo de 60 megapíxeles." });
      const token = `${scope}-${req.user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
      const filename = `${token}.webp`, previewFilename = `${token}-thumb.webp`;
      const full = await source.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(chatMediaDir, filename));
      await source.clone().resize(420, 420, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toFile(path.join(chatMediaDir, previewFilename));
      res.json({ type: "image", provider: "local", id: token, url: `/chat-media/${filename}`, preview_url: `/chat-media/${previewFilename}`, width: full.width, height: full.height });
    } catch (error) {
      if (error?.message?.includes("Input image exceeds pixel limit")) return res.status(400).json({ error: "La imagen supera el máximo de 60 megapíxeles." });
      if (error?.name === "InputBufferError" || error?.message?.includes("unsupported image format")) return res.status(400).json({ error: "No se pudo leer la imagen. Puede estar dañada o usar una variante no compatible." });
      next(error);
    }
};

app.put(
  "/api/chat/image",
  requireAuth,
  requireWritableUser,
  express.raw({ type: "*/*", limit: "12mb" }),
  (req, res, next) => processChatImage(req, res, next, req.body, String(req.get("content-type") || "").split(";")[0].toLowerCase())
);

app.put(
  "/api/chat/image-chunk",
  requireAuth,
  requireWritableUser,
  express.raw({ type: "*/*", limit: "800kb" }),
  async (req, res, next) => {
    const uploadId = String(req.get("x-upload-id") || ""), index = Number(req.get("x-chunk-index")), total = Number(req.get("x-chunk-total"));
    const contentType = String(req.get("x-file-type") || "").toLowerCase(), key = `${req.user.id}:${uploadId}`;
    if (!/^[a-z0-9-]{8,80}$/i.test(uploadId) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 24 || index >= total || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Fragmento de imagen no válido." });
    const current = chatImageChunks.get(key) || { chunks: [], size: 0, contentType, expires: Date.now() + 5 * 60 * 1000 };
    if (index !== current.chunks.length || contentType !== current.contentType) { chatImageChunks.delete(key); return res.status(409).json({ error: "La subida se ha interrumpido. Vuelve a seleccionar la imagen." }); }
    current.chunks.push(req.body); current.size += req.body.length;
    if (current.size > 12 * 1024 * 1024) { chatImageChunks.delete(key); return res.status(413).json({ error: "La imagen no puede superar los 12 MB." }); }
    chatImageChunks.set(key, current);
    for (const [pendingKey, pending] of chatImageChunks) if (pending.expires < Date.now()) chatImageChunks.delete(pendingKey);
    if (index < total - 1) return res.json({ received: index + 1 });
    chatImageChunks.delete(key);
    return processChatImage(req, res, next, Buffer.concat(current.chunks, current.size), contentType);
  }
);

app.put("/api/comments/image", requireAuth, requireWritableUser, express.raw({ type: "*/*", limit: "12mb" }),
  (req, res, next) => processChatImage(req, res, next, req.body, String(req.get("content-type") || "").split(";")[0].toLowerCase(), "comment"));

app.put("/api/comments/image-chunk", requireAuth, requireWritableUser, express.raw({ type: "*/*", limit: "800kb" }), async (req, res, next) => {
  const uploadId = String(req.get("x-upload-id") || ""), index = Number(req.get("x-chunk-index")), total = Number(req.get("x-chunk-total"));
  const contentType = String(req.get("x-file-type") || "").toLowerCase(), key = `comment:${req.user.id}:${uploadId}`;
  if (!/^[a-z0-9-]{8,80}$/i.test(uploadId) || !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 24 || index >= total || !Buffer.isBuffer(req.body)) return res.status(400).json({ error: "Fragmento de imagen no válido." });
  const current = chatImageChunks.get(key) || { chunks: [], size: 0, contentType, expires: Date.now() + 5 * 60 * 1000 };
  if (index !== current.chunks.length || contentType !== current.contentType) { chatImageChunks.delete(key); return res.status(409).json({ error: "La subida se ha interrumpido. Vuelve a seleccionar la imagen." }); }
  current.chunks.push(req.body); current.size += req.body.length;
  if (current.size > 12 * 1024 * 1024) { chatImageChunks.delete(key); return res.status(413).json({ error: "La imagen no puede superar los 12 MB." }); }
  chatImageChunks.set(key, current);
  if (index < total - 1) return res.json({ received: index + 1 });
  chatImageChunks.delete(key);
  return processChatImage(req, res, next, Buffer.concat(current.chunks, current.size), contentType, "comment");
});

app.delete("/api/comments/image/:token", requireAuth, requireWritableUser, (req, res) => {
  const token = String(req.params.token || "");
  if (!token.startsWith(`comment-${req.user.id}-`) || !/^comment-\d+-\d+-[a-f0-9]+$/.test(token)) return res.status(400).json({ error: "Imagen no válida." });
  if (db.prepare("SELECT id FROM match_comments WHERE media_provider='local' AND media_id=?").get(token)) return res.status(409).json({ error: "La imagen ya pertenece a un comentario." });
  removeChatMediaFiles(token); res.json({ ok: true });
});

app.get("/api/chat", requireAuth, (req, res) => {
  const aroundId = Math.max(0, Number(req.query.around) || 0);
  const selectMessages = (where, order, limit) => db.prepare(`
    SELECT c.id,c.message,c.created_at,c.reply_to_id,c.reply_deleted,c.media_type,c.media_provider,c.media_id,c.media_url,c.media_preview_url,c.media_width,c.media_height,u.id user_id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename,
      parent.message reply_message,parent.media_type reply_media_type,parent.media_preview_url reply_media_preview_url,parent.media_url reply_media_url,
      COALESCE(NULLIF(parent_user.display_name,''),parent_user.username) reply_username
    FROM chat_messages c
    JOIN users u ON u.id=c.user_id
    LEFT JOIN chat_messages parent ON parent.id=c.reply_to_id
    LEFT JOIN users parent_user ON parent_user.id=parent.user_id
    ${where} ORDER BY c.id ${order} LIMIT ${limit}
  `).all(aroundId);
  let messages;
  if (aroundId) {
    if (!db.prepare("SELECT id FROM chat_messages WHERE id=?").get(aroundId)) return res.status(404).json({ error: "El mensaje original ya no está disponible." });
    messages = [...selectMessages("WHERE c.id<=?", "DESC", 13).reverse(), ...selectMessages("WHERE c.id>?", "ASC", 12)];
  } else {
    messages = selectMessages("WHERE ?>=0", "DESC", 25).reverse();
  }
  res.json(messages.map((message) => ({ ...message, avatar_url: avatarUrl(message) })));
});
app.post("/api/chat", requireAuth, requireWritableUser, (req, res) => {
  const message = String(req.body.message || "").trim().slice(0, 500);
  const media = req.body.media && typeof req.body.media === "object" ? req.body.media : null;
  const mediaType = ["gif", "sticker", "image"].includes(media?.type) ? media.type : null;
  const replyToId = req.body.reply_to_id ? Number(req.body.reply_to_id) : null;
  if (!message && !mediaType) return res.status(400).json({ error: "Escribe un mensaje o selecciona un archivo." });
  if (["gif", "sticker"].includes(mediaType) && (!media.id || !validGiphyUrl(media.url))) return res.status(400).json({ error: "El GIF o sticker no es válido." });
  if (mediaType === "image" && (media.provider !== "local" || !String(media.id || "").startsWith(`chat-${req.user.id}-`) || !/^\/chat-media\/chat-[\w.-]+\.webp$/.test(media.url || "") || !/^\/chat-media\/chat-[\w.-]+-thumb\.webp$/.test(media.preview_url || "") || !fs.existsSync(path.join(chatMediaDir, path.basename(media.url))))) return res.status(400).json({ error: "La imagen no es válida." });
  const repliedMessage = replyToId ? db.prepare("SELECT id,user_id FROM chat_messages WHERE id=?").get(replyToId) : null;
  if (replyToId && !repliedMessage) {
    return res.status(400).json({ error: "El mensaje al que respondes ya no existe." });
  }
  const result = db.prepare(`INSERT INTO chat_messages(user_id,reply_to_id,message,media_type,media_provider,media_id,media_url,media_preview_url,media_width,media_height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, replyToId, message, mediaType, mediaType === "image" ? "local" : mediaType ? "giphy" : null, mediaType ? String(media.id).slice(0, 100) : null, mediaType ? media.url : null, mediaType ? (media.preview_url || media.url) : null, mediaType ? Math.max(1, Math.min(2000, Number(media.width) || 480)) : null, mediaType ? Math.max(1, Math.min(2000, Number(media.height) || 360)) : null, now());
  const senderName = req.user.display_name || req.user.username;
  const recipients = new Map();
  if (repliedMessage && repliedMessage.user_id !== req.user.id) recipients.set(repliedMessage.user_id, "reply");
  const mentionTokens = new Set([...message.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((match) => match[1].toLocaleLowerCase("es")));
  if (mentionTokens.size) {
    for (const mentioned of db.prepare("SELECT id,username,COALESCE(NULLIF(display_name,''),username) display_name FROM users WHERE active=1 AND id<>?").all(req.user.id)) {
      const aliases = [mentioned.username, mentioned.display_name.replace(/\s+/g, "_")].map((value) => value.toLocaleLowerCase("es"));
      if (aliases.some((alias) => mentionTokens.has(alias)) && !recipients.has(mentioned.id)) recipients.set(mentioned.id, "mention");
    }
  }
  for (const [userId, reason] of recipients) createNotification({
    userId,
    type: reason === "reply" ? "chat_reply" : "chat_mention",
    title: reason === "reply" ? "Nueva respuesta en el chat" : "Te han mencionado en el chat",
    message: reason === "reply" ? `${senderName} ha respondido a tu mensaje.` : `${senderName} te ha mencionado en un mensaje.`,
    entityType: "chat_message",
    entityId: result.lastInsertRowid,
    link: `/chat?message=${result.lastInsertRowid}`,
    eventKey: `chat-${reason}:${result.lastInsertRowid}:${userId}`
  });
  const expired = db.prepare(`
    WITH retained AS (
      SELECT id,reply_to_id FROM chat_messages ORDER BY created_at DESC,id DESC LIMIT 25
    )
    SELECT id,media_url,media_preview_url FROM chat_messages
    WHERE id NOT IN (SELECT id FROM retained)
      AND id NOT IN (SELECT reply_to_id FROM retained WHERE reply_to_id IS NOT NULL)
  `).all();
  if (expired.length) {
    db.prepare(`DELETE FROM chat_messages WHERE id IN (${expired.map(() => "?").join(",")})`).run(...expired.map((item) => item.id));
    for (const item of expired) for (const url of [item.media_url, item.media_preview_url]) if (url?.startsWith("/chat-media/")) fs.rm(path.join(chatMediaDir, path.basename(url)), { force: true }, () => {});
  }
  void cleanAbandonedChatMedia().catch(() => {});
  res.status(201).json({ id: result.lastInsertRowid });
});
app.delete("/api/chat/:id", requireAuth, requireWritableUser, (req, res) => {
  const row = db.prepare("SELECT * FROM chat_messages WHERE id=?").get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "No puedes eliminar este mensaje." });
  db.transaction(() => {
    db.prepare("UPDATE chat_messages SET reply_deleted=1,reply_to_id=NULL WHERE reply_to_id=?").run(row.id);
    db.prepare("DELETE FROM chat_messages WHERE id=?").run(row.id);
  })();
  if (row.media_provider === "local" && row.media_id) removeChatMediaFiles(row.media_id);
  res.json({ ok: true });
});
app.get("/api/chat/status", requireAuth, (req, res) => {
  const lastRead = db.prepare("SELECT last_read_message_id FROM chat_reads WHERE user_id=?").get(req.user.id)?.last_read_message_id || 0;
  const unread = db.prepare("SELECT COUNT(*) count FROM chat_messages WHERE id>? AND user_id!=?").get(lastRead, req.user.id).count;
  res.json({ unread, last_read_message_id: lastRead });
});
app.post("/api/chat/read", requireAuth, requireWritableUser, (req, res) => {
  const lastMessageId = db.prepare("SELECT COALESCE(MAX(id),0) id FROM chat_messages").get().id;
  db.prepare(`
    INSERT INTO chat_reads(user_id,last_read_message_id,read_at) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id,read_at=excluded.read_at
  `).run(req.user.id, lastMessageId, now());
  res.json({ ok: true, last_read_message_id: lastMessageId });
});

app.get("/api/matches/:id/detail", requireAuth, (req, res) => {
  const match = db.prepare(`
    SELECT m.*,p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,
      p.predicted_scorer_id,p.winner_points,p.exact_result_points,p.scorer_points,p.total_points,p.scoring_multiplier
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=? WHERE m.id=?
  `).get(req.user.id, req.params.id);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  const open = match.status === "open" && !isExpired(match);
  const participantCount = db.prepare(`
    SELECT COUNT(*) count FROM predictions p
    JOIN users u ON u.id=p.user_id
    WHERE p.match_id=? AND u.role='user'
  `).get(match.id).count;
  const participantStatusRows = () => db.prepare(`
    SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename,
      CASE WHEN p.id IS NULL THEN 0 ELSE 1 END participating,
      p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.predicted_scorer_id
    FROM users u
    LEFT JOIN predictions p ON p.user_id=u.id AND p.match_id=?
    WHERE u.active=1 AND u.role='user'
    ORDER BY participating ASC,u.username
  `).all(match.id).map((participant) => participant.participating
    ? {
      id: participant.id,
      username: participant.username,
      avatar_url: avatarUrl(participant),
      participating: Boolean(participant.participating),
      ...predictionValidation(match, participant)
    }
    : { id: participant.id, username: participant.username, avatar_url: avatarUrl(participant), participating: Boolean(participant.participating) });
  const participants = open
    ? participantStatusRows().filter((participant) => req.user.role === "admin" || !participant.participating)
    : db.prepare(`
    SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.avatar_filename,
      CASE WHEN p.id IS NULL THEN 0 ELSE 1 END participating,
      p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.predicted_scorer_id,
      player.name predicted_scorer_name,p.scorer_points,p.total_points
    FROM users u
    LEFT JOIN predictions p ON p.user_id=u.id AND p.match_id=?
    LEFT JOIN players player ON player.id=p.predicted_scorer_id
    WHERE u.active=1 AND u.role='user'
    ORDER BY participating DESC,
      p.predicted_team1_goals DESC,
      p.predicted_team2_goals DESC,
      u.username
  `).all(match.id).map((participant) => {
    const { avatar_filename: _avatarFilename, ...publicParticipant } = participant;
    const participantWithAvatar = {
      ...publicParticipant,
      avatar_url: avatarUrl(participant),
      participating: Boolean(participant.participating)
    };
    return participant.participating &&
      participant.predicted_team1_goals === 0 &&
      participant.predicted_team2_goals === 0
      ? { ...participantWithAvatar, predicted_scorer_id: NO_SCORER_ID, predicted_scorer_name: NO_SCORER.name }
      : participantWithAvatar;
  });
  const distribution = open ? [] : db.prepare(
    "SELECT predicted_winner winner,COUNT(*) count FROM predictions WHERE match_id=? GROUP BY predicted_winner"
  ).all(match.id);
  res.json({ match: serializeMatch(match), participants, participant_count: participantCount, revealed: !open, distribution });
});

const playerNameTokens = (name) => normalizePlayerName(name).split(" ").filter(Boolean);
const sideFromTeamCode = (teamCode, match) =>
  teamCode === match.team1_fifa_code ? "team1" : teamCode === match.team2_fifa_code ? "team2" : null;
const mapEspnPlayerById = (espnId, players) => {
  const id = String(espnId || "");
  return id ? players.find((player) => String(player.espn_id || "") === id) || null : null;
};
const mapEspnPlayer = (name, teamCode, players) => {
  const normalized = normalizePlayerName(name);
  let candidates = players.filter((player) =>
    (!teamCode || player.team_fifa_code === teamCode) && normalizePlayerName(player.name) === normalized
  );
  if (candidates.length === 1) return candidates[0];
  const tokens = playerNameTokens(name), surname = tokens.at(-1);
  if (!surname || surname.length < 4) return null;
  candidates = players.filter((player) => {
    if (teamCode && player.team_fifa_code !== teamCode) return false;
    const playerTokens = playerNameTokens(player.name);
    return playerTokens.at(-1) === surname &&
      (!tokens[0] || !playerTokens[0] || tokens[0][0] === playerTokens[0][0]);
  });
  return candidates.length === 1 ? candidates[0] : null;
};
const enrichLivePlayers = (live, match) => {
  if (!live) return live;
  const teamCodes = [match.team1_fifa_code, match.team2_fifa_code].filter(Boolean);
  const players = teamCodes.length ? db.prepare(`
    SELECT id,name,team_fifa_code,espn_id FROM players
    WHERE team_fifa_code IN (${teamCodes.map(() => "?").join(",")})
  `).all(...teamCodes) : [];
  const codeByEspnTeamId = new Map((live.competitors || []).map((team) => [String(team.id), team.code]));
  const timeline = (live.timeline || []).map((item) => {
    const teamCode = item.team_code || codeByEspnTeamId.get(String(item.team_id));
    const mappedAthletes = (item.athletes || []).map((name, index) => {
      const player = mapEspnPlayerById(item.athlete_ids?.[index], players) || mapEspnPlayer(name, teamCode, players);
      return { espn_name: name, player_id: player?.id || null, player_name: player?.name || null, team_fifa_code: player?.team_fifa_code || null };
    });
    const inferredTeamCode = teamCode || mappedAthletes[0]?.team_fifa_code || "";
    return {
      ...item,
      team_code: inferredTeamCode,
      side: sideFromTeamCode(inferredTeamCode, match),
      mapped_athletes: mappedAthletes,
      scorer_player_id: item.scoring && !item.own_goal ? mappedAthletes[0]?.player_id || null : null,
    };
  });
  const timelineById = new Map(timeline.map((item) => [String(item.id), item]));
  const goals = (live.goals || timeline.filter((item) => item.scoring)).map((goal) => {
    const item = timelineById.get(String(goal.id)) || goal;
    const teamCode = goal.team_code || item.team_code || codeByEspnTeamId.get(String(goal.team_id));
    const espnName = goal.espn_name || goal.scorer_name || item.athletes?.[0] || "Goleador sin identificar";
    const mapped = item.mapped_athletes?.[0] || mapEspnPlayerById(goal.espn_athlete_id || item.athlete_ids?.[0], players) || mapEspnPlayer(espnName, teamCode, players);
    const resolvedTeamCode = teamCode || mapped?.team_fifa_code || "";
    const mappedPlayerId = mapped?.player_id ?? mapped?.id ?? null;
    const mappedPlayerName = mapped?.player_name ?? mapped?.name ?? null;
    return {
      ...goal,
      team_code: resolvedTeamCode,
      side: sideFromTeamCode(resolvedTeamCode, match),
      scorer_name: mappedPlayerName || espnName,
      espn_name: espnName,
      player_id: mappedPlayerId,
      player_name: mappedPlayerName,
      scorer_player_id: !goal.own_goal ? mappedPlayerId : null,
    };
  });
  const byCode = new Map((live.competitors || []).map((team) => [team.code, team]));
  const feedScore = {
    team1: Number(byCode.get(match.team1_fifa_code)?.score ?? live.score?.team1 ?? 0),
    team2: Number(byCode.get(match.team2_fifa_code)?.score ?? live.score?.team2 ?? 0),
  };
  const goalScore = goals.reduce((score, goal) => {
    let side = goal.side;
    if (goal.own_goal) side = side === "team1" ? "team2" : side === "team2" ? "team1" : side;
    if (side) score[side] += 1;
    return score;
  }, { team1: 0, team2: 0 });
  const score = feedScore.team1 + feedScore.team2 === 0 && goalScore.team1 + goalScore.team2 > 0
    ? goalScore
    : feedScore;
  return {
    ...live,
    timeline,
    score,
    goals,
    scorer_player_ids: [...new Set(goals.filter((goal) => goal.scorer_player_id).map((goal) => goal.scorer_player_id))],
    unmatched_scorers: [...new Set(goals.filter((goal) => !goal.own_goal && !goal.scorer_player_id && goal.espn_name !== "Goleador sin identificar").map((goal) => goal.espn_name))],
  };
};
const asTestReplay = (live, match) => {
  const localTeamNames = new Map([
    [match.team1_fifa_code, match.team1],
    [match.team2_fifa_code, match.team2],
  ]);
  return {
    ...live,
    test_mode: true,
    source_completed: live.completed,
    state: "in",
    completed: false,
    status: "Modo prueba ESPN",
    competitors: (live.competitors || []).map((team, index) => {
      const localCode = localTeamNames.has(team.code)
        ? team.code
        : index === 0 ? match.team1_fifa_code : match.team2_fifa_code;
      return {
        ...team,
        code: localCode,
        name: localTeamNames.get(localCode) || team.name,
      };
    }),
  };
};
const liveTestCache = new Map();

const liveMatchRow = (id) => db.prepare(`
  SELECT m.*,home.fifa_code team1_fifa_code,away.fifa_code team2_fifa_code
  FROM matches m
  LEFT JOIN teams home ON home.id=m.team1_id
  LEFT JOIN teams away ON away.id=m.team2_id
  WHERE m.id=?
`).get(id);

const loadLiveMatch = async (match) => {
  if (match.status === "finished" && !match.live_test_enabled) {
    return { available: false, live: null, stale: false, espn_completed: Boolean(match.live_completed_at), live_completed_at: match.live_completed_at || null };
  }
  let cached = (() => {
    try { return match.live_data_json ? JSON.parse(match.live_data_json) : null; } catch { return null; }
  })();
  if (cached && !espnEventMatches(cached, { ...match, starts_at: matchStartsAt(match).toISOString() })) {
    db.prepare("UPDATE matches SET espn_event_id=NULL,live_data_json=NULL,live_updated_at=NULL,live_completed_at=NULL WHERE id=?").run(match.id);
    match.espn_event_id = null;
    match.live_data_json = null;
    match.live_updated_at = null;
    match.live_completed_at = null;
    cached = null;
  }
  const cacheAge = match.live_updated_at ? Date.now() - new Date(match.live_updated_at).getTime() : Infinity;
  if (match.live_test_enabled && match.live_test_event_id) {
    try {
      const cachedReplay = liveTestCache.get(match.live_test_event_id);
      const matchWithStart = { ...match, starts_at: matchStartsAt(match).toISOString() };
      let sourceLive = cachedReplay && Date.now() - cachedReplay.at < 20000
        ? cachedReplay.live
        : null;
      if (!sourceLive) sourceLive = await getEspnEventById(match.live_test_event_id, matchWithStart);
      if (!espnEventMatches(sourceLive, matchWithStart)) {
        db.prepare("UPDATE matches SET live_test_enabled=0,live_test_event_id=NULL,updated_at=? WHERE id=?")
          .run(now(), match.id);
        return { available: false, live: null, stale: false, test_mode: false, error: "El evento ESPN guardado no coincide con este partido." };
      }
      liveTestCache.set(match.live_test_event_id, { at: Date.now(), live: sourceLive });
      const replay = enrichLivePlayers(asTestReplay(sourceLive, match), match);
      return { available: true, live: replay, stale: false, test_mode: true, espn_completed: Boolean(match.live_completed_at), live_completed_at: match.live_completed_at || null };
    } catch (error) {
      console.error(`[espn] No se pudo cargar el replay ${match.live_test_event_id}:`, error.message);
      return { available: false, live: null, stale: false, test_mode: true, error: "No se pudo cargar el evento de prueba." };
    }
  }
  if (match.live_completed_at && cached) {
    return { available: true, live: enrichLivePlayers(cached, match), stale: false, espn_completed: true, live_completed_at: match.live_completed_at };
  }
  if (cached?.completed || (cached && cacheAge < 20000)) {
    const cachedCompletion = cached.completed ? (match.live_completed_at || cached.fetched_at || now()) : null;
    if (cachedCompletion && !match.live_completed_at) {
      db.prepare("UPDATE matches SET live_completed_at=? WHERE id=?").run(cachedCompletion, match.id);
      match.live_completed_at = cachedCompletion;
    }
    return { available: true, live: enrichLivePlayers(cached, match), stale: false, espn_completed: Boolean(match.live_completed_at || cached.completed), live_completed_at: match.live_completed_at || null };
  }
  if (!isMatchInPlay(match)) {
    return { available: Boolean(cached), live: enrichLivePlayers(cached, match), stale: Boolean(cached), espn_completed: Boolean(match.live_completed_at || cached?.completed), live_completed_at: match.live_completed_at || null };
  }
  try {
    const live = enrichLivePlayers(await getEspnLiveMatch({
      ...match,
      starts_at: matchStartsAt(match).toISOString(),
    }), match);
    if (!live) return { available: false, live: enrichLivePlayers(cached, match), stale: Boolean(cached), espn_completed: Boolean(match.live_completed_at || cached?.completed), live_completed_at: match.live_completed_at || null };
    const completedAt = live.completed ? (match.live_completed_at || live.fetched_at || now()) : null;
    db.prepare(`
      UPDATE matches
      SET espn_event_id=?,
          live_data_json=?,
          live_updated_at=?,
          live_completed_at=CASE WHEN ? THEN COALESCE(live_completed_at, ?) ELSE live_completed_at END
      WHERE id=?
    `).run(live.event_id, JSON.stringify(live), live.fetched_at, live.completed ? 1 : 0, completedAt, match.id);
    if (completedAt) match.live_completed_at = completedAt;
    return { available: true, live, stale: false, espn_completed: Boolean(match.live_completed_at || live.completed), live_completed_at: match.live_completed_at || null };
  } catch (error) {
    console.error(`[espn] No se pudo actualizar el partido ${match.id}:`, error.message);
    return { available: Boolean(cached), live: enrichLivePlayers(cached, match), stale: Boolean(cached), espn_completed: Boolean(match.live_completed_at || cached?.completed), live_completed_at: match.live_completed_at || null };
  }
};

app.get("/api/matches/live-scores", requireAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const ids = [...new Set(String(req.query.ids || "").split(",").map((id) => Number(id)).filter(Number.isInteger))].slice(0, 20);
  if (!ids.length) return res.json({ items: {} });
  const items = {};
  for (const id of ids) {
    const match = liveMatchRow(id);
    if (!match || !canAccessMatch(req, match)) continue;
    const started = isMatchInPlay(match);
    if (match.status !== "closed" && !started && !match.live_test_enabled && !match.live_data_json) {
      items[id] = { available: false };
      continue;
    }
    const response = await loadLiveMatch(match);
    const live = response.live;
    items[id] = live ? {
      available: response.available,
      stale: response.stale,
      provider: live.provider,
      state: live.state,
      completed: live.completed,
      espn_completed: Boolean(response.espn_completed || match.live_completed_at || live.completed),
      live_completed_at: response.live_completed_at || match.live_completed_at || null,
      status: live.status,
      clock: live.clock,
      score: live.score,
      goals: live.goals || [],
      scorer_player_ids: live.scorer_player_ids || [],
      unmatched_scorers: live.unmatched_scorers || [],
      test_mode: live.test_mode || response.test_mode || false,
      source_completed: live.source_completed,
      fetched_at: live.fetched_at,
    } : { available: false, stale: response.stale, espn_completed: Boolean(response.espn_completed || match.live_completed_at), live_completed_at: response.live_completed_at || match.live_completed_at || null };
  }
  res.json({ items });
});

app.get("/api/matches/:id/live", requireAuth, async (req, res) => {
  const match = liveMatchRow(req.params.id);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  res.json(await loadLiveMatch(match));
});

app.patch("/api/admin/matches/:id/live-test", requireAdmin, async (req, res) => {
  const match = db.prepare(`
    SELECT m.*,home.fifa_code team1_fifa_code,away.fifa_code team2_fifa_code
    FROM matches m
    LEFT JOIN teams home ON home.id=m.team1_id
    LEFT JOIN teams away ON away.id=m.team2_id
    WHERE m.id=?
  `).get(req.params.id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  const enabled = requestBoolean(req.body.enabled);
  let eventId = String(req.body.event_id || "").trim();
  if (enabled && requestBoolean(req.body.auto_match)) {
    if (!match.team1_fifa_code || !match.team2_fifa_code) {
      return res.status(400).json({ error: "El partido necesita dos selecciones con código FIFA para buscarlo en ESPN." });
    }
    try {
      const discovered = await getEspnLiveMatch({
        ...match,
        starts_at: matchStartsAt(match).toISOString(),
        espn_event_id: null,
      });
      if (!discovered?.event_id) {
        return res.status(404).json({ error: "ESPN no tiene un evento real que coincida con la fecha y las dos selecciones de este partido." });
      }
      eventId = discovered.event_id;
      liveTestCache.set(eventId, {
        at: Date.now(),
        live: discovered,
      });
    } catch (error) {
      return res.status(502).json({ error: error.message?.startsWith("ESPN respondió")
        ? "ESPN no está disponible ahora mismo. Inténtalo de nuevo en unos minutos."
        : "No se pudo localizar este partido en ESPN." });
    }
  }
  if (!enabled) eventId = String(match.live_test_event_id || "").trim();
  if (enabled && !/^\d{4,12}$/.test(eventId)) return res.status(400).json({ error: "Introduce un ID numérico de evento ESPN válido." });
  if (enabled) {
    try {
      const matchWithStart = { ...match, starts_at: matchStartsAt(match).toISOString() };
      const live = await getEspnEventById(eventId, matchWithStart);
      if (!espnEventMatches(live, matchWithStart)) {
        return res.status(400).json({ error: "Ese evento ESPN no coincide con la fecha y las selecciones de este partido." });
      }
    } catch {
      return res.status(400).json({ error: "ESPN no reconoce ese evento o no está disponible." });
    }
  }
  db.prepare("UPDATE matches SET live_test_enabled=?,live_test_event_id=?,updated_at=? WHERE id=?")
    .run(enabled ? 1 : 0, eventId || null, now(), match.id);
  logAction(req.user.id, enabled ? "enable_live_test" : "disable_live_test", "match", match.id,
    enabled ? `Modo prueba ESPN activado con evento ${eventId}` : "Modo prueba ESPN desactivado", match, null);
  res.json({ ok: true, enabled, event_id: eventId || null });
});

const emptySimulationPoints = () => ({ winner_points: 0, exact_result_points: 0, scorer_points: 0, total_points: 0, winner_hits: 0, exact_hits: 0, scorer_hits: 0 });
const addSimulationPoints = (target, points) => {
  target.winner_points += Number(points.winner_points || 0);
  target.exact_result_points += Number(points.exact_result_points || 0);
  target.scorer_points += Number(points.scorer_points || 0);
  target.total_points += Number(points.total_points || 0);
  target.winner_hits += Number(points.winner_hits || 0);
  target.exact_hits += Number(points.exact_hits || 0);
  target.scorer_hits += Number(points.scorer_hits || 0);
};
const simulationForMatches = (req, items) => {
  const config = settings(), matches = [], totals = new Map(), perMatch = [];
  for (const item of items) {
    const match = db.prepare("SELECT * FROM matches WHERE id=?").get(item.match_id);
    if (!match || !canAccessMatch(req, match)) throw Object.assign(new Error("Partido no encontrado."), { status: 404 });
    if (match.status !== "closed" && !match.live_test_enabled) throw Object.assign(new Error("La simulación solo está disponible mientras el partido está en juego."), { status: 409 });
    if (!isMatchInPlay(match) && !match.live_test_enabled) throw Object.assign(new Error("El partido todavía no ha comenzado."), { status: 409 });
    const g1 = parseIntField(item.result_team1), g2 = parseIntField(item.result_team2);
    if (g1 === null || g2 === null) throw Object.assign(new Error("Introduce un marcador válido."), { status: 400 });
    const scorerIds = parseScorerList(item.scorer_ids);
    if (!scorerIds) throw Object.assign(new Error("Goleadores no válidos."), { status: 400 });
    const playerScorerIds = scorerIds.filter((value) => value !== NO_SCORER_ID);
    if (playerScorerIds.length) {
      const teams = db.prepare("SELECT fifa_code FROM teams WHERE id IN (?,?)").all(match.team1_id, match.team2_id).map(row => row.fifa_code);
      const valid = db.prepare(`SELECT id FROM players WHERE id IN (${playerScorerIds.map(() => "?").join(",")}) AND team_fifa_code IN (?,?)`).all(...playerScorerIds, ...teams);
      if (valid.length !== playerScorerIds.length) throw Object.assign(new Error("Goleador no válido para este partido."), { status: 400 });
    }
    const multiplier = match.is_star ? 2 : 1, winnerValue = calculateWinner(g1, g2), actualScorers = new Set(playerScorerIds);
    if (Number(match.scorer_enabled) && g1 === 0 && g2 === 0) actualScorers.add(NO_SCORER_ID);
    const predictions = db.prepare(`SELECT p.*,COALESCE(NULLIF(u.display_name,''),u.username) username FROM predictions p JOIN users u ON u.id=p.user_id WHERE p.match_id=?`).all(match.id);
    const matchPoints = new Map(predictions.map(prediction => {
      const predictedScorer = prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0 ? NO_SCORER_ID : prediction.predicted_scorer_id;
      const winnerPoints = (prediction.predicted_winner === winnerValue ? Number(config.winner_points || 3) : 0) * multiplier;
      const exactPoints = (prediction.predicted_team1_goals === g1 && prediction.predicted_team2_goals === g2 ? Number(config.exact_result_points || 5) : 0) * multiplier;
      const scorerPoints = (Number(match.scorer_enabled) && predictedScorer && actualScorers.has(predictedScorer) ? Number(config.scorer_points || 2) : 0) * multiplier;
      return [prediction.user_id, { winner_points: winnerPoints, exact_result_points: exactPoints, scorer_points: scorerPoints, total_points: winnerPoints + exactPoints + scorerPoints, winner_hits: winnerPoints > 0 ? 1 : 0, exact_hits: exactPoints > 0 ? 1 : 0, scorer_hits: scorerPoints > 0 ? 1 : 0 }];
    }));
    matchPoints.forEach((points, userId) => {
      if (!totals.has(userId)) totals.set(userId, emptySimulationPoints());
      addSimulationPoints(totals.get(userId), points);
    });
    matches.push({ id: match.id, result_team1: g1, result_team2: g2, winner: winnerValue, multiplier, points: matchPoints.get(req.user.id) || emptySimulationPoints() });
    perMatch.push({ match_id: match.id, points: matchPoints.get(req.user.id) || emptySimulationPoints() });
  }
  const before = leaderboardRows(), previousPositions = new Map(before.map((row, index) => [row.id, index + 1]));
  const ranking = before.map(row => {
    const points = totals.get(row.id) || emptySimulationPoints();
    return { ...row, simulated: points, total_points: Number(row.total_points) + points.total_points, exact_hits: Number(row.exact_hits) + points.exact_hits, winner_hits: Number(row.winner_hits) + points.winner_hits, scorer_hits: Number(row.scorer_hits) + points.scorer_hits };
  }).sort((a, b) => b.total_points - a.total_points || b.exact_hits - a.exact_hits || b.winner_hits - a.winner_hits || b.scorer_hits - a.scorer_hits || a.id - b.id)
    .map((row, index) => ({ id: row.id, username: row.username, points: row.total_points, match_points: row.simulated.total_points, position: index + 1, movement: previousPositions.get(row.id) - (index + 1), is_me: row.id === req.user.id }));
  return { matches, per_match_points: perMatch, points: totals.get(req.user.id) || emptySimulationPoints(), ranking, mine: ranking.find(row => row.id === req.user.id) };
};

app.post("/api/matches/:id/simulation", requireAuth, (req, res) => {
  try {
    const result = simulationForMatches(req, [{ match_id: req.params.id, result_team1: req.body.result_team1, result_team2: req.body.result_team2, scorer_ids: req.body.scorer_ids }]);
    const matchResult = result.matches[0];
    res.json({ ...matchResult, points: result.points, ranking: result.ranking, mine: result.mine });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "No se pudo simular el resultado." });
  }
});

app.post("/api/matches/simulation", requireAuth, (req, res) => {
  try {
    const items = Array.isArray(req.body.matches) ? req.body.matches.filter((item) => item && item.active !== false) : [];
    if (!items.length) return res.status(400).json({ error: "Activa al menos un partido para simular." });
    res.json(simulationForMatches(req, items.slice(0, 8)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "No se pudo simular el resultado." });
  }
});

app.get("/api/matches/:id/comments", requireAuth, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  const comments = db.prepare(`
    SELECT c.*,COALESCE(NULLIF(u.display_name,''),u.username) username,u.role,u.avatar_filename FROM match_comments c JOIN users u ON u.id=c.user_id
    WHERE c.match_id=? ORDER BY c.created_at DESC
  `).all(req.params.id);
  res.json(comments.map((comment) => ({ ...comment, avatar_url: avatarUrl(comment) })));
});

app.get("/api/giphy/search", requireAuth, requireWritableUser, async (req, res) => {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return res.status(503).json({ error: "El buscador de GIF no está configurado." });
  const query = String(req.query.q || "").trim().slice(0, 50);
  const type = req.query.type === "sticker" ? "sticker" : "gif";
  if (query.length < 2) return res.status(400).json({ error: "Escribe al menos 2 caracteres." });

  const currentTime = Date.now();
  const recent = (giphySearchWindows.get(req.user.id) || []).filter((stamp) => currentTime - stamp < GIPHY_WINDOW_MS);
  if (recent.length >= giphySearchLimit) {
    const retryAfter = Math.max(1, Math.ceil((GIPHY_WINDOW_MS - (currentTime - recent[0])) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: `Has alcanzado el límite de ${giphySearchLimit} búsquedas por hora.`, retry_after: retryAfter, remaining: 0, limit: giphySearchLimit });
  }
  recent.push(currentTime);
  giphySearchWindows.set(req.user.id, recent);

  const cacheKey = `${type}:${query.toLocaleLowerCase("es")}`;
  let items = giphySearchCache.get(cacheKey);
  if (!items || currentTime - items.createdAt >= GIPHY_CACHE_MS) {
    try {
      const endpoint = type === "sticker" ? "stickers" : "gifs";
      const params = new URLSearchParams({ api_key: apiKey, q: query, limit: "20", rating: "g", lang: "es", bundle: "messaging_non_clips" });
      const response = await fetch(`https://api.giphy.com/v1/${endpoint}/search?${params}`, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`GIPHY respondió ${response.status}`);
      const payload = await response.json();
      items = {
        createdAt: currentTime,
        data: (payload.data || []).map((item) => {
          const display = item.images?.fixed_width || item.images?.downsized || item.images?.original;
          const preview = item.images?.fixed_width_small || item.images?.fixed_width || display;
          return { id: item.id, type, title: item.title || "", url: display?.webp || display?.url, preview_url: preview?.webp || preview?.url || display?.url, width: Number(display?.width) || null, height: Number(display?.height) || null };
        }).filter((item) => validGiphyUrl(item.url))
      };
      giphySearchCache.set(cacheKey, items);
    } catch (error) {
      recent.pop();
      return res.status(502).json({ error: "No se pudieron cargar los GIF de GIPHY." });
    }
  }
  res.json({ items: items.data, remaining: Math.max(0, giphySearchLimit - recent.length), limit: giphySearchLimit, attribution: "Powered by GIPHY" });
});

app.get("/api/reactions", requireAuth, (req, res) => {
  const targetType = String(req.query.target_type || "");
  const targetIds = [...new Set(String(req.query.target_ids || "").split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!REACTION_TARGET_TYPES.has(targetType) || !targetIds.length || targetIds.length > 100) {
    return res.status(400).json({ error: "Objetivos de reacción no válidos." });
  }
  const reactions = {};
  for (const targetId of targetIds) {
    const validation = validateReactionTarget(req, targetType, targetId);
    if (validation.error) return res.status(validation.status).json({ error: validation.error });
    reactions[`${targetType}:${targetId}`] = reactionSummary(targetType, targetId, req.user.id);
  }
  res.json({ reactions, allowed_emojis: ALLOWED_REACTION_EMOJIS });
});

app.post("/api/reactions/toggle", requireAuth, requireWritableUser, (req, res) => {
  const targetType = String(req.body.target_type || "");
  const targetId = Number(req.body.target_id);
  const emoji = String(req.body.emoji || "");
  if (!REACTION_TARGET_TYPES.has(targetType)) return res.status(400).json({ error: "Tipo de objetivo no válido." });
  if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: "Objetivo no válido." });
  if (!ALLOWED_REACTION_EMOJIS.includes(emoji)) return res.status(400).json({ error: "Emoji no permitido." });
  const validation = validateReactionTarget(req, targetType, targetId);
  if (validation.error) return res.status(validation.status).json({ error: validation.error });
  if (validation.target.target_user_id === req.user.id) {
    return res.status(403).json({ error: "No puedes reaccionar a tu propio contenido." });
  }
  const existing = db.prepare("SELECT id,emoji FROM reactions WHERE user_id=? AND target_type=? AND target_id=?")
    .get(req.user.id, targetType, targetId);
  let insertedReactionId = null;
  db.transaction(() => {
    if (existing) db.prepare("DELETE FROM reactions WHERE id=?").run(existing.id);
    if (!existing || existing.emoji !== emoji) {
      insertedReactionId = db.prepare("INSERT INTO reactions(user_id,target_type,target_id,emoji,created_at) VALUES(?,?,?,?,?)")
        .run(req.user.id, targetType, targetId, emoji, now()).lastInsertRowid;
    }
  })();
  if (insertedReactionId) createNotification({
    userId: validation.target.target_user_id,
    type: "reaction",
    title: `${emoji} Nueva reacción`,
    message: `${req.user.display_name || req.user.username} ha reaccionado a tu ${targetType === "prediction" ? "pronóstico" : "comentario"}.`,
    entityType: targetType,
    entityId: targetId,
    link: `/match/${validation.target.target_match_id}`,
    eventKey: `reaction:${insertedReactionId}`,
    sendPush: false
  });
  res.json({ target_key: `${targetType}:${targetId}`, reactions: reactionSummary(targetType, targetId, req.user.id) });
});
app.post("/api/matches/:id/comments", requireAuth, requireWritableUser, (req, res) => {
  const comment = String(req.body.comment || "").trim().slice(0, 500);
  const media = req.body.media && typeof req.body.media === "object" ? req.body.media : null;
  const mediaType = ["gif", "sticker", "image"].includes(media?.type) ? media.type : null;
  if (!comment && !mediaType) return res.status(400).json({ error: "Escribe un comentario o selecciona un archivo." });
  if (["gif", "sticker"].includes(mediaType) && (!media.id || !validGiphyUrl(media.url) || (media.preview_url && !validGiphyUrl(media.preview_url)))) {
    return res.status(400).json({ error: "El GIF seleccionado no es válido." });
  }
  if (mediaType === "image" && (media.provider !== "local" || !String(media.id || "").startsWith(`comment-${req.user.id}-`) || !/^\/chat-media\/comment-[\w.-]+\.webp$/.test(media.url || "") || !/^\/chat-media\/comment-[\w.-]+-thumb\.webp$/.test(media.preview_url || "") || !fs.existsSync(path.join(chatMediaDir, path.basename(media.url))))) return res.status(400).json({ error: "La imagen no es válida." });
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  const result = db.prepare(`INSERT INTO match_comments(match_id,user_id,comment,media_type,media_provider,media_id,media_url,media_preview_url,media_width,media_height,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(req.params.id, req.user.id, comment, mediaType, mediaType === "image" ? "local" : mediaType ? "giphy" : null, mediaType ? String(media.id).slice(0, 100) : null, mediaType ? media.url : null, mediaType ? (media.preview_url || media.url) : null, mediaType ? Math.max(1, Math.min(2000, Number(media.width) || 480)) : null, mediaType ? Math.max(1, Math.min(2000, Number(media.height) || 360)) : null, now(), now());
  const mentionedUserIds = new Set();
  const mentionTokens = new Set([...comment.matchAll(/@([\p{L}\p{N}_.-]+)/gu)].map((match) => match[1].toLocaleLowerCase("es")));
  if (mentionTokens.size) {
    for (const mentioned of db.prepare("SELECT id,username,COALESCE(NULLIF(display_name,''),username) display_name FROM users WHERE active=1 AND id<>?").all(req.user.id)) {
      const aliases = [mentioned.username, mentioned.display_name.replace(/\s+/g, "_")].map((value) => value.toLocaleLowerCase("es"));
      if (!aliases.some((alias) => mentionTokens.has(alias))) continue;
      mentionedUserIds.add(mentioned.id);
      createNotification({
        userId: mentioned.id,
        type: "match_mention",
        title: `Te han mencionado en ${match.team1} - ${match.team2}`,
        message: `${req.user.display_name || req.user.username} te ha mencionado en un comentario.`,
        entityType: "match_comment",
        entityId: result.lastInsertRowid,
        link: `/match/${match.id}#comentarios`,
        eventKey: `match-mention:${result.lastInsertRowid}:${mentioned.id}`
      });
    }
  }
  notifyAllExcept(req.user.id, {
    type: "match_comment",
    title: "Nuevo comentario",
    message: `${req.user.display_name || req.user.username} ha comentado en ${match.team1} - ${match.team2}.`,
    entityType: "match_comment",
    entityId: result.lastInsertRowid,
    link: `/match/${match.id}#comentarios`,
    eventKey: `match-comment:${result.lastInsertRowid}`
  }, mentionedUserIds);
  res.status(201).json({ id: result.lastInsertRowid });
});
app.put("/api/comments/:id", requireAuth, requireWritableUser, (req, res) => {
  const row = db.prepare("SELECT * FROM match_comments WHERE id=?").get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "No puedes editar este comentario." });
  db.prepare("UPDATE match_comments SET comment=?,updated_at=? WHERE id=?").run(String(req.body.comment || "").trim().slice(0,500), now(), row.id);
  res.json({ ok: true });
});
app.delete("/api/comments/:id", requireAuth, requireWritableUser, (req, res) => {
  const row = db.prepare("SELECT * FROM match_comments WHERE id=?").get(req.params.id);
  if (!row || (row.user_id !== req.user.id && req.user.role !== "admin")) return res.status(403).json({ error: "No puedes eliminar este comentario." });
  db.prepare("DELETE FROM match_comments WHERE id=?").run(row.id);
  if (row.media_provider === "local" && row.media_id) removeChatMediaFiles(row.media_id);
  res.json({ ok: true });
});

app.post("/api/matches", requireAdmin, (req, res) => {
  const data = matchPayload(req.body);
  const entities = selectedMatchEntities(data);
  const team1Name = entities.team1?.name || data.team1, team2Name = entities.team2?.name || data.team2;
  if (!data.match_date || !data.match_time || !data.auto_close_at || !team1Name || !team2Name) return res.status(400).json({ error: "Fecha, hora y equipos válidos son obligatorios." });
  if (req.body.team1_id !== undefined && !entities.team1) return res.status(400).json({ error: "Equipo local no válido." });
  if (req.body.team2_id !== undefined && !entities.team2) return res.status(400).json({ error: "Equipo visitante no válido." });
  if ((entities.team1 && entities.team2 && entities.team1.id === entities.team2.id) || team1Name === team2Name) return res.status(400).json({ error: "Los equipos deben ser distintos." });
  if (data.stadium_id && !entities.stadium) return res.status(400).json({ error: "Estadio no válido." });
  const stamp = now();
  const result = db.prepare(`INSERT INTO matches(match_date,match_time,stadium,team1,team2,team1_id,team2_id,stadium_id,
    scorer_enabled,status,auto_close_at,force_published,is_star,is_knockout,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?,?)`)
    .run(data.match_date, data.match_time, entities.stadium?.name || "", team1Name, team2Name,
      entities.team1?.id || null, entities.team2?.id || null, entities.stadium?.id || null, data.scorer_enabled,
      data.auto_close_at, data.force_published, data.is_star, data.is_knockout, stamp, stamp);
  const created = db.prepare("SELECT * FROM matches WHERE id=?").get(result.lastInsertRowid);
  logAction(req.user.id, "create_match", "match", created.id, "Partido creado", null, created);
  if (isMatchPublished(created) && created.status === "open" && !isExpired(created)) {
    notifyAll({ type: "match_available", title: "Nuevo partido disponible",
      message: `Ya puedes apostar en ${created.team1} - ${created.team2}.`, entityType: "match",
      entityId: created.id, link: `/match/${created.id}`, eventKey: `match-available:${created.id}` });
  }
  res.status(201).json(serializeMatch(created));
});

app.put("/api/matches/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  const data = matchPayload(req.body, before);
  const entities = selectedMatchEntities(data);
  const team1Name = entities.team1?.name || data.team1, team2Name = entities.team2?.name || data.team2;
  if (!data.match_date || !data.match_time || !data.auto_close_at || !team1Name || !team2Name || team1Name === team2Name) return res.status(400).json({ error: "Selecciona fecha, hora y dos equipos válidos y distintos." });
  if (req.body.team1_id !== undefined && !entities.team1) return res.status(400).json({ error: "Equipo local no válido." });
  if (req.body.team2_id !== undefined && !entities.team2) return res.status(400).json({ error: "Equipo visitante no válido." });
  if (data.stadium_id && !entities.stadium) return res.status(400).json({ error: "Estadio no válido." });
  const teamsChanged = Number(before.team1_id || 0) !== Number(entities.team1?.id || 0) ||
    Number(before.team2_id || 0) !== Number(entities.team2?.id || 0);
  if (teamsChanged && db.prepare("SELECT 1 FROM predictions WHERE match_id=? LIMIT 1").get(before.id)) {
    return res.status(409).json({ error: "No se pueden cambiar los equipos porque ya existen pronósticos para este partido." });
  }
  if (!Number(before.scorer_enabled) && data.scorer_enabled && before.status === "finished" &&
      Number(before.result_team1 || 0) + Number(before.result_team2 || 0) > 0 &&
      !db.prepare("SELECT 1 FROM match_scorers WHERE match_id=? LIMIT 1").get(before.id)) {
    return res.status(409).json({ error: "Guarda primero los goleadores reales antes de activar la regla de goleador en un partido finalizado." });
  }
  db.transaction(() => {
    db.prepare(`UPDATE matches SET match_date=?,match_time=?,stadium=?,team1=?,team2=?,team1_id=?,team2_id=?,
      stadium_id=?,scorer_enabled=?,auto_close_at=?,force_published=?,is_star=?,is_knockout=?,updated_at=? WHERE id=?`)
      .run(data.match_date, data.match_time, entities.stadium?.name || before.stadium || "", team1Name, team2Name,
        entities.team1?.id || null, entities.team2?.id || null, entities.stadium?.id || null, data.scorer_enabled,
        data.auto_close_at, data.force_published, data.is_star, data.is_knockout, now(), before.id);
    if (!data.scorer_enabled) {
      db.prepare("DELETE FROM match_scorers WHERE match_id=?").run(before.id);
      db.prepare("UPDATE predictions SET predicted_scorer_id=NULL,scorer_points=0 WHERE match_id=?").run(before.id);
    }
  })();
  if (before.status === "finished" &&
      (Number(before.is_star) !== data.is_star || Number(before.scorer_enabled) !== data.scorer_enabled)) {
    recalculateMatch(before.id);
    saveRankingSnapshot();
  }
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  logAction(req.user.id, "edit_match", "match", before.id, "Partido editado", before, after);
  if (!isMatchPublished(before) && isMatchPublished(after) && after.status === "open" && !isExpired(after)) {
    notifyAll({ type: "match_available", title: "Nuevo partido disponible",
      message: `Ya puedes apostar en ${after.team1} - ${after.team2}.`, entityType: "match",
      entityId: after.id, link: `/match/${after.id}`, eventKey: `match-available:${after.id}` });
  }
  res.json(serializeMatch(after));
});

app.delete("/api/matches/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  db.prepare("DELETE FROM matches WHERE id=?").run(before.id);
  if (before.status === "finished") saveRankingSnapshot();
  logAction(req.user.id, "delete_match", "match", before.id, "Partido eliminado", before, null);
  res.json({ ok: true });
});

app.patch("/api/matches/:id/status", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  const status = req.body.status;
  if (!before || !["open", "closed", "finished"].includes(status)) return res.status(400).json({ error: "Partido o estado no válido." });
  if (status === "finished" && (before.result_team1 === null || before.result_team2 === null)) return res.status(400).json({ error: "Introduce el resultado antes de finalizar." });
  if (status === "open" && isMatchInPlay(before)) return res.status(409).json({ error: "No se puede reabrir un partido que ya está en juego." });
  const reopenMode = req.body.reopen_mode;
  if (status === "open" && !["automatic", "manual"].includes(reopenMode)) {
    return res.status(400).json({ error: "Indica si la reapertura mantiene el cierre automático o queda abierta manualmente." });
  }
  const closeReason = status === "closed"
    ? "manual"
    : status === "open"
      ? reopenMode === "manual" ? "manual" : null
      : before.close_reason;
  db.prepare("UPDATE matches SET status=?,close_reason=?,updated_at=? WHERE id=?").run(status, closeReason, now(), before.id);
  db.prepare("UPDATE predictions SET locked=?,updated_at=? WHERE match_id=?").run(status === "open" ? 0 : 1, now(), before.id);
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  const description = status === "open"
    ? `Partido reabierto con cierre ${reopenMode === "automatic" ? "automático" : "manual"}`
    : `Estado cambiado a ${status}`;
  logAction(req.user.id, status === "closed" ? "close_match" : "edit_match", "match", before.id, description, before, after);
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
    scheduleMatchCloseBackup(after);
  }
  res.json(serializeMatch(after));
});

app.delete("/api/matches/:id/result", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  if (before.status !== "finished" || before.result_team1 === null || before.result_team2 === null) {
    return res.status(409).json({ error: "Este partido no tiene un resultado que eliminar." });
  }

  const config = settings();
  const deadlinePassed = config.auto_close_enabled === "1" && new Date() >= effectiveCloseAt(before, config);
  const nextStatus = deadlinePassed ? "closed" : "open";
  const closeReason = deadlinePassed ? "automatic" : "manual";
  const locked = deadlinePassed ? 1 : 0;
  const stamp = now();
  db.transaction(() => {
    db.prepare(`
      UPDATE matches
      SET status=?,result_team1=NULL,result_team2=NULL,winner=NULL,penalty_team1=NULL,penalty_team2=NULL,close_reason=?,updated_at=?
      WHERE id=?
    `).run(nextStatus, closeReason, stamp, before.id);
    db.prepare(`
      UPDATE predictions
      SET winner_points=0,exact_result_points=0,scorer_points=0,total_points=0,scoring_multiplier=1,locked=?,updated_at=?
      WHERE match_id=?
    `).run(locked, stamp, before.id);
    db.prepare("DELETE FROM match_scorers WHERE match_id=?").run(before.id);
    db.prepare("DELETE FROM movement_summaries WHERE match_id=? AND seen_at IS NULL").run(before.id);
  })();

  saveRankingSnapshot();
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  const description = deadlinePassed
    ? "Resultado eliminado; el partido permanece cerrado por plazo"
    : "Resultado eliminado y partido reabierto";
  logAction(req.user.id, "delete_result", "match", before.id, description, before, after);
  res.json(serializeMatch(after));
});

app.post("/api/matches/:id/finish", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  const g1 = parseIntField(req.body.result_team1), g2 = parseIntField(req.body.result_team2);
  if (!before) return res.status(404).json({ error: "Partido no encontrado." });
  if (g1 === null || g2 === null) return res.status(400).json({ error: "Los goles deben ser enteros positivos o cero." });
  const scorerIds = parseScorerList(req.body.scorer_ids);
  if (scorerIds === null) return res.status(400).json({ error: "La lista de goleadores no es válida." });
  const noScorerSelected = scorerIds.includes(NO_SCORER_ID);
  if (before.scorer_enabled && g1 + g2 > 0 && scorerIds.length === 0 && !hasOwnGoalFlag(req.body.has_own_goal)) {
    return res.status(400).json({ error: "Selecciona al menos un goleador. Los autogoles no se incluyen." });
  }
  if (g1 + g2 > 0 && noScorerSelected) return res.status(400).json({ error: "Sin goleador solo es válido para resultados 0-0." });
  if (g1 + g2 === 0 && scorerIds.length && !noScorerSelected) return res.status(400).json({ error: "Un empate 0-0 solo puede tener Sin goleador." });
  const playerScorerIds = noScorerSelected ? [] : scorerIds;
  if (playerScorerIds.length) {
    if (!before.team1_id || !before.team2_id) return res.status(400).json({ error: "El partido debe tener equipos vinculados para guardar goleadores." });
    const allowedTeamIds = scoringTeamIds(before, g1, g2);
    const valid = db.prepare(`
      SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
      WHERE p.id IN (${playerScorerIds.map(() => "?").join(",")}) AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
    `).all(...playerScorerIds, ...allowedTeamIds);
    if (valid.length !== playerScorerIds.length) return res.status(400).json({ error: "Todos los goleadores deben pertenecer a equipos que hayan marcado." });
  }
  const wantsPenalties = requestBoolean(req.body.has_penalties) ||
    (req.body.has_penalties === undefined &&
      req.body.penalty_team1 !== undefined && req.body.penalty_team1 !== null && req.body.penalty_team1 !== "" &&
      req.body.penalty_team2 !== undefined && req.body.penalty_team2 !== null && req.body.penalty_team2 !== "");
  const p1 = parseOptionalPenalty(req.body.penalty_team1);
  const p2 = parseOptionalPenalty(req.body.penalty_team2);
  if ((req.body.penalty_team1 !== undefined && p1 === null && req.body.penalty_team1 !== "" && req.body.penalty_team1 !== null) ||
      (req.body.penalty_team2 !== undefined && p2 === null && req.body.penalty_team2 !== "" && req.body.penalty_team2 !== null)) {
    return res.status(400).json({ error: "Los penaltis deben ser enteros positivos o cero." });
  }
  let penaltyTeam1 = null, penaltyTeam2 = null;
  if (wantsPenalties) {
    if (!Number(before.is_knockout)) return res.status(400).json({ error: "Solo los partidos de eliminatoria pueden tener tanda de penaltis." });
    if (g1 !== g2) return res.status(400).json({ error: "Solo se pueden guardar penaltis si el resultado hasta 120 minutos es empate." });
    if (p1 === null || p2 === null) return res.status(400).json({ error: "Introduce los goles de la tanda para ambos equipos." });
    if (p1 === p2) return res.status(400).json({ error: "La tanda de penaltis no puede terminar empatada." });
    penaltyTeam1 = p1;
    penaltyTeam2 = p2;
  }
  const winner = calculateWinner(g1, g2);
  if (req.body.winner && req.body.winner !== winner) return res.status(400).json({ error: "El ganador no coincide con el marcador." });
  if (before.status === "finished" && before.result_team1 === g1 && before.result_team2 === g2) {
    const storedScorerIds = db.prepare("SELECT player_id FROM match_scorers WHERE match_id=? ORDER BY player_id")
      .all(before.id).map((row) => row.player_id);
    const submittedScorerIds = [...playerScorerIds].sort((a, b) => a - b);
    if (storedScorerIds.length === submittedScorerIds.length && storedScorerIds.every((id, index) => id === submittedScorerIds[index]) &&
        Number(before.penalty_team1 ?? -1) === Number(penaltyTeam1 ?? -1) &&
        Number(before.penalty_team2 ?? -1) === Number(penaltyTeam2 ?? -1)) {
      return res.json(serializeMatch(before));
    }
  }
  const leaderboardBefore = leaderboardRows();
  db.transaction(() => {
    db.prepare("UPDATE matches SET status='finished',result_team1=?,result_team2=?,winner=?,penalty_team1=?,penalty_team2=?,updated_at=? WHERE id=?")
      .run(g1, g2, winner, penaltyTeam1, penaltyTeam2, now(), before.id);
    db.prepare("DELETE FROM match_scorers WHERE match_id=?").run(before.id);
    const addScorer = db.prepare("INSERT INTO match_scorers(match_id,player_id) VALUES(?,?)");
    playerScorerIds.forEach((playerId) => addScorer.run(before.id, playerId));
  })();
  recalculateMatch(before.id);
  saveRankingSnapshot();
  const leaderboardAfter = leaderboardRows();
  const after = db.prepare("SELECT * FROM matches WHERE id=?").get(before.id);
  logAction(req.user.id, before.status === "finished" ? "edit_result" : "finish_match", "match", before.id, "Resultado guardado y puntos recalculados", before, after);
  const resultNotificationTitle = before.status === "finished"
    ? `Resultado publicado - modificacion - (${req.user.username})`
    : `Resultado publicado (${req.user.username})`;
  const resultNotificationEventKey = before.status === "finished"
    ? `result-edit:${before.id}:${crypto.randomUUID()}`
    : `result:${before.id}:${g1}-${g2}:${crypto.randomUUID()}`;
  // A result can be deleted and later published again with the same score.
  // Each publication must remain a distinct notification and movement event.
  const movementEventKey = `movement:${before.id}:${crypto.randomUUID()}`;
  const actualScorers = playerScorerIds.length ? db.prepare(`
    SELECT p.name FROM players p WHERE p.id IN (${playerScorerIds.map(() => "?").join(",")}) ORDER BY p.name
  `).all(...playerScorerIds).map((row) => row.name) : [];
  const beforePositions = new Map(leaderboardBefore.map((row, index) => [row.id, index + 1]));
  const predictionByUser = new Map(db.prepare(`
    SELECT user_id,predicted_team1_goals,predicted_team2_goals,winner_points,
      exact_result_points,scorer_points,total_points,scoring_multiplier,
      CASE WHEN predicted_scorer_id IS NULL THEN NULL ELSE
        COALESCE((SELECT name FROM players WHERE id=predicted_scorer_id),'Sin goleador') END predicted_scorer_name
    FROM predictions WHERE match_id=?
  `).all(before.id).map((row) => [row.user_id, row]));
  const insertMovement = db.prepare(`
    INSERT INTO movement_summaries(event_key,user_id,match_id,payload,created_at)
    VALUES(?,?,?,?,?)
  `);
  db.transaction(() => {
    // Repeated corrections collapse into one pending card: users see only the latest result.
    db.prepare("DELETE FROM movement_summaries WHERE match_id=? AND seen_at IS NULL").run(before.id);
    leaderboardAfter.forEach((row, index) => {
      const position = index + 1;
      const prediction = predictionByUser.get(row.id);
      const context = leaderboardAfter.map((ranked, offset) => ({
        id: ranked.id, username: ranked.username, points: ranked.total_points,
        match_points: Number(predictionByUser.get(ranked.id)?.total_points || 0),
        position: offset + 1, movement: (beforePositions.get(ranked.id) || offset + 1) - (offset + 1),
        is_me: ranked.id === row.id
      }));
      insertMovement.run(movementEventKey, row.id, before.id, JSON.stringify({
        match: { id: before.id, date: before.match_date, time: before.match_time, team1: before.team1,
          team2: before.team2, result_team1: g1, result_team2: g2, is_star: Boolean(before.is_star), scorers: actualScorers },
        points: prediction ? Number(prediction.total_points) : 0,
        prediction: prediction ? { ...prediction, scoring_multiplier: Number(prediction.scoring_multiplier || 1) } : null,
        ranking: { position, previous_position: beforePositions.get(row.id) || position,
          movement: (beforePositions.get(row.id) || position) - position, total_points: row.total_points, context }
      }), now());
    });
  })();
  notifyAll({
    type: "result_published",
    title: resultNotificationTitle,
    message: `${before.team1} ${g1} - ${g2} ${before.team2}.${before.is_star ? " Partido Estrella x2." : ""}`,
    entityType: "match",
    entityId: before.id,
    link: "/",
    eventKey: resultNotificationEventKey,
    sendPush: false
  });
  const pointsByUser = new Map();
  db.prepare("SELECT user_id,total_points,scoring_multiplier FROM predictions WHERE match_id=? AND total_points>0").all(before.id)
    .forEach((prediction) => createNotification({
      userId: prediction.user_id,
      type: "points_earned",
      title: "Has sumado puntos",
      message: before.is_star
        ? `Has conseguido ${prediction.total_points} puntos en ${before.team1} - ${before.team2}: ${prediction.total_points / prediction.scoring_multiplier} puntos base ×${prediction.scoring_multiplier} por ser Partido Estrella.`
        : `Has conseguido ${prediction.total_points} puntos en ${before.team1} - ${before.team2}.`,
      entityType: "match",
      entityId: before.id,
      link: "/clasificacion",
      eventKey: `points:${before.id}:${g1}-${g2}:${prediction.total_points}:x${prediction.scoring_multiplier}`,
      sendPush: (pointsByUser.set(prediction.user_id, prediction.total_points), false)
    }));
  const topThree = new Map(notifyNewTopThree(leaderboardBefore, `result:${before.id}:${g1}-${g2}`, false)
    .map((row) => [row.id, row.position]));
  db.prepare("SELECT id FROM users WHERE active=1").all().forEach(({ id }) => {
    const points = pointsByUser.get(id) || 0, position = topThree.get(id);
    const details = [points ? `Has sumado ${points} ${points === 1 ? "punto" : "puntos"}.` : "Consulta tus puntos.", position ? `Ahora estas en el top 3 (puesto ${position}).` : ""].filter(Boolean).join(" ");
    void sendPushToUser(id, { type: "result_published", categories: ["match_updates", ...(points ? ["points"] : []), ...(position ? ["ranking"] : [])],
      title: `${before.team1} ${g1} - ${g2} ${before.team2}`, message: details, entityId: before.id,
      link: "/clasificacion", eventKey: `result-summary:${resultNotificationEventKey}:${id}` });
  });
  res.json(serializeMatch(after));
});

app.get("/api/predictions/me", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM predictions WHERE user_id=? ORDER BY match_id").all(req.user.id));
});
app.get("/api/matches/:id/scorers", requireAuth, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  const players = db.prepare(`
    SELECT p.id,p.name,p.position,p.team_fifa_code FROM match_scorers ms
    JOIN players p ON p.id=ms.player_id WHERE ms.match_id=? ORDER BY p.name
  `).all(match.id);
  res.json(serializeActualScorers(match, players));
});
app.put("/api/matches/:id/scorers", requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (match.result_team1 === null) return res.status(409).json({ error: "Guarda primero el resultado." });
  const scorerIds = parseScorerList(req.body.scorer_ids);
  if (scorerIds === null) return res.status(400).json({ error: "La lista de goleadores no es válida." });
  const noScorerSelected = scorerIds.includes(NO_SCORER_ID);
  if (match.scorer_enabled && match.result_team1 + match.result_team2 > 0 && !scorerIds.length && !hasOwnGoalFlag(req.body.has_own_goal)) {
    return res.status(400).json({ error: "Selecciona al menos un goleador." });
  }
  if (match.result_team1 + match.result_team2 > 0 && noScorerSelected) return res.status(400).json({ error: "Sin goleador solo es válido para resultados 0-0." });
  if (match.result_team1 + match.result_team2 === 0 && scorerIds.length && !noScorerSelected) return res.status(400).json({ error: "Un empate 0-0 solo puede tener Sin goleador." });
  const playerScorerIds = noScorerSelected ? [] : scorerIds;
  const allowedTeamIds = scoringTeamIds(match, match.result_team1, match.result_team2);
  const valid = playerScorerIds.length ? db.prepare(`
    SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
    WHERE p.id IN (${playerScorerIds.map(() => "?").join(",")}) AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
  `).all(...playerScorerIds, ...allowedTeamIds) : [];
  if (valid.length !== playerScorerIds.length) return res.status(400).json({ error: "Goleador no válido para este resultado." });
  db.transaction(() => {
    db.prepare("DELETE FROM match_scorers WHERE match_id=?").run(match.id);
    const insert = db.prepare("INSERT INTO match_scorers(match_id,player_id) VALUES(?,?)");
    playerScorerIds.forEach((playerId) => insert.run(match.id, playerId));
  })();
  recalculateMatch(match.id);
  saveRankingSnapshot();
  res.json(serializeMatch(db.prepare("SELECT * FROM matches WHERE id=?").get(match.id)));
});
app.get("/api/predictions/match/:matchId", requireAuth, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.matchId);
  if (!match || !canAccessMatch(req, match)) return res.status(404).json({ error: "Partido no encontrado." });
  const count = db.prepare(`
    SELECT COUNT(*) count FROM predictions p
    JOIN users u ON u.id=p.user_id
    WHERE p.match_id=? AND u.role='user'
  `).get(match.id).count;
  if (match.status === "open" && !isExpired(match) && !isMatchInPlay(match)) {
    return res.json({ revealed: false, count, participants: [] });
  }
  const predictions = db.prepare(`
    SELECT p.id,p.user_id,COALESCE(NULLIF(u.display_name,''),u.username) username,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,
      p.winner_points,p.exact_result_points,p.scorer_points,p.total_points,p.predicted_scorer_id,
      player.name predicted_scorer_name,player.position predicted_scorer_position
    FROM predictions p JOIN users u ON u.id=p.user_id LEFT JOIN players player ON player.id=p.predicted_scorer_id
    WHERE p.match_id=? AND u.role='user' ORDER BY u.username
  `).all(match.id).map((prediction) => prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0
    ? { ...prediction, predicted_scorer_id: NO_SCORER_ID, predicted_scorer_name: NO_SCORER.name, predicted_scorer_position: NO_SCORER.position }
    : prediction);
  res.json({ revealed: true, count, predictions });
});

function savePrediction(req, res, predictionId = null) {
  const matchId = Number(req.body.match_id);
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(matchId);
  const g1 = parseIntField(req.body.predicted_team1_goals), g2 = parseIntField(req.body.predicted_team2_goals);
  const winner = req.body.predicted_winner;
  const scorerSelection = parseScorerSelection(req.body.predicted_scorer_id);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (!isMatchPublished(match)) return res.status(409).json({ error: "Este partido todavía no está publicado para apostar." });
  if (match.status !== "open" || isExpired(match) || isMatchInPlay(match)) return res.status(409).json({ error: "Las apuestas de este partido ya están cerradas." });
  if (g1 === null || g2 === null || !["team1", "team2", "draw"].includes(winner)) return res.status(400).json({ error: "Predicción no válida." });
  if (!scorerSelection) return res.status(400).json({ error: "Goleador no válido." });
  if (predictionWinner(g1, g2) !== winner) return res.status(400).json({ error: "El ganador elegido no coincide con el resultado pronosticado." });
  if (match.scorer_enabled && g1 + g2 > 0 && scorerSelection.type !== "player") return res.status(400).json({ error: "Selecciona un goleador para este pronóstico." });
  if (g1 + g2 === 0 && scorerSelection.type === "player") return res.status(400).json({ error: "Un pronóstico 0-0 solo puede incluir Sin goleador." });
  if (g1 + g2 > 0 && scorerSelection.type === "no_scorer") return res.status(400).json({ error: "Sin goleador solo es válido para pronósticos 0-0." });
  const predictedScorerId = scorerSelection.type === "player" ? scorerSelection.playerId : null;
  if (predictedScorerId) {
    const allowedTeamIds = scoringTeamIds(match, g1, g2);
    const player = db.prepare(`
      SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
      WHERE p.id=? AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
    `).get(predictedScorerId, ...allowedTeamIds);
    if (!player) return res.status(400).json({ error: "El goleador debe pertenecer a un equipo que marque en tu pronóstico." });
  }
  const existing = db.prepare("SELECT * FROM predictions WHERE user_id=? AND match_id=?").get(req.user.id, matchId);
  if (predictionId && (!existing || existing.id !== Number(predictionId))) return res.status(403).json({ error: "No puedes modificar esta predicción." });
  if (existing) {
    db.prepare("UPDATE predictions SET predicted_winner=?,predicted_team1_goals=?,predicted_team2_goals=?,predicted_scorer_id=?,updated_at=? WHERE id=?")
      .run(winner, g1, g2, predictedScorerId, now(), existing.id);
    return res.json(db.prepare("SELECT * FROM predictions WHERE id=?").get(existing.id));
  }
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO predictions(user_id,match_id,predicted_winner,predicted_team1_goals,predicted_team2_goals,predicted_scorer_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(req.user.id, matchId, winner, g1, g2, predictedScorerId, stamp, stamp);
  res.status(201).json(db.prepare("SELECT * FROM predictions WHERE id=?").get(result.lastInsertRowid));
}
app.post("/api/predictions", requireAuth, requireWritableUser, (req, res) => savePrediction(req, res));
app.put("/api/predictions/:id", requireAuth, requireWritableUser, (req, res) => savePrediction(req, res, req.params.id));

app.get("/api/movement-summaries/pending", requireAuth, (req, res) => {
  if (req.user.role === "admin" || req.user.is_read_only) return res.json({ summaries: [] });
  const summaries = db.prepare(`
    SELECT id,payload,created_at FROM movement_summaries
    WHERE user_id=? AND seen_at IS NULL ORDER BY created_at,id
  `).all(req.user.id).map((row) => ({ id: row.id, created_at: row.created_at, ...JSON.parse(row.payload) }));
  res.json({ summaries });
});
app.post("/api/movement-summaries/seen", requireAuth, requireWritableUser, (req, res) => {
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))] : [];
  if (!ids.length) return res.status(400).json({ error: "No hay resúmenes que marcar como vistos." });
  db.prepare(`UPDATE movement_summaries SET seen_at=? WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`)
    .run(now(), req.user.id, ...ids);
  res.json({ ok: true });
});

app.get("/api/notifications", requireAuth, (req, res) => {
  const notifications = db.prepare(`
    SELECT *
    FROM notifications
    WHERE user_id=?
      AND (
        read=0
        OR id IN (
          SELECT id
          FROM notifications
          WHERE user_id=? AND read=1
          ORDER BY created_at DESC, id DESC
          LIMIT 5
        )
      )
    ORDER BY created_at DESC, id DESC
  `).all(req.user.id, req.user.id);
  const unread = db.prepare("SELECT COUNT(*) count FROM notifications WHERE user_id=? AND read=0").get(req.user.id).count;
  res.json({ notifications, unread });
});
app.patch("/api/notifications/:id/read", requireAuth, requireWritableUser, (req, res) => {
  const result = db.prepare("UPDATE notifications SET read=1,read_at=? WHERE id=? AND user_id=?")
    .run(now(), req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "Notificación no encontrada." });
  res.json({ ok: true });
});
app.post("/api/notifications/read-all", requireAuth, requireWritableUser, (req, res) => {
  db.prepare("UPDATE notifications SET read=1,read_at=? WHERE user_id=? AND read=0").run(now(), req.user.id);
  res.json({ ok: true });
});

app.get("/api/push/status", requireAuth, (req, res) => {
  const subscriptions = db.prepare("SELECT endpoint FROM push_subscriptions WHERE user_id=?").all(req.user.id);
  res.json({
    configured: pushConfigured,
    public_key: pushConfigured ? vapidPublicKey : null,
    subscriptions: subscriptions.length,
    subscription_endpoints: subscriptions.map(({ endpoint }) => endpoint),
    preferences: getPushPreferences(req.user.id)
  });
});
app.post("/api/push/subscribe", requireAuth, requireWritableUser, (req, res) => {
  if (!pushConfigured) return res.status(503).json({ error: "Las notificaciones push no estan configuradas en el servidor." });
  try {
    savePushSubscription(req.user.id, req.body.subscription, req.get("user-agent"));
    res.status(201).json({ ok: true });
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.delete("/api/push/unsubscribe", requireAuth, requireWritableUser, (req, res) => {
  const endpoint = String(req.body.endpoint || "");
  if (endpoint) db.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").run(req.user.id, endpoint);
  res.json({ ok: true });
});
app.patch("/api/push/preferences", requireAuth, requireWritableUser, (req, res) => {
  const current = getPushPreferences(req.user.id), stamp = now();
  const value = (key) => req.body[key] === undefined ? Number(current[key]) : req.body[key] ? 1 : 0;
  db.prepare(`
    INSERT INTO notification_preferences(user_id,match_updates,points,ranking,social,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET match_updates=excluded.match_updates,
      points=excluded.points,ranking=excluded.ranking,social=excluded.social,updated_at=excluded.updated_at
  `).run(req.user.id, value("match_updates"), value("points"), value("ranking"), value("social"), stamp);
  res.json(getPushPreferences(req.user.id));
});

app.get("/api/leaderboard", requireAuth, (_req, res) => res.json(leaderboardRows()));
app.get("/api/leaderboard/daily", requireAuth, (_req, res) => {
  const latestDate = db.prepare("SELECT MAX(match_date) date FROM matches WHERE status='finished'").get().date;
  const rows = db.prepare(`
    SELECT u.id,COALESCE(NULLIF(u.display_name,''),u.username) username,u.personal_phrase,
      COALESCE(SUM(p.total_points),0) total_points,
      COALESCE(SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END),0) winner_hits,
      COALESCE(SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END),0) exact_hits,
      COALESCE(SUM(CASE WHEN p.scorer_points>0 THEN 1 ELSE 0 END),0) scorer_hits
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id
      AND p.match_id IN (SELECT id FROM matches WHERE match_date=? AND status='finished')
    WHERE u.active=1 AND u.role='user'
    GROUP BY u.id ORDER BY total_points DESC,exact_hits DESC,winner_hits DESC,scorer_hits DESC,u.id
  `).all(latestDate);
  res.json({ date: latestDate || null, rows });
});

app.get("/api/history/days", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT m.match_date,COUNT(*) matches_count,COALESCE(SUM(p.total_points),0) my_points
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    GROUP BY m.match_date ORDER BY m.match_date DESC
  `).all(req.user.id);
  if (req.user.role === "admin") return res.json(rows);
  const visibleDates = new Set(db.prepare("SELECT * FROM matches").all().filter(isMatchPublished).map((match) => match.match_date));
  res.json(rows.filter((row) => visibleDates.has(row.match_date)));
});
app.get("/api/history/day/:date", requireAuth, (req, res) => {
  const matches = db.prepare(`
    SELECT m.*,p.id prediction_id,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points
    FROM matches m LEFT JOIN predictions p ON p.match_id=m.id AND p.user_id=?
    WHERE m.match_date=? ORDER BY m.match_time
  `).all(req.user.id, req.params.date);
  const visibleMatches = serializeMatches(matches.filter((match) => canAccessMatch(req, match)));
  const details = Object.fromEntries(visibleMatches.map((match) => {
    if (match.status === "open" && !isExpired(match)) return [match.id, null];
    return [match.id, db.prepare(`
      SELECT COALESCE(NULLIF(u.display_name,''),u.username) username,p.predicted_winner,p.predicted_team1_goals,p.predicted_team2_goals,p.total_points,
        p.predicted_scorer_id,player.name predicted_scorer_name
      FROM predictions p JOIN users u ON u.id=p.user_id
      LEFT JOIN players player ON player.id=p.predicted_scorer_id
      WHERE p.match_id=? AND u.role='user' ORDER BY u.username
    `).all(match.id).map((prediction) => prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0
      ? { ...prediction, predicted_scorer_id: NO_SCORER_ID, predicted_scorer_name: NO_SCORER.name }
      : prediction)];
  }));
  res.json({ matches: visibleMatches, predictions: details });
});
app.get("/api/history/day/:date/summary", requireAuth, (req, res) => {
  res.json(db.prepare(`
    SELECT COALESCE(NULLIF(u.display_name,''),u.username) username,COALESCE(SUM(p.total_points),0) points,
      COALESCE(SUM(CASE WHEN p.winner_points>0 THEN 1 ELSE 0 END),0) winner_hits,
      COALESCE(SUM(CASE WHEN p.exact_result_points>0 THEN 1 ELSE 0 END),0) exact_hits,
      COALESCE(SUM(CASE WHEN p.scorer_points>0 THEN 1 ELSE 0 END),0) scorer_hits
    FROM users u LEFT JOIN predictions p ON p.user_id=u.id
      AND p.match_id IN (SELECT id FROM matches WHERE match_date=?)
    WHERE u.active=1 AND u.role='user'
    GROUP BY u.id ORDER BY points DESC,exact_hits DESC,winner_hits DESC,scorer_hits DESC,u.id
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
    if (user.role === "user") saveRankingSnapshot();
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
    if (before.role === "user" || after.role === "user") saveRankingSnapshot();
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
  if (before.role === "user") saveRankingSnapshot();
  logAction(req.user.id, req.body.active ? "activate_user" : "deactivate_user", "user", before.id, "Estado de usuario modificado", safeUser(before), safeUser(after));
  res.json(safeUser(after));
});
app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const before = db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if (!before) return res.status(404).json({ error: "Usuario no encontrado." });
  if (before.username.toLowerCase() === "administrador" || before.id === req.user.id) return res.status(400).json({ error: "Este usuario administrador no se puede eliminar." });
  db.prepare("DELETE FROM users WHERE id=?").run(before.id);
  if (before.role === "user" && before.active) saveRankingSnapshot();
  logAction(req.user.id, "delete_user", "user", before.id, "Usuario eliminado", safeUser(before), null);
  res.json({ ok: true });
});

app.post("/api/admin/recalculate", requireAdmin, (req, res) => {
  const count = recalculateAll();
  saveRankingSnapshot();
  logAction(req.user.id, "recalculate_points", "prediction", null, `Recalculadas ${count} predicciones`);
  res.json({ ok: true, recalculated: count });
});
app.post("/api/admin/recalculate/:matchId", requireAdmin, (req, res) => {
  const count = recalculateMatch(req.params.matchId);
  saveRankingSnapshot();
  logAction(req.user.id, "recalculate_points", "match", Number(req.params.matchId), `Recalculadas ${count} predicciones`);
  res.json({ ok: true, recalculated: count });
});
app.get("/api/admin/matches/:matchId/predictions", requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.matchId);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (match.status === "open" && !isExpired(match)) {
    return res.status(409).json({ error: "Las apuestas solo se pueden revisar cuando el partido está cerrado." });
  }
  const predictions = db.prepare(`
    SELECT p.*,u.id user_id,COALESCE(NULLIF(u.display_name,''),u.username) username,
      player.name predicted_scorer_name,player.position predicted_scorer_position
    FROM predictions p
    JOIN users u ON u.id=p.user_id
    LEFT JOIN players player ON player.id=p.predicted_scorer_id
    WHERE p.match_id=? AND u.role='user'
    ORDER BY u.username COLLATE NOCASE
  `).all(match.id).map((prediction) => prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0
    ? { ...prediction, predicted_scorer_id: NO_SCORER_ID, predicted_scorer_name: NO_SCORER.name, predicted_scorer_position: NO_SCORER.position }
    : prediction);
  const missingUsers = db.prepare(`
    SELECT u.id user_id,COALESCE(NULLIF(u.display_name,''),u.username) username
    FROM users u
    LEFT JOIN predictions p ON p.user_id=u.id AND p.match_id=?
    WHERE u.active=1 AND u.role='user' AND p.id IS NULL
    ORDER BY username COLLATE NOCASE
  `).all(match.id);
  res.json({ match: serializeMatch(match), predictions, missing_users: missingUsers });
});

app.post("/api/admin/matches/:matchId/predictions", requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.matchId);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (match.status === "open" && !isExpired(match) && !isMatchInPlay(match)) {
    return res.status(409).json({ error: "La apuesta de emergencia solo se puede añadir cuando el plazo ya está cerrado." });
  }
  if (match.status === "finished" || match.result_team1 !== null || match.result_team2 !== null) {
    return res.status(409).json({ error: "No se pueden añadir apuestas cuando el partido ya tiene un resultado final." });
  }
  const userId = Number(req.body.user_id);
  const user = Number.isInteger(userId) && db.prepare(`
    SELECT id,COALESCE(NULLIF(display_name,''),username) username
    FROM users WHERE id=? AND role='user' AND active=1
  `).get(userId);
  if (!user) return res.status(400).json({ error: "Selecciona un usuario activo válido." });
  if (db.prepare("SELECT id FROM predictions WHERE user_id=? AND match_id=?").get(user.id, match.id)) {
    return res.status(409).json({ error: "Este usuario ya tiene una apuesta en el partido." });
  }
  const g1 = parseIntField(req.body.predicted_team1_goals);
  const g2 = parseIntField(req.body.predicted_team2_goals);
  const reason = String(req.body.reason || "").trim();
  const scorerSelection = parseScorerSelection(req.body.predicted_scorer_id);
  if (g1 === null || g2 === null) return res.status(400).json({ error: "El marcador debe contener dos números enteros no negativos." });
  if (reason.length < 5 || reason.length > 500) return res.status(400).json({ error: "Indica un motivo de entre 5 y 500 caracteres." });
  if (!scorerSelection) return res.status(400).json({ error: "Goleador no válido." });
  if (!Number(match.scorer_enabled) && scorerSelection.type !== "none") return res.status(400).json({ error: "Este partido no admite pronóstico de goleador." });
  if (Number(match.scorer_enabled) && g1 + g2 > 0 && scorerSelection.type !== "player") return res.status(400).json({ error: "Selecciona un goleador para un marcador con goles." });
  if (g1 + g2 === 0 && scorerSelection.type === "player") return res.status(400).json({ error: "Un pronóstico 0-0 solo puede incluir Sin goleador." });
  if (g1 + g2 > 0 && scorerSelection.type === "no_scorer") return res.status(400).json({ error: "Sin goleador solo es válido para pronósticos 0-0." });
  const predictedScorerId = scorerSelection.type === "player" ? scorerSelection.playerId : null;
  if (predictedScorerId) {
    const allowedTeamIds = scoringTeamIds(match, g1, g2);
    const player = allowedTeamIds.length && db.prepare(`
      SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
      WHERE p.id=? AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
    `).get(predictedScorerId, ...allowedTeamIds);
    if (!player) return res.status(400).json({ error: "El goleador debe pertenecer a un equipo que marque en el pronóstico." });
  }
  try {
    const stamp = now();
    const result = db.prepare(`
      INSERT INTO predictions(user_id,match_id,predicted_winner,predicted_team1_goals,predicted_team2_goals,
        predicted_scorer_id,locked,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,?,?)
    `).run(user.id, match.id, predictionWinner(g1, g2), g1, g2, predictedScorerId, stamp, stamp);
    const created = db.prepare("SELECT * FROM predictions WHERE id=?").get(result.lastInsertRowid);
    logAction(req.user.id, "create_prediction", "prediction", created.id,
      `Apuesta de emergencia añadida para ${user.username} en ${match.team1} - ${match.team2}. Motivo: ${reason}`,
      null, { ...created, reason });
    res.status(201).json({ ...created, username: user.username, recalculated: false });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "Este usuario ya tiene una apuesta en el partido." });
    throw error;
  }
});

app.patch("/api/admin/matches/:matchId/predictions/:predictionId", requireAdmin, (req, res) => {
  const match = db.prepare("SELECT * FROM matches WHERE id=?").get(req.params.matchId);
  if (!match) return res.status(404).json({ error: "Partido no encontrado." });
  if (match.status === "open" && !isExpired(match)) {
    return res.status(409).json({ error: "No se puede corregir una apuesta mientras el partido está abierto." });
  }
  const before = db.prepare(`
    SELECT p.*,COALESCE(NULLIF(u.display_name,''),u.username) username,u.role
    FROM predictions p JOIN users u ON u.id=p.user_id
    WHERE p.id=? AND p.match_id=?
  `).get(req.params.predictionId, match.id);
  if (!before || before.role !== "user") return res.status(404).json({ error: "Apuesta no encontrada para este partido." });

  const g1 = parseIntField(req.body.predicted_team1_goals);
  const g2 = parseIntField(req.body.predicted_team2_goals);
  const reason = String(req.body.reason || "").trim();
  const scorerSelection = parseScorerSelection(req.body.predicted_scorer_id);
  if (g1 === null || g2 === null) return res.status(400).json({ error: "El marcador debe contener dos números enteros no negativos." });
  if (reason.length < 5 || reason.length > 500) return res.status(400).json({ error: "Indica un motivo de entre 5 y 500 caracteres." });
  if (!scorerSelection) return res.status(400).json({ error: "Goleador no válido." });
  if (!Number(match.scorer_enabled) && scorerSelection.type !== "none") return res.status(400).json({ error: "Este partido no admite pronóstico de goleador." });
  if (Number(match.scorer_enabled) && g1 + g2 > 0 && scorerSelection.type !== "player") return res.status(400).json({ error: "Selecciona un goleador para un marcador con goles." });
  if (g1 + g2 === 0 && scorerSelection.type === "player") return res.status(400).json({ error: "Un pronóstico 0-0 solo puede incluir Sin goleador." });
  if (g1 + g2 > 0 && scorerSelection.type === "no_scorer") return res.status(400).json({ error: "Sin goleador solo es válido para pronósticos 0-0." });

  const predictedScorerId = scorerSelection.type === "player" ? scorerSelection.playerId : null;
  if (predictedScorerId) {
    const allowedTeamIds = scoringTeamIds(match, g1, g2);
    const player = allowedTeamIds.length && db.prepare(`
      SELECT p.id FROM players p JOIN teams t ON t.fifa_code=p.team_fifa_code
      WHERE p.id=? AND t.id IN (${allowedTeamIds.map(() => "?").join(",")})
    `).get(predictedScorerId, ...allowedTeamIds);
    if (!player) return res.status(400).json({ error: "El goleador debe pertenecer a un equipo que marque en el pronóstico." });
  }

  const changed = before.predicted_team1_goals !== g1 || before.predicted_team2_goals !== g2 ||
    (before.predicted_scorer_id ?? null) !== predictedScorerId;
  if (!changed) return res.status(400).json({ error: "La corrección no contiene ningún cambio." });

  const correctPrediction = db.transaction(() => {
    db.prepare(`UPDATE predictions SET predicted_winner=?,predicted_team1_goals=?,predicted_team2_goals=?,
      predicted_scorer_id=?,updated_at=? WHERE id=?`)
      .run(predictionWinner(g1, g2), g1, g2, predictedScorerId, now(), before.id);
    if (match.status === "finished") recalculateMatch(match.id);
    const after = db.prepare("SELECT * FROM predictions WHERE id=?").get(before.id);
    logAction(req.user.id, "edit_prediction", "prediction", before.id,
      `Apuesta corregida para ${before.username} en ${match.team1} - ${match.team2}. Motivo: ${reason}`,
      { ...before, reason: undefined }, { ...after, reason });
    return after;
  });
  const after = correctPrediction();
  if (match.status === "finished") saveRankingSnapshot();
  res.json({ ...after, username: before.username, recalculated: match.status === "finished" });
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
  saveRankingSnapshot();
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
app.get("/api/admin/worldcup-json-status", requireAdmin, (_req, res) => {
  try {
    const catalog = loadWorldCupReference();
    res.json({ synced_at: catalog.synced_at || null, matches: catalog.matches?.length || 0 });
  } catch {
    res.json({ synced_at: null, matches: 0 });
  }
});
app.post("/api/admin/sync-worldcup-json", requireAdmin, async (req, res, next) => {
  try {
    const catalog = await syncWorldCupReference();
    const result = { synced_at: catalog.synced_at, matches: catalog.matches.length };
    logAction(req.user.id, "sync_worldcup_json", "settings", null, "Información JSON sincronizada manualmente", null, result);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
app.get("/api/admin/espn-mapping-status", requireAdmin, (_req, res) => {
  res.json(espnMappingStatus());
});
app.post("/api/admin/sync-espn-mappings", requireAdmin, async (req, res, next) => {
  try {
    const result = await syncEspnMappings();
    logAction(req.user.id, "sync_espn_mappings", "settings", null, "Mapeo ESPN sincronizado manualmente", null, result);
    res.json({ ...result, ...espnMappingStatus() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/clear-espn-live-cache", requireAdmin, (req, res) => {
  const before = db.prepare(`
    SELECT COUNT(*) count FROM matches
    WHERE espn_event_id IS NOT NULL
       OR live_data_json IS NOT NULL
       OR live_updated_at IS NOT NULL
       OR live_completed_at IS NOT NULL
  `).get().count;
  db.prepare(`
    UPDATE matches
    SET espn_event_id=NULL,
        live_data_json=NULL,
        live_updated_at=NULL,
        live_completed_at=NULL
    WHERE espn_event_id IS NOT NULL
       OR live_data_json IS NOT NULL
       OR live_updated_at IS NOT NULL
       OR live_completed_at IS NOT NULL
  `).run();
  logAction(req.user.id, "clear_espn_live_cache", "settings", null, `Caché ESPN Live limpiada en ${before} partidos`, null, { matches_cleared: before });
  res.json({ ok: true, matches_cleared: before });
});
app.get("/api/admin/settings", requireAdmin, (_req, res) => res.json(settings()));
app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const allowed = ["pool_name", "winner_points", "exact_result_points", "scorer_points", "auto_close_enabled", "auto_close_minutes_before", "prediction_reminder_enabled", "knockout_mode_enabled"];
  const numeric = ["winner_points", "exact_result_points", "scorer_points", "auto_close_minutes_before"];
  const booleans = ["auto_close_enabled", "prediction_reminder_enabled", "knockout_mode_enabled"];
  if (numeric.some((key) => req.body[key] !== undefined && (!Number.isInteger(Number(req.body[key])) || Number(req.body[key]) < 0))) {
    return res.status(400).json({ error: "Las puntuaciones y los minutos deben ser enteros positivos o cero." });
  }
  if (booleans.some((key) => req.body[key] !== undefined && !["0", "1", 0, 1, true, false].includes(req.body[key]))) {
    return res.status(400).json({ error: "Configuración no válida." });
  }
  const update = db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at");
  db.transaction(() => allowed.forEach((key) => {
    if (req.body[key] !== undefined) update.run(key, booleans.includes(key) ? settingBooleanValue(req.body[key]) : String(req.body[key]), now());
  }))();
  logAction(req.user.id, "edit_settings", "settings", null, "Configuración actualizada", null, settings());
  res.json(settings());
});

const messageOptions = (messageId) => db.prepare(
  "SELECT id,label,position FROM admin_message_options WHERE message_id=? ORDER BY position,id"
).all(messageId);

app.get("/api/admin-messages/pending", requireAuth, (req, res) => {
  if (req.user.is_read_only) return res.json({ message: null, pending_count: 0 });
  if (req.user.role === "admin") return res.json({ message: null, pending_count: 0 });
  const pending = db.prepare(`
    SELECT m.* FROM admin_messages m
    WHERE NOT EXISTS (
      SELECT 1 FROM admin_message_responses r WHERE r.message_id=m.id AND r.user_id=?
    )
    ORDER BY m.created_at,m.id LIMIT 1
  `).get(req.user.id);
  const count = db.prepare(`
    SELECT COUNT(*) count FROM admin_messages m
    WHERE NOT EXISTS (
      SELECT 1 FROM admin_message_responses r WHERE r.message_id=m.id AND r.user_id=?
    )
  `).get(req.user.id).count;
  res.json({
    message: pending ? { ...pending, options: messageOptions(pending.id) } : null,
    pending_count: count
  });
});

app.post("/api/admin-messages/:id/respond", requireAuth, requireWritableUser, (req, res) => {
  if (req.user.role === "admin") return res.status(403).json({ error: "Los administradores no responden comunicados." });
  const message = db.prepare("SELECT * FROM admin_messages WHERE id=?").get(req.params.id);
  if (!message) return res.status(404).json({ error: "El comunicado ya no existe." });
  let optionId = null;
  if (message.type === "poll") {
    optionId = Number(req.body.option_id);
    const option = db.prepare("SELECT id FROM admin_message_options WHERE id=? AND message_id=?").get(optionId, message.id);
    if (!option) return res.status(400).json({ error: "Selecciona una respuesta válida." });
  }
  db.prepare(`
    INSERT OR IGNORE INTO admin_message_responses(message_id,user_id,option_id,responded_at)
    VALUES(?,?,?,?)
  `).run(message.id, req.user.id, optionId, now());
  res.json({ ok: true });
});

app.get("/api/admin/admin-messages", requireAdmin, (_req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) count FROM users WHERE role='user' AND active=1").get().count;
  const messages = db.prepare(`
    SELECT m.*,u.username created_by_username,
      COUNT(DISTINCT CASE WHEN target.active=1 THEN r.user_id END) responded_count
    FROM admin_messages m
    LEFT JOIN users u ON u.id=m.created_by
    LEFT JOIN admin_message_responses r ON r.message_id=m.id
    LEFT JOIN users target ON target.id=r.user_id AND target.role='user'
    GROUP BY m.id ORDER BY m.created_at DESC,m.id DESC
  `).all();
  res.json(messages.map((message) => {
    const options = messageOptions(message.id).map((option) => {
      const users = db.prepare(`
        SELECT u.id,u.username,r.responded_at FROM admin_message_responses r
        JOIN users u ON u.id=r.user_id
        WHERE r.message_id=? AND r.option_id=? AND u.role='user' AND u.active=1
        ORDER BY u.username
      `).all(message.id, option.id);
      return { ...option, count: users.length, percentage: totalUsers ? Math.round(users.length / totalUsers * 100) : 0, users };
    });
    const respondedUsers = db.prepare(`
      SELECT u.id,u.username,r.responded_at FROM admin_message_responses r
      JOIN users u ON u.id=r.user_id
      WHERE r.message_id=? AND u.role='user' AND u.active=1 ORDER BY u.username
    `).all(message.id);
    const pendingUsers = db.prepare(`
      SELECT u.id,u.username FROM users u
      WHERE u.role='user' AND u.active=1 AND NOT EXISTS (
        SELECT 1 FROM admin_message_responses r WHERE r.message_id=? AND r.user_id=u.id
      ) ORDER BY u.username
    `).all(message.id);
    return {
      ...message, options, responded_users: respondedUsers, pending_users: pendingUsers,
      total_users: totalUsers,
      response_percentage: totalUsers ? Math.round(message.responded_count / totalUsers * 100) : 0
    };
  }));
});

app.post("/api/admin/admin-messages", requireAdmin, (req, res) => {
  const type = req.body.type === "poll" ? "poll" : "message";
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  const options = Array.isArray(req.body.options)
    ? req.body.options.map((value) => String(value || "").trim().slice(0, 80)).filter(Boolean)
    : [];
  if (!title || !body) return res.status(400).json({ error: "Título y mensaje son obligatorios." });
  if (type === "poll" && options.length < 2) return res.status(400).json({ error: "La encuesta necesita al menos dos respuestas." });
  if (options.length > 10) return res.status(400).json({ error: "Puedes crear un máximo de 10 respuestas." });
  const result = db.transaction(() => {
    const created = db.prepare("INSERT INTO admin_messages(type,title,body,created_by,created_at) VALUES(?,?,?,?,?)")
      .run(type, title, body, req.user.id, now());
    const insertOption = db.prepare("INSERT INTO admin_message_options(message_id,label,position) VALUES(?,?,?)");
    options.forEach((label, index) => insertOption.run(created.lastInsertRowid, label, index));
    return created;
  })();
  logAction(req.user.id, "create_admin_message", "admin_message", Number(result.lastInsertRowid), `${type === "poll" ? "Encuesta" : "Mensaje"} creado: ${title}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.delete("/api/admin/admin-messages/:id", requireAdmin, (req, res) => {
  const message = db.prepare("SELECT * FROM admin_messages WHERE id=?").get(req.params.id);
  if (!message) return res.status(404).json({ error: "Comunicado no encontrado." });
  db.prepare("DELETE FROM admin_messages WHERE id=?").run(message.id);
  logAction(req.user.id, "delete_admin_message", "admin_message", message.id, `Comunicado eliminado: ${message.title}`, message, null);
  res.json({ ok: true });
});

app.get("/api/admin/news", requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT n.*,COALESCE(NULLIF(u.display_name,''),u.username) created_by_name
    FROM news_items n LEFT JOIN users u ON u.id=n.created_by
    ORDER BY n.created_at DESC,n.id DESC
  `).all();
  res.json(rows);
});

app.post("/api/admin/news", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  const published = req.body.published === false || req.body.published === 0 || req.body.published === "0" ? 0 : 1;
  if (!title || !body) return res.status(400).json({ error: "Título y contenido son obligatorios." });
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO news_items(title,body,published,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?)
  `).run(title, body, published, req.user.id, stamp, stamp);
  logAction(req.user.id, "create_news", "news_item", Number(result.lastInsertRowid), `Novedad creada: ${title}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.patch("/api/admin/news/:id", requireAdmin, (req, res) => {
  const current = db.prepare("SELECT * FROM news_items WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Novedad no encontrada." });
  const title = req.body.title === undefined ? current.title : String(req.body.title || "").trim().slice(0, 120);
  const body = req.body.body === undefined ? current.body : String(req.body.body || "").trim().slice(0, 2000);
  const published = req.body.published === undefined ? current.published : (req.body.published === false || req.body.published === 0 || req.body.published === "0" ? 0 : 1);
  if (!title || !body) return res.status(400).json({ error: "Título y contenido son obligatorios." });
  const next = { ...current, title, body, published, updated_at: now() };
  db.prepare("UPDATE news_items SET title=?,body=?,published=?,updated_at=? WHERE id=?")
    .run(next.title, next.body, next.published, next.updated_at, current.id);
  logAction(req.user.id, "edit_news", "news_item", current.id, `Novedad actualizada: ${title}`, current, next);
  res.json({ ok: true });
});

app.delete("/api/admin/news/:id", requireAdmin, (req, res) => {
  const current = db.prepare("SELECT * FROM news_items WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Novedad no encontrada." });
  db.prepare("DELETE FROM news_items WHERE id=?").run(current.id);
  logAction(req.user.id, "delete_news", "news_item", current.id, `Novedad eliminada: ${current.title}`, current, null);
  res.json({ ok: true });
});

app.get("/api/announcements/pending", requireAuth, (req, res) => {
  if (req.user.role === "admin" || req.user.is_read_only) return res.json({ announcement: null });
  const announcement = db.transaction(() => {
    const pending = db.prepare(`
      SELECT a.* FROM scheduled_announcements a
      WHERE a.active=1 AND a.starts_at<=?
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_announcement_views v
          WHERE v.announcement_id=a.id AND v.user_id=?
        )
      ORDER BY a.starts_at,a.id LIMIT 1
    `).get(now(), req.user.id);
    if (!pending) return null;
    db.prepare(`
      INSERT OR IGNORE INTO scheduled_announcement_views(announcement_id,user_id,viewed_at)
      VALUES(?,?,?)
    `).run(pending.id, req.user.id, now());
    return pending;
  })();
  res.json({ announcement });
});

app.get("/api/admin/announcements", requireAdmin, (_req, res) => {
  const totalUsers = db.prepare("SELECT COUNT(*) count FROM users WHERE role='user' AND active=1").get().count;
  const rows = db.prepare(`
    SELECT a.*,COUNT(v.user_id) viewed_count
    FROM scheduled_announcements a
    LEFT JOIN scheduled_announcement_views v ON v.announcement_id=a.id
    GROUP BY a.id ORDER BY a.starts_at DESC,a.id DESC
  `).all();
  res.json(rows.map((row) => ({ ...row, total_users: totalUsers })));
});

app.post("/api/admin/announcements", requireAdmin, (req, res) => {
  const title = String(req.body.title || "").trim().slice(0, 120);
  const body = String(req.body.body || "").trim().slice(0, 1000);
  const startsAt = normalizeMatchInstant(req.body.starts_at);
  const seconds = Number(req.body.auto_close_seconds);
  if (!title || !body || !startsAt) return res.status(400).json({ error: "Título, mensaje y fecha de inicio son obligatorios." });
  if (!Number.isInteger(seconds) || (seconds !== 0 && (seconds < 3 || seconds > 60))) return res.status(400).json({ error: "El cierre automático debe estar desactivado o entre 3 y 60 segundos." });
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO scheduled_announcements(title,body,starts_at,active,confetti,auto_close_seconds,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(title, body, startsAt, requestBoolean(req.body.active) ? 1 : 0, requestBoolean(req.body.confetti) ? 1 : 0, seconds, req.user.id, stamp, stamp);
  logAction(req.user.id, "create_announcement", "scheduled_announcement", Number(result.lastInsertRowid), `Anuncio programado: ${title}`);
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.patch("/api/admin/announcements/:id", requireAdmin, (req, res) => {
  const current = db.prepare("SELECT * FROM scheduled_announcements WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Anuncio no encontrado." });
  const title = req.body.title === undefined ? current.title : String(req.body.title || "").trim().slice(0, 120);
  const body = req.body.body === undefined ? current.body : String(req.body.body || "").trim().slice(0, 1000);
  const startsAt = req.body.starts_at === undefined ? current.starts_at : normalizeMatchInstant(req.body.starts_at);
  const seconds = req.body.auto_close_seconds === undefined ? current.auto_close_seconds : Number(req.body.auto_close_seconds);
  if (!title || !body || !startsAt || !Number.isInteger(seconds) || (seconds !== 0 && (seconds < 3 || seconds > 60))) return res.status(400).json({ error: "Datos del anuncio no válidos." });
  const next = {
    title, body, starts_at: startsAt, auto_close_seconds: seconds,
    active: req.body.active === undefined ? current.active : requestBoolean(req.body.active) ? 1 : 0,
    confetti: req.body.confetti === undefined ? current.confetti : requestBoolean(req.body.confetti) ? 1 : 0
  };
  db.prepare("UPDATE scheduled_announcements SET title=?,body=?,starts_at=?,active=?,confetti=?,auto_close_seconds=?,updated_at=? WHERE id=?")
    .run(next.title, next.body, next.starts_at, next.active, next.confetti, next.auto_close_seconds, now(), current.id);
  logAction(req.user.id, "edit_announcement", "scheduled_announcement", current.id, `Anuncio actualizado: ${title}`, current, next);
  res.json({ ok: true });
});

app.delete("/api/admin/announcements/:id", requireAdmin, (req, res) => {
  const current = db.prepare("SELECT * FROM scheduled_announcements WHERE id=?").get(req.params.id);
  if (!current) return res.status(404).json({ error: "Anuncio no encontrado." });
  db.prepare("DELETE FROM scheduled_announcements WHERE id=?").run(current.id);
  logAction(req.user.id, "delete_announcement", "scheduled_announcement", current.id, `Anuncio eliminado: ${current.title}`, current, null);
  res.json({ ok: true });
});

if (fs.existsSync(path.join(frontendDist, "index.html"))) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "La imagen del chat no puede superar los 12 MB y la foto de perfil no puede superar los 5 MB." });
  }
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});
