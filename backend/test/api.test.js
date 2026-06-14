import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { app } from "../src/app.js";
import { db } from "../src/db/database.js";

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
  assert.match(event.text, /Partido Estrella x2/);
  assert.match(event.text, /8 ×2 = 16/);

  const notifications = await user.get("/api/notifications");
  const notification = notifications.body.notifications.find((item) => item.type === "points_earned" && item.entity_id === created.body.id);
  assert.match(notification.message, /8 puntos base ×2/);
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
});

test("el detalle muestra también los usuarios que aún no participan", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const matches = await agent.get("/api/matches");
  const open = matches.body.find((match) => match.betting_open);
  assert.ok(open);

  const detail = await agent.get(`/api/matches/${open.id}/detail`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.participants.length > 0);
  assert.equal(detail.body.participants.every((participant) => participant.participating === 0 || participant.participating === 1), true);
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
