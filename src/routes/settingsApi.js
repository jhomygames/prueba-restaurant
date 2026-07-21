/**
 * Pestaña "Configuración" del panel: cada restaurante gestiona SUS propias
 * integraciones (agente de voz de Vapi y WhatsApp de Twilio) sin tocar
 * variables de entorno ni depender del desarrollador.
 *
 * Seguridad:
 * - Todo bajo requireAuth: el restaurante sale del JWT.
 * - Los secretos (auth token de Twilio, API key de Vapi) se guardan CIFRADOS
 *   (secretBox) y NUNCA se devuelven al frontend: solo un resumen enmascarado.
 * - Los endpoints que crean recursos externos o envían mensajes tienen un
 *   rate-limit sencillo por restaurante.
 */

const express = require("express");
const twilio = require("twilio");
const registry = require("../services/registry");
const vapiAdmin = require("../services/vapiAdmin");
const { encrypt, decrypt, mask } = require("../services/secretBox");
const { requireAuth } = require("./auth");

const router = express.Router();

router.use("/api/settings", requireAuth);

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[settingsApi] ${req.method} ${req.path}:`, err.message);
      res.status(500).json({ error: "internal_error", detail: err.message });
    }
  };
}

// Rate-limit para acciones caras (crear assistant, enviar WhatsApp de prueba)
const actionHits = new Map(); // restaurantId -> { count, resetAt }
function tooManyActions(restaurantId, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const e = actionHits.get(restaurantId);
  if (!e || now > e.resetAt) {
    actionHits.set(restaurantId, { count: 1, resetAt: now + windowMs });
    return false;
  }
  e.count += 1;
  return e.count > max;
}

function publicBaseUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
}

/** Vista pública de la configuración: sin un solo secreto en claro. */
function toPublicSettings(r, req) {
  const vapiKey = r.vapi.apiKeyEnc ? decrypt(r.vapi.apiKeyEnc) : "";
  return {
    slug: r.slug,
    nombre: r.nombre,
    googleReviewUrl: r.googleReviewUrl,
    staffWhatsApp: r.staffWhatsApp,
    voz: {
      configured: Boolean(r.vapi.assistantId),
      assistantId: r.vapi.assistantId,
      telefono: r.vapi.telefono,
      apiKeyPropia: Boolean(r.vapi.apiKeyEnc),
      apiKeyMasked: vapiKey ? mask(vapiKey) : "",
    },
    whatsapp: {
      configured: Boolean(r.twilio.accountSid && r.twilio.authTokenEnc && r.twilio.whatsappFrom),
      accountSid: r.twilio.accountSid,
      from: r.twilio.whatsappFrom,
      authTokenMasked: r.twilio.authTokenEnc ? "••••••••" : "",
      webhookUrl: `${publicBaseUrl(req)}/whatsapp/webhook`,
    },
  };
}

// ---------- Datos generales ----------

router.get(
  "/api/settings",
  handle(async (req, res) => {
    res.json(toPublicSettings(req.restaurant, req));
  })
);

router.put(
  "/api/settings",
  handle(async (req, res) => {
    const fields = {};
    if (req.body.nombre !== undefined) fields.Nombre = String(req.body.nombre).trim();
    if (req.body.googleReviewUrl !== undefined) fields.GoogleReviewUrl = req.body.googleReviewUrl;
    if (req.body.staffWhatsApp !== undefined) fields.StaffWhatsApp = req.body.staffWhatsApp;

    if (fields.Nombre === "") return res.status(400).json({ error: "nombre_vacio" });

    const updated = await registry.updateRestaurant(req.restaurant.id, fields);
    res.json(toPublicSettings(updated, req));
  })
);

// ---------- Voz (Vapi) ----------

router.put(
  "/api/settings/vapi",
  handle(async (req, res) => {
    const { apiKey } = req.body || {};
    // null/"" borra la key propia y vuelve a usar la central del entorno.
    const value = apiKey ? encrypt(String(apiKey).trim()) : "";
    const updated = await registry.updateRestaurant(req.restaurant.id, { VapiApiKeyEnc: value });
    res.json(toPublicSettings(updated, req));
  })
);

router.post(
  "/api/settings/vapi/provision",
  handle(async (req, res) => {
    if (tooManyActions(req.restaurant.id)) {
      return res.status(429).json({ error: "demasiadas_acciones" });
    }
    const creds = registry.vapiApiKey(req.restaurant);
    if (!creds) {
      return res.status(400).json({ error: "sin_api_key_vapi" });
    }
    if (req.restaurant.vapi.assistantId) {
      return res.status(409).json({ error: "ya_tiene_assistant", assistantId: req.restaurant.vapi.assistantId });
    }

    const base = publicBaseUrl(req);
    const assistant = await vapiAdmin.createAssistant(creds.key, req.restaurant.nombre, base);
    const phone = await vapiAdmin.provisionPhoneNumber(creds.key, assistant.id);

    const updated = await registry.updateRestaurant(req.restaurant.id, {
      VapiAssistantId: assistant.id,
      VapiPhoneNumberId: phone?.id || "",
      VapiTelefono: phone?.number || "",
    });

    res.json({
      ...toPublicSettings(updated, req),
      aviso: phone
        ? null
        : "Agente creado. No se pudo asignar un número automáticamente (límite de la cuenta de Vapi): asígnalo en dashboard.vapi.ai y vuelve a probar la conexión.",
    });
  })
);

router.post(
  "/api/settings/vapi/sync-prompt",
  handle(async (req, res) => {
    const creds = registry.vapiApiKey(req.restaurant);
    if (!creds) return res.status(400).json({ error: "sin_api_key_vapi" });
    if (!req.restaurant.vapi.assistantId) return res.status(400).json({ error: "sin_assistant" });

    await vapiAdmin.updateAssistant(
      creds.key,
      req.restaurant.vapi.assistantId,
      req.restaurant.nombre,
      publicBaseUrl(req)
    );
    res.json({ ok: true });
  })
);

router.post(
  "/api/settings/vapi/test",
  handle(async (req, res) => {
    const creds = registry.vapiApiKey(req.restaurant);
    if (!creds) return res.status(400).json({ error: "sin_api_key_vapi" });
    if (!req.restaurant.vapi.assistantId) return res.status(400).json({ error: "sin_assistant" });

    try {
      const a = await vapiAdmin.getAssistant(creds.key, req.restaurant.vapi.assistantId);
      res.json({
        ok: true,
        nombre: a.name,
        modelo: a.model?.model,
        voz: a.voice?.voiceId,
        fuenteCredenciales: creds.source,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  })
);

// ---------- WhatsApp (Twilio) ----------

router.put(
  "/api/settings/whatsapp",
  handle(async (req, res) => {
    const { accountSid, authToken, from } = req.body || {};

    // Limpiar la configuración propia y volver a la central
    if (!accountSid && !authToken && !from) {
      const updated = await registry.updateRestaurant(req.restaurant.id, {
        TwilioAccountSid: "",
        TwilioAuthTokenEnc: "",
        TwilioWhatsAppFrom: "",
      });
      return res.json(toPublicSettings(updated, req));
    }

    if (!accountSid || !from) {
      return res.status(400).json({ error: "faltan_datos", detalle: "Se necesitan Account SID y número emisor." });
    }

    // Si no mandan token nuevo, conservar el existente (permite editar solo el número)
    const effectiveToken = authToken
      ? String(authToken).trim()
      : decrypt(req.restaurant.twilio.authTokenEnc);
    if (!effectiveToken) {
      return res.status(400).json({ error: "falta_auth_token" });
    }

    // Validar contra Twilio ANTES de guardar
    try {
      const client = twilio(String(accountSid).trim(), effectiveToken);
      await client.api.accounts(String(accountSid).trim()).fetch();
    } catch (err) {
      return res.status(400).json({ error: "credenciales_invalidas", detalle: err.message });
    }

    const normalizedFrom = String(from).trim().startsWith("whatsapp:")
      ? String(from).trim()
      : `whatsapp:${String(from).trim()}`;

    const updated = await registry.updateRestaurant(req.restaurant.id, {
      TwilioAccountSid: String(accountSid).trim(),
      TwilioAuthTokenEnc: encrypt(effectiveToken),
      TwilioWhatsAppFrom: normalizedFrom,
    });
    res.json(toPublicSettings(updated, req));
  })
);

router.post(
  "/api/settings/whatsapp/test",
  handle(async (req, res) => {
    if (tooManyActions(req.restaurant.id)) {
      return res.status(429).json({ error: "demasiadas_acciones" });
    }
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ error: "falta_destino" });

    const creds = registry.twilioCredentials(req.restaurant);
    if (!creds) return res.status(400).json({ error: "whatsapp_no_configurado" });

    try {
      const client = twilio(creds.accountSid, creds.authToken);
      const msg = await client.messages.create({
        from: creds.from,
        to: String(to).startsWith("whatsapp:") ? String(to) : `whatsapp:${String(to).trim()}`,
        body: `Mensaje de prueba de ${req.restaurant.nombre}. Si lo recibes, la integración de WhatsApp funciona.`,
      });
      res.json({ ok: true, sid: msg.sid, estado: msg.status, fuenteCredenciales: creds.source });
    } catch (err) {
      // Los errores de Twilio son informativos (número no unido al sandbox, etc.)
      res.status(400).json({ ok: false, error: err.message });
    }
  })
);

module.exports = router;
