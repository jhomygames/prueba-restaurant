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
const crypto = require("crypto");
const twilio = require("twilio");
const registry = require("../services/registry");
const vapiAdmin = require("../services/vapiAdmin");
const connectors = require("../services/connectors");
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
    integracion: toPublicIntegration(r, req),
  };
}

/**
 * Bloque de la integración con plataformas externas.
 *
 * El "token de acceso" SÍ se devuelve en claro, a diferencia de las demás
 * credenciales: no es un secreto de un tercero que nosotros custodiamos, sino
 * uno que generamos nosotros y que el restaurante tiene que copiar para
 * dárselo a la plataforma (TheFork lo pide durante el alta). Solo lo ve el
 * dueño de ese restaurante, ya autenticado. Está cifrado en la base de datos.
 */
function toPublicIntegration(r, req) {
  const i = r.integracion || {};
  const proveedor = i.proveedor || "";
  const apiKey = i.apiKeyEnc ? decrypt(i.apiKeyEnc) : "";
  const webhookSecret = i.webhookSecretEnc ? decrypt(i.webhookSecretEnc) : "";

  const adapter = proveedor ? connectors.getAdapter(proveedor) : null;
  let webhookUrl = "";
  if (proveedor && webhookSecret) {
    const base = `${publicBaseUrl(req)}/integrations/${proveedor}/webhook/${r.slug}`;
    // Los que se autentican con Bearer no llevan el secreto en la URL.
    webhookUrl = adapter?.authMode === "bearer" ? base : `${base}?secret=${encodeURIComponent(webhookSecret)}`;
  }

  return {
    proveedores: connectors.listAdapters(),
    proveedor,
    activa: i.activa === true,
    restauranteExternoId: i.restauranteExternoId || "",
    apiKeyMasked: apiKey ? mask(apiKey) : "",
    authMode: adapter?.authMode || "",
    accessToken: webhookSecret,
    webhookUrl,
    ultimaSync: i.ultimaSync || "",
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

    // Se comprueba en dos pasos para poder decir QUÉ falla. Preguntar solo por
    // el assistant confunde dos cosas muy distintas: una clave que no sirve, y
    // una clave correcta de otra cuenta de Vapi donde ese assistant no existe.
    let assistants;
    try {
      assistants = await vapiAdmin.listAssistants(creds.key);
    } catch (err) {
      return res.status(400).json({
        ok: false,
        fallo: "api_key",
        error: err.message,
        pista:
          "Vapi entrega dos claves con el mismo aspecto. Aquí hace falta la PRIVADA (Vapi → API Keys).",
      });
    }

    try {
      const a = await vapiAdmin.getAssistant(creds.key, req.restaurant.vapi.assistantId);
      res.json({
        ok: true,
        nombre: a.name,
        modelo: a.model?.model,
        voz: a.voice?.voiceId,
        fuenteCredenciales: creds.source,
        assistantsEnLaCuenta: assistants.length,
      });
    } catch (err) {
      // El listado funcionó, así que la clave vale: el problema es el id del
      // assistant, o que pertenece a otra cuenta.
      res.status(400).json({
        ok: false,
        fallo: "assistant",
        error: err.message,
        pista: `La clave es correcta y ve ${assistants.length} assistant(s) en esa cuenta, pero ninguno con el id configurado.`,
        assistantsDisponibles: assistants.map((a) => ({ id: a.id, nombre: a.name })),
      });
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

// ---------- Plataformas de reservas externas (TheFork, etc.) ----------

router.put(
  "/api/settings/integration",
  handle(async (req, res) => {
    const { provider, apiKey, restauranteExternoId } = req.body || {};

    // Sin proveedor = desconectar y limpiar todo.
    if (!provider) {
      const updated = await registry.updateRestaurant(req.restaurant.id, {
        IntegracionProveedor: "",
        IntegracionApiKeyEnc: "",
        IntegracionRestauranteId: "",
        IntegracionWebhookSecretEnc: "",
        IntegracionActiva: false,
      });
      return res.json(toPublicIntegration(updated, req));
    }

    if (!connectors.getAdapter(provider)) {
      return res.status(400).json({ error: "proveedor_desconocido" });
    }

    const fields = {
      IntegracionProveedor: provider,
      IntegracionActiva: true,
    };
    if (restauranteExternoId !== undefined) {
      fields.IntegracionRestauranteId = String(restauranteExternoId || "").trim();
    }
    // Si no mandan clave nueva, se conserva la que hubiera.
    if (apiKey) fields.IntegracionApiKeyEnc = encrypt(String(apiKey).trim());

    // El token que autentica los webhooks entrantes lo generamos nosotros una
    // sola vez: es el que el restaurante le entrega a la plataforma.
    const yaTiene = req.restaurant.integracion?.webhookSecretEnc;
    if (!yaTiene) {
      fields.IntegracionWebhookSecretEnc = encrypt(crypto.randomBytes(32).toString("hex"));
    }

    const updated = await registry.updateRestaurant(req.restaurant.id, fields);
    res.json(toPublicIntegration(updated, req));
  })
);

/** Regenera el token de acceso (por si se filtró o la plataforma pide uno nuevo). */
router.post(
  "/api/settings/integration/rotate-token",
  handle(async (req, res) => {
    if (tooManyActions(req.restaurant.id)) {
      return res.status(429).json({ error: "demasiadas_acciones" });
    }
    if (!req.restaurant.integracion?.proveedor) {
      return res.status(400).json({ error: "sin_integracion" });
    }
    const updated = await registry.updateRestaurant(req.restaurant.id, {
      IntegracionWebhookSecretEnc: encrypt(crypto.randomBytes(32).toString("hex")),
    });
    res.json({
      ...toPublicIntegration(updated, req),
      aviso: "Token regenerado. Actualízalo en la plataforma o dejará de aceptar sus avisos.",
    });
  })
);

/**
 * Comprobación de estado. No puede llamar a la plataforma (TheFork no expone
 * un endpoint de validación público), así que verifica lo que sí depende de
 * nosotros: que el conector esté completo y listo para recibir.
 */
router.post(
  "/api/settings/integration/test",
  handle(async (req, res) => {
    const creds = connectors.integrationCredentials(req.restaurant);
    if (!creds || !creds.provider) return res.status(400).json({ error: "sin_integracion" });

    const adapter = connectors.getAdapter(creds.provider);
    const problemas = [];
    if (!creds.activa) problemas.push("La integración está desactivada.");
    if (!creds.webhookSecret) problemas.push("Falta el token de acceso para autenticar los avisos.");
    if (!process.env.PUBLIC_BASE_URL) {
      problemas.push("Falta configurar la dirección pública del servidor (PUBLIC_BASE_URL).");
    }

    res.json({
      ok: problemas.length === 0,
      proveedor: adapter?.etiqueta || creds.provider,
      recibePor: adapter?.authMode === "bearer" ? "webhook con token Bearer" : "webhook con secreto en la URL",
      problemas,
      nota:
        adapter?.authMode === "bearer"
          ? "No podemos comprobar la conexión desde aquí: es la plataforma quien nos llama. La prueba real es hacer una reserva en ella."
          : undefined,
    });
  })
);

module.exports = router;
