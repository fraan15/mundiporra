export const NO_SCORER_ID = "no_scorer";
export const NO_SCORER = Object.freeze({
  id: NO_SCORER_ID,
  name: "Sin goleador",
  position: "SIN_GOLES",
  team_fifa_code: null,
  team_name: "Sin goles",
  special: true
});

export function isNoScorerValue(value) {
  return value === NO_SCORER_ID;
}

export function parseScorerSelection(value) {
  if (value === undefined || value === null || value === "") return { type: "none", playerId: null };
  if (isNoScorerValue(value)) return { type: "no_scorer", playerId: null };
  const playerId = Number(value);
  return Number.isSafeInteger(playerId) && playerId > 0
    ? { type: "player", playerId }
    : null;
}

export function parseScorerList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const selections = value.map(parseScorerSelection);
  if (selections.some((selection) => !selection || selection.type === "none")) return null;
  const hasNoScorer = selections.some((selection) => selection.type === "no_scorer");
  const playerIds = selections.filter((selection) => selection.type === "player").map((selection) => selection.playerId);
  if (hasNoScorer && playerIds.length) return null;
  return hasNoScorer ? [NO_SCORER_ID] : [...new Set(playerIds)];
}

export function serializePredictedScorer(prediction, player = null) {
  if (!prediction) return null;
  if (prediction.predicted_team1_goals === 0 && prediction.predicted_team2_goals === 0) return NO_SCORER;
  return player || null;
}

export function serializeActualScorers(match, players = []) {
  if (Number(match?.scorer_enabled) && match.result_team1 === 0 && match.result_team2 === 0) return [NO_SCORER];
  return players;
}
