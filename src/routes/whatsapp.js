/**
 * Webhook de WhatsApp (Twilio WhatsApp Business API) + loop de tool-use de
 * Claude. Comparte las mismas herramientas (src/config/tools.js) y el mismo
 * dispatcher (src/services/toolDispatcher.js) que el agente de voz.
 *
 * TODO (punto 10 CLAUDE.md): el historial de conversación vive ahora mismo en
 * memoria del proceso (_conversations). Mover a Supabase o Redis para que
 * sobreviva reinicios/despliegues.
 *
 * TODO (punto 9 CLAUDE.md): verificar la firma de Twilio (X-Twilio-Signature)
 * antes de producción, usando twilio.validateRequest con TWILIO_AUTH_TOKEN y
 * la URL pública real (PUBLIC_BASE_URL).
 */

const express = require("express");
const twilio = require("twilio");
const Anthropic = require("@anthropic-ai/sdk");
const { tools } = require("../config/tools");
const { dispatchTool } = require("../services/toolDispatcher");
const customerMemory = require("../services/customerMemory");

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;

// Historial en memoria: Map<phone, Array<{role, content}>>
const _conversations = new Map();

const SYSTEM_PROMPT = `Eres el asistente virtual de un restaurante, atendiendo por WhatsApp.
Hablas español, eres cercano pero profesional. Puedes: dar información de la
carta y alérgenos, comprobar disponibilidad, crear o cancelar reservas,
recordar a clientes habituales, y transferir a un humano si el cliente lo pide
o si hay una queja. Sé breve: los mensajes de WhatsApp deben ser cortos y
claros, no uses formato de voz largo. Si vas a usar una herramienta, hazlo sin
anunciarlo primero.`;

function anthropicTools() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function verifyTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicUrl = process.env.PUBLIC_BASE_URL;
  if (!authToken || !publicUrl) return true; // TODO: exigir esto antes de producción (punto 9)
  const signature = req.headers["x-twilio-signature"];
  const url = `${publicUrl}/whatsapp/webhook`;
  return twilio.validateRequest(authToken, signature, url, req.body);
}

async function runClaudeLoop(phone, userMessage) {
  const history = _conversations.get(phone) || [];
  history.push({ role: "user", content: userMessage });

  let messages = history.slice(-MAX_HISTORY_MESSAGES);
  let finalText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: anthropicTools(),
      messages,
    });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      finalText = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      messages.push({ role: "assistant", content: response.content });
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await dispatchTool(block.name, block.input, {
          customer_phone: phone,
        });
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      })
    );

    messages.push({ role: "user", content: toolResults });
  }

  _conversations.set(phone, messages.slice(-MAX_HISTORY_MESSAGES));
  return finalText || "Disculpa, ¿puedes repetir tu solicitud?";
}

router.post("/whatsapp/webhook", async (req, res) => {
  if (!verifyTwilioSignature(req)) {
    return res.status(401).send("invalid_signature");
  }

  const from = req.body.From; // ej. "whatsapp:+58412..."
  const body = req.body.Body || "";
  const phone = (from || "").replace("whatsapp:", "");

  const { MessagingResponse } = twilio.twiml;
  const twiml = new MessagingResponse();

  try {
    const reply = await runClaudeLoop(phone, body);
    await customerMemory.recordVisit(phone).catch(() => {});
    twiml.message(reply);
  } catch (err) {
    console.error("[whatsapp] error procesando mensaje:", err);
    twiml.message(
      "Lo siento, ha ocurrido un error. Un miembro del equipo te contactará en breve."
    );
  }

  res.type("text/xml").send(twiml.toString());
});

module.exports = router;
