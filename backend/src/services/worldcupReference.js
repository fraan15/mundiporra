import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const catalogDir = path.join(root, "data/catalog");
export const referencePath = path.join(catalogDir, "worldcup.matches.es.json");
export const rawReferencePath = path.join(catalogDir, "worldcup.raw.json");
export const WORLD_CUP_SOURCE_URL = process.env.WORLD_CUP_JSON_URL ||
  "https://raw.githubusercontent.com/openfootball/worldcup.json/refs/heads/master/2026/worldcup.json";

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

const madridFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit",
  hourCycle: "h23"
});

function readCatalog(filename) {
  return JSON.parse(fs.readFileSync(path.join(catalogDir, filename), "utf8"));
}

function normalizeTeam(name, teamByCode) {
  const fifaCode = teamAliases.get(name) || null;
  const team = fifaCode ? teamByCode.get(fifaCode) : null;
  return { source_name: name, fifa_code: fifaCode, name_es: team?.name || name };
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
  return JSON.parse(fs.readFileSync(referencePath, "utf8"));
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
  fs.mkdirSync(catalogDir, { recursive: true });
  fs.writeFileSync(`${rawReferencePath}.tmp`, `${JSON.stringify(source, null, 2)}\n`);
  fs.renameSync(`${rawReferencePath}.tmp`, rawReferencePath);
  fs.writeFileSync(`${referencePath}.tmp`, `${JSON.stringify(normalized, null, 2)}\n`);
  fs.renameSync(`${referencePath}.tmp`, referencePath);
  return normalized;
}

function referenceStatsForTeam(catalog, team) {
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
  return { stats, recent_matches, source: "worldcup_json", synced_at: catalog.synced_at || null };
}

export function teamReferenceStats(team) {
  try {
    return referenceStatsForTeam(loadWorldCupReference(), team);
  } catch {
    return null;
  }
}

export function startWorldCupReferenceSync({ logger = console, intervalMs = 3 * 60 * 60 * 1000 } = {}) {
  if (process.env.WORLD_CUP_SYNC_ENABLED === "false") return { stop() {} };
  let timer = null;
  let stopped = false;
  const run = async () => {
    try {
      const catalog = await syncWorldCupReference();
      logger.log(`[worldcup] JSON sincronizado: ${catalog.matches.length} partidos.`);
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
