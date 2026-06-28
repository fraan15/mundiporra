import test from "node:test";
import assert from "node:assert/strict";
import { espnEventMatches, espnScoreboardDates, findEspnEvent, normalizeEspnLive } from "../src/services/espnLive.js";

test("relaciona un partido del Mundial por códigos locales", () => {
  const events = [{
    id: "760486",
    date: "2026-06-28T19:00Z",
    competitions: [{ competitors: [
      { team: { abbreviation: "RSA" } },
      { team: { abbreviation: "CAN" } },
    ] }],
  }];
  const event = findEspnEvent(events, {
    team1_fifa_code: "RSA",
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

test("relaciona abreviaturas ESPN conflictivas con los códigos del catálogo local", () => {
  const cases = [
    ["Germany", "GER", "DEU"],
    ["Netherlands", "NED", "NLD"],
    ["Switzerland", "SUI", "CHE"],
    ["Saudi Arabia", "KSA", "SAU"],
    ["Costa Rica", "CRC", "CRI"],
    ["Croatia", "CRO", "HRV"],
    ["South Africa", "ZAF", "RSA"],
    ["South Korea", "KOR", "KOR"],
    ["Czechia", "CZE", "CZE"],
    ["United States", "USA", "USA"],
  ];
  cases.forEach(([name, espnCode, localCode], index) => {
    const event = findEspnEvent([{
      id: `event-${index}`,
      date: "2026-06-28T19:00Z",
      competitions: [{ competitors: [
        { team: { abbreviation: espnCode, displayName: name } },
        { team: { abbreviation: "CAN" } },
      ] }],
    }], {
      team1_fifa_code: localCode,
      team2_fifa_code: "CAN",
      starts_at: "2026-06-28T19:00Z",
    });
    assert.equal(event?.id, `event-${index}`, name);
  });
});

test("encuentra partido con alias ESPN pero conserva código local", () => {
  const match = {
    team1_fifa_code: "RSA",
    team2_fifa_code: "CAN",
    starts_at: "2026-06-28T19:00Z",
    match_date: "2026-06-28",
  };
  const event = {
    id: "rsa-can",
    date: "2026-06-28T19:00Z",
    competitions: [{ competitors: [
      { score: "1", team: { id: "1", abbreviation: "ZAF", displayName: "South Africa" } },
      { score: "0", team: { id: "2", abbreviation: "CAN", displayName: "Canada" } },
    ], details: [{
      id: "goal-rsa",
      clock: { displayValue: "11'" },
      team: { id: "1", abbreviation: "ZAF" },
      type: { text: "Goal" },
      scoringPlay: true,
      participants: [{ athlete: { id: "10", displayName: "Bafana" } }],
    }] }],
  };
  assert.equal(findEspnEvent([event], match)?.id, "rsa-can");
  const live = normalizeEspnLive(event, { header: event }, match);
  assert.equal(live.competitors[0].code, "RSA");
  assert.equal(live.goals[0].team_code, "RSA");
  assert.equal(live.goals[0].side, "team1");
});

test("conserva códigos locales para Alemania y Países Bajos tras normalizar live", () => {
  const cases = [
    { espn: "GER", local: "DEU", opponent: "CAN", id: "deu-can" },
    { espn: "NED", local: "NLD", opponent: "USA", id: "nld-usa" },
  ];
  cases.forEach(({ espn, local, opponent, id }) => {
    const match = {
      team1_fifa_code: local,
      team2_fifa_code: opponent,
      starts_at: "2026-06-28T19:00Z",
      match_date: "2026-06-28",
    };
    const event = {
      id,
      date: "2026-06-28T19:00Z",
      competitions: [{ competitors: [
        { score: "1", team: { id: "1", abbreviation: espn } },
        { score: "0", team: { id: "2", abbreviation: opponent } },
      ], details: [{
        id: `${id}-goal`,
        clock: { displayValue: "22'" },
        team: { id: "1", abbreviation: espn },
        type: { text: "Goal" },
        scoringPlay: true,
        participants: [{ athlete: { id: "10", displayName: "Scorer" } }],
      }] }],
    };
    assert.equal(findEspnEvent([event], match)?.id, id);
    const live = normalizeEspnLive(event, { header: event }, match);
    assert.equal(live.competitors[0].code, local);
    assert.equal(live.goals[0].team_code, local);
    assert.equal(live.goals[0].side, "team1");
  });
});

test("consulta también la fecha UTC para partidos de madrugada en Madrid", () => {
  assert.deepEqual(espnScoreboardDates({
    match_date: "2026-06-28",
    starts_at: "2026-06-27T23:30:00.000Z",
  }), ["20260628", "20260627", "20260626"]);
  const event = findEspnEvent([{
    id: "760481",
    date: "2026-06-27T23:30:00Z",
    competitions: [{ competitors: [
      { team: { abbreviation: "COL" } },
      { team: { abbreviation: "POR" } },
    ] }],
  }], {
    team1_fifa_code: "COL",
    team2_fifa_code: "POR",
    starts_at: "2026-06-27T23:30:00.000Z",
  });
  assert.equal(event?.id, "760481");
});

test("rechaza eventos ESPN de las mismas selecciones si la hora no cuadra", () => {
  const match = {
    team1_fifa_code: "COL",
    team2_fifa_code: "POR",
    starts_at: "2026-06-27T23:30:00.000Z",
  };
  const wrongEvent = {
    id: "wrong-col-por",
    date: "2026-06-20T19:00:00Z",
    competitions: [{ competitors: [
      { team: { abbreviation: "COL" } },
      { team: { abbreviation: "POR" } },
    ] }],
  };
  assert.equal(findEspnEvent([wrongEvent], match), null);
  assert.equal(espnEventMatches({
    event_id: "wrong-col-por",
    date: wrongEvent.date,
    competitors: [{ code: "COL" }, { code: "POR" }],
  }, match), false);
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
          athletesInvolved: [{ id: "10", displayName: "Delantero", team: { id: "1" } }, { id: "11", displayName: "Asistente", team: { id: "1" } }],
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
  assert.equal(live.timeline[0].category, "goal");
  assert.equal(live.timeline[0].label_es, "Gol");
  assert.equal(live.timeline[0].display_minute, "54'");
  assert.equal(live.timeline[0].minute_value, 54);
  assert.deepEqual(live.timeline[0].athletes, ["Delantero", "Asistente"]);
  assert.deepEqual(live.score, { team1: 2, team2: 1 });
  assert.equal(live.goals.length, 1);
  assert.equal(live.goals[0].minute, "54'");
  assert.equal(live.goals[0].espn_name, "Delantero");
  assert.equal(live.goals[0].espn_athlete_id, "10");
  assert.equal(live.goals[0].display, "54' Delantero");
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

test("clasifica, traduce y ordena el tiempo añadido de las incidencias", () => {
  const live = normalizeEspnLive({ id: "101" }, {
    header: { id: "101", competitions: [{
      competitors: [{ team: { id: "1", abbreviation: "ESP" } }],
      details: [{
        id: "card-1",
        clock: { displayValue: "45'+2" },
        team: { id: "1" },
        type: { text: "Yellow Card" },
        yellowCard: true,
      }],
    }] },
  });
  assert.equal(live.timeline[0].category, "yellow_card");
  assert.equal(live.timeline[0].label_es, "Tarjeta amarilla");
  assert.equal(live.timeline[0].display_minute, "45+2'");
  assert.equal(live.timeline[0].minute_value, 47);
  assert.equal(live.timeline[0].team_code, "ESP");
  assert.equal(live.timeline[0].is_key_event, false);
  assert.equal(live.goals.length, 0);
});

test("distingue goles de penalti y autogoles sin incluir otras incidencias", () => {
  const live = normalizeEspnLive({ id: "102" }, {
    header: { id: "102", competitions: [{
      competitors: [],
      details: [
        { id: "pen", clock: { displayValue: "12'" }, type: { text: "Penalty - Scored" }, scoringPlay: true, penaltyKick: true, participants: [{ athlete: { displayName: "Alex" } }] },
        { id: "own", clock: { displayValue: "30'" }, type: { text: "Own Goal" }, scoringPlay: true, ownGoal: true, participants: [{ athlete: { displayName: "Sam" } }] },
        { id: "card", clock: { displayValue: "40'" }, type: { text: "Red Card" }, redCard: true },
      ],
    }] },
  });
  assert.equal(live.goals.length, 2);
  assert.equal(live.goals[0].label, "Gol de penalti");
  assert.equal(live.goals[0].penalty, true);
  assert.equal(live.goals[1].label, "Autogol");
  assert.equal(live.goals[1].own_goal, true);
});

test("deduplica goles repetidos por ESPN aunque vengan en varias secciones", () => {
  const duplicatedGoals = [
    { id: "g1", clock: { displayValue: "17'" }, type: { text: "Goal" }, scoringPlay: true, team: { id: "1" }, participants: [{ athlete: { id: "10", displayName: "Jugador A" } }] },
    { id: "g2", clock: { displayValue: "24'" }, type: { text: "Goal" }, scoringPlay: true, team: { id: "2" }, participants: [{ athlete: { id: "20", displayName: "Jugador B" } }] },
    { id: "g3", clock: { displayValue: "39'" }, type: { text: "Goal" }, scoringPlay: true, team: { id: "1" }, participants: [{ athlete: { id: "11", displayName: "Jugador C" } }] },
    { id: "g4", clock: { displayValue: "55'" }, type: { text: "Goal" }, scoringPlay: true, team: { id: "1" }, participants: [{ athlete: { id: "12", displayName: "Jugador D" } }] },
  ];
  const live = normalizeEspnLive({ id: "dup" }, {
    header: { id: "dup", competitions: [{
      competitors: [
        { score: "3", team: { id: "1", abbreviation: "COD" } },
        { score: "1", team: { id: "2", abbreviation: "UZB" } },
      ],
      details: duplicatedGoals,
    }] },
    commentary: duplicatedGoals.map((goal) => ({
      ...goal,
      id: `commentary-${goal.id}`,
      text: `${goal.participants[0].athlete.displayName} scores`,
      participants: [{ athlete: { ...goal.participants[0].athlete, fullName: goal.participants[0].athlete.displayName } }],
    })),
  });
  assert.equal(live.score.team1, 3);
  assert.equal(live.score.team2, 1);
  assert.equal(live.goals.length, 4);
  assert.deepEqual(live.goals.map((goal) => goal.espn_name), ["Jugador A", "Jugador B", "Jugador C", "Jugador D"]);
});

test("no clasifica como gol un tiro parado aunque el texto diga goal", () => {
  const live = normalizeEspnLive({ id: "saved" }, {
    header: { id: "saved", competitions: [{
      competitors: [
        { score: "0", team: { id: "1", abbreviation: "ALG" } },
        { score: "0", team: { id: "2", abbreviation: "AUT" } },
      ],
    }] },
    commentary: [{
      sequence: 1,
      text: "Attempt saved. Ibrahim Maza (Algeria) left footed shot from the centre of the box is saved in the centre of the goal.",
      play: {
        id: "saved-1",
        type: { text: "Shot On Target" },
        text: "Attempt saved. Ibrahim Maza (Algeria) left footed shot from the centre of the box is saved in the centre of the goal.",
        clock: { displayValue: "44'" },
        participants: [{ athlete: { displayName: "Ibrahim Maza" } }],
      },
    }],
  });
  assert.equal(live.goals.length, 0);
});

test("ordena goles de tiempo añadido de forma cronológica natural", () => {
  const live = normalizeEspnLive({ id: "added-goals" }, {
    header: { id: "added-goals", competitions: [{
      competitors: [
        { score: "2", team: { id: "1", abbreviation: "ESP" } },
        { score: "1", team: { id: "2", abbreviation: "GER" } },
      ],
      details: [
        { id: "g90", clock: { displayValue: "90+4'" }, team: { id: "2" }, type: { text: "Goal" }, scoringPlay: true, participants: [{ athlete: { id: "20", displayName: "Late" } }] },
        { id: "g12", clock: { displayValue: "12'" }, team: { id: "1" }, type: { text: "Goal" }, scoringPlay: true, participants: [{ athlete: { id: "10", displayName: "Early" } }] },
        { id: "g45", clock: { displayValue: "45'+2" }, team: { id: "1" }, type: { text: "Goal" }, scoringPlay: true, participants: [{ athlete: { id: "11", displayName: "Added" } }] },
      ],
    }] },
  });
  assert.deepEqual(live.goals.map((goal) => goal.minute), ["12'", "45+2'", "90+4'"]);
  assert.deepEqual(live.goals.map((goal) => goal.minute_value), [12, 47, 94]);
});
