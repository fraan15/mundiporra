import { db } from "../db/database.js";

export function hydrateUser(req, _res, next) {
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
