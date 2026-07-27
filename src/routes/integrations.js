/**
 * Webhook público para plataformas de reservas externas.
 *
 *   POST /integrations/:provider/webhook/:slug
 *
 * Lo llaman TheFork y compañía cuando alguien reserva en su plataforma. NO
 * lleva sesión (viene de fuera), así que la seguridad se apoya en tres cosas:
 *
 *   1. El restaurante se identifica por el `:slug` de la URL, NUNCA por nada
 *      que venga dentro del payload (que lo controla el emisor).
 *   2. El proveedor declarado en la URL debe coincidir con el que ese
 *      restaurante tiene configurado, y la integración debe estar activa.
 *   3. El emisor se autentica con un secreto por restaurante, en la forma que
 *      use cada plataforma: TheFork manda `Authorization: Bearer`; otros
 *      admiten `?secret=` en la URL.
 *
 * Sobre los códigos de respuesta: las plataformas reintentan ante errores, así
 * que un payload que no sabemos interpretar se responde con éxito (y se
 * registra en el log) en vez de provocar una tormenta de reintentos. Los fallos
 * de autenticación sí devuelven 401/403 a propósito.
 */

const express = require("express");
const registry = require("../services/registry");
const connectors = require("../services/connectors");
const { decrypt } = require("../services/secretBox");

const router = express.Router();

router.post("/integrations/:provider/webhook/:slug", async (req, res) => {
  const { provider, slug } = req.params;

  try {
    const restaurant = await registry.findBySlug(slug);
    if (!restaurant) {
      console.warn(`[integrations] webhook para un restaurante inexistente: ${slug}`);
      return res.status(404).json({ error: "restaurante_no_encontrado" });
    }

    const creds = connectors.integrationCredentials(restaurant);
    if (!creds || !creds.activa) {
      console.warn(`[integrations] ${slug}: webhook recibido con la integración desactivada`);
      return res.status(403).json({ error: "integracion_inactiva" });
    }
    if (creds.provider !== provider) {
      console.warn(
        `[integrations] ${slug}: webhook de "${provider}" pero el restaurante tiene "${creds.provider}"`
      );
      return res.status(403).json({ error: "proveedor_no_coincide" });
    }

    const adapter = connectors.getAdapter(provider);
    if (!adapter) return res.status(404).json({ error: "proveedor_desconocido" });

    // --- Autenticación del emisor, según lo que use cada plataforma ---
    const autenticado =
      adapter.authMode === "bearer"
        ? adapter.verifyAuth(req, creds.webhookSecret)
        : String(req.query.secret || "") === creds.webhookSecret && Boolean(creds.webhookSecret);

    if (!autenticado) {
      console.warn(`[integrations] ${slug}/${provider}: autenticación del webhook fallida`);
      return res.status(401).json({ error: "no_autorizado" });
    }

    // --- Traducir y guardar ---
    const normalizada = adapter.parseWebhook(req.body);
    if (!normalizada) {
      console.warn(`[integrations] ${slug}/${provider}: payload no interpretable, se ignora`);
      // Respondemos éxito igualmente: si devolviéramos error, la plataforma
      // reintentaría en bucle un payload que nunca vamos a poder procesar.
      if (adapter.successStatus === 204) return res.status(204).end();
      return res.json({ ok: true, ignored: true });
    }

    const resultado = await connectors.upsertExternalReservation(
      { baseId: restaurant.baseId },
      normalizada
    );

    // Log sin datos personales: id externo y fecha bastan para depurar.
    console.log(
      `[integrations] ${slug}/${provider} ${normalizada.externalId} ${normalizada.date} ${normalizada.time} -> ${resultado.action}`
    );

    if (adapter.successStatus === 204) return res.status(204).end();
    return res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(`[integrations] error procesando webhook ${provider}/${slug}:`, err.message);
    // 500 hace que la plataforma reintente, que es lo correcto ante un fallo
    // nuestro (a diferencia de un payload que no entendemos).
    return res.status(500).json({ error: "internal_error" });
  }
});

module.exports = router;
