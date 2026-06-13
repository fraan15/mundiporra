import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(here, "../../data/worldcup-porra.sqlite");
const dbPath = process.env.DB_PATH || defaultPath;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user')),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_date TEXT NOT NULL,
      match_time TEXT NOT NULL,
      stadium TEXT NOT NULL DEFAULT '',
      team1 TEXT NOT NULL,
      team2 TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed','finished')),
      result_team1 INTEGER,
      result_team2 INTEGER,
      winner TEXT CHECK(winner IN ('team1','team2','draw') OR winner IS NULL),
      auto_close_at TEXT NOT NULL,
      close_reason TEXT CHECK(close_reason IN ('manual','automatic') OR close_reason IS NULL),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      predicted_winner TEXT NOT NULL CHECK(predicted_winner IN ('team1','team2','draw')),
      predicted_team1_goals INTEGER NOT NULL CHECK(predicted_team1_goals >= 0),
      predicted_team2_goals INTEGER NOT NULL CHECK(predicted_team2_goals >= 0),
      winner_points INTEGER NOT NULL DEFAULT 0,
      exact_result_points INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE TABLE IF NOT EXISTS points_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      points INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_actions_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_user_id INTEGER REFERENCES users(id),
      action_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      description TEXT NOT NULL,
      before_data TEXT,
      after_data TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expire TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('match_closed','result_published','points_earned','top_three','points_adjustment','match_comment')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      link TEXT,
      read INTEGER NOT NULL DEFAULT 0 CHECK(read IN (0,1)),
      event_key TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      UNIQUE(user_id, event_key)
    );
    CREATE TABLE IF NOT EXISTS match_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_reads (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      read_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ranking_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      snapshot_date TEXT NOT NULL,
      position INTEGER NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date, match_time);
    CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
    CREATE INDEX IF NOT EXISTS idx_log_created ON admin_actions_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_match ON match_comments(match_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
  `);
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("personal_phrase")) db.exec("ALTER TABLE users ADD COLUMN personal_phrase TEXT NOT NULL DEFAULT ''");
  const notificationsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'").get()?.sql || "";
  if (!notificationsSql.includes("'match_comment'")) {
    db.exec(`
      ALTER TABLE notifications RENAME TO notifications_legacy;
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('match_closed','result_published','points_earned','top_three','points_adjustment','match_comment')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        link TEXT,
        read INTEGER NOT NULL DEFAULT 0 CHECK(read IN (0,1)),
        event_key TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT,
        UNIQUE(user_id, event_key)
      );
      INSERT INTO notifications SELECT * FROM notifications_legacy;
      DROP TABLE notifications_legacy;
      CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at);
    `);
  }

  const stamp = now();
  const addSetting = db.prepare("INSERT OR IGNORE INTO app_settings (key,value,updated_at) VALUES (?,?,?)");
  [
    ["pool_name", "La Porra Mundial"],
    ["winner_points", "3"],
    ["exact_result_points", "5"],
    ["auto_close_enabled", "1"],
    ["auto_close_minutes_before", "0"]
  ].forEach(([key, value]) => addSetting.run(key, value, stamp));

  const addUser = db.prepare(`
    INSERT OR IGNORE INTO users (username,password,role,active,created_at,updated_at)
    VALUES (?,?,?,?,?,?)
  `);
  addUser.run("administrador", "yami", "admin", 1, stamp, stamp);
  if (process.env.NODE_ENV === "test" || process.env.SEED_DEMO_DATA === "true") {
    addUser.run("lucia", "lucia", "user", 1, stamp, stamp);
    addUser.run("marcos", "marcos", "user", 1, stamp, stamp);
    addUser.run("sara", "sara", "user", 1, stamp, stamp);
  }

  if (db.prepare("SELECT COUNT(*) count FROM matches").get().count === 0) {
    const year = new Date().getUTCFullYear();
    const addMatch = db.prepare(`
      INSERT INTO matches (match_date,match_time,stadium,team1,team2,status,auto_close_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?)
    `);
    [
      [`${year}-06-18`, "18:00", "Estadio Metropolitano", "España", "Brasil"],
      [`${year}-06-19`, "21:00", "Arena del Atlántico", "Argentina", "Francia"],
      [`${year}-06-20`, "17:00", "Estadio del Sol", "Portugal", "Alemania"],
      [`${year}-06-21`, "20:00", "Arena Central", "México", "Japón"]
    ].forEach(([date, time, stadium, team1, team2]) => {
      addMatch.run(date, time, stadium, team1, team2, new Date(`${date}T${time}:00`).toISOString(), stamp, stamp);
    });
  }
}

export function settings() {
  return Object.fromEntries(db.prepare("SELECT key,value FROM app_settings").all().map((row) => [row.key, row.value]));
}

export function logAction(adminId, actionType, entityType, entityId, description, before = null, after = null) {
  db.prepare(`
    INSERT INTO admin_actions_log
    (admin_user_id,action_type,entity_type,entity_id,description,before_data,after_data,created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(adminId || null, actionType, entityType, entityId || null, description,
    before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, now());
}

export { now };
