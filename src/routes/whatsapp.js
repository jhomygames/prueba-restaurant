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

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_TOOL_ITERATIONS = 5;
const MAX_HISTORY_MESSAGES = 20;

// Historial en memoria: Map<phone, Array<{role, content}>>
const _conversations = new Map();

function buildSystemPrompt(phone) {
  const ahora = new Date().toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `Eres el asistente por WhatsApp de una hamburguesería. Atiendes reservas, dudas sobre la carta y peticiones de contacto humano.

FECHA Y HORA ACTUAL: ${ahora} (zona Europe/Madrid). Úsala para resolver expresiones como "mañana", "el viernes" o "esta noche" a fechas concretas YYYY-MM-DD antes de llamar a cualquier herramienta.

TELÉFONO DEL CLIENTE: ${phone}. Úsalo directamente como customer_phone en las herramientas; no se lo pidas.

ESTILO WhatsApp:
- Mensajes cortos (1-4 líneas), tono cercano y profesional, tuteo.
- Un emoji ocasional está bien; no abuses.
- Nunca inventes platos, precios ni disponibilidad: consulta siempre las herramientas.

RESERVAS:
1. Necesitas: fecha, hora, nº de personas y nombre. Pide solo lo que falte, todo en un mismo mensaje.
2. Comprueba disponibilidad antes de confirmar. Si no hay mesa, ofrece las alternativas que devuelva la herramienta.
3. Tras crear la reserva, confirma con un resumen: día, hora, personas, nombre.
4. Para cancelar, basta el teléfono (ya lo tienes) y la fecha.

ALÉRGENOS (crítico):
- Si el cliente menciona alergia o intolerancia, consulta get_menu_info con exclude_allergen y responde solo con platos aptos.
- Añade siempre: "Te recomiendo confirmarlo también con el personal en sala".
- Si usas get_customer_memory y el cliente tiene alergias registradas, tenlas en cuenta sin que las repita.
- Al crear reserva de un cliente que mencionó alergias, inclúyelas en notes.

TRANSFERIR A HUMANO (transfer_to_human con channel "whatsapp") cuando: lo pidan explícitamente, haya una queja, un grupo grande (+8 personas), o algo fuera de tu alcance. Confirma que el equipo le contactará pronto.

PRIVACIDAD (LOPD): pide solo nombre; el teléfono ya lo tienes. No pidas más datos personales.`;
}

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
      system: buildSystemPrompt(phone),
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
