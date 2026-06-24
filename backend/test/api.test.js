import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { app } from "../src/app.js";
import { db } from "../src/db/database.js";
import { remindNextNightMissingPredictions } from "../src/services/matches.js";
import { normalizeWorldCupReference, worldCupOverview } from "../src/services/worldcupReference.js";

test("sirve el frontend compilado desde la ruta raíz", async () => {
  const response = await request(app).get("/");
  assert.equal(response.status, 200);
  assert.match(response.text, /<div id="root"><\/div>/);
});

test("acepta el mismo origen público reenviado por Cloudflare", async () => {
  const origin = "https://example-tunnel.trycloudflare.com";
  const headers = {
    Origin: origin,
    "X-Forwarded-Host": "example-tunnel.trycloudflare.com",
    "X-Forwarded-Proto": "https"
  };
  const response = await request(app)
    .get("/api/auth/me")
    .set(headers);
  assert.equal(response.status, 200);
  assert.equal(response.headers["access-control-allow-origin"], origin);

  const preflight = await request(app)
    .options("/api/auth/login")
    .set(headers)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], origin);

  const login = await request(app)
    .post("/api/auth/login")
    .set(headers)
    .send({ username: "administrador", password: "yami" });
  assert.equal(login.status, 200);
  assert.equal(login.headers["access-control-allow-origin"], origin);
});

test("login inicial y sesión", async () => {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, "admin");
  const me = await agent.get("/api/auth/me");
  assert.equal(me.body.user.username, "administrador");
});

test("el chat devuelve solo los 25 mensajes más recientes", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });

  for (let index = 1; index <= 30; index += 1) {
    const response = await agent.post("/api/chat").send({ message: `Mensaje de prueba ${index}` });
    assert.equal(response.status, 201);
  }

  const response = await agent.get("/api/chat");
  assert.equal(response.status, 200);
  assert.equal(response.body.length, 25);
  assert.equal(response.body[0].message, "Mensaje de prueba 6");
  assert.equal(response.body.at(-1).message, "Mensaje de prueba 30");
});

test("solo el autor o un administrador pueden borrar un mensaje del chat", async () => {
  const author = request.agent(app), other = request.agent(app);
  await author.post("/api/auth/login").send({ username: "lucia", password: "lucia" }).expect(200);
  await other.post("/api/auth/login").send({ username: "espectador", password: "mundial2026" }).expect(200);
  const created = await author.post("/api/chat").send({ message: "Mensaje que se puede borrar" }).expect(201);
  const reply = await author.post("/api/chat").send({ message: "Respuesta que permanece", reply_to_id: created.body.id }).expect(201);
  await other.delete(`/api/chat/${created.body.id}`).expect(403);
  await author.delete(`/api/chat/${created.body.id}`).expect(200);
  assert.equal(db.prepare("SELECT id FROM chat_messages WHERE id=?").get(created.body.id), undefined);
  const retainedReply = db.prepare("SELECT reply_to_id,reply_deleted FROM chat_messages WHERE id=?").get(reply.body.id);
  assert.equal(retainedReply.reply_to_id, null);
  assert.equal(retainedReply.reply_deleted, 1);
  assert.equal((await author.get("/api/chat")).body.find(item => item.id === reply.body.id).reply_deleted, 1);
});

test("respuestas y menciones del chat crean una sola notificación social por destinatario", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });

  const original = await admin.post("/api/chat").send({ message: "Mensaje para responder" });
  const reply = await user.post("/api/chat").send({ message: "@administrador te respondo", reply_to_id: original.body.id });
  assert.equal(reply.status, 201);
  const adminNotifications = (await admin.get("/api/notifications")).body.notifications.filter((item) => item.entity_id === reply.body.id && item.entity_type === "chat_message");
  assert.equal(adminNotifications.length, 1);
  assert.equal(adminNotifications[0].type, "chat_reply");
  assert.equal(adminNotifications[0].link, `/chat?message=${reply.body.id}`);

  const mention = await admin.post("/api/chat").send({ message: "Hola @lucia" });
  const userNotification = (await user.get("/api/notifications")).body.notifications.find((item) => item.entity_id === mention.body.id && item.entity_type === "chat_message");
  assert.equal(userNotification.type, "chat_mention");
});

test("el chat ensambla imágenes enviadas en fragmentos", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const image = await sharp({ create: { width: 120, height: 120, channels: 3, background: "#b31229" } }).jpeg().toBuffer();
  const split = Math.ceil(image.length / 2), uploadId = `chunk-test-${Date.now()}`;
  const headers = { "X-Upload-Id": uploadId, "X-Chunk-Total": "2", "X-File-Type": "image/jpeg", "Content-Type": "application/octet-stream" };
  await agent.put("/api/chat/image-chunk").set({ ...headers, "X-Chunk-Index": "0" }).send(image.subarray(0, split)).expect(200);
  const completed = await agent.put("/api/chat/image-chunk").set({ ...headers, "X-Chunk-Index": "1" }).send(image.subarray(split)).expect(200);
  assert.equal(completed.body.type, "image");
  assert.match(completed.body.url, /^\/chat-media\/chat-/);
  await agent.delete(`/api/chat/image/${completed.body.id}`).expect(200);
});

test("el usuario hardcodeado de solo lectura puede leer pero no escribir", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const created = await admin.post("/api/matches").send({
    match_date: "2099-06-18",
    match_time: "18:00",
    team1: "Lectura",
    team2: "Visitante",
    force_published: true
  });
  assert.equal(created.status, 201);

  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username: "espectador", password: "mundial2026" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.is_read_only, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM users WHERE username='espectador'").get().count, 0);

  const matches = await agent.get("/api/matches");
  assert.equal(matches.status, 200);
  assert.ok(Array.isArray(matches.body));

  const profile = await agent.get("/api/profile/me");
  assert.equal(profile.status, 200);
  assert.equal(profile.body.user.username, "espectador");

  const match = matches.body.find((item) => item.id === created.body.id);
  assert.ok(match);
  assert.equal((await agent.post("/api/predictions").send({
    match_id: match.id,
    predicted_winner: "draw",
    predicted_team1_goals: 0,
    predicted_team2_goals: 0
  })).status, 403);
  assert.equal((await agent.post(`/api/matches/${match.id}/comments`).send({ comment: "Solo miro." })).status, 403);
  assert.equal((await agent.post("/api/chat").send({ message: "Hola" })).status, 403);
});

test("las reacciones validan visibilidad, revelado, emojis, conteos y toggle", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  const spectator = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  await spectator.post("/api/auth/login").send({ username: "espectador", password: "mundial2026" });

  const openMatch = await admin.post("/api/matches").send({
    match_date: "2098-07-01", match_time: "20:00", team1: "Reacción A", team2: "Reacción B", force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: openMatch.body.id, predicted_winner: "draw", predicted_team1_goals: 0, predicted_team2_goals: 0
  });
  assert.equal(prediction.status, 201);
  assert.equal((await user.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "❤️" })).status, 400);
  assert.equal((await user.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "😂" })).status, 403);

  await admin.patch(`/api/matches/${openMatch.body.id}/status`).send({ status: "closed" });
  assert.equal((await user.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "😂" })).status, 403);
  const added = await admin.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "😂" });
  assert.equal(added.status, 200);
  assert.equal(added.body.reactions["😂"].count, 1);
  assert.equal(added.body.reactions["😂"].reacted, true);
  assert.equal(added.body.reactions["😂"].users[0].username, "administrador");
  const reactionNotifications = await user.get("/api/notifications");
  const reactionNotification = reactionNotifications.body.notifications.find((item) => item.event_key === `reaction:${
    db.prepare("SELECT id FROM reactions WHERE user_id=? AND target_type='prediction' AND target_id=?").get(
      db.prepare("SELECT id FROM users WHERE username='administrador'").get().id, prediction.body.id
    ).id
  }`);
  assert.equal(reactionNotification.type, "reaction");
  assert.match(reactionNotification.message, /administrador ha reaccionado a tu pronóstico/);
  assert.equal(reactionNotification.link, `/match/${openMatch.body.id}`);
  const listed = await admin.get(`/api/reactions?target_type=prediction&target_ids=${prediction.body.id}`);
  assert.equal(listed.body.reactions[`prediction:${prediction.body.id}`]["😂"].count, 1);
  assert.equal(listed.body.reactions[`prediction:${prediction.body.id}`]["😂"].reacted, true);
  const changed = await admin.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "🔥" });
  assert.equal(changed.body.reactions["😂"].count, 0);
  assert.equal(changed.body.reactions["🔥"].count, 1);
  assert.equal(changed.body.reactions["🔥"].reacted, true);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM reactions WHERE user_id=? AND target_type='prediction' AND target_id=?").get(
    db.prepare("SELECT id FROM users WHERE username='administrador'").get().id, prediction.body.id
  ).count, 1);
  await admin.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "😂" });
  const removed = await admin.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "😂" });
  assert.equal(removed.body.reactions["😂"].count, 0);
  assert.equal(removed.body.reactions["😂"].reacted, false);
  assert.equal((await spectator.post("/api/reactions/toggle").send({ target_type: "prediction", target_id: prediction.body.id, emoji: "🔥" })).status, 403);

  const comment = await user.post(`/api/matches/${openMatch.body.id}/comments`).send({ comment: "Comentario reaccionable" });
  assert.equal(comment.status, 201);
  const commentToggle = await admin.post("/api/reactions/toggle").send({ target_type: "match_comment", target_id: comment.body.id, emoji: "👏" });
  assert.equal(commentToggle.status, 200);
  assert.equal(commentToggle.body.reactions["👏"].count, 1);
  assert.equal(commentToggle.body.reactions["👏"].reacted, true);

  const hiddenMatch = await admin.post("/api/matches").send({
    match_date: "2099-07-01", match_time: "20:00", team1: "Oculto A", team2: "Oculto B"
  });
  const stamp = new Date().toISOString();
  const hiddenComment = db.prepare("INSERT INTO match_comments(match_id,user_id,comment,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(hiddenMatch.body.id, db.prepare("SELECT id FROM users WHERE username='lucia'").get().id, "Oculto", stamp, stamp);
  assert.equal((await user.post("/api/reactions/toggle").send({ target_type: "match_comment", target_id: hiddenComment.lastInsertRowid, emoji: "👀" })).status, 404);
});

test("interpreta las horas de los partidos en Europe/Madrid", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });

  const created = await admin.post("/api/matches").send({
    match_date: "2099-06-15",
    match_time: "01:00",
    team1: "Zona horaria",
    team2: "Madrid"
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.auto_close_at, "2099-06-14T23:00:00.000Z");

  const edited = await admin.put(`/api/matches/${created.body.id}`).send({
    match_date: "2099-06-15",
    match_time: "01:00",
    auto_close_at: "2099-06-15T01:00",
    team1: "Zona horaria",
    team2: "Madrid"
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.auto_close_at, "2099-06-14T23:00:00.000Z");
});

test("rechaza credenciales incorrectas", async () => {
  const response = await request(app).post("/api/auth/login").send({ username: "administrador", password: "no" });
  assert.equal(response.status, 401);
});

test("un usuario puede cambiar su propia contraseña", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });

  const incorrect = await agent.patch("/api/profile/password").send({
    current_password: "incorrecta",
    new_password: "lucia2"
  });
  assert.equal(incorrect.status, 400);

  const changed = await agent.patch("/api/profile/password").send({
    current_password: "lucia",
    new_password: "lucia2"
  });
  assert.equal(changed.status, 200);

  const newLogin = await request(app).post("/api/auth/login").send({ username: "lucia", password: "lucia2" });
  assert.equal(newLogin.status, 200);

  await agent.patch("/api/profile/password").send({
    current_password: "lucia2",
    new_password: "lucia"
  });
});

test("el nombre visible se publica sin cambiar la identidad y admite 3 cambios cada 24 horas", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const before = db.prepare("SELECT id,username FROM users WHERE username='lucia'").get();

  for (const displayName of ["Lucía Uno", "Lucía Dos", "Lucía Final"]) {
    const changed = await agent.patch("/api/profile/me").send({ display_name: displayName, personal_phrase: "" });
    assert.equal(changed.status, 200);
    assert.equal(changed.body.display_name, displayName);
    assert.equal(changed.body.username, "lucia");
  }

  const rejected = await agent.patch("/api/profile/me").send({ display_name: "Lucía Cuatro", personal_phrase: "" });
  assert.equal(rejected.status, 429);
  const after = db.prepare("SELECT id,username,display_name FROM users WHERE id=?").get(before.id);
  assert.deepEqual(after, { ...before, display_name: "Lucía Final" });
  const leaderboard = await agent.get("/api/leaderboard");
  assert.equal(leaderboard.body.find((row) => row.id === before.id).username, "Lucía Final");
});

test("un usuario puede subir y eliminar una foto de perfil", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const image = await sharp({
    create: { width: 800, height: 500, channels: 3, background: "#a91f32" }
  }).png().toBuffer();

  const uploaded = await agent.put("/api/profile/avatar").set("Content-Type", "image/png").send(image);
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.avatar_url, /^\/avatars\/user-\d+-\d+\.webp$/);

  const served = await agent.get(uploaded.body.avatar_url);
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "image/webp");

  const removed = await agent.delete("/api/profile/avatar");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.avatar_url, null);
});

test("rechaza contenido que no sea una imagen válida", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const response = await agent.put("/api/profile/avatar").set("Content-Type", "image/png").send("no es una imagen");
  assert.equal(response.status, 400);
  assert.match(response.body.error, /dañado|incompleto|compatible/i);
});

test("explica por qué se rechazan tipos y dimensiones no válidos", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });

  const wrongType = await agent.put("/api/profile/avatar").set("Content-Type", "application/pdf").send("pdf");
  assert.equal(wrongType.status, 415);
  assert.match(wrongType.body.error, /JPEG, PNG o WebP/);

  const tinyImage = await sharp({
    create: { width: 50, height: 50, channels: 3, background: "#a91f32" }
  }).png().toBuffer();
  const tooSmall = await agent.put("/api/profile/avatar").set("Content-Type", "image/png").send(tinyImage);
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error, /100 × 100/);
});

test("un usuario normal no accede a administración", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const response = await agent.get("/api/users");
  assert.equal(response.status, 403);
});

test("el administrador puede paginar y filtrar partidos", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });

  const paginated = await agent.get("/api/admin/matches?page=1&page_size=1&filter=all");
  assert.equal(paginated.status, 200);
  assert.equal(paginated.body.matches.length, 1);
  assert.equal(paginated.body.pagination.page_size, 1);
  assert.ok(paginated.body.pagination.total >= 1);
  assert.ok(paginated.body.pagination.total_pages >= 1);

  const upcoming = await agent.get("/api/admin/matches?filter=upcoming");
  assert.equal(upcoming.status, 200);
  assert.equal(upcoming.body.matches.every((match) => ["open", "closed"].includes(match.status)), true);

  const normalUser = request.agent(app);
  await normalUser.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const forbidden = await normalUser.get("/api/admin/matches");
  assert.equal(forbidden.status, 403);
});

test("el calendario worldcup marca eliminatorias desde round", () => {
  const catalog = normalizeWorldCupReference({
    name: "World Cup 2026",
    matches: [
      { round: "Matchday 1", date: "2026-06-11", time: "13:00 UTC-6", team1: "Mexico", team2: "South Africa", ground: "Mexico City" },
      { round: "Round of 32", date: "2026-06-28", time: "12:00 UTC-7", team1: "2A", team2: "2B", ground: "Los Angeles (Inglewood)" },
      { round: "Semi-final", date: "2026-07-14", time: "14:00 UTC-5", team1: "W97", team2: "W98", ground: "Dallas (Arlington)" }
    ]
  });
  assert.equal(catalog.matches[0].is_knockout, false);
  assert.equal(catalog.matches[1].is_knockout, true);
  assert.equal(catalog.matches[2].is_knockout, true);
});

test("el grupo E enlaza Curazao con su bandera", () => {
  const overview = worldCupOverview();
  const groupE = overview.groups.find((group) => group.name === "Group E");
  const curazao = groupE.standings.find((team) => team.fifa_code === "CUW");
  assert.equal(curazao.name, "Curazao");
  assert.equal(curazao.source_name, "Curaçao");
  assert.equal(curazao.flag_icon, "🇨🇼");
});

test("las eliminatorias guardan penaltis informativos sin cambiar el signo puntuable", async () => {
  const admin = request.agent(app), user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const suffix = Date.now();
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-20",
    match_time: "21:00",
    team1: `KO A ${suffix}`,
    team2: `KO B ${suffix}`,
    force_published: true,
    scorer_enabled: false,
    is_knockout: true
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.is_knockout, 1);
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "draw",
    predicted_team1_goals: 1,
    predicted_team2_goals: 1,
    predicted_scorer_id: null
  });
  assert.equal(prediction.status, 201);

  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });
  const finished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 1,
    result_team2: 1,
    scorer_ids: [],
    has_penalties: true,
    penalty_team1: 6,
    penalty_team2: 5
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.body.winner, "draw");
  assert.equal(finished.body.penalty_team1, 6);
  assert.equal(finished.body.penalty_team2, 5);
  assert.equal(finished.body.penalty_summary.text, `Tras penaltis: gana KO A ${suffix} 6-5`);

  const scored = db.prepare("SELECT winner_points,exact_result_points,total_points FROM predictions WHERE id=?").get(prediction.body.id);
  assert.ok(scored.winner_points > 0);
  assert.ok(scored.exact_result_points > 0);
  assert.equal(scored.total_points, scored.winner_points + scored.exact_result_points);
});

test("rechaza penaltis si el resultado de eliminatoria hasta 120 no es empate", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-21",
    match_time: "21:00",
    team1: "KO no empate A",
    team2: "KO no empate B",
    force_published: true,
    scorer_enabled: false,
    is_knockout: true
  });
  assert.equal(created.status, 201);

  const rejected = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1,
    scorer_ids: [],
    has_penalties: true,
    penalty_team1: 6,
    penalty_team2: 5
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /120 minutos es empate/);
});

test("el calendario JSON solo ofrece referencias manuales y marca duplicados", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });

  const first = await admin.get("/api/admin/match-reference?date=2026-06-15");
  assert.equal(first.status, 200);
  assert.equal(first.body.from, "2026-06-15");
  assert.equal(first.body.to, "2026-06-18");
  assert.ok(first.body.matches.length > 0);
  const candidate = first.body.matches.find((match) => match.selectable && !match.existing_match);
  assert.ok(candidate);

  const created = await admin.post("/api/matches").send({
    match_date: candidate.match_date,
    match_time: candidate.match_time,
    team1_id: candidate.team1.id,
    team2_id: candidate.team2.id,
    stadium_id: candidate.stadium.id
  });
  assert.equal(created.status, 201);

  const second = await admin.get("/api/admin/match-reference?date=2026-06-15");
  const duplicate = second.body.matches.find((match) => match.reference_id === candidate.reference_id);
  assert.equal(duplicate.existing_match.id, created.body.id);

  const normalUser = request.agent(app);
  await normalUser.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  assert.equal((await normalUser.get("/api/admin/match-reference?date=2026-06-15")).status, 403);
});

test("las estadísticas de equipos leen resultados del JSON sin finalizar partidos manuales", async () => {
  const user = request.agent(app);
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const mexico = db.prepare("SELECT * FROM teams WHERE fifa_code='MEX'").get();

  const detail = await user.get(`/api/teams/${mexico.id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.stats_source, "worldcup_json");
  assert.equal(detail.body.stats.played, 1);
  assert.equal(detail.body.stats.won, 1);
  assert.equal(detail.body.stats.goals_for, 2);
  assert.equal(detail.body.stats.goals_against, 0);
  assert.equal(detail.body.recent_matches[0].opponent, "Sudáfrica");

  const manualMatches = db.prepare(`
    SELECT COUNT(*) count FROM matches
    WHERE (team1_id=? OR team2_id=?) AND (result_team1 IS NOT NULL OR result_team2 IS NOT NULL)
  `).get(mexico.id, mexico.id);
  assert.equal(manualMatches.count, 0);
});

test("la clasificación requiere autenticación", async () => {
  const response = await request(app).get("/api/leaderboard");
  assert.equal(response.status, 401);
});

test("los administradores no aparecen en la clasificación", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const response = await agent.get("/api/leaderboard");
  assert.equal(response.status, 200);
  assert.ok(response.body.length > 0);
  assert.equal(response.body.some((row) => row.username === "administrador"), false);
});

test("la clasificación diaria muestra a todos con cero antes del primer resultado", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const response = await agent.get("/api/leaderboard/daily");
  assert.equal(response.status, 200);
  assert.ok(response.body.rows.length > 0);
  assert.equal(response.body.rows.some((row) => row.username === "administrador"), false);
  if (response.body.date === null) {
    assert.equal(response.body.rows.every((row) => row.total_points === 0), true);
  }
});

test("una predicción debe coincidir con el ganador del marcador", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const created = await admin.post("/api/matches").send({
    match_date: future.toISOString().slice(0, 10),
    match_time: future.toISOString().slice(11, 16),
    team1: "Equipo prueba",
    team2: "Equipo rival",
    force_published: true
  });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const response = await agent.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "draw",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1
  });
  assert.equal(response.status, 400);
});

test("no permite pronosticar en un partido ya empezado aunque esté abierto manualmente", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const created = await admin.post("/api/matches").send({
    match_date: "2000-01-01",
    match_time: "12:00",
    team1: "Partido empezado",
    team2: "Abierto manual",
    force_published: true
  });
  assert.equal(created.status, 201);
  db.prepare("UPDATE matches SET status='open',close_reason='manual' WHERE id=?").run(created.body.id);

  const response = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "draw",
    predicted_team1_goals: 1,
    predicted_team2_goals: 1
  });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /cerradas/);
});

test("un Partido Estrella duplica los puntos y deja trazabilidad x2", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const created = await admin.post("/api/matches").send({
    match_date: future.toISOString().slice(0, 10),
    match_time: future.toISOString().slice(11, 16),
    team1: "Brasil",
    team2: "Argentina",
    force_published: true,
    is_star: true
  });
  assert.equal(created.body.is_star, 1);

  await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1
  });
  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1
  });

  const predictions = await user.get("/api/predictions/me");
  const scored = predictions.body.find((item) => item.match_id === created.body.id);
  assert.equal(scored.winner_points, 6);
  assert.equal(scored.exact_result_points, 10);
  assert.equal(scored.total_points, 16);
  assert.equal(scored.scoring_multiplier, 2);

  const activity = await user.get("/api/activity?page_size=30");
  const event = activity.body.items.find((item) => item.event_id === scored.id && item.type === "points");
  assert.match(event.text, /lucia ganó 16 puntos en Partido Estrella por acertar ganador \+ resultado exacto/);
  assert.equal(event.points_breakdown.base_total, 8);
  assert.equal(event.points_breakdown.multiplier, 2);
  assert.equal(event.points_breakdown.total, 16);
  assert.deepEqual(event.points_breakdown.rules.map((rule) => [rule.label, rule.base_points]), [["Ganador", 3], ["Resultado exacto", 5]]);
  assert.deepEqual(event.points_breakdown.rules.map((rule) => [rule.description, rule.earned_points]), [["acierto de ganador", 6], ["acierto exacto", 10]]);

  const notifications = await user.get("/api/notifications");
  const notification = notifications.body.notifications.find((item) => item.type === "points_earned" && item.entity_id === created.body.id);
  assert.match(notification.message, /8 puntos base ×2/);
  const resultNotification = notifications.body.notifications.find((item) => item.type === "result_published" && item.entity_id === created.body.id);
  assert.equal(resultNotification.title, "Resultado publicado (administrador)");
});

test("importa catálogos sin duplicados y puntúa cualquier goleador válido", async () => {
  assert.equal(db.prepare("SELECT COUNT(*) count FROM teams").get().count, 48);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM players").get().count, 1245);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM stadiums").get().count, 16);

  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? ORDER BY id LIMIT 1").get(team1.fifa_code);
  const otherScorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? ORDER BY id LIMIT 1").get(team2.fifa_code);
  const stadium = db.prepare("SELECT * FROM stadiums ORDER BY id LIMIT 1").get();
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const created = await admin.post("/api/matches").send({
    match_date: future.toISOString().slice(0, 10),
    match_time: future.toISOString().slice(11, 16),
    team1_id: team1.id,
    team2_id: team2.id,
    stadium_id: stadium.id,
    scorer_enabled: true,
    force_published: true,
    is_star: true
  });
  assert.equal(created.status, 201);

  const missingScorer = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1
  });
  assert.equal(missingScorer.status, 400);

  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1,
    predicted_scorer_id: scorer.id
  });
  assert.equal(prediction.status, 201);

  const openDetailForAdmin = await admin.get(`/api/matches/${created.body.id}/detail`);
  assert.equal(openDetailForAdmin.status, 200);
  assert.equal(openDetailForAdmin.body.revealed, false);
  const openParticipant = openDetailForAdmin.body.participants.find((item) => item.username === "lucia");
  assert.equal(openParticipant.participating, 1);
  assert.equal(openParticipant.result_valid, true);
  assert.equal(openParticipant.scorer_required, true);
  assert.equal(openParticipant.scorer_valid, true);
  assert.equal(openParticipant.predicted_team1_goals, undefined);
  assert.equal(openParticipant.predicted_scorer_id, undefined);

  const openDetailForUser = await user.get(`/api/matches/${created.body.id}/detail`);
  assert.equal(openDetailForUser.body.revealed, false);
  assert.deepEqual(openDetailForUser.body.participants, []);

  const finished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1,
    scorer_ids: [scorer.id, otherScorer.id]
  });
  assert.equal(finished.status, 200);
  const detail = await user.get(`/api/matches/${created.body.id}/detail`);
  const participant = detail.body.participants.find((item) => item.username === "lucia");
  assert.equal(participant.predicted_scorer_name, scorer.name);
  const scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.equal(scored.winner_points, 6);
  assert.equal(scored.exact_result_points, 10);
  assert.equal(scored.scorer_points, 4);
  assert.equal(scored.total_points, 20);
});

test("un pronóstico 0-0 usa Sin goleador y puede puntuar el máximo completo", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "marcos", password: "marcos" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-01", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });
  const accepted = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "draw",
    predicted_team1_goals: 0, predicted_team2_goals: 0,
    predicted_scorer_id: "no_scorer"
  });
  assert.equal(accepted.status, 201);
  const finished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 0, result_team2: 0, scorer_ids: ["no_scorer"]
  });
  assert.equal(finished.status, 200);
  assert.equal(finished.body.actual_scorers[0].id, "no_scorer");
  const detail = await user.get(`/api/matches/${created.body.id}/detail`);
  const participant = detail.body.participants.find((item) => item.username === "marcos");
  assert.equal(participant.predicted_scorer_id, "no_scorer");
  assert.equal(participant.predicted_scorer_name, "Sin goleador");
  const scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(accepted.body.id);
  assert.equal(scored.winner_points, 3);
  assert.equal(scored.exact_result_points, 5);
  assert.equal(scored.scorer_points, 2);
  assert.equal(scored.total_points, 10);
});

test("los goleadores reales solo pueden ser de equipos que hayan marcado", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer1 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const scorer2 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team2.fifa_code);
  const createMatch = () => admin.post("/api/matches").send({
    match_date: "2099-07-02", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });

  const homeWin = await createMatch();
  assert.equal((await admin.post(`/api/matches/${homeWin.body.id}/finish`).send({
    result_team1: 1, result_team2: 0, scorer_ids: [scorer2.id]
  })).status, 400);
  assert.equal((await admin.post(`/api/matches/${homeWin.body.id}/finish`).send({
    result_team1: 1, result_team2: 0, scorer_ids: [scorer1.id]
  })).status, 200);

  const awayWin = await createMatch();
  assert.equal((await admin.post(`/api/matches/${awayWin.body.id}/finish`).send({
    result_team1: 0, result_team2: 1, scorer_ids: [scorer1.id]
  })).status, 400);
  assert.equal((await admin.post(`/api/matches/${awayWin.body.id}/finish`).send({
    result_team1: 0, result_team2: 1, scorer_ids: [scorer2.id]
  })).status, 200);

  const draw = await createMatch();
  assert.equal((await admin.post(`/api/matches/${draw.body.id}/finish`).send({
    result_team1: 1, result_team2: 1, scorer_ids: [scorer1.id, scorer2.id]
  })).status, 200);
});

test("el goleador pronosticado debe ser de un equipo que marque", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer1 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const scorer2 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team2.fifa_code);
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-03", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });

  assert.equal((await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 0,
    predicted_scorer_id: scorer2.id
  })).status, 400);

  assert.equal((await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 0,
    predicted_scorer_id: scorer1.id
  })).status, 201);
});

test("configura los puntos de goleador y los refleja en la clasificación", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "sara", password: "sara" });
  const originalSettings = (await admin.get("/api/admin/settings")).body;
  const configured = await admin.put("/api/admin/settings").send({ ...originalSettings, scorer_points: 7 });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.scorer_points, "7");
  assert.equal((await admin.put("/api/admin/settings").send({ scorer_points: -1 })).status, 400);

  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-02", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "team1",
    predicted_team1_goals: 1, predicted_team2_goals: 0, predicted_scorer_id: scorer.id
  });
  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2, result_team2: 0, scorer_ids: [scorer.id]
  });
  const scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.equal(scored.winner_points, 3);
  assert.equal(scored.exact_result_points, 0);
  assert.equal(scored.scorer_points, 7);
  assert.equal(scored.total_points, 10);
  const leaderboard = await user.get("/api/leaderboard");
  const row = leaderboard.body.find((item) => item.username === "sara");
  assert.ok(row.scorer_points >= 7);
  assert.ok(row.scorer_hits >= 1);
  const activity = await user.get("/api/activity?page_size=30");
  const event = activity.body.items.find((item) => item.event_id === scored.id && item.type === "points");
  assert.equal(event.scorer_points, 7);
  assert.match(event.text, /sara ganó 10 puntos por acertar ganador \+ goleador/);
  assert.deepEqual(event.points_breakdown.rules.map((rule) => [rule.label, rule.base_points]), [["Ganador", 3], ["Goleador", 7]]);
  assert.equal(event.points_breakdown.rules.find((rule) => rule.label === "Goleador").detail, scorer.name);

  await admin.put("/api/admin/settings").send(originalSettings);
});

test("valida, edita y desactiva la regla de goleadores", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "marcos", password: "marcos" });
  const [team1, team2, outsiderTeam] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 3").all();
  const scorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const replacement = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team2.fifa_code);
  const outsider = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(outsiderTeam.fifa_code);

  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-03", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });
  const invalidPrediction = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "team1",
    predicted_team1_goals: 2, predicted_team2_goals: 1, predicted_scorer_id: outsider.id
  });
  assert.equal(invalidPrediction.status, 400);
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "team1",
    predicted_team1_goals: 2, predicted_team2_goals: 1, predicted_scorer_id: scorer.id
  });
  assert.equal((await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2, result_team2: 1, scorer_ids: [outsider.id]
  })).status, 400);
  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2, result_team2: 1, scorer_ids: [scorer.id]
  });
  assert.equal(db.prepare("SELECT scorer_points FROM predictions WHERE id=?").get(prediction.body.id).scorer_points, 2);
  const edited = await admin.put(`/api/matches/${created.body.id}/scorers`).send({ scorer_ids: [replacement.id] });
  assert.equal(edited.status, 200);
  assert.equal(db.prepare("SELECT scorer_points FROM predictions WHERE id=?").get(prediction.body.id).scorer_points, 0);

  const disabled = await admin.post("/api/matches").send({
    match_date: "2099-07-04", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: false, force_published: true
  });
  assert.equal((await user.post("/api/predictions").send({
    match_id: disabled.body.id, predicted_winner: "draw",
    predicted_team1_goals: 1, predicted_team2_goals: 1
  })).status, 201);
  assert.equal((await admin.post(`/api/matches/${disabled.body.id}/finish`).send({
    result_team1: 1, result_team2: 1
  })).status, 200);
});

test("rechaza entradas manipuladas sin provocar errores internos", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-05", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });
  assert.equal(created.status, 201);
  assert.equal((await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 1, result_team2: 0, scorer_ids: "no-es-un-array"
  })).status, 400);
  assert.equal((await admin.post("/api/matches").send({
    match_date: "fecha-invalida", match_time: "99:99",
    team1_id: team1.id, team2_id: team2.id
  })).status, 400);
  assert.equal((await admin.post("/api/matches").send({
    match_date: "2099-07-05", match_time: "20:00",
    team1_id: 999999, team2_id: team2.id
  })).status, 400);
});

test("protege la coherencia al editar equipos y la regla de goleador", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const [team1, team2, team3] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 3").all();
  const scorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-06", match_time: "20:00",
    team1_id: team1.id, team2_id: team2.id, scorer_enabled: true, force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "team1",
    predicted_team1_goals: 1, predicted_team2_goals: 0, predicted_scorer_id: scorer.id
  });
  assert.equal(prediction.status, 201);
  assert.equal((await admin.put(`/api/matches/${created.body.id}`).send({
    team1_id: team3.id
  })).status, 409);
  assert.equal((await admin.put(`/api/matches/${created.body.id}`).send({
    scorer_enabled: false
  })).status, 200);
  assert.equal(db.prepare("SELECT predicted_scorer_id FROM predictions WHERE id=?").get(prediction.body.id).predicted_scorer_id, null);
});

test("recalcula con fiabilidad al editar resultado, goleadores y Partido Estrella", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "sara", password: "sara" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer1 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const scorer2 = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team2.fifa_code);
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-07",
    match_time: "20:00",
    team1_id: team1.id,
    team2_id: team2.id,
    scorer_enabled: true,
    force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1,
    predicted_scorer_id: scorer1.id
  });
  assert.equal(prediction.status, 201);

  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1,
    scorer_ids: [scorer1.id]
  });
  let scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points, scored.scoring_multiplier], [3, 5, 2, 10, 1]);

  const starred = await admin.put(`/api/matches/${created.body.id}`).send({ is_star: true });
  assert.equal(starred.status, 200);
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points, scored.scoring_multiplier], [6, 10, 4, 20, 2]);

  const editedResult = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 1,
    result_team2: 2,
    scorer_ids: [scorer2.id]
  });
  assert.equal(editedResult.status, 200);
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points, scored.scoring_multiplier], [0, 0, 0, 0, 2]);
  const editNotification = (await user.get("/api/notifications")).body.notifications.find((item) =>
    item.type === "result_published" && item.entity_id === created.body.id && item.event_key?.startsWith(`result-edit:${created.body.id}:`) && item.message.includes(`${team1.name} 1 - 2 ${team2.name}`)
  );
  assert.equal(editNotification.title, "Resultado publicado - modificacion - (administrador)");
  assert.match(editNotification.message, new RegExp(`${team1.name} 1 - 2 ${team2.name}`));

  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1,
    scorer_ids: [scorer2.id]
  });
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points], [6, 10, 0, 16]);
  const sameScoreEdit = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1,
    scorer_ids: [scorer2.id]
  });
  assert.equal(sameScoreEdit.status, 200);
  const sameScoreNotifications = (await user.get("/api/notifications")).body.notifications.filter((item) =>
    item.type === "result_published" && item.entity_id === created.body.id && item.event_key?.startsWith(`result-edit:${created.body.id}:`) && item.message.includes(`${team1.name} 2 - 1 ${team2.name}`)
  );
  assert.equal(sameScoreNotifications.length, 1);
  const pendingMovements = (await user.get("/api/movement-summaries/pending")).body.summaries
    .filter((item) => item.match.id === created.body.id);
  assert.equal(pendingMovements.length, 1);
  assert.deepEqual([pendingMovements[0].match.result_team1, pendingMovements[0].match.result_team2], [2, 1]);

  const recalculatedMatch = await admin.post(`/api/admin/recalculate/${created.body.id}`);
  assert.equal(recalculatedMatch.status, 200);
  assert.equal(recalculatedMatch.body.recalculated, 1);
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points], [6, 10, 0, 16]);

  const fixedScorers = await admin.put(`/api/matches/${created.body.id}/scorers`).send({ scorer_ids: [scorer1.id] });
  assert.equal(fixedScorers.status, 200);
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points], [6, 10, 4, 20]);

  const normal = await admin.put(`/api/matches/${created.body.id}`).send({ is_star: false });
  assert.equal(normal.status, 200);
  scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.deepEqual([scored.winner_points, scored.exact_result_points, scored.scorer_points, scored.total_points, scored.scoring_multiplier], [3, 5, 2, 10, 1]);
});

test("no permite activar goleador en un partido finalizado con goles sin goleadores reales", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "marcos", password: "marcos" });
  const [team1, team2] = db.prepare("SELECT * FROM teams ORDER BY id LIMIT 2").all();
  const scorer = db.prepare("SELECT * FROM players WHERE team_fifa_code=? LIMIT 1").get(team1.fifa_code);
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-08",
    match_time: "20:00",
    team1_id: team1.id,
    team2_id: team2.id,
    scorer_enabled: false,
    force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 1,
    predicted_team2_goals: 0
  });
  assert.equal(prediction.status, 201);
  await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 1,
    result_team2: 0
  });

  const rejected = await admin.put(`/api/matches/${created.body.id}`).send({ scorer_enabled: true });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Guarda primero los goleadores reales/);

  const savedScorers = await admin.put(`/api/matches/${created.body.id}/scorers`).send({ scorer_ids: [scorer.id] });
  assert.equal(savedScorers.status, 200);
  const enabled = await admin.put(`/api/matches/${created.body.id}`).send({ scorer_enabled: true });
  assert.equal(enabled.status, 200);
  const scored = db.prepare("SELECT * FROM predictions WHERE id=?").get(prediction.body.id);
  assert.equal(scored.scorer_points, 0);
  assert.equal(scored.total_points, 8);
});

test("los partidos se publican 24 horas antes salvo publicación forzada", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const future = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const payload = {
    match_date: future.toISOString().slice(0, 10),
    match_time: future.toISOString().slice(11, 16),
    team1: "Equipo oculto",
    team2: "Equipo visitante"
  };

  const created = await admin.post("/api/matches").send(payload);
  assert.equal(created.status, 201);
  assert.equal(created.body.published, false);
  assert.equal((await user.get("/api/matches")).body.some((match) => match.id === created.body.id), false);
  const calendar = await user.get("/api/dashboard/calendar");
  assert.equal(calendar.body.some((match) => match.id === created.body.id), false);
  assert.equal((await user.get(`/api/matches/${created.body.id}/detail`)).status, 404);
  assert.equal((await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "draw",
    predicted_team1_goals: 1,
    predicted_team2_goals: 1
  })).status, 409);

  const published = await admin.put(`/api/matches/${created.body.id}`).send({ ...payload, force_published: true });
  assert.equal(published.body.published, true);
  assert.equal((await user.get("/api/matches")).body.some((match) => match.id === created.body.id), true);
});

test("los endpoints ligeros de partidos filtran calendario, vistas y ticker", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const dayKey = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  };
  const yesterday = dayKey(-1), today = dayKey(0), tomorrow = dayKey(1), later = dayKey(3);

  const todayMatch = await admin.post("/api/matches").send({
    match_date: today, match_time: "23:45", team1: "Hoy ligero", team2: "Hoy rival", force_published: true
  }).expect(201);
  const openTomorrow = await admin.post("/api/matches").send({
    match_date: tomorrow, match_time: "23:45", team1: "Mañana abierto", team2: "Mañana rival", force_published: true
  }).expect(201);
  const closedTomorrow = await admin.post("/api/matches").send({
    match_date: tomorrow, match_time: "00:00", team1: "Madrugada cerrada", team2: "Madrugada rival", force_published: true
  }).expect(201);
  const hiddenLater = await admin.post("/api/matches").send({
    match_date: later, match_time: "23:45", team1: "Oculto ligero", team2: "Oculto rival"
  }).expect(201);
  const yesterdayLive = await admin.post("/api/matches").send({
    match_date: yesterday, match_time: "00:01", team1: "Ayer live", team2: "Ayer rival", force_published: true
  }).expect(201);
  const yesterdayFinished = await admin.post("/api/matches").send({
    match_date: yesterday, match_time: "00:02", team1: "Ayer final", team2: "Ayer cerrado", force_published: true
  }).expect(201);
  await admin.post(`/api/matches/${yesterdayFinished.body.id}/finish`).send({ result_team1: 1, result_team2: 0 }).expect(200);
  await user.post("/api/predictions").send({
    match_id: openTomorrow.body.id,
    predicted_winner: "draw",
    predicted_team1_goals: 0,
    predicted_team2_goals: 0
  }).expect(201);
  await admin.patch(`/api/matches/${closedTomorrow.body.id}/status`).send({ status: "closed" }).expect(200);

  const calendar = await user.get("/api/dashboard/calendar").expect(200);
  assert.equal(calendar.body.some((match) => match.id === todayMatch.body.id), true);
  assert.equal(calendar.body.some((match) => match.id === yesterdayLive.body.id), true);
  assert.equal(calendar.body.some((match) => match.id === openTomorrow.body.id), true);
  assert.equal(calendar.body.some((match) => match.id === closedTomorrow.body.id), true);
  assert.equal(calendar.body.some((match) => match.id === hiddenLater.body.id), false);
  assert.equal(calendar.body.some((match) => match.id === yesterdayFinished.body.id), false);

  const todayTicker = await user.get("/api/matches/today").expect(200);
  assert.deepEqual(todayTicker.body.map((match) => match.id).filter((id) => [todayMatch.body.id, openTomorrow.body.id].includes(id)), [todayMatch.body.id]);

  const todayView = await user.get("/api/matches/view/today").expect(200);
  assert.equal(todayView.body.every((match) => match.match_date === today), true);

  const upcoming = await user.get("/api/matches/view/upcoming").expect(200);
  assert.equal(upcoming.body.some((match) => match.id === openTomorrow.body.id), true);
  assert.equal(upcoming.body.some((match) => match.id === closedTomorrow.body.id), true);
  assert.equal(upcoming.body.some((match) => match.id === todayMatch.body.id), false);
  assert.equal(upcoming.body.every((match) => match.match_date !== today && match.status !== "finished" && !match.in_play), true);

  const pending = await user.get("/api/matches/view/pending").expect(200);
  assert.equal(pending.body.some((match) => match.id === openTomorrow.body.id), false);
  assert.equal(pending.body.every((match) => match.betting_open && !match.prediction_id), true);

  const history = await user.get(`/api/matches/view/history?date=${yesterday}`).expect(200);
  assert.equal(history.body.some((match) => match.id === yesterdayFinished.body.id), true);
  assert.equal(history.body.some((match) => match.id === yesterdayLive.body.id), false);

  const summary = await user.get("/api/matches/summary").expect(200);
  assert.equal(summary.body.today >= 1, true);
  assert.equal(summary.body.history >= 1, true);
});

test("avisa individualmente a las 22:00 de apuestas pendientes de madrugada sin duplicar", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const matchDate = "2099-07-02";
  const first = await admin.post("/api/matches").send({ match_date: matchDate, match_time: "01:30", team1: "Nocturno uno", team2: "Nocturno dos", force_published: true });
  const second = await admin.post("/api/matches").send({ match_date: matchDate, match_time: "06:45", team1: "Nocturno tres", team2: "Nocturno cuatro", force_published: true });
  await user.post("/api/predictions").send({ match_id: first.body.id, predicted_winner: "draw", predicted_team1_goals: 1, predicted_team2_goals: 1 }).expect(201);

  const atTenInMadrid = new Date("2099-07-01T20:15:00.000Z");
  assert.equal(remindNextNightMissingPredictions(atTenInMadrid) > 0, true);
  assert.equal(remindNextNightMissingPredictions(atTenInMadrid), 0);
  const userId = db.prepare("SELECT id FROM users WHERE username='lucia'").get().id;
  const notification = db.prepare("SELECT * FROM notifications WHERE event_key=?").get(`night-match-reminder:${matchDate}:${userId}`);
  assert.ok(notification);
  assert.match(notification.message, /Tienes 1 partido de madrugada pendiente/);
  assert.equal(notification.entity_id, second.body.id);
});

test("la portada mantiene como próximo un partido cerrado antes de empezar", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const originalSettings = (await admin.get("/api/admin/settings")).body;
  await admin.put("/api/admin/settings").send({ ...originalSettings, auto_close_enabled: "1", auto_close_minutes_before: "5" });

  const startsAt = new Date(Date.now() + 3 * 60 * 1000);
  const madridParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(startsAt).map(({ type, value }) => [type, value]));
  const created = await admin.post("/api/matches").send({
    match_date: `${madridParts.year}-${madridParts.month}-${madridParts.day}`,
    match_time: `${madridParts.hour}:${madridParts.minute}`,
    team1: "Equipo cierre",
    team2: "Equipo visible",
    force_published: true
  });
  assert.equal(created.status, 201);

  const dashboard = await user.get("/api/dashboard");
  const upcoming = dashboard.body.next_matches.find((match) => match.id === created.body.id);
  assert.ok(upcoming);
  assert.equal(upcoming.status, "closed");
  assert.equal(upcoming.betting_open, false);
  assert.equal(upcoming.in_play, false);
  assert.equal(dashboard.body.in_play_matches.some((match) => match.id === created.body.id), false);

  await admin.put("/api/admin/settings").send(originalSettings);
});

test("el administrador puede eliminar un resultado y reabrir el partido", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const created = await admin.post("/api/matches").send({
    match_date: future.toISOString().slice(0, 10),
    match_time: future.toISOString().slice(11, 16),
    team1: "Equipo reapertura",
    team2: "Equipo contrario",
    force_published: true
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1
  });
  assert.equal(prediction.status, 201);

  const finished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1
  });
  assert.equal(finished.body.status, "finished");

  const reopened = await admin.delete(`/api/matches/${created.body.id}/result`);
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.status, "open");
  assert.equal(reopened.body.result_team1, null);
  assert.equal(reopened.body.result_team2, null);
  assert.equal(reopened.body.winner, null);
  assert.equal(reopened.body.betting_open, true);

  const predictions = await user.get("/api/predictions/me");
  const reset = predictions.body.find((item) => item.match_id === created.body.id);
  assert.equal(reset.winner_points, 0);
  assert.equal(reset.exact_result_points, 0);
  assert.equal(reset.total_points, 0);
  assert.equal(reset.locked, 0);

  const republished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 2,
    result_team2: 1
  });
  assert.equal(republished.status, 200);
  assert.equal(republished.body.status, "finished");
  const movementSummaries = await user.get("/api/movement-summaries/pending");
  assert.equal(movementSummaries.status, 200);
  assert.equal(movementSummaries.body.summaries.filter((item) => item.match.id === created.body.id).length, 1);
});

test("al reabrir se puede elegir cierre automático o apertura manual", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const created = await admin.post("/api/matches").send({
    match_date: "2099-06-15",
    match_time: "01:00",
    team1: "Reapertura",
    team2: "Configurable",
    force_published: true
  });

  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });

  const missingMode = await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "open" });
  assert.equal(missingMode.status, 400);

  const automatic = await admin.patch(`/api/matches/${created.body.id}/status`).send({
    status: "open",
    reopen_mode: "automatic"
  });
  assert.equal(automatic.status, 200);
  assert.equal(automatic.body.status, "open");
  assert.equal(automatic.body.close_reason, null);

  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });
  const manual = await admin.patch(`/api/matches/${created.body.id}/status`).send({
    status: "open",
    reopen_mode: "manual"
  });
  assert.equal(manual.status, 200);
  assert.equal(manual.body.status, "open");
  assert.equal(manual.body.close_reason, "manual");
});

test("no permite reabrir un partido que ya está en juego", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const created = await admin.post("/api/matches").send({
    match_date: "2000-01-02",
    match_time: "12:00",
    team1: "En juego",
    team2: "No reabrible",
    force_published: true
  });
  assert.equal(created.status, 201);
  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });

  const reopened = await admin.patch(`/api/matches/${created.body.id}/status`).send({
    status: "open",
    reopen_mode: "manual"
  });
  assert.equal(reopened.status, 409);
  assert.match(reopened.body.error, /en juego/);
});

test("eliminar un resultado no reabre apuestas si ya pasó la hora de cierre", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const created = await admin.post("/api/matches").send({
    match_date: past.toISOString().slice(0, 10),
    match_time: past.toISOString().slice(11, 16),
    team1: "Equipo cerrado",
    team2: "Equipo finalizado",
    force_published: true
  });

  const finished = await admin.post(`/api/matches/${created.body.id}/finish`).send({
    result_team1: 1,
    result_team2: 0
  });
  assert.equal(finished.body.status, "finished");

  const cleared = await admin.delete(`/api/matches/${created.body.id}/result`);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.status, "closed");
  assert.equal(cleared.body.close_reason, "automatic");
  assert.equal(cleared.body.betting_open, false);

  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id,
    predicted_winner: "team1",
    predicted_team1_goals: 1,
    predicted_team2_goals: 0
  });
  assert.equal(prediction.status, 409);
});

test("la distribución de votos permanece oculta mientras se puede apostar", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const matches = await agent.get("/api/matches");
  const open = matches.body.find((match) => match.betting_open);
  assert.ok(open);

  const detail = await agent.get(`/api/matches/${open.id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.revealed, false);
  assert.deepEqual(detail.body.distribution, []);
  assert.deepEqual(detail.body.participants, []);
  assert.equal(typeof detail.body.participant_count, "number");

  const predictions = await agent.get(`/api/predictions/match/${open.id}`);
  assert.equal(predictions.status, 200);
  assert.equal(predictions.body.revealed, false);
  assert.deepEqual(predictions.body.participants, []);
  assert.equal(Array.isArray(predictions.body.predictions), false);
});

test("el administrador ve quien falta sin ver pronosticos en partidos abiertos", async () => {
  const admin = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const matches = await admin.get("/api/matches");
  const open = matches.body.find((match) => match.betting_open);
  assert.ok(open);

  const detail = await admin.get(`/api/matches/${open.id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.revealed, false);
  assert.deepEqual(detail.body.distribution, []);
  assert.ok(detail.body.participants.length > 0);
  assert.equal(detail.body.participants.every((participant) => typeof participant.participating === "boolean"), true);
  assert.equal(detail.body.participants.some((participant) => participant.username === "administrador"), false);
  assert.equal(detail.body.participants.some((participant) => Object.hasOwn(participant, "predicted_winner")), false);
  assert.equal(detail.body.participants.some((participant) => Object.hasOwn(participant, "predicted_team1_goals")), false);
  assert.equal(detail.body.participants.some((participant) => Object.hasOwn(participant, "total_points")), false);
});

test("el detalle muestra los participantes solo cuando el partido está cerrado", async () => {
  const agent = request.agent(app);
  const admin = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const matches = await agent.get("/api/matches");
  const open = matches.body.find((match) => match.betting_open);
  assert.ok(open);

  const hidden = await agent.get(`/api/matches/${open.id}/detail`);
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.revealed, false);
  assert.deepEqual(hidden.body.participants, []);

  const close = await admin.patch(`/api/matches/${open.id}/status`).send({ status: "closed" });
  assert.equal(close.status, 200);

  const detail = await agent.get(`/api/matches/${open.id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.revealed, true);
  assert.ok(detail.body.participants.length > 0);
  assert.equal(detail.body.participants.every((participant) => typeof participant.participating === "boolean"), true);
  assert.equal(detail.body.participants.some((participant) => participant.username === "administrador"), false);
});

test("detecta la IP real enviada por Cloudflare o X-Forwarded-For", async () => {
  const response = await request(app)
    .get("/api/auth/me")
    .set("X-Forwarded-For", "203.0.113.45, 10.0.0.2");
  assert.equal(response.body.client_ip, "203.0.113.45");
});

test("las notificaciones son privadas y requieren sesión", async () => {
  const anonymous = await request(app).get("/api/notifications");
  assert.equal(anonymous.status, 401);
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const response = await agent.get("/api/notifications");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.notifications));
});

test("devuelve todas las notificaciones pendientes y solo las 5 leídas más recientes", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const user = db.prepare("SELECT id FROM users WHERE username=?").get("lucia");
  const prefix = `notification-limit-${Date.now()}`;
  const insert = db.prepare(`
    INSERT INTO notifications (user_id,type,title,message,event_key,read,created_at)
    VALUES (?,?,?,?,?,?,?)
  `);

  for (let index = 0; index < 8; index += 1) {
    insert.run(user.id, "match_closed", `Leída ${index}`, "Prueba", `${prefix}:read:${index}`, 1, `2099-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
  }
  for (let index = 0; index < 7; index += 1) {
    insert.run(user.id, "match_closed", `Pendiente ${index}`, "Prueba", `${prefix}:unread:${index}`, 0, `2099-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
  }

  const response = await agent.get("/api/notifications");
  const testNotifications = response.body.notifications.filter((item) => item.event_key?.startsWith(prefix));
  const readNotifications = testNotifications.filter((item) => item.read === 1);
  const unreadNotifications = testNotifications.filter((item) => item.read === 0);

  assert.equal(response.status, 200);
  assert.equal(unreadNotifications.length, 7);
  assert.equal(readNotifications.length, 5);
  assert.deepEqual(readNotifications.map((item) => item.title), ["Leída 7", "Leída 6", "Leída 5", "Leída 4", "Leída 3"]);
});

test("mensajes y encuestas de administración bloquean hasta responder y guardan estadísticas", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });

  const created = await admin.post("/api/admin/admin-messages").send({
    type: "poll",
    title: "Encuesta de prueba",
    body: "Elige una opción",
    options: ["Sí", "No"]
  });
  assert.equal(created.status, 201);

  const pending = await user.get("/api/admin-messages/pending");
  assert.equal(pending.body.message.id, created.body.id);
  assert.equal(pending.body.message.options.length, 2);

  const answered = await user.post(`/api/admin-messages/${created.body.id}/respond`).send({
    option_id: pending.body.message.options[0].id
  });
  assert.equal(answered.status, 200);
  assert.notEqual((await user.get("/api/admin-messages/pending")).body.message?.id, created.body.id);

  const stats = await admin.get("/api/admin/admin-messages");
  const poll = stats.body.find((item) => item.id === created.body.id);
  assert.equal(poll.responded_users.some((item) => item.username === "lucia"), true);
  assert.equal(poll.options[0].users.some((item) => item.username === "lucia"), true);

  assert.equal((await admin.delete(`/api/admin/admin-messages/${created.body.id}`)).status, 200);
});

test("un comentario nuevo notifica a los demás y enlaza a los comentarios", async () => {
  const author = request.agent(app);
  const recipient = request.agent(app);
  await author.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await recipient.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const matches = await author.get("/api/matches");
  const match = matches.body[0];
  assert.ok(match);

  const created = await author.post(`/api/matches/${match.id}/comments`).send({ comment: "Comentario para probar notificaciones" });
  assert.equal(created.status, 201);

  const recipientNotifications = await recipient.get("/api/notifications");
  const notification = recipientNotifications.body.notifications.find((item) => item.event_key === `match-comment:${created.body.id}`);
  assert.equal(notification.type, "match_comment");
  assert.equal(notification.link, `/match/${match.id}#comentarios`);

  const authorNotifications = await author.get("/api/notifications");
  assert.equal(authorNotifications.body.notifications.some((item) => item.event_key === `match-comment:${created.body.id}`), false);
});

test("una mención en un comentario crea un único aviso específico del partido", async () => {
  const author = request.agent(app), mentioned = request.agent(app);
  await author.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await mentioned.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const match = db.prepare("SELECT id,team1,team2 FROM matches ORDER BY id LIMIT 1").get();
  const created = await author.post(`/api/matches/${match.id}/comments`).send({ comment: "Hola @lucia, mira este partido" }).expect(201);
  const notifications = (await mentioned.get("/api/notifications")).body.notifications.filter((item) => item.entity_type === "match_comment" && item.entity_id === created.body.id);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, "match_mention");
  assert.equal(notifications[0].title, `Te han mencionado en ${match.team1} - ${match.team2}`);
  assert.equal(notifications[0].link, `/match/${match.id}#comentarios`);
});

test("un comentario admite un GIF válido de GIPHY y rechaza medios externos", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" }).expect(200);
  const match = db.prepare("SELECT id FROM matches ORDER BY id LIMIT 1").get();
  const media = {
    type: "gif",
    id: "test-gif",
    url: "https://media.giphy.com/media/test/giphy.webp",
    preview_url: "https://media.giphy.com/media/test/preview.webp",
    width: 320,
    height: 240
  };
  await agent.post(`/api/matches/${match.id}/comments`).send({ comment: "", media }).expect(201);
  const comments = await agent.get(`/api/matches/${match.id}/comments`).expect(200);
  assert.equal(comments.body[0].media_provider, "giphy");
  assert.equal(comments.body[0].media_type, "gif");
  assert.equal(comments.body[0].media_url, media.url);
  await agent.post(`/api/matches/${match.id}/comments`).send({ comment: "", media: { ...media, url: "https://example.com/falso.gif" } }).expect(400);
});

test("una foto de comentario se comprime, normaliza y elimina con el comentario", async () => {
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" }).expect(200);
  const match = db.prepare("SELECT id FROM matches ORDER BY id LIMIT 1").get();
  const jpeg = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: "#c33" } }).jpeg({ quality: 95 }).toBuffer();
  const upload = await agent.put("/api/comments/image").set("Content-Type", "image/jpeg").send(jpeg).expect(200);
  assert.match(upload.body.id, new RegExp(`^comment-${login.body.user.id}-\\d+-[a-f0-9]+$`));
  assert.match(upload.body.url, /\.webp$/);
  assert.ok(upload.body.width <= 1600 && upload.body.height <= 1600);
  await request(app).get(upload.body.url).expect(200).expect("Content-Type", /image\/webp/);

  const created = await agent.post(`/api/matches/${match.id}/comments`).send({ comment: "Foto", media: upload.body }).expect(201);
  assert.equal(db.prepare("SELECT media_type FROM match_comments WHERE id=?").get(created.body.id).media_type, "image");
  await agent.delete(`/api/comments/${created.body.id}`).expect(200);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual((await request(app).get(upload.body.url)).status, 200);
});

test("una foto descartada antes de comentar se elimina", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" }).expect(200);
  const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#369" } }).jpeg().toBuffer();
  const upload = await agent.put("/api/comments/image").set("Content-Type", "image/jpeg").send(jpeg).expect(200);
  await agent.delete(`/api/comments/image/${upload.body.id}`).expect(200);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual((await request(app).get(upload.body.url)).status, 200);
});

test("consultar dashboard y perfiles no escribe instantáneas de clasificación", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const lucia = db.prepare("SELECT id FROM users WHERE username=?").get("lucia");
  const date = new Date().toISOString().slice(0, 10);
  db.prepare("DELETE FROM ranking_snapshots WHERE snapshot_date=?").run(date);

  assert.equal((await agent.get("/api/dashboard")).status, 200);
  assert.equal((await agent.get("/api/profile/me")).status, 200);
  assert.equal((await agent.get(`/api/users/${lucia.id}/public`)).status, 200);

  const written = db.prepare("SELECT COUNT(*) count FROM ranking_snapshots WHERE snapshot_date=?").get(date).count;
  assert.equal(written, 0);
});

test("las medallas de puntos usan umbrales exigentes pero alcanzables para 106 partidos", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" }).expect(200);
  const lucia = db.prepare("SELECT id FROM users WHERE username=?").get("lucia");

  const medals = await agent.get(`/api/users/${lucia.id}/public/medals`).expect(200);
  const pointsCatalog = medals.body.badge_catalog.find((group) => group.group === "points");
  assert.deepEqual(pointsCatalog.tiers.map((tier) => tier.threshold), [100, 200, 300, 375]);
  assert.equal(pointsCatalog.tiers.some((tier) => [500, 800].includes(tier.threshold)), false);
});

test("la medalla rey del empate cuenta solo empates acertados", async () => {
  const admin = request.agent(app);
  const drawKing = request.agent(app);
  const drawGambler = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const suffix = Date.now();
  const kingUsername = `rey-empate-${suffix}`;
  const gamblerUsername = `apuesta-empate-${suffix}`;
  await admin.post("/api/users").send({ username: kingUsername, password: "prueba-segura", role: "user" }).expect(201);
  await admin.post("/api/users").send({ username: gamblerUsername, password: "prueba-segura", role: "user" }).expect(201);
  await drawKing.post("/api/auth/login").send({ username: kingUsername, password: "prueba-segura" }).expect(200);
  await drawGambler.post("/api/auth/login").send({ username: gamblerUsername, password: "prueba-segura" }).expect(200);

  const currentMax = Number(db.prepare(`
    SELECT COALESCE(MAX(draws),0) draws FROM (
      SELECT COUNT(*) draws
      FROM predictions p
      JOIN matches m ON m.id=p.match_id
      JOIN users u ON u.id=p.user_id
      WHERE m.status='finished' AND p.predicted_winner='draw' AND p.winner_points>0 AND u.active=1 AND u.role='user'
      GROUP BY p.user_id
    )
  `).get().draws || 0);
  const targetDraws = currentMax + 1;

  for (let index = 0; index < targetDraws; index += 1) {
    const created = await admin.post("/api/matches").send({
      match_date: "2099-07-11",
      match_time: "20:00",
      team1: `Empate acertado A ${suffix}-${index}`,
      team2: `Empate acertado B ${suffix}-${index}`,
      force_published: true,
      scorer_enabled: false
    }).expect(201);
    await drawKing.post("/api/predictions").send({
      match_id: created.body.id,
      predicted_winner: "draw",
      predicted_team1_goals: 1,
      predicted_team2_goals: 1,
      predicted_scorer_id: null
    }).expect(201);
    await admin.post(`/api/matches/${created.body.id}/finish`).send({
      result_team1: 1,
      result_team2: 1,
      scorer_ids: []
    }).expect(200);
  }
  for (let index = 0; index < targetDraws + 1; index += 1) {
    const created = await admin.post("/api/matches").send({
      match_date: "2099-07-12",
      match_time: "20:00",
      team1: `Empate fallado A ${suffix}-${index}`,
      team2: `Empate fallado B ${suffix}-${index}`,
      force_published: true,
      scorer_enabled: false
    }).expect(201);
    await drawGambler.post("/api/predictions").send({
      match_id: created.body.id,
      predicted_winner: "draw",
      predicted_team1_goals: 1,
      predicted_team2_goals: 1,
      predicted_scorer_id: null
    }).expect(201);
    await admin.post(`/api/matches/${created.body.id}/finish`).send({
      result_team1: 2,
      result_team2: 1,
      scorer_ids: []
    }).expect(200);
  }

  const king = db.prepare("SELECT id FROM users WHERE username=?").get(kingUsername);
  const gambler = db.prepare("SELECT id FROM users WHERE username=?").get(gamblerUsername);
  const kingMedals = await drawKing.get(`/api/users/${king.id}/public/medals`).expect(200);
  const gamblerMedals = await drawGambler.get(`/api/users/${gambler.id}/public/medals`).expect(200);
  assert.equal(kingMedals.body.badges.some((badge) => badge.name === `Rey del empate · ${targetDraws}`), true);
  assert.equal(gamblerMedals.body.badges.some((badge) => badge.name.startsWith("Rey del empate")), false);
});

test("un ajuste guarda el histórico y el detalle público cuadra exactamente", async () => {
  const admin = request.agent(app);
  const user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  await user.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const lucia = db.prepare("SELECT id FROM users WHERE username=?").get("lucia");
  const reason = `Comprobación de histórico ${Date.now()}`;

  const adjustment = await admin.post("/api/admin/points-adjustments").send({
    user_id: lucia.id,
    points: 1,
    reason
  });
  assert.equal(adjustment.status, 201);

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = db.prepare("SELECT position,points FROM ranking_snapshots WHERE user_id=? AND snapshot_date=?").get(lucia.id, date);
  const leaderboard = await user.get("/api/leaderboard");
  const rankingRow = leaderboard.body.find((row) => row.id === lucia.id);
  assert.deepEqual(snapshot, { position: leaderboard.body.findIndex((row) => row.id === lucia.id) + 1, points: rankingRow.total_points });

  const profile = await user.get(`/api/users/${lucia.id}/public`);
  assert.equal(profile.status, 200);
  const detail = profile.body.points_detail;
  assert.equal(detail.automatic_points, detail.matches.reduce((sum, match) => sum + match.total_points, 0));
  assert.equal(detail.adjustment_points, detail.adjustments.reduce((sum, item) => sum + item.points, 0));
  assert.equal(detail.total_points, detail.automatic_points + detail.adjustment_points);
  assert.equal(profile.body.stats.total_points, detail.total_points);
  assert.equal(detail.adjustments.some((item) => item.reason === reason && item.points === 1), true);
});

test("un administrador corrige una apuesta cerrada con auditoría sin reabrir el partido", async () => {
  const admin = request.agent(app), user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const username = `correccion-${Date.now()}`;
  await admin.post("/api/users").send({ username, password: "prueba-segura", role: "user" });
  await user.post("/api/auth/login").send({ username, password: "prueba-segura" });
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-10", match_time: "18:00", team1: "Corrección A", team2: "Corrección B",
    force_published: true, scorer_enabled: false
  });
  const prediction = await user.post("/api/predictions").send({
    match_id: created.body.id, predicted_winner: "team1", predicted_team1_goals: 1,
    predicted_team2_goals: 0, predicted_scorer_id: null
  });
  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });

  const correction = await admin.patch(`/api/admin/matches/${created.body.id}/predictions/${prediction.body.id}`).send({
    predicted_team1_goals: 0, predicted_team2_goals: 2, predicted_scorer_id: null,
    reason: "Error de transcripción comprobado"
  });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.predicted_winner, "team2");
  assert.equal(db.prepare("SELECT status FROM matches WHERE id=?").get(created.body.id).status, "closed");
  const log = db.prepare("SELECT * FROM admin_actions_log WHERE action_type='edit_prediction' AND entity_id=? ORDER BY id DESC").get(prediction.body.id);
  assert.ok(log);
  assert.equal(JSON.parse(log.before_data).predicted_team1_goals, 1);
  assert.equal(JSON.parse(log.after_data).predicted_team2_goals, 2);
  assert.match(log.description, /Error de transcripción/);
});

test("la corrección de una apuesta finalizada recalcula sus puntos y está protegida", async () => {
  const admin = request.agent(app), user = request.agent(app);
  await admin.post("/api/auth/login").send({ username: "administrador", password: "yami" });
  const username = `recalculo-${Date.now()}`;
  await admin.post("/api/users").send({ username, password: "prueba-segura", role: "user" });
  await user.post("/api/auth/login").send({ username, password: "prueba-segura" });
  const created = await admin.post("/api/matches").send({
    match_date: "2099-07-11", match_time: "18:00", team1: "Final A", team2: "Final B",
    force_published: true, scorer_enabled: false
  });
  const prediction = await user.post("/api/predictions").send({ match_id: created.body.id, predicted_winner: "draw", predicted_team1_goals: 0, predicted_team2_goals: 0, predicted_scorer_id: null });
  await admin.patch(`/api/matches/${created.body.id}/status`).send({ status: "closed" });
  await admin.post(`/api/matches/${created.body.id}/finish`).send({ result_team1: 2, result_team2: 1, scorer_ids: [] });
  const forbidden = await user.patch(`/api/admin/matches/${created.body.id}/predictions/${prediction.body.id}`).send({ predicted_team1_goals: 2, predicted_team2_goals: 1, predicted_scorer_id: null, reason: "No autorizado" });
  assert.equal(forbidden.status, 403);
  const corrected = await admin.patch(`/api/admin/matches/${created.body.id}/predictions/${prediction.body.id}`).send({ predicted_team1_goals: 2, predicted_team2_goals: 1, predicted_scorer_id: null, reason: "Corrección tras revisión" });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.recalculated, true);
  const stored = db.prepare("SELECT winner_points,exact_result_points,total_points FROM predictions WHERE id=?").get(prediction.body.id);
  assert.ok(stored.winner_points > 0);
  assert.ok(stored.exact_result_points > 0);
  assert.equal(stored.total_points, stored.winner_points + stored.exact_result_points);
});
