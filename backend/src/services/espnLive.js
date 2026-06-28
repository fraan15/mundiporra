const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ODDS_URL = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events";
const REQUEST_TIMEOUT_MS = 8000;

const CODE_ALIASES_FOR_MATCHING = {
  GER: "DEU",
  NED: "NLD",
  SUI: "CHE",
  KSA: "SAU",
  CRC: "CRI",
  CRO: "HRV",
  ZAF: "RSA",
};

const rawCode = (value) => String(value || "").trim().toUpperCase();
const canonicalMatchCode = (value) => {
  const code = rawCode(value);
  return CODE_ALIASES_FOR_MATCHING[code] || code;
};
const outputCode = (value) => canonicalMatchCode(value);
const toLocalTeamCode = (espnCode, match) => {
  const code = rawCode(espnCode);
  const canonical = canonicalMatchCode(code);
  if (canonical && canonical === canonicalMatchCode(match?.team1_fifa_code)) return rawCode(match.team1_fifa_code);
  if (canonical && canonical === canonicalMatchCode(match?.team2_fifa_code)) return rawCode(match.team2_fifa_code);
  return code;
};
const liveCode = (value, match) => match ? toLocalTeamCode(value, match) : outputCode(value);
const sideFromLocalCode = (code, match) => {
  if (!match) return null;
  const localCode = rawCode(code);
  if (localCode && localCode === rawCode(match.team1_fifa_code)) return "team1";
  if (localCode && localCode === rawCode(match.team2_fifa_code)) return "team2";
  return null;
};
const numberValue = (value) => {
  if (value && typeof value === "object") value = value.value ?? value.displayValue;
  const parsed = Number(String(value ?? "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const displayValue = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "object") return String(value);
  return displayValue(value.displayValue ?? value.value);
};
const americanToDecimal = (value) => {
  const odds = numberValue(value);
  if (odds === null || odds === 0) return null;
  return Number((odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds)).toFixed(2));
};
const decimalOdd = (market, fallback) =>
  numberValue(market?.current?.moneyLine?.decimal ?? market?.close?.moneyLine?.decimal) ??
  americanToDecimal(fallback);
const fetchJson = async (url) => {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "MundiPorra/1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ESPN respondió ${response.status}`);
  return response.json();
};

const competitionOf = (event) => event?.competitions?.[0] || null;
const teamCode = (competitor) => canonicalMatchCode(competitor?.team?.abbreviation);
const localTeamCodes = (match) => [
  canonicalMatchCode(match.team1_fifa_code),
  canonicalMatchCode(match.team2_fifa_code),
].filter(Boolean);
const espnDate = (value) => new Date(value).toISOString().slice(0, 10).replaceAll("-", "");
const EVENT_TIME_TOLERANCE_MS = 6 * 60 * 60 * 1000;

export const espnScoreboardDates = (match) => {
  const startsAt = new Date(match.starts_at);
  return [...new Set([
    match.match_date.replaceAll("-", ""),
    espnDate(startsAt),
    espnDate(startsAt.getTime() - 86400000),
    espnDate(startsAt.getTime() + 86400000),
  ])];
};

export const findEspnEvent = (events, match) => {
  const expectedCodes = localTeamCodes(match);
  const candidates = (events || []).filter((event) => {
    const codes = (competitionOf(event)?.competitors || []).map(teamCode);
    return expectedCodes.length === 2 && expectedCodes.every((code) => codes.includes(code)) && espnEventTimeMatches(event, match);
  });
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  const expected = new Date(match.starts_at).getTime();
  return candidates.sort((a, b) =>
    Math.abs(new Date(a.date).getTime() - expected) - Math.abs(new Date(b.date).getTime() - expected)
  )[0];
};

export const espnEventTimeMatches = (event, match, toleranceMs = EVENT_TIME_TOLERANCE_MS) => {
  if (!match?.starts_at) return true;
  const eventDate = event?.date || competitionOf(event)?.date || competitionOf(event)?.startDate;
  if (!eventDate) return false;
  const expected = new Date(match.starts_at).getTime();
  const actual = new Date(eventDate).getTime();
  return Number.isFinite(expected) && Number.isFinite(actual) && Math.abs(actual - expected) <= toleranceMs;
};

export const espnEventMatches = (liveOrEvent, match) => {
  const expectedCodes = localTeamCodes(match);
  const codes = liveOrEvent?.competitors
    ? liveOrEvent.competitors.map((team) => canonicalMatchCode(team.code || team.team?.abbreviation))
    : (competitionOf(liveOrEvent)?.competitors || []).map(teamCode);
  return expectedCodes.length === 2 &&
    expectedCodes.every((code) => codes.includes(code)) &&
    espnEventTimeMatches(liveOrEvent, match);
};

const participantDetails = (item) => (item?.athletesInvolved || item?.participants || item?.athletes || [])
  .map((participant) => {
    const athlete = participant?.athlete || participant;
    const name = athlete?.displayName || athlete?.fullName || participant?.displayName || "";
    if (!name) return null;
    return {
      id: String(athlete?.id || participant?.id || ""),
      name,
      full_name: athlete?.fullName || participant?.fullName || name,
      team_id: String(athlete?.team?.id || participant?.team?.id || ""),
    };
  })
  .filter(Boolean);

const eventLabel = (item) =>
  item?.type?.text || item?.type?.description || item?.type?.name ||
  (item?.scoringPlay ? "Gol" : item?.yellowCard ? "Tarjeta amarilla" : item?.redCard ? "Tarjeta roja" : "Incidencia");

const minuteDetails = (value, label = "") => {
  const raw = String(value || "").trim();
  const added = raw.match(/(\d+)\s*['’]?\s*\+\s*(\d+)/);
  const regular = raw.match(/(\d+)/);
  const minuteValue = added
    ? Number(added[1]) + Number(added[2])
    : regular ? Number(regular[1]) : null;
  const normalizedLabel = String(label || "").toLowerCase();
  if (/end of game|full time|final/.test(normalizedLabel)) return { minute_value: minuteValue ?? 999, display_minute: "Final" };
  if (/half.?time|end of (the )?(first )?half/.test(normalizedLabel)) return { minute_value: minuteValue ?? 45, display_minute: "Descanso" };
  if (/start of game|kick.?off|inicio/.test(normalizedLabel) && minuteValue === null) return { minute_value: 0, display_minute: "Inicio" };
  return {
    minute_value: minuteValue,
    display_minute: added ? `${added[1]}+${added[2]}'` : regular ? `${regular[1]}'` : raw,
  };
};

const categorizeEvent = (item, label, text) => {
  const source = `${label} ${text}`.toLowerCase();
  const normalizedLabel = String(label || "").toLowerCase();
  const normalizedText = String(text || "").trim().toLowerCase();
  if (item?.redCard || /red card|tarjeta roja/.test(source)) return "red_card";
  if (item?.yellowCard || /yellow card|tarjeta amarilla/.test(source)) return "yellow_card";
  if (item?.scoringPlay || /^goal\b|^gol\b|penalty scored/.test(normalizedLabel) || /^goal!|^gol!/.test(normalizedText)) return "goal";
  if (item?.penaltyKick || /penalty kick|penalti|penalty/.test(source)) return "penalty";
  if (/substitution|substitute|cambio/.test(source)) return "substitution";
  if (/\bvar\b|video assistant/.test(source)) return "var";
  if (/start of game|kick.?off|end of game|end of (the )?half|half.?time|full time|inicio|final/.test(source)) return "start_end";
  if (/shot|attempt|save|chance|tiro|ocasión|parada/.test(source)) return "chance";
  return "other";
};

const spanishEventLabel = (category, label, text) => {
  const source = `${label} ${text}`.toLowerCase();
  if (category === "goal") return /penalty|penalti/.test(source) ? "Gol de penalti" : "Gol";
  return {
    yellow_card: "Tarjeta amarilla",
    red_card: "Tarjeta roja",
    penalty: "Penalti",
    substitution: "Cambio",
    var: "VAR",
    chance: /saved|save|detenido|parada/.test(source) ? "Parada" : "Ocasión",
    start_end: /end of game|full time|final/.test(source)
      ? "Final"
      : /end of (the )?half|half.?time|descanso/.test(source) ? "Descanso" : "Inicio",
    other: /offside/.test(source) ? "Fuera de juego" : /foul/.test(source) ? "Falta" : "Incidencia",
  }[category] || "Incidencia";
};

const normalizeTimelineItem = (item, index, codeByTeamId, match) => {
  const play = item?.play || item;
  const participantRows = participantDetails(play);
  const athletes = participantRows.map((participant) => participant.name);
  const text = play?.text || item?.text || play?.shortText || play?.description || "";
  const label = eventLabel(play);
  const category = categorizeEvent(play, label, text);
  const minute = displayValue(play?.clock?.displayValue || play?.clock?.displayClock || item?.time?.displayValue || item?.time || "").replace("—", "");
  const teamId = String(play?.team?.id || "");
  const minuteInfo = minuteDetails(minute, `${label} ${text}`);
  const teamCodeValue = liveCode(play?.team?.abbreviation || codeByTeamId.get(teamId), match);
  return {
    id: String(play?.id || item?.sequence || `${play?.period?.number || play?.period || 0}-${play?.clock?.value || play?.clock?.displayValue || ""}-${play?.clock?.displayValue || ""}-${index}-${text}`),
    minute,
    period: play?.period?.displayValue || play?.period?.number || play?.period || null,
    type: label,
    text,
    athletes,
    athlete_ids: participantRows.map((participant) => participant.id),
    athlete_team_ids: participantRows.map((participant) => participant.team_id),
    team_id: teamId,
    scoring: Boolean(play?.scoringPlay || /^goal\b|^gol\b|penalty scored/i.test(label) || /^goal!|^gol!/i.test(text.trim())),
    yellow_card: Boolean(play?.yellowCard || /yellow|amarilla/i.test(label)),
    red_card: Boolean(play?.redCard || /red card|roja/i.test(label)),
    penalty: Boolean(play?.penaltyKick || /penalty|penal/i.test(`${label} ${text}`)),
    own_goal: Boolean(play?.ownGoal || /own goal|autogol/i.test(`${label} ${text}`)),
    category,
    label_es: spanishEventLabel(category, label, text),
    ...minuteInfo,
    team_code: teamCodeValue,
    is_key_event: ["goal", "red_card", "penalty", "var", "start_end"].includes(category),
    side: sideFromLocalCode(teamCodeValue, match),
  };
};

const normalizeStats = (summary, competition, match) => {
  const teams = summary?.boxscore?.teams || [];
  return teams.map((entry) => {
    const competitor = (competition?.competitors || []).find((row) => String(row.team?.id) === String(entry.team?.id));
    return {
      id: String(entry.team?.id || ""),
      name: entry.team?.displayName || competitor?.team?.displayName || "",
      code: liveCode(entry.team?.abbreviation || competitor?.team?.abbreviation, match),
      stats: (entry.statistics || []).map((stat) => ({
        key: stat.name || stat.abbreviation || stat.label,
        label: stat.label || stat.displayName || stat.name,
        display: displayValue(stat.displayValue ?? stat.value),
        value: numberValue(stat.value ?? stat.displayValue),
      })),
    };
  });
};

const goalSignature = (item) => [
  item.minute_value ?? item.display_minute ?? item.minute ?? "",
  normalizePlayerNameForSignature(item.athletes?.[0]) || item.athlete_ids?.[0] || item.team_id || item.team_code || "",
  item.own_goal ? "own" : item.penalty ? "pen" : "goal",
].join("|");

const normalizePlayerNameForSignature = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export const normalizeEspnLive = (event, summary = {}, match = null) => {
  const headerEvent = summary?.header || event;
  const competition = competitionOf(headerEvent) || competitionOf(event);
  const status = competition?.status || headerEvent?.status || event?.status || {};
  const competitors = (competition?.competitors || []).map((row) => ({
    id: String(row.team?.id || ""),
    code: liveCode(row.team?.abbreviation, match),
    name: row.team?.displayName || row.team?.name || "",
    home_away: row.homeAway,
    score: numberValue(row.score) ?? 0,
    winner: Boolean(row.winner),
  }));
  const rawTimeline = [
    ...(competition?.details || []),
    ...(summary?.details || []),
    ...(summary?.commentary || []),
    ...(summary?.plays || []),
  ];
  const codeByTeamId = new Map(competitors.map((team) => [team.id, team.code]));
  const normalizedTimeline = rawTimeline.map((item, index) => normalizeTimelineItem(item, index, codeByTeamId, match));
  const timelineBySignature = new Map();
  normalizedTimeline.forEach((normalized) => {
    const signature = normalized.scoring || normalized.category === "goal"
      ? `goal|${goalSignature(normalized)}`
      : [
        normalized.minute, normalized.scoring, normalized.yellow_card, normalized.red_card,
        normalized.athletes[0], normalized.athletes[1],
        normalized.yellow_card || normalized.red_card ? "" : normalized.type,
      ].join("|");
    if (!timelineBySignature.has(signature)) timelineBySignature.set(signature, normalized);
  });
  const timeline = [...timelineBySignature.values()].sort((a, b) => (b.minute_value ?? -1) - (a.minute_value ?? -1));
  const mappedGoals = timeline.filter((item) => item.scoring || item.category === "goal")
    .map((item) => {
      const scorerName = item.athletes?.[0] || "Goleador sin identificar";
      const goalLabel = item.own_goal ? "Autogol" : item.penalty ? "Gol de penalti" : "Gol";
      return {
        id: item.id,
        minute: item.display_minute || item.minute,
        minute_value: item.minute_value,
        team_id: item.team_id,
        team_code: item.team_code,
        side: item.side,
        scorer_name: scorerName,
        espn_name: scorerName,
        espn_athlete_id: item.athlete_ids?.[0] || "",
        espn_athlete_team_id: item.athlete_team_ids?.[0] || "",
        player_id: null,
        player_name: null,
        scorer_player_id: null,
        penalty: item.penalty,
        own_goal: item.own_goal,
        label: goalLabel,
        display: `${item.display_minute || item.minute || ""} ${scorerName}`.trim(),
      };
    })
    .sort((a, b) => (a.minute_value ?? 999) - (b.minute_value ?? 999));
  const dedupedGoals = [...new Map(mappedGoals.map((goal) => [goalSignature({
    minute_value: goal.minute_value,
    display_minute: goal.minute,
    team_id: goal.team_id,
    team_code: goal.team_code,
    athlete_ids: goal.espn_athlete_id ? [goal.espn_athlete_id] : [],
    athletes: [goal.espn_name],
    own_goal: goal.own_goal,
    penalty: goal.penalty,
  }), goal])).values()];
  const scoreGoalTotal = competitors.reduce((sum, team) => sum + Number(team.score || 0), 0);
  const goals = scoreGoalTotal > 0 && dedupedGoals.length > scoreGoalTotal
    ? dedupedGoals.slice(0, scoreGoalTotal)
    : dedupedGoals;
  return {
    provider: "ESPN",
    event_id: String(headerEvent?.id || event?.id || competition?.id || ""),
    date: headerEvent?.date || competition?.date || competition?.startDate || event?.date || "",
    state: status?.type?.state || "pre",
    completed: Boolean(status?.type?.completed),
    status: status?.type?.shortDetail || status?.type?.detail || status?.type?.description || "",
    clock: status?.displayClock || competition?.status?.displayClock || "",
    period: status?.period || competition?.status?.period || null,
    competitors,
    score: {
      team1: competitors[0]?.score ?? 0,
      team2: competitors[1]?.score ?? 0,
    },
    goals,
    timeline,
    stats: normalizeStats(summary, competition, match),
    venue: competition?.venue?.fullName || headerEvent?.venue?.displayName || event?.venue?.displayName || "",
    fetched_at: new Date().toISOString(),
  };
};

export async function getEspnLiveMatch(match) {
  let event = null;
  if (match.espn_event_id) {
    const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(match.espn_event_id)}`);
    const live = normalizeEspnLive({ id: match.espn_event_id }, summary, match);
    if (espnEventMatches(live, match)) return live;
  }
  const dates = espnScoreboardDates(match);
  for (const date of dates) {
    const scoreboard = await fetchJson(`${SCOREBOARD_URL}?dates=${date}`);
    event = findEspnEvent(scoreboard.events, match);
    if (event) break;
  }
  if (!event) return null;
  const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(event.id)}`).catch(() => ({}));
  return normalizeEspnLive(event, summary, match);
}

export async function getEspnEventById(eventId, match = null) {
  const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(eventId)}`);
  const live = normalizeEspnLive({ id: eventId }, summary, match);
  if (!live.event_id || live.competitors.length !== 2) throw new Error("El evento de ESPN no contiene un partido válido.");
  return live;
}

export async function getEspnOdds(eventId, competitionId = eventId) {
  const data = await fetchJson(`${ODDS_URL}/${encodeURIComponent(eventId)}/competitions/${encodeURIComponent(competitionId)}/odds?limit=20`);
  const item = (data.items || []).find((row) =>
    decimalOdd(row.homeTeamOdds, row.homeTeamOdds?.moneyLine) &&
    decimalOdd(row.awayTeamOdds, row.awayTeamOdds?.moneyLine)
  );
  if (!item) return null;
  return {
    provider: item.provider?.name || "ESPN",
    home: decimalOdd(item.homeTeamOdds, item.homeTeamOdds?.moneyLine),
    draw: numberValue(item.current?.draw?.decimal ?? item.close?.draw?.decimal) ?? americanToDecimal(item.drawOdds?.moneyLine),
    away: decimalOdd(item.awayTeamOdds, item.awayTeamOdds?.moneyLine),
    over_under: numberValue(item.current?.total?.alternateDisplayValue ?? item.overUnder),
    over: numberValue(item.current?.over?.decimal) ?? americanToDecimal(item.overOdds),
    under: numberValue(item.current?.under?.decimal) ?? americanToDecimal(item.underOdds),
    spread: item.details || null,
    fetched_at: new Date().toISOString(),
  };
}
