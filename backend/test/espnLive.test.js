import test from "node:test";
import assert from "node:assert/strict";
import { findEspnEvent, normalizeEspnLive } from "../src/services/espnLive.js";

test("relaciona un partido del Mundial por códigos FIFA aunque ESPN use otros", () => {
  const events = [{
    id: "760486",
    date: "2026-06-28T19:00Z",
    competitions: [{ competitors: [
      { team: { abbreviation: "RSA" } },
      { team: { abbreviation: "CAN" } },
    ] }],
  }];
  const event = findEspnEvent(events, {
    team1_fifa_code: "ZAF",
    team2_fifa_code: "CAN",
    starts_at: "2026-06-28T19:00Z",
  });
  assert.equal(event.id, "760486");
  assert.equal(findEspnEvent(events, {
    team1_fifa_code: "ESP",
    team2_fifa_code: "CAN",
    starts_at: "2026-06-28T19:00Z",
  }), null);
});

test("normaliza marcador, incidencias y estadísticas sin convertirlos en resultado oficial", () => {
  const summary = {
    header: {
      id: "99",
      competitions: [{
        status: { displayClock: "67'", type: { state: "in", shortDetail: "2ª parte", completed: false } },
        competitors: [
          { homeAway: "home", score: "2", team: { id: "1", abbreviation: "ESP", displayName: "Spain" } },
          { homeAway: "away", score: "1", team: { id: "2", abbreviation: "GER", displayName: "Germany" } },
        ],
        details: [{
          id: "goal-1",
          clock: { displayValue: "54'" },
          type: { text: "Goal" },
          scoringPlay: true,
          participants: [{ athlete: { displayName: "Delantero" } }, { athlete: { displayName: "Asistente" } }],
        }],
      }],
    },
    boxscore: { teams: [{
      team: { id: "1", abbreviation: "ESP" },
      statistics: [{ name: "foulsCommitted", label: "Faltas", displayValue: "8" }],
    }] },
  };
  const live = normalizeEspnLive({ id: "99" }, summary);
  assert.equal(live.state, "in");
  assert.equal(live.clock, "67'");
  assert.deepEqual(live.competitors.map((team) => [team.code, team.score]), [["ESP", 2], ["DEU", 1]]);
  assert.equal(live.timeline[0].scoring, true);
  assert.deepEqual(live.timeline[0].athletes, ["Delantero", "Asistente"]);
  assert.equal(live.stats[0].stats[0].label, "Faltas");
});

test("convierte estadísticas compuestas de ESPN en texto renderizable", () => {
  const live = normalizeEspnLive({ id: "100" }, {
    header: { id: "100", competitions: [{ competitors: [] }] },
    boxscore: { teams: [{
      team: { id: "1", abbreviation: "ESP" },
      statistics: [{ name: "possession", label: "Posesión", displayValue: { value: 61, displayValue: "61%" } }],
    }] },
  });
  assert.equal(live.stats[0].stats[0].display, "61%");
  assert.equal(live.stats[0].stats[0].value, 61);
});
