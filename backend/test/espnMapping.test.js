import test from "node:test";
import assert from "node:assert/strict";
import { db, initDatabase } from "../src/db/database.js";
import { syncEspnMappings } from "../src/services/espnMapping.js";

test("mapea jugadores ESPN por dorsal único de selección cuando el nombre difiere", async () => {
  initDatabase();
  const local = db.prepare("SELECT id FROM players WHERE team_fifa_code='JOR' AND number=10").get();
  assert.ok(local);
  db.prepare("UPDATE players SET name='Mousa Al-Tamari',espn_id=NULL WHERE id=?").run(local.id);
  db.prepare("UPDATE teams SET espn_id=NULL WHERE fifa_code='JOR'").run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/teams/12345/roster")) {
      return {
        ok: true,
        json: async () => ({
          athletes: [{
            id: "257489",
            displayName: "Musa Al-Taamari",
            fullName: "Musa Al-Taamari",
            jersey: "10",
          }],
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        sports: [{ leagues: [{ teams: [{ team: { id: "12345", abbreviation: "JOR", displayName: "Jordan" } }] }] }],
      }),
    };
  };

  try {
    const result = await syncEspnMappings();
    assert.equal(result.teams_mapped, 1);
    assert.equal(result.players_mapped, 1);
    assert.equal(db.prepare("SELECT espn_id FROM players WHERE id=?").get(local.id).espn_id, "257489");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mapea Sudáfrica cuando ESPN usa ZAF y el catálogo local usa RSA", async () => {
  initDatabase();
  db.prepare("UPDATE teams SET espn_id=NULL WHERE fifa_code='RSA'").run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/teams/76543/roster")) {
      return {
        ok: true,
        json: async () => ({ athletes: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        sports: [{ leagues: [{ teams: [{ team: { id: "76543", abbreviation: "ZAF", displayName: "South Africa" } }] }] }],
      }),
    };
  };

  try {
    const result = await syncEspnMappings();
    assert.equal(result.teams_mapped, 1);
    assert.equal(db.prepare("SELECT espn_id FROM teams WHERE fifa_code='RSA'").get().espn_id, "76543");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("mapea equipos aunque ESPN use código alternativo al local", async () => {
  initDatabase();
  db.prepare("UPDATE teams SET espn_id=NULL WHERE fifa_code='GER'").run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/teams/54321/roster")) {
      return { ok: true, json: async () => ({ athletes: [] }) };
    }
    return {
      ok: true,
      json: async () => ({
        sports: [{ leagues: [{ teams: [{ team: { id: "54321", abbreviation: "DEU", displayName: "Germany" } }] }] }],
      }),
    };
  };

  try {
    const result = await syncEspnMappings();
    assert.equal(result.teams_mapped, 1);
    assert.equal(db.prepare("SELECT espn_id FROM teams WHERE fifa_code='GER'").get().espn_id, "54321");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remapea ESPN ID de jugador si estaba asignado a otro equipo", async () => {
  initDatabase();
  const jordan = db.prepare("SELECT id FROM players WHERE team_fifa_code='JOR' AND number=10").get();
  const other = db.prepare("SELECT id FROM players WHERE team_fifa_code!='JOR' LIMIT 1").get();
  assert.ok(jordan);
  assert.ok(other);
  const jordanName = db.prepare("SELECT name FROM players WHERE id=?").get(jordan.id).name;
  db.prepare("UPDATE players SET espn_id=NULL WHERE id=?").run(jordan.id);
  db.prepare("UPDATE players SET espn_id='257489' WHERE id=?").run(other.id);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/teams/12345/roster")) {
      return {
        ok: true,
        json: async () => ({ athletes: [{ id: "257489", displayName: jordanName, jersey: "10" }] }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        sports: [{ leagues: [{ teams: [{ team: { id: "12345", abbreviation: "JOR", displayName: "Jordan" } }] }] }],
      }),
    };
  };

  try {
    const result = await syncEspnMappings();
    assert.equal(result.players_mapped, 1);
    assert.equal(db.prepare("SELECT espn_id FROM players WHERE id=?").get(jordan.id).espn_id, "257489");
    assert.equal(db.prepare("SELECT espn_id FROM players WHERE id=?").get(other.id).espn_id, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
