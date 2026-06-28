const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary";
const ODDS_URL = "https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world/events";
const REQUEST_TIMEOUT_MS = 8000;

const ESPN_TO_FIFA = {
  RSA: "ZAF",
  GER: "DEU",
  NED: "NLD",
  SUI: "CHE",
  CRO: "HRV",
  KSA: "SAU",
  CRC: "CRI",
};

const normalizeCode = (value) => ESPN_TO_FIFA[String(value || "").toUpperCase()] || String(value || "").toUpperCase();
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
const teamCode = (competitor) => normalizeCode(competitor?.team?.abbreviation);
const localTeamCodes = (match) => [
  normalizeCode(match.team1_fifa_code),
  normalizeCode(match.team2_fifa_code),
].filter(Boolean);

export const findEspnEvent = (events, match) => {
  const expectedCodes = localTeamCodes(match);
  const candidates = (events || []).filter((event) => {
    const codes = (competitionOf(event)?.competitors || []).map(teamCode);
    return expectedCodes.length === 2 && expectedCodes.every((code) => codes.includes(code));
  });
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  const expected = new Date(match.starts_at).getTime();
  return candidates.sort((a, b) =>
    Math.abs(new Date(a.date).getTime() - expected) - Math.abs(new Date(b.date).getTime() - expected)
  )[0];
};

const participantNames = (item) => (item?.participants || item?.athletes || [])
  .map((participant) => participant?.athlete?.displayName || participant?.athlete?.fullName || participant?.displayName)
  .filter(Boolean);

const eventLabel = (item) =>
  item?.type?.text || item?.type?.description || item?.type?.name ||
  (item?.scoringPlay ? "Gol" : item?.yellowCard ? "Tarjeta amarilla" : item?.redCard ? "Tarjeta roja" : "Incidencia");

const minuteDetails = (value, label = "") => {
  const raw = String(value || "").trim();
  const added = raw.match(/(\d+)\s*['’]?\s*\+\s*(\d+)/);
  const regular = raw.match(/(\d+)/);
  const minuteValue = added
    ? Number(added[1]) + Number(added[2]) / 100
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
  if (item?.redCard || /red card|tarjeta roja/.test(source)) return "red_card";
  if (item?.yellowCard || /yellow card|tarjeta amarilla/.test(source)) return "yellow_card";
  if (item?.scoringPlay || /goal|gol|penalty scored/.test(source)) return "goal";
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

const normalizeTimelineItem = (item, index, codeByTeamId) => {
  const play = item?.play || item;
  const athletes = participantNames(play);
  const text = play?.text || item?.text || play?.shortText || play?.description || "";
  const label = eventLabel(play);
  const category = categorizeEvent(play, label, text);
  const minute = displayValue(play?.clock?.displayValue || play?.clock?.displayClock || item?.time?.displayValue || item?.time || "").replace("—", "");
  const teamId = String(play?.team?.id || "");
  const minuteInfo = minuteDetails(minute, `${label} ${text}`);
  return {
    id: String(play?.id || item?.sequence || `${play?.period?.number || play?.period || 0}-${play?.clock?.value || play?.clock?.displayValue || index}-${text}`),
    minute,
    period: play?.period?.displayValue || play?.period?.number || play?.period || null,
    type: label,
    text,
    athletes,
    team_id: teamId,
    scoring: Boolean(play?.scoringPlay || /goal|gol|penalty scored/i.test(label)),
    yellow_card: Boolean(play?.yellowCard || /yellow|amarilla/i.test(label)),
    red_card: Boolean(play?.redCard || /red card|roja/i.test(label)),
    penalty: Boolean(play?.penaltyKick || /penalty|penal/i.test(`${label} ${text}`)),
    own_goal: Boolean(play?.ownGoal || /own goal|autogol/i.test(`${label} ${text}`)),
    category,
    label_es: spanishEventLabel(category, label, text),
    ...minuteInfo,
    team_code: normalizeCode(play?.team?.abbreviation || codeByTeamId.get(teamId)),
    is_key_event: ["goal", "red_card", "penalty", "var", "start_end"].includes(category),
    side: null,
  };
};

const normalizeStats = (summary, competition) => {
  const teams = summary?.boxscore?.teams || [];
  return teams.map((entry) => {
    const competitor = (competition?.competitors || []).find((row) => String(row.team?.id) === String(entry.team?.id));
    return {
      id: String(entry.team?.id || ""),
      name: entry.team?.displayName || competitor?.team?.displayName || "",
      code: normalizeCode(entry.team?.abbreviation || competitor?.team?.abbreviation),
      stats: (entry.statistics || []).map((stat) => ({
        key: stat.name || stat.abbreviation || stat.label,
        label: stat.label || stat.displayName || stat.name,
        display: displayValue(stat.displayValue ?? stat.value),
        value: numberValue(stat.value ?? stat.displayValue),
      })),
    };
  });
};

export const normalizeEspnLive = (event, summary = {}) => {
  const headerEvent = summary?.header || event;
  const competition = competitionOf(headerEvent) || competitionOf(event);
  const status = competition?.status || headerEvent?.status || event?.status || {};
  const competitors = (competition?.competitors || []).map((row) => ({
    id: String(row.team?.id || ""),
    code: normalizeCode(row.team?.abbreviation),
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
  const normalizedTimeline = rawTimeline.map((item, index) => normalizeTimelineItem(item, index, codeByTeamId));
  const timeline = [...new Map(normalizedTimeline.map((normalized) => {
    const signature = [
      normalized.minute, normalized.scoring, normalized.yellow_card, normalized.red_card,
      normalized.athletes[0], normalized.athletes[1],
      normalized.scoring || normalized.yellow_card || normalized.red_card ? "" : normalized.type,
    ].join("|");
    return [signature, normalized];
  })).values()].sort((a, b) => (b.minute_value ?? -1) - (a.minute_value ?? -1));
  return {
    provider: "ESPN",
    event_id: String(headerEvent?.id || event?.id || competition?.id || ""),
    state: status?.type?.state || "pre",
    completed: Boolean(status?.type?.completed),
    status: status?.type?.shortDetail || status?.type?.detail || status?.type?.description || "",
    clock: status?.displayClock || competition?.status?.displayClock || "",
    period: status?.period || competition?.status?.period || null,
    competitors,
    timeline,
    stats: normalizeStats(summary, competition),
    venue: competition?.venue?.fullName || headerEvent?.venue?.displayName || event?.venue?.displayName || "",
    fetched_at: new Date().toISOString(),
  };
};

export async function getEspnLiveMatch(match) {
  let event = null;
  if (match.espn_event_id) {
    const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(match.espn_event_id)}`);
    return normalizeEspnLive({ id: match.espn_event_id }, summary);
  }
  const dates = [...new Set([
    match.match_date.replaceAll("-", ""),
    new Date(new Date(match.starts_at).getTime() - 86400000).toISOString().slice(0, 10).replaceAll("-", ""),
    new Date(new Date(match.starts_at).getTime() + 86400000).toISOString().slice(0, 10).replaceAll("-", ""),
  ])];
  for (const date of dates) {
    const scoreboard = await fetchJson(`${SCOREBOARD_URL}?dates=${date}`);
    event = findEspnEvent(scoreboard.events, match);
    if (event) break;
  }
  if (!event) return null;
  const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(event.id)}`).catch(() => ({}));
  return normalizeEspnLive(event, summary);
}

export async function getEspnEventById(eventId) {
  const summary = await fetchJson(`${SUMMARY_URL}?event=${encodeURIComponent(eventId)}`);
  const live = normalizeEspnLive({ id: eventId }, summary);
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
