import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { app } from "../src/app.js";

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

test("un usuario normal no accede a administración", async () => {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const response = await agent.get("/api/users");
  assert.equal(response.status, 403);
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
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "lucia", password: "lucia" });
  const matches = await agent.get("/api/matches");
  const open = matches.body.find((match) => match.betting_open);
  assert.ok(open);
  const response = await agent.post("/api/predictions").send({
    match_id: open.id,
    predicted_winner: "draw",
    predicted_team1_goals: 2,
    predicted_team2_goals: 1
  });
  assert.equal(response.status, 400);
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
