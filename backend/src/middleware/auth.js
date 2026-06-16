import { db } from "../db/database.js";

export const READ_ONLY_USER = {
  id: -1,
  username: "espectador",
  role: "user",
  active: 1,
  is_read_only: true,
  personal_phrase: "Modo solo lectura",
  avatar_filename: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
};

export function hydrateUser(req, _res, next) {
  if (req.session?.readOnlyUser) {
    req.user = READ_ONLY_USER;
    return next();
  }
  if (req.session?.userId) {
    const user = db.prepare("SELECT id,username,role,active,avatar_filename,created_at,updated_at FROM users WHERE id=?").get(req.session.userId);
    req.user = user?.active ? user : null;
    if (!req.user) req.session.userId = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Debes iniciar sesión." });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Debes iniciar sesión." });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acceso reservado a administradores." });
  next();
}

export function requireWritableUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Debes iniciar sesión." });
  if (req.user.is_read_only) return res.status(403).json({ error: "Este usuario es de solo lectura." });
  next();
}
