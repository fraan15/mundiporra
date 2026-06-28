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
