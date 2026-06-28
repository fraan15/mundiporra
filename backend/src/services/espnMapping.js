import { db, now } from "../db/database.js";
import { normalizePlayerName } from "./worldcupReference.js";

const TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams";
const ROSTER_URL = (teamId) => `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams/${encodeURIComponent(teamId)}/roster`;
const REQUEST_TIMEOUT_MS = 10000;

const ESPN_TO_FIFA = {
  GER: "DEU",
  NED: "NLD",
  SUI: "CHE",
  KSA: "SAU",
  CRC: "CRI",
  CRO: "HRV",
  ZAF: "RSA",
};

const normalizeCode = (value) => ESPN_TO_FIFA[String(value || "").toUpperCase()] || String(value || "").toUpperCase();
const teamNameKey = (value) => normalizePlayerName(value)
  .replace(/\b(?:fc|cf|national|team|men|mens)\b/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const jerseyNumber = (value) => {
  const parsed = Number(String(value ?? "").match(/\d+/)?.[0]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const ROSTER_REPLACEMENT_OVERRIDES = [
  {
    teamCode: "MAR",
    number: 17,
    espnNames: ["abde ezzalzouli", "abdessamad ezzalzouli"],
    localNames: ["amine sbai"],
  },
  {
    teamCode: "ARG",
    number: 15,
    espnNames: ["nico gonzalez", "nicolas gonzalez"],
    localNames: ["nico gonzalez", "nicolas gonzalez"],
  },
];

const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "MundiPorra/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ESPN respondió ${response.status} en ${url}`);
  return response.json();
};

const extractTeams = (payload) => payload?.sports?.flatMap((sport) =>
  sport.leagues?.flatMap((league) => league.teams?.map((entry) => entry.team).filter(Boolean) || []) || []
) || [];

const indexLocalPlayers = (fifaCode) => {
  const rows = db.prepare("SELECT id,name,number,date_of_birth,espn_id FROM players WHERE team_fifa_code=?").all(fifaCode);
  const byName = new Map();
  const byBirthDate = new Map();
  const byNumber = new Map();
  for (const row of rows) {
    const key = normalizePlayerName(row.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(row);
    if (row.number !== null && row.number !== undefined) {
      const keyNumber = Number(row.number);
      if (!byNumber.has(keyNumber)) byNumber.set(keyNumber, []);
      byNumber.get(keyNumber).push(row);
    }
    if (row.date_of_birth) {
      if (!byBirthDate.has(row.date_of_birth)) byBirthDate.set(row.date_of_birth, []);
      byBirthDate.get(row.date_of_birth).push(row);
    }
  }
  return { rows, byName, byBirthDate, byNumber };
};

const playerNameKeys = (athlete) => [...new Set([
  athlete.fullName,
  athlete.displayName,
  `${athlete.firstName || ""} ${athlete.lastName || ""}`,
  athlete.shortName,
].map(normalizePlayerName).filter(Boolean))];

const tokenCompatible = (left = "", right = "") =>
  Boolean(left && right) && (left[0] === right[0] || left.startsWith(right) || right.startsWith(left));

const fuzzyNameCandidates = (athlete, players) => {
  const keys = playerNameKeys(athlete);
  const best = new Map();
  for (const key of keys) {
    const tokens = key.split(" ").filter(Boolean);
    const first = tokens[0], surname = tokens.at(-1);
    if (!first || !surname || surname.length < 4) continue;
    for (const player of players) {
      const playerTokens = normalizePlayerName(player.name).split(" ").filter(Boolean);
      const playerFirst = playerTokens[0], playerSurname = playerTokens.at(-1);
      if (playerSurname === surname && tokenCompatible(first, playerFirst)) best.set(player.id, player);
    }
  }
  return [...best.values()];
};

const firstUnique = (...groups) => {
  for (const group of groups) {
    const unique = [...new Map((group || []).map((player) => [player.id, player])).values()];
    if (unique.length === 1) return unique;
    if (unique.length > 1) return unique;
  }
  return [];
};

const localTeamCandidates = (espnTeam) => [
  espnTeam.abbreviation,
  normalizeCode(espnTeam.abbreviation),
  espnTeam.shortDisplayName,
  espnTeam.displayName,
  espnTeam.name,
  espnTeam.location,
].filter(Boolean);

const findLocalTeam = (espnTeam, indexes) => {
  for (const value of localTeamCandidates(espnTeam)) {
    const raw = String(value || "").toUpperCase();
    const byCode = indexes.byCode.get(raw) || indexes.byCode.get(normalizeCode(raw));
    if (byCode) return byCode;
    const byName = indexes.byName.get(teamNameKey(value));
    if (byName) return byName;
  }
  return null;
};

const rosterReplacementCandidates = (localTeam, athlete, rows, number) => {
  const athleteNames = new Set(playerNameKeys(athlete));
  return ROSTER_REPLACEMENT_OVERRIDES
    .filter((item) => item.teamCode === localTeam.fifa_code && item.number === number)
    .filter((item) => item.espnNames.some((name) => athleteNames.has(normalizePlayerName(name))))
    .flatMap((item) => rows.filter((player) =>
      Number(player.number) === item.number &&
      item.localNames.some((name) => normalizePlayerName(player.name) === normalizePlayerName(name))
    ));
};

export async function syncEspnMappings() {
  const startedAt = now();
  const teamsPayload = await fetchJson(TEAMS_URL);
  const espnTeams = extractTeams(teamsPayload);
  const localTeams = db.prepare("SELECT id,fifa_code,name,espn_id FROM teams").all();
  const localByCode = new Map();
  const localByName = new Map();
  for (const team of localTeams) {
    localByCode.set(String(team.fifa_code || "").toUpperCase(), team);
    localByCode.set(normalizeCode(team.fifa_code), team);
    localByName.set(teamNameKey(team.name), team);
  }
  const updateTeam = db.prepare("UPDATE teams SET espn_id=? WHERE id=?");
  const updatePlayer = db.prepare("UPDATE players SET espn_id=? WHERE id=?");
  const clearDuplicatePlayer = db.prepare("UPDATE players SET espn_id=NULL WHERE espn_id=? AND id<>?");

  const summary = {
    synced_at: startedAt,
    teams_seen: espnTeams.length,
    teams_mapped: 0,
    teams_unmapped: [],
    players_seen: 0,
    players_mapped: 0,
    players_already_mapped: 0,
    players_unmapped: [],
    players_ambiguous: [],
  };

  for (const espnTeam of espnTeams) {
    const fifaCode = normalizeCode(espnTeam.abbreviation);
    const localTeam = findLocalTeam(espnTeam, { byCode: localByCode, byName: localByName });
    if (!localTeam) {
      summary.teams_unmapped.push({ espn_id: String(espnTeam.id), code: fifaCode, name: espnTeam.displayName || espnTeam.name });
      continue;
    }
    updateTeam.run(String(espnTeam.id), localTeam.id);
    summary.teams_mapped++;

    let roster;
    try {
      roster = await fetchJson(ROSTER_URL(espnTeam.id));
    } catch (error) {
      summary.players_unmapped.push({ team: localTeam.name, reason: error.message });
      continue;
    }
    const { rows, byName, byBirthDate, byNumber } = indexLocalPlayers(localTeam.fifa_code);
    for (const athlete of roster.athletes || []) {
      summary.players_seen++;
      const espnId = String(athlete.id || "");
      if (!espnId) continue;
      const exactMapped = db.prepare("SELECT id,team_fifa_code FROM players WHERE espn_id=?").get(espnId);
      if (exactMapped?.team_fifa_code === localTeam.fifa_code) {
        summary.players_already_mapped++;
        continue;
      }
      const nameCandidates = [];
      for (const key of playerNameKeys(athlete)) {
        for (const player of byName.get(key) || []) nameCandidates.push(player);
      }
      const uniqueByName = [...new Map(nameCandidates.map((player) => [player.id, player])).values()];
      const uniqueByFuzzyName = fuzzyNameCandidates(athlete, rows);
      const birthDate = String(athlete.dateOfBirth || "").slice(0, 10);
      const uniqueByBirthDate = [...new Map((byBirthDate.get(birthDate) || []).map((player) => [player.id, player])).values()];
      const number = jerseyNumber(athlete.jersey || athlete.displayJersey || athlete.uniform || athlete.number);
      const uniqueByNumber = [...new Map((byNumber.get(number) || []).map((player) => [player.id, player])).values()];
      const fuzzyWithNumber = number ? uniqueByFuzzyName.filter((player) => Number(player.number) === number) : [];
      const nameWithNumber = number ? uniqueByName.filter((player) => Number(player.number) === number) : [];
      const replacementOverride = number ? rosterReplacementCandidates(localTeam, athlete, rows, number) : [];
      const unique = firstUnique(replacementOverride, uniqueByName, uniqueByBirthDate, nameWithNumber, fuzzyWithNumber, uniqueByNumber, uniqueByFuzzyName);
      if (unique.length === 1) {
        clearDuplicatePlayer.run(espnId, unique[0].id);
        updatePlayer.run(espnId, unique[0].id);
        summary.players_mapped++;
      } else if (unique.length > 1) {
        summary.players_ambiguous.push({ team: localTeam.name, espn_id: espnId, espn_name: athlete.displayName || athlete.fullName, candidates: unique.map((player) => player.name) });
      } else {
        summary.players_unmapped.push({ team: localTeam.name, espn_id: espnId, espn_name: athlete.displayName || athlete.fullName });
      }
    }
  }

  return summary;
}

export function espnMappingStatus() {
  const teams = db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN espn_id IS NOT NULL AND espn_id!='' THEN 1 ELSE 0 END) mapped FROM teams").get();
  const players = db.prepare("SELECT COUNT(*) total,SUM(CASE WHEN espn_id IS NOT NULL AND espn_id!='' THEN 1 ELSE 0 END) mapped FROM players").get();
  const teamsUnmapped = db.prepare(`
    SELECT fifa_code code,name
    FROM teams
    WHERE espn_id IS NULL OR espn_id=''
    ORDER BY name
  `).all();
  const playersUnmapped = db.prepare(`
    SELECT p.id,p.name,p.number,p.position,p.team_fifa_code team_code,t.name team
    FROM players p
    JOIN teams t ON t.fifa_code=p.team_fifa_code
    WHERE p.espn_id IS NULL OR p.espn_id=''
    ORDER BY t.name,p.number IS NULL,p.number,p.name
  `).all();
  return {
    teams_total: teams.total || 0,
    teams_mapped: teams.mapped || 0,
    players_total: players.total || 0,
    players_mapped: players.mapped || 0,
    teams_unmapped_local: teamsUnmapped,
    players_unmapped_local: playersUnmapped,
  };
}
