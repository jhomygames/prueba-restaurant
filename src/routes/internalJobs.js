/**
 * Endpoints internos disparados por Make.com actuando solo como "reloj".
 * Toda la lógica de negocio vive aquí, no en Make (decisión documentada en
 * CLAUDE.md: evitar depender de módulos frágiles de Make).
 *
 * Protegidos con header `x-internal-secret` == INTERNAL_JOBS_SECRET.
 *
 * Plan Make Free (máx. 2 escenarios simultáneos) => los recordatorios de 24h
 * y 1h se fusionan en una sola ejecución (`/internal/reminders/run`).
 */

const express = require("express");
const twilio = require("twilio");
const reservations = require("../services/reservations");

const router = express.Router();

function requireInternalSecret(req, res, next) {
  const expected = process.env.INTERNAL_JOBS_SECRET;
  const provided = req.headers["x-internal-secret"];
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "invalid_internal_secret" });
  }
  next();
}

function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendWhatsApp(toPhone, body) {
  const client = getTwilioClient();
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;
  if (!client || !fromNumber) {
    console.warn("[internalJobs] Twilio no configurado, solo logueando envío:", toPhone, body);
    return { sent: false, reason: "twilio_not_configured" };
  }
  await client.messages.create({
    from: fromNumber,
    to: `whatsapp:${toPhone}`,
    body,
  });
  return { sent: true };
}

// Revisa ambas ventanas (24h y 1h) en una sola ejecución, ya que Make Free
// solo permite 2 escenarios simultáneos.
router.post("/internal/reminders/run", requireInternalSecret, async (req, res) => {
  try {
    const [upcoming24h, upcoming1h] = await Promise.all([
      reservations.getUpcomingReservations({ hoursAhead: 24 }),
      reservations.getUpcomingReservations({ hoursAhead: 1 }),
    ]);

    const results = [];

    for (const r of upcoming24h) {
      const body =
        `¡Hola ${r.customer_name}! Te recordamos tu reserva mañana ` +
        `${r.date} a las ${r.time} para ${r.party_size} persona(s). ` +
        `Si necesitas cancelar o modificarla, responde a este mensaje.`;
      results.push({
        reservation_id: r.id,
        window: "24h",
        ...(await sendWhatsApp(r.customer_phone, body)),
      });
    }

    for (const r of upcoming1h) {
      const body =
        `¡Hola ${r.customer_name}! Tu reserva es en 1 hora, hoy a las ${r.time} ` +
        `para ${r.party_size} persona(s). ¡Te esperamos!`;
      results.push({
        reservation_id: r.id,
        window: "1h",
        ...(await sendWhatsApp(r.customer_phone, body)),
      });
    }

    res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[internalJobs] error en reminders/run:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/internal/reviews/run", requireInternalSecret, async (req, res) => {
  try {
    // TODO (punto 11 CLAUDE.md): getRecentlyCompletedVisits es un stub que
    // reutiliza getUpcomingReservations. Sustituir cuando Covermanager/TheFork
    // exponga un endpoint real de visitas completadas.
    const recentVisits = await reservations.getRecentlyCompletedVisits({ hoursAgo: 2 });

    const reviewUrl = process.env.GOOGLE_REVIEW_URL || "https://TU_ENLACE_GOOGLE_REVIEW";
    const results = [];
    for (const r of recentVisits) {
      const body =
        `Gracias por visitarnos, ${r.customer_name} 🙏 Si te gustó tu experiencia, ` +
        `¿nos dejarías una reseña en Google? ${reviewUrl}`;
      results.push({
        reservation_id: r.id,
        ...(await sendWhatsApp(r.customer_phone, body)),
      });
    }

    res.json({ ok: true, processed: results.length, results });
  } catch (err) {
    console.error("[internalJobs] error en reviews/run:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = router;
