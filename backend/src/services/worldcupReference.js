import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const catalogDir = path.join(root, "data/catalog");
export const referencePath = path.join(catalogDir, "worldcup.matches.es.json");
export const rawReferencePath = path.join(catalogDir, "worldcup.json");
export const rawReferenceV2Path = path.join(catalogDir, "worldcup.v2.json");
const legacyRawReferencePath = path.join(catalogDir, "worldcup.raw.json");
export const WORLD_CUP_SOURCE_URL = process.env.WORLD_CUP_JSON_URL ||
  "https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json";
export const WORLD_CUP_V2_SOURCE_URL = process.env.WORLD_CUP_JSON_V2_URL ||
  "https://raw.githubusercontent.com/upbound-web/worldcup-live.json/refs/heads/master/2026/worldcup.json";

const teamAliases = new Map([
  ["Mexico", "MEX"], ["South Africa", "RSA"], ["South Korea", "KOR"], ["Czech Republic", "CZE"],
  ["Canada", "CAN"], ["Bosnia & Herzegovina", "BIH"], ["Qatar", "QAT"], ["Switzerland", "SUI"],
  ["Brazil", "BRA"], ["Morocco", "MAR"], ["Haiti", "HAI"], ["Scotland", "SCO"],
  ["USA", "USA"], ["Paraguay", "PAR"], ["Australia", "AUS"], ["Turkey", "TUR"],
  ["Germany", "GER"], ["Curaçao", "CUW"], ["Ivory Coast", "CIV"], ["Ecuador", "ECU"],
  ["Netherlands", "NED"], ["Japan", "JPN"], ["Sweden", "SWE"], ["Tunisia", "TUN"],
  ["Belgium", "BEL"], ["Egypt", "EGY"], ["Iran", "IRN"], ["New Zealand", "NZL"],
  ["Spain", "ESP"], ["Cape Verde", "CPV"], ["Saudi Arabia", "KSA"], ["Uruguay", "URU"],
  ["France", "FRA"], ["Senegal", "SEN"], ["Iraq", "IRQ"], ["Norway", "NOR"],
  ["Argentina", "ARG"], ["Algeria", "ALG"], ["Austria", "AUT"], ["Jordan", "JOR"],
  ["Portugal", "POR"], ["DR Congo", "COD"], ["Uzbekistan", "UZB"], ["Colombia", "COL"],
  ["England", "ENG"], ["Croatia", "CRO"], ["Ghana", "GHA"], ["Panama", "PAN"]
]);

const teamNameFixes = new Map([
  ["CuraÃ§ao", "Curaçao"],
  ["Curacao", "Curaçao"]
]);

export const worldCupGroups = [
  { name: "Group A", teams: ["Mexico", "South Africa", "South Korea", "Czech Republic"] },
  { name: "Group B", teams: ["Canada", "Bosnia & Herzegovina", "Qatar", "Switzerland"] },
  { name: "Group C", teams: ["Brazil", "Morocco", "Haiti", "Scotland"] },
  { name: "Group D", teams: ["USA", "Paraguay", "Australia", "Turkey"] },
  { name: "Group E", teams: ["Germany", "Curaçao", "Ivory Coast", "Ecuador"] },
  { name: "Group F", teams: ["Netherlands", "Japan", "Sweden", "Tunisia"] },
  { name: "Group G", teams: ["Belgium", "Egypt", "Iran", "New Zealand"] },
  { name: "Group H", teams: ["Spain", "Cape Verde", "Saudi Arabia", "Uruguay"] },
  { name: "Group I", teams: ["France", "Senegal", "Iraq", "Norway"] },
  { name: "Group J", teams: ["Argentina", "Algeria", "Austria", "Jordan"] },
  { name: "Group K", teams: ["Portugal", "DR Congo", "Uzbekistan", "Colombia"] },
  { name: "Group L", teams: ["England", "Croatia", "Ghana", "Panama"] }
];

const madridFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
  hourCycle: "h23"
});

function readCatalog(filename) {
  return JSON.parse(fs.readFileSync(path.join(catalogDir, filename), "utf8"));
}

function writeRawReference(rawPath, source) {
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(`${rawPath}.tmp`, `${JSON.stringify(source, null, 2)}\n`);
  fs.renameSync(`${rawPath}.tmp`, rawPath);
}

function normalizeTeam(name, teamByCode) {
  const fixedName = teamNameFixes.get(name) || name;
  const fifaCode = teamAliases.get(fixedName) || null;
  const team = fifaCode ? teamByCode.get(fifaCode) : null;
  return { source_name: fixedName, fifa_code: fifaCode, name_es: team?.name || fixedName };
}

function normalizeDateTime(date, time) {
  const match = String(time || "").match(/^(\d{2}):(\d{2}) UTC([+-]\d{1,2})$/);
  if (!match) return { match_date: date, match_time: "", starts_at: null };
  const [, hour, minute, offsetHours] = match;
  const startsAt = new Date(Date.UTC(
    Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)),
    Number(hour) - Number(offsetHours), Number(minute)
  ));
  const parts = Object.fromEntries(madridFormatter.formatToParts(startsAt).map(({ type, value }) => [type, value]));
  return {
    match_date: `${parts.year}-${parts.month}-${parts.day}`,
    match_time: `${parts.hour}:${parts.minute}`,
    starts_at: startsAt.toISOString()
  };
}

function normalizeScore(score) {
  return Array.isArray(score?.ft) && score.ft.length === 2
    ? { ft: [Number(score.ft[0]), Number(score.ft[1])], ht: Array.isArray(score.ht) ? score.ht : null }
    : null;
}

function normalizeGoals(goals) {
  return Array.isArray(goals)
    ? goals.map((goal) => ({
      name: String(goal?.name || "").trim(),
      minute: String(goal?.minute || "").trim()
    })).filter((goal) => goal.name)
    : [];
}

export function normalizePlayerName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[ıİ]/g, "i")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}

function canonicalPlayerName(name, playerNames = null) {
  if (!playerNames) return name;
  if (playerNames instanceof Map) return playerNames.get(normalizePlayerName(name)) || null;
  if (playerNames.has(name)) return name;
  return playerNames.has(normalizePlayerName(name)) ? name : null;
}

export function isKnockoutRound(round) {
  return Boolean(round) && !/^Matchday\b/i.test(String(round).trim());
}

export function normalizeWorldCupReference(source, options = {}) {
  const teams = options.teams || readCatalog("worldcup.teams.es.json");
  const stadiums = options.stadiums || readCatalog("worldcup.stadiums.json").stadiums;
  const teamByCode = new Map(teams.map((team) => [team.fifa_code, team]));
  const stadiumByCity = new Map(stadiums.map((stadium) => [stadium.city, stadium]));
  const matches = (source.matches || []).map((match, index) => {
    const stadium = stadiumByCity.get(match.ground);
    return {
      reference_id: index + 1,
      round: match.round,
      is_knockout: isKnockoutRound(match.round),
      group: match.group || null,
      ...normalizeDateTime(match.date, match.time),
      team1: normalizeTeam(match.team1, teamByCode),
      team2: normalizeTeam(match.team2, teamByCode),
      stadium: stadium ? { name: stadium.name, city: stadium.city } : { name: null, city: match.ground },
      score: normalizeScore(match.score),
      goals1: normalizeGoals(match.goals1),
      goals2: normalizeGoals(match.goals2),
      source: { date: match.date, time: match.time }
    };
  });
  return {
    name: source.name,
    language: "es",
    display_timezone: "Europe/Madrid",
    generated_from: options.generatedFrom || "worldcup.json",
    source_url: options.sourceUrl || null,
    synced_at: options.syncedAt || new Date().toISOString(),
    matches
  };
}

export function loadWorldCupReference() {
  const rawPath = fs.existsSync(rawReferencePath)
    ? rawReferencePath
    : fs.existsSync(legacyRawReferencePath)
      ? legacyRawReferencePath
      : null;
  if (rawPath) {
    const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
    return normalizeWorldCupReference(raw, {
      generatedFrom: "worldcup.json",
      sourceUrl: WORLD_CUP_SOURCE_URL,
      syncedAt: fs.statSync(rawPath).mtime.toISOString()
    });
  }
  return JSON.parse(fs.readFileSync(referencePath, "utf8"));
}

export function loadWorldCupReferenceV2() {
  if (!fs.existsSync(rawReferenceV2Path)) {
    throw new Error("Todavía no hay ningún worldcup.json v2 descargado.");
  }
  const raw = JSON.parse(fs.readFileSync(rawReferenceV2Path, "utf8"));
  return normalizeWorldCupReference(raw, {
    generatedFrom: "worldcup.v2.json",
    sourceUrl: WORLD_CUP_V2_SOURCE_URL,
    syncedAt: fs.statSync(rawReferenceV2Path).mtime.toISOString()
  });
}

export async function syncWorldCupReference({ fetchImpl = globalThis.fetch, sourceUrl = WORLD_CUP_SOURCE_URL } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No hay fetch disponible para descargar el calendario.");
  const response = await fetchImpl(sourceUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`No se pudo descargar worldcup.json (${response.status}).`);
  const source = await response.json();
  const normalized = normalizeWorldCupReference(source, {
    generatedFrom: "worldcup.json",
    sourceUrl,
    syncedAt: new Date().toISOString()
  });
  writeRawReference(rawReferencePath, source);
  return normalized;
}

export async function syncWorldCupReferenceV2({ fetchImpl = globalThis.fetch, sourceUrl = WORLD_CUP_V2_SOURCE_URL } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("No hay fetch disponible para descargar el calendario.");
  const response = await fetchImpl(sourceUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`No se pudo descargar worldcup.json v2 (${response.status}).`);
  const source = await response.json();
  const normalized = normalizeWorldCupReference(source, {
    generatedFrom: "worldcup.v2.json",
    sourceUrl,
    syncedAt: new Date().toISOString()
  });
  writeRawReference(rawReferenceV2Path, source);
  return normalized;
}

function referenceStatsForTeam(catalog, team, playerNames = null) {
  const playedMatches = catalog.matches
    .filter((match) => match.score?.ft && [match.team1.fifa_code, match.team2.fifa_code].includes(team.fifa_code))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  const stats = playedMatches.reduce((summary, match) => {
    const home = match.team1.fifa_code === team.fifa_code;
    const goalsFor = home ? match.score.ft[0] : match.score.ft[1];
    const goalsAgainst = home ? match.score.ft[1] : match.score.ft[0];
    summary.played += 1;
    summary.goals_for += goalsFor;
    summary.goals_against += goalsAgainst;
    if (goalsFor > goalsAgainst) summary.won += 1;
    else if (goalsFor < goalsAgainst) summary.lost += 1;
    else summary.drawn += 1;
    return summary;
  }, { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 });
  stats.goal_difference = stats.goals_for - stats.goals_against;
  stats.points = stats.won * 3 + stats.drawn;
  stats.win_percentage = stats.played ? Math.round(stats.won / stats.played * 100) : 0;
  const recent_matches = playedMatches.slice(0, 10).map((match) => {
    const home = match.team1.fifa_code === team.fifa_code;
    const goals_for = home ? match.score.ft[0] : match.score.ft[1];
    const goals_against = home ? match.score.ft[1] : match.score.ft[0];
    const teamGoals = home ? match.goals1 : match.goals2;
    const opponentGoals = home ? match.goals2 : match.goals1;
    return {
      id: `ref-${match.reference_id}`,
      source: "worldcup_json",
      match_date: match.match_date,
      match_time: match.match_time,
      opponent: home ? match.team2.name_es : match.team1.name_es,
      goals_for,
      goals_against,
      scorers: {
        team: teamGoals || [],
        opponent: opponentGoals || []
      },
      outcome: goals_for > goals_against ? "W" : goals_for < goals_against ? "L" : "D"
    };
  });
  const scorersByName = new Map();
  playedMatches.forEach((match) => {
    const home = match.team1.fifa_code === team.fifa_code;
    const teamGoals = home ? match.goals1 : match.goals2;
    (teamGoals || []).forEach((goal) => {
      const name = canonicalPlayerName(goal.name, playerNames);
      if (!name) return;
      const current = scorersByName.get(name) || { name, goals: 0 };
      current.goals += 1;
      scorersByName.set(name, current);
    });
  });
  const top_scorers = [...scorersByName.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, "es"))
    .slice(0, 3);
  return { stats, recent_matches, top_scorers, source: "worldcup_json", synced_at: catalog.synced_at || null };
}

export function teamReferenceStats(team, playerNames = null) {
  try {
    return referenceStatsForTeam(loadWorldCupReference(), team, playerNames);
  } catch {
    return null;
  }
}

function standingSeed(teamName, teamsByCode) {
  const fifaCode = teamAliases.get(teamName) || null;
  const team = fifaCode ? teamsByCode.get(fifaCode) : null;
  return {
    fifa_code: fifaCode,
    source_name: teamName,
    name: team?.name || teamName,
    flag_icon: team?.flag_icon || null,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0
  };
}

function applyStandingMatch(standing, goalsFor, goalsAgainst) {
  standing.played += 1;
  standing.goals_for += goalsFor;
  standing.goals_against += goalsAgainst;
  standing.goal_difference = standing.goals_for - standing.goals_against;
  if (goalsFor > goalsAgainst) standing.won += 1;
  else if (goalsFor < goalsAgainst) standing.lost += 1;
  else standing.drawn += 1;
  standing.points = standing.won * 3 + standing.drawn;
}

export function worldCupOverview() {
  const catalog = loadWorldCupReference();
  const teams = readCatalog("worldcup.teams.es.json");
  const teamsByCode = new Map(teams.map((team) => [team.fifa_code, team]));
  const groups = worldCupGroups.map((group) => {
    const standings = group.teams.map((teamName) => standingSeed(teamName, teamsByCode));
    const standingsByCode = new Map(standings.map((team) => [team.fifa_code, team]));
    catalog.matches
      .filter((match) => match.group === group.name && match.score?.ft)
      .forEach((match) => {
        const home = standingsByCode.get(match.team1.fifa_code);
        const away = standingsByCode.get(match.team2.fifa_code);
        if (!home || !away) return;
        applyStandingMatch(home, match.score.ft[0], match.score.ft[1]);
        applyStandingMatch(away, match.score.ft[1], match.score.ft[0]);
      });
    standings.sort((a, b) =>
      b.points - a.points ||
      b.goal_difference - a.goal_difference ||
      b.goals_for - a.goals_for ||
      a.name.localeCompare(b.name, "es")
    );
    return { name: group.name, standings };
  });
  const knockout_matches = catalog.matches
    .filter((match) => match.is_knockout)
    .map((match) => ({
      reference_id: match.reference_id,
      round: match.round,
      match_date: match.match_date,
      match_time: match.match_time,
      source_date: match.source?.date || match.match_date,
      source_time: match.source?.time || "",
      team1: match.team1.name_es || match.team1.source_name,
      team2: match.team2.name_es || match.team2.source_name,
      team1_code: match.team1.fifa_code,
      team2_code: match.team2.fifa_code,
      stadium: match.stadium,
      score: match.score
    }));
  return {
    name: catalog.name,
    synced_at: catalog.synced_at || null,
    groups,
    knockout_matches
  };
}

export function startWorldCupReferenceSync({ logger = console, intervalMs = 60 * 60 * 1000 } = {}) {
  if (process.env.WORLD_CUP_SYNC_ENABLED === "false") return { stop() {} };
  let timer = null;
  let stopped = false;
  const run = async () => {
    try {
      const catalog = await syncWorldCupReference();
      logger.log(`[worldcup] JSON sincronizado: ${catalog.matches.length} partidos.`);
      const catalogV2 = await syncWorldCupReferenceV2();
      logger.log(`[worldcup] JSON v2 sincronizado: ${catalogV2.matches.length} partidos.`);
    } catch (error) {
      logger.error(`[worldcup] No se pudo sincronizar worldcup.json: ${error.message}`);
    } finally {
      if (!stopped) {
        timer = setTimeout(run, intervalMs);
        timer.unref?.();
      }
    }
  };
  timer = setTimeout(run, 0);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}
