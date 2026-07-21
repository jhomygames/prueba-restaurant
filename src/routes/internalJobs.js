/**
 * Endpoints internos disparados por Make.com actuando solo como "reloj".
 * Toda la lógica de negocio vive aquí, no en Make (decisión documentada en
 * CLAUDE.md: evitar depender de módulos frágiles de Make).
 *
 * Protegidos con header `x-internal-secret` == INTERNAL_JOBS_SECRET.
 *
 * MULTI-TENANT: una sola ejecución recorre TODOS los restaurantes activos del
 * Registro, cada uno contra su propia base y con sus propias credenciales de
 * Twilio. Así siguen bastando los 2 escenarios del plan Free de Make.
 *
 * Plan Make Free (máx. 2 escenarios simultáneos) => los recordatorios de 24h
 * y 1h se fusionan en una sola ejecución (`/internal/reminders/run`).
 */

const express = require("express");
const twilio = require("twilio");
const reservations = require("../services/reservations");
const customerMemory = require("../services/customerMemory");
const registry = require("../services/registry");

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_JOBS_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "invalid_internal_secret" });
  }
  next();
}

/** Envía por WhatsApp usando las credenciales del restaurante (o las centrales). */
async function sendWhatsApp(restaurant, toPhone, body) {
  const creds = registry.twilioCredentials(restaurant);
  if (!creds) {
    console.warn(
      `[internalJobs] Twilio no configurado para ${restaurant.nombre}, solo logueando:`,
      toPhone
    );
    return { sent: false, reason: "twilio_not_configured" };
  }
  const client = twilio(creds.accountSid, creds.authToken);
  await client.messages.create({
    from: creds.from,
    to: `whatsapp:${toPhone}`,
    body,
  });
  return { sent: true };
}

// Revisa ambas ventanas (24h y 1h) en una sola ejecución, ya que Make Free
// solo permite 2 escenarios simultáneos. Idempotente: cada reserva se marca
// (Recordatorio24h / Recordatorio1h) tras el envío, así las ejecuciones de
// Make cada 15 min no duplican mensajes. Las ventanas no se solapan: el
// recordatorio de 24h solo aplica a reservas a más de 20h vista.
router.post("/internal/reminders/run", requireInternalSecret, async (req, res) => {
  try {
    const restaurants = await registry.activeRestaurants();
    const results = [];

    for (const restaurant of restaurants) {
      const ctx = { baseId: restaurant.baseId };
      try {
        const [upcoming24h, upcoming1h] = await Promise.all([
          reservations.getUpcomingReservations(ctx, { hoursAhead: 25, hoursFloor: 20 }),
          reservations.getUpcomingReservations(ctx, { hoursAhead: 1.25 }),
        ]);

        for (const r of upcoming24h.filter((r) => !r.reminded_24h)) {
          const body =
            `¡Hola ${r.customer_name}! Te recordamos tu reserva de mañana en ${restaurant.nombre}, ` +
            `${r.date} a las ${r.time} para ${r.party_size} persona(s). ` +
            `Si necesitas cancelar o modificarla, responde a este mensaje.`;
          const sendResult = await sendWhatsApp(restaurant, r.customer_phone, body);
          if (sendResult.sent) {
            await reservations.markReservation(ctx, r.id, { Recordatorio24h: true });
          }
          results.push({ restaurante: restaurant.slug, reservation_id: r.id, window: "24h", ...sendResult });
        }

        for (const r of upcoming1h.filter((r) => !r.reminded_1h)) {
          const body =
            `¡Hola ${r.customer_name}! Tu reserva en ${restaurant.nombre} es en aproximadamente 1 hora, ` +
            `hoy a las ${r.time} para ${r.party_size} persona(s). ¡Te esperamos!`;
          const sendResult = await sendWhatsApp(restaurant, r.customer_phone, body);
          if (sendResult.sent) {
            await reservations.markReservation(ctx, r.id, { Recordatorio1h: true });
          }
          results.push({ restaurante: restaurant.slug, reservation_id: r.id, window: "1h", ...sendResult });
        }
      } catch (err) {
        // Un restaurante roto no debe impedir procesar el resto.
        console.error(`[internalJobs] error en recordatorios de ${restaurant.slug}:`, err.message);
        results.push({ restaurante: restaurant.slug, error: err.message });
      }
    }

    res.json({ ok: true, restaurantes: restaurants.length, processed: results.length, results });
  } catch (err) {
    console.error("[internalJobs] error en reminders/run:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// Pide reseña a las visitas cuya reserva pasó hace 2-4 horas. Idempotente:
// marca ResenaPedida y pasa la reserva a Estado "completada" tras enviar.
router.post("/internal/reviews/run", requireInternalSecret, async (req, res) => {
  try {
    const restaurants = await registry.activeRestaurants();
    const results = [];

    for (const restaurant of restaurants) {
      const ctx = { baseId: restaurant.baseId };
      try {
        const recentVisits = await reservations.getRecentlyCompletedVisits(ctx, { hoursAgo: 4 });
        const reviewUrl =
          restaurant.googleReviewUrl || process.env.GOOGLE_REVIEW_URL || "https://TU_ENLACE_GOOGLE_REVIEW";

        for (const r of recentVisits) {
          const body =
            `Gracias por visitarnos en ${restaurant.nombre}, ${r.customer_name} 🙏 ` +
            `Si te gustó tu experiencia, ¿nos dejarías una reseña en Google? ${reviewUrl}`;
          const sendResult = await sendWhatsApp(restaurant, r.customer_phone, body);
          if (sendResult.sent) {
            await reservations.markReservation(ctx, r.id, {
              ResenaPedida: true,
              Estado: "completada",
            });
            // La visita ya ocurrió: es el momento correcto de contarla en la
            // memoria del cliente (no al reservar ni al escribir por WhatsApp).
            await customerMemory
              .recordVisit(ctx, r.customer_phone)
              .catch((err) => console.error("[internalJobs] error registrando visita:", err));
          }
          results.push({ restaurante: restaurant.slug, reservation_id: r.id, ...sendResult });
        }
      } catch (err) {
        console.error(`[internalJobs] error en reseñas de ${restaurant.slug}:`, err.message);
        results.push({ restaurante: restaurant.slug, error: err.message });
      }
    }

    res.json({ ok: true, restaurantes: restaurants.length, processed: results.length, results });
  } catch (err) {
    console.error("[internalJobs] error en reviews/run:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = router;
