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

const router = express.Router();

function verifyVapiSecret(req) {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  if (!expected) return true; // TODO: exigir esto antes de ir a producción (punto 9)
  return req.headers["x-vapi-secret"] === expected;
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
    req.body?.call?.customer?.number || req.body?.customer?.number;

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
        const result = await dispatchTool(name, args, { customer_phone: customerPhone });
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
