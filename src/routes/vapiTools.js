/**
 * Webhook de tool-calls del agente de voz (Vapi).
 *
 * Vapi hace POST aquí cuando el asistente decide invocar una función durante
 * la llamada. Formato esperado (server-tool-calls):
 *   { message: { type: "tool-calls", toolCallList: [{ id, name, arguments }] } }
 * Respuesta esperada:
 *   { results: [{ toolCallId, result }] }
 *
 * TODO (punto 9 CLAUDE.md): verificar firma/secreto de Vapi antes de producción.
 * Vapi permite configurar un "Server URL Secret" que llega en el header
 * `x-vapi-secret`; comparar contra process.env.VAPI_WEBHOOK_SECRET cuando
 * esté disponible.
 */

const express = require("express");
const { dispatchTool } = require("../services/toolDispatcher");
const registry = require("../services/registry");
const { safeCompare } = require("../services/secretBox");

const router = express.Router();

/**
 * Resuelve a QUÉ restaurante pertenece la llamada. Vapi manda el assistant y el
 * número en distintos sitios según el tipo de evento, así que probamos todas
 * las rutas conocidas del payload antes de rendirnos.
 */
async function resolveRestaurant(body) {
  const call = body?.message?.call || body?.call || {};
  const assistantId =
    body?.message?.assistant?.id || call.assistantId || call.assistant?.id || body?.assistantId;
  const phoneNumberId =
    call.phoneNumberId || call.phoneNumber?.id || body?.message?.phoneNumber?.id;

  const found = await registry.findByVapi({ assistantId, phoneNumberId });
  if (!found) {
    console.error(
      `[vapiTools] no se pudo identificar el restaurante (assistantId=${assistantId}, phoneNumberId=${phoneNumberId})`
    );
  }
  return found;
}

/**
 * Comprueba el secreto compartido que envían Vapi (Server URL Secret) y n8n.
 *
 * Sigue siendo opcional a propósito: si no hay VAPI_WEBHOOK_SECRET configurado
 * se acepta la llamada, para no tumbar un agente que ya está atendiendo. En
 * cuanto la variable existe, pasa a ser obligatoria.
 */
function verifyVapiSecret(req) {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true;
  return safeCompare(req.headers["x-vapi-secret"], expected);
}

router.post("/vapi/tools", async (req, res) => {
  if (!verifyVapiSecret(req)) {
    return res.status(401).json({ error: "invalid_vapi_secret" });
  }

  const message = req.body?.message;
  const toolCalls =
    message?.toolCallList || message?.toolCalls || [];

  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return res.status(400).json({ error: "no_tool_calls_in_payload" });
  }

  const customerPhone =
    req.body?.message?.call?.customer?.number ||
    req.body?.call?.customer?.number ||
    req.body?.customer?.number;

  const restaurant = await resolveRestaurant(req.body);
  if (!restaurant) {
    // Respuesta suave: el agente dirá que hay un problema en vez de cortar.
    return res.json({
      results: toolCalls.map((c) => ({
        toolCallId: c.id,
        result: JSON.stringify({ error: "restaurante_no_identificado" }),
      })),
    });
  }

  const results = await Promise.all(
    toolCalls.map(async (call) => {
      const name = call.name || call.function?.name;
      let args = call.arguments || call.function?.arguments || {};
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      try {
        const result = await dispatchTool(name, args, {
          customer_phone: customerPhone,
          restaurant,
          channel: "voz",
        });
        return { toolCallId: call.id, result: JSON.stringify(result) };
      } catch (err) {
        console.error(`[vapiTools] error ejecutando ${name}:`, err);
        return {
          toolCallId: call.id,
          result: JSON.stringify({ error: "tool_execution_failed" }),
        };
      }
    })
  );

  res.json({ results });
});

module.exports = router;
