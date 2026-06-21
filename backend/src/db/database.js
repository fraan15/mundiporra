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
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

const now = () => new Date().toISOString();
const catalogDir = path.resolve(here, "../../data/catalog");

function importCatalogs() {
  const read = (filename) => JSON.parse(fs.readFileSync(path.join(catalogDir, filename), "utf8"));
  if (!fs.existsSync(catalogDir)) return;
  const teams = read("worldcup.teams.es.json");
  const squads = read("worldcup.squads.es.json");
  const stadiums = read("worldcup.stadiums.json").stadiums;
  const importAll = db.transaction(() => {
    const upsertTeam = db.prepare(`
      INSERT INTO teams(fifa_code,name,group_name,continent,confed,flag_icon)
      VALUES(@fifa_code,@name,@group_name,@continent,@confed,@flag_icon)
      ON CONFLICT(fifa_code) DO UPDATE SET name=excluded.name,group_name=excluded.group_name,
        continent=excluded.continent,confed=excluded.confed,flag_icon=excluded.flag_icon
    `);
    teams.forEach((team) => upsertTeam.run({ ...team, group_name: team.group }));

    const upsertPlayer = db.prepare(`
      INSERT INTO players(team_fifa_code,name,number,position,date_of_birth)
      VALUES(@team_fifa_code,@name,@number,@position,@date_of_birth)
      ON CONFLICT(team_fifa_code,name,date_of_birth) DO UPDATE SET
        number=excluded.number,position=excluded.position
    `);
    squads.forEach((team) => team.players.forEach((player) => upsertPlayer.run({
      team_fifa_code: team.fifa_code, name: player.name, number: player.number,
      position: player.pos, date_of_birth: player.date_of_birth
    })));

    const upsertStadium = db.prepare(`
      INSERT INTO stadiums(name,city,country_code,timezone,capacity,coords)
      VALUES(@name,@city,@country_code,@timezone,@capacity,@coords)
      ON CONFLICT(name,city) DO UPDATE SET country_code=excluded.country_code,
        timezone=excluded.timezone,capacity=excluded.capacity,coords=excluded.coords
    `);
    stadiums.forEach((stadium) => upsertStadium.run({ ...stadium, country_code: stadium.cc.toUpperCase() }));
  });
  importAll();
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL DEFAULT '',
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
      force_published INTEGER NOT NULL DEFAULT 0 CHECK(force_published IN (0,1)),
      is_star INTEGER NOT NULL DEFAULT 0 CHECK(is_star IN (0,1)),
      close_reason TEXT CHECK(close_reason IN ('manual','automatic') OR close_reason IS NULL),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fifa_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      group_name TEXT,
      continent TEXT,
      confed TEXT,
      flag_icon TEXT
    );
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_fifa_code TEXT NOT NULL REFERENCES teams(fifa_code) ON UPDATE CASCADE,
      name TEXT NOT NULL,
      number INTEGER,
      position TEXT,
      date_of_birth TEXT,
      UNIQUE(team_fifa_code,name,date_of_birth)
    );
    CREATE TABLE IF NOT EXISTS stadiums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country_code TEXT,
      timezone TEXT,
      capacity INTEGER,
      coords TEXT,
      UNIQUE(name,city)
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
      scoring_multiplier INTEGER NOT NULL DEFAULT 1,
      locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );
    CREATE TABLE IF NOT EXISTS match_scorers (
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
      PRIMARY KEY(match_id,player_id)
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
      type TEXT NOT NULL CHECK(type IN ('match_available','match_reminder','match_closed','result_published','points_earned','top_three','points_adjustment','match_comment','reaction','chat_reply','chat_mention')),
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
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      match_updates INTEGER NOT NULL DEFAULT 1 CHECK(match_updates IN (0,1)),
      points INTEGER NOT NULL DEFAULT 1 CHECK(points IN (0,1)),
      ranking INTEGER NOT NULL DEFAULT 1 CHECK(ranking IN (0,1)),
      social INTEGER NOT NULL DEFAULT 1 CHECK(social IN (0,1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS match_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      comment TEXT NOT NULL,
      media_type TEXT CHECK(media_type IN ('gif','sticker')),
      media_provider TEXT,
      media_id TEXT,
      media_url TEXT,
      media_preview_url TEXT,
      media_width INTEGER,
      media_height INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK(target_type IN ('prediction','match_comment')),
      target_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id,target_type,target_id,emoji)
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reply_to_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      media_type TEXT CHECK(media_type IN ('gif','sticker','image')),
      media_provider TEXT,
      media_id TEXT,
      media_url TEXT,
      media_preview_url TEXT,
      media_width INTEGER,
      media_height INTEGER,
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
    CREATE TABLE IF NOT EXISTS movement_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT,
      UNIQUE(event_key,user_id)
    );
    CREATE TABLE IF NOT EXISTS admin_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('message','poll')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_message_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_message_responses (
      message_id INTEGER NOT NULL REFERENCES admin_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id INTEGER REFERENCES admin_message_options(id) ON DELETE CASCADE,
      responded_at TEXT NOT NULL,
      PRIMARY KEY(message_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(match_date, match_time);
    CREATE INDEX IF NOT EXISTS idx_matches_status_close ON matches(status, auto_close_at);
    CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_fifa_code ON teams(fifa_code);
    CREATE INDEX IF NOT EXISTS idx_players_team_fifa_code ON players(team_fifa_code);
    CREATE INDEX IF NOT EXISTS idx_players_name ON players(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_stadiums_name ON stadiums(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_match_scorers_player ON match_scorers(player_id);
    CREATE INDEX IF NOT EXISTS idx_log_created ON admin_actions_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_match ON match_comments(match_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type,target_id);
    CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_message_responses_user ON admin_message_responses(user_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_movement_summaries_pending ON movement_summaries(user_id,seen_at,created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
    CREATE INDEX IF NOT EXISTS idx_points_adjustments_user ON points_adjustments(user_id);
  `);

  const commentColumns = new Set(db.prepare("PRAGMA table_info(match_comments)").all().map((column) => column.name));
  const commentMediaColumns = {
    media_type: "TEXT CHECK(media_type IN ('gif','sticker'))",
    media_provider: "TEXT",
    media_id: "TEXT",
    media_url: "TEXT",
    media_preview_url: "TEXT",
    media_width: "INTEGER",
    media_height: "INTEGER"
  };
  for (const [name, definition] of Object.entries(commentMediaColumns)) {
    if (!commentColumns.has(name)) db.exec(`ALTER TABLE match_comments ADD COLUMN ${name} ${definition}`);
  }
  const chatColumns = new Set(db.prepare("PRAGMA table_info(chat_messages)").all().map((column) => column.name));
  const chatMediaColumns = {
    media_type: "TEXT CHECK(media_type IN ('gif','sticker','image'))",
    media_provider: "TEXT",
    media_id: "TEXT",
    media_url: "TEXT",
    media_preview_url: "TEXT",
    media_width: "INTEGER",
    media_height: "INTEGER"
  };
  for (const [name, definition] of Object.entries(chatMediaColumns)) {
    if (!chatColumns.has(name)) db.exec(`ALTER TABLE chat_messages ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`
    DELETE FROM reactions
    WHERE id NOT IN (SELECT MAX(id) FROM reactions GROUP BY user_id,target_type,target_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reactions_one_per_target
      ON reactions(user_id,target_type,target_id);
  `);
  const userColumns = db.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  if (!userColumns.includes("personal_phrase")) db.exec("ALTER TABLE users ADD COLUMN personal_phrase TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes("avatar_filename")) db.exec("ALTER TABLE users ADD COLUMN avatar_filename TEXT");
  if (!userColumns.includes("display_name")) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE users SET display_name=username WHERE TRIM(display_name)=''");
  db.exec(`CREATE TABLE IF NOT EXISTS display_name_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    previous_name TEXT NOT NULL,
    new_name TEXT NOT NULL,
    changed_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS idx_display_name_changes_user_time ON display_name_changes(user_id,changed_at);`);
  const matchColumns = db.prepare("PRAGMA table_info(matches)").all().map((column) => column.name);
  if (!matchColumns.includes("force_published")) db.exec("ALTER TABLE matches ADD COLUMN force_published INTEGER NOT NULL DEFAULT 0 CHECK(force_published IN (0,1))");
  if (!matchColumns.includes("is_star")) db.exec("ALTER TABLE matches ADD COLUMN is_star INTEGER NOT NULL DEFAULT 0 CHECK(is_star IN (0,1))");
  if (!matchColumns.includes("team1_id")) db.exec("ALTER TABLE matches ADD COLUMN team1_id INTEGER REFERENCES teams(id)");
  if (!matchColumns.includes("team2_id")) db.exec("ALTER TABLE matches ADD COLUMN team2_id INTEGER REFERENCES teams(id)");
  if (!matchColumns.includes("stadium_id")) db.exec("ALTER TABLE matches ADD COLUMN stadium_id INTEGER REFERENCES stadiums(id)");
  if (!matchColumns.includes("scorer_enabled")) {
    db.exec(`
      ALTER TABLE matches ADD COLUMN scorer_enabled INTEGER NOT NULL DEFAULT 1 CHECK(scorer_enabled IN (0,1));
      UPDATE matches SET scorer_enabled=0;
    `);
  }
  const predictionColumns = db.prepare("PRAGMA table_info(predictions)").all().map((column) => column.name);
  if (!predictionColumns.includes("scoring_multiplier")) db.exec("ALTER TABLE predictions ADD COLUMN scoring_multiplier INTEGER NOT NULL DEFAULT 1");
  if (!predictionColumns.includes("predicted_scorer_id")) db.exec("ALTER TABLE predictions ADD COLUMN predicted_scorer_id INTEGER REFERENCES players(id)");
  if (!predictionColumns.includes("scorer_points")) db.exec("ALTER TABLE predictions ADD COLUMN scorer_points INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_matches_team1_id ON matches(team1_id);
    CREATE INDEX IF NOT EXISTS idx_matches_team2_id ON matches(team2_id);
    CREATE INDEX IF NOT EXISTS idx_matches_stadium_id ON matches(stadium_id);
    CREATE INDEX IF NOT EXISTS idx_predictions_scorer ON predictions(predicted_scorer_id);
  `);
  importCatalogs();
  db.exec(`
    UPDATE matches SET team1_id=(SELECT id FROM teams WHERE teams.name=matches.team1)
      WHERE team1_id IS NULL AND (SELECT COUNT(*) FROM teams WHERE teams.name=matches.team1)=1;
    UPDATE matches SET team2_id=(SELECT id FROM teams WHERE teams.name=matches.team2)
      WHERE team2_id IS NULL AND (SELECT COUNT(*) FROM teams WHERE teams.name=matches.team2)=1;
    UPDATE matches SET stadium_id=(SELECT id FROM stadiums WHERE stadiums.name=matches.stadium)
      WHERE stadium_id IS NULL AND stadium!='' AND (SELECT COUNT(*) FROM stadiums WHERE stadiums.name=matches.stadium)=1;
  `);
  const notificationsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='notifications'").get()?.sql || "";
  if (!notificationsSql.includes("'match_comment'") || !notificationsSql.includes("'match_available'") || !notificationsSql.includes("'match_reminder'") || !notificationsSql.includes("'reaction'") || !notificationsSql.includes("'chat_reply'") || !notificationsSql.includes("'chat_mention'")) {
    db.exec(`
      ALTER TABLE notifications RENAME TO notifications_legacy;
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK(type IN ('match_available','match_reminder','match_closed','result_published','points_earned','top_three','points_adjustment','match_comment','reaction','chat_reply','chat_mention')),
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
    ["scorer_points", "2"],
    ["auto_close_enabled", "1"],
    ["auto_close_minutes_before", "0"],
    ["prediction_reminder_enabled", "1"]
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
