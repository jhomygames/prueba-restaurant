/**
 * Autenticación del panel de staff (login por restaurante).
 *
 * El JWT es la ÚNICA fuente de verdad del tenant en /api/*: lleva el id del
 * restaurante y su baseId, y `requireAuth` los cuelga en `req.restaurant`.
 * Nunca se acepta un baseId/restaurantId que venga del body o del query.
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const registry = require("../services/registry");

const router = express.Router();

const TOKEN_TTL = "7d";
const MIN_PASSWORD_LENGTH = 8;

function jwtSecret() {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error("AUTH_JWT_SECRET no configurado: el login no puede funcionar.");
  return s;
}

// --- Rate limit básico en memoria (por IP) para no dejar el login a fuerza bruta.
// Suficiente para el sandbox; en producción usar un store compartido.
const attempts = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(ip) {
  attempts.delete(ip);
}

/** Middleware: exige un JWT válido y resuelve el restaurante del usuario. */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "no_token" });

    const payload = jwt.verify(token, jwtSecret());
    const restaurant = await registry.findById(payload.restaurantId);
    if (!restaurant || !restaurant.activo) {
      return res.status(401).json({ error: "restaurante_inactivo" });
    }

    req.auth = { userId: payload.userId, email: payload.email, rol: payload.rol };
    req.restaurant = restaurant;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ error: "token_expirado" });
    if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "token_invalido" });
    console.error("[auth] error verificando token:", err.message);
    res.status(500).json({ error: "internal_error" });
  }
}

router.post("/api/auth/login", async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || "desconocida";
  try {
    if (rateLimited(ip)) {
      return res.status(429).json({ error: "demasiados_intentos" });
    }

    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "faltan_credenciales" });
    }

    const user = await registry.findUserByEmail(email);
    // Mismo mensaje para usuario inexistente y contraseña incorrecta: no
    // revelamos qué emails existen.
    const ok = user && user.activo && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) {
      return res.status(401).json({ error: "credenciales_invalidas" });
    }

    const restaurant = await registry.findById(user.restauranteId);
    if (!restaurant || !restaurant.activo) {
      return res.status(403).json({ error: "restaurante_inactivo" });
    }

    clearAttempts(ip);

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        rol: user.rol,
        restaurantId: restaurant.id,
      },
      jwtSecret(),
      { expiresIn: TOKEN_TTL }
    );

    res.json({
      token,
      user: { email: user.email, nombre: user.nombre, rol: user.rol },
      restaurant: { slug: restaurant.slug, nombre: restaurant.nombre },
    });
  } catch (err) {
    console.error("[auth] error en login:", err.message);
    res.status(500).json({ error: "internal_error" });
  }
});

/** Devuelve la sesión actual (para revalidar el token al abrir el panel). */
router.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({
    user: req.auth,
    restaurant: { slug: req.restaurant.slug, nombre: req.restaurant.nombre },
  });
});

router.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "faltan_datos" });
    }
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: "password_corta", minimo: MIN_PASSWORD_LENGTH });
    }

    const user = await registry.findUserById(req.auth.userId);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: "password_actual_incorrecta" });
    }

    const hash = await bcrypt.hash(String(newPassword), 10);
    await registry.updateUser(user.id, { PasswordHash: hash });

    res.json({ ok: true });
  } catch (err) {
    console.error("[auth] error cambiando contraseña:", err.message);
    res.status(500).json({ error: "internal_error" });
  }
});

module.exports = { router, requireAuth };
