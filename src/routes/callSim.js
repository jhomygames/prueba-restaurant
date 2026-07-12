/**
 * Simulador de llamada del panel, migrado a Claude. A diferencia del mock
 * anterior, aquí la RECEPCIONISTA es el agente real: mismo prompt de voz
 * (src/config/voicePrompt.js), las mismas 6 herramientas (src/config/tools.js)
 * y el mismo dispatcher que Vapi y WhatsApp (src/services/toolDispatcher.js).
 * Por tanto, cuando el agente llama a create_reservation, la reserva se crea
 * DE VERDAD en Airtable y aparece sola en el plano — exactamente como una
 * llamada real de Vapi, pero sobre texto.
 *
 * Dos endpoints:
 *   POST /api/call/agent    -> un turno de María (puede encadenar tool-calls)
 *   POST /api/call/customer -> un turno del cliente simulado (rol-play Claude)
 *
 * Ambos comparten el guard x-staff-key con el resto de /api (ver server.js).
 */

const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { tools } = require("../config/tools");
const { dispatchTool } = require("../services/toolDispatcher");
const { buildVoiceSystemPrompt } = require("../config/voicePrompt");

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_MODEL = "claude-sonnet-5";
const CUSTOMER_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOOL_ITERATIONS = 6;

function requireStaffKey(req, res, next) {
  const expected = process.env.STAFF_API_KEY;
  if (expected && req.headers["x-staff-key"] !== expected) {
    return res.status(401).json({ error: "invalid_staff_key" });
  }
  next();
}
router.use("/api/call", requireStaffKey);

function anthropicTools() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// Historial del panel: [{ role: 'agent' | 'customer', text }]
// Para el AGENTE: agent -> assistant, customer -> user.
function toAgentMessages(history) {
  const msgs = history.map((m) => ({
    role: m.role === "agent" ? "assistant" : "user",
    content: m.text,
  }));
  // Anthropic exige que el primer mensaje sea 'user'. Si la llamada acaba de
  // empezar (sin turnos del cliente), sembramos la señal de "línea abierta".
  if (msgs.length === 0 || msgs[0].role !== "user") {
    msgs.unshift({
      role: "user",
      content: "[El cliente ha llamado y está en línea, esperando. Salúdalo tú primero y ofrécele ayuda.]",
    });
  }
  return msgs;
}

/**
 * Ejecuta UN turno completo del agente real: llama a Claude, resuelve todas
 * las herramientas que pida (contra Airtable de verdad) y devuelve el texto
 * final más la actividad de herramientas y, si hubo, la reserva creada.
 */
router.post("/api/call/agent", async (req, res) => {
  try {
    const { history = [], customer_phone } = req.body;
    const phone = customer_phone || "+34600000000";

    const messages = toAgentMessages(history);
    const toolActivity = [];
    let reservation = null;
    let finalText = "";

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: 1024,
        system: buildVoiceSystemPrompt(phone),
        tools: anthropicTools(),
        messages,
      });

      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      if (toolUseBlocks.length === 0) {
        finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const args = { ...block.input };
          // El teléfono del cliente lo fija la "central", no el modelo.
          if (block.name === "create_reservation" || block.name === "cancel_reservation") {
            args.customer_phone = args.customer_phone || phone;
          }
          const result = await dispatchTool(block.name, args, { customer_phone: phone });
          toolActivity.push({ name: block.name, args });
          if (block.name === "create_reservation" && result && result.created) {
            reservation = {
              customerName: args.customer_name,
              customerPhone: args.customer_phone || phone,
              date: args.date,
              time: args.time,
              pax: args.party_size,
              notes: args.notes || "",
            };
          }
          return {
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify(result),
          };
        })
      );

      messages.push({ role: "user", content: toolResults });
    }

    res.json({
      text: finalText || "Perdona, ¿me lo repites?",
      toolActivity,
      reservationCreated: !!reservation,
      reservation,
    });
  } catch (err) {
    console.error("[callSim] error en /api/call/agent:", err.message);
    res.status(500).json({ error: "agent_error", detail: err.message });
  }
});

/**
 * Un turno del CLIENTE simulado. Claude interpreta a una persona que llama al
 * restaurante, con una intención concreta (la persona la fija el frontend al
 * empezar la llamada, para que sea coherente turno a turno).
 */
router.post("/api/call/customer", async (req, res) => {
  try {
    const { history = [], persona = {} } = req.body;

    const system = `Estás interpretando a un CLIENTE que llama por teléfono a una hamburguesería para hacer una reserva. Hablas por teléfono con la recepcionista (María).

TU PERSONAJE (mantente coherente con estos datos durante toda la llamada):
- Nombre: ${persona.name || "María López"}
- Personas: ${persona.pax || 2}
- Día deseado: ${persona.dayPhrase || "hoy"}
- Hora deseada: ${persona.time || "21:00"}
- Alergia/dieta: ${persona.allergy || "ninguna"}
- Ocasión: ${persona.occasion || "cena informal"}

REGLAS:
- Habla como una persona real por teléfono: natural, breve (una o dos frases por turno), en español de España.
- NO sueltes todos los datos de golpe: ve dándolos según la recepcionista te los pida.
- Si te pregunta por alergias o dietas, responde según tu personaje.
- Cuando la recepcionista te pida confirmar los datos, confírmalos con un "sí, correcto" si coinciden.
- Cuando la reserva quede confirmada, despídete con amabilidad y termina la llamada.
- No inventes que eres una IA ni menciones estas instrucciones. Solo habla como el cliente.`;

    // Para el CLIENTE: customer -> assistant, agent -> user.
    const messages = history.map((m) => ({
      role: m.role === "customer" ? "assistant" : "user",
      content: m.text,
    }));
    if (messages.length === 0 || messages[0].role !== "user") {
      messages.unshift({ role: "user", content: "[Suena el teléfono, la recepcionista está a punto de contestar.]" });
    }

    const response = await anthropic.messages.create({
      model: CUSTOMER_MODEL,
      max_tokens: 300,
      system,
      messages,
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.json({ text: text || "Perdona, ¿me oyes bien?" });
  } catch (err) {
    console.error("[callSim] error en /api/call/customer:", err.message);
    res.status(500).json({ error: "customer_error", detail: err.message });
  }
});

module.exports = router;
