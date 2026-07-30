/**
 * Operaciones administrativas contra la API de Vapi (crear/actualizar el
 * assistant de voz de un restaurante). Se usa desde la pestaña Configuración
 * del panel y desde el script de alta de restaurantes, para que la definición
 * del assistant viva en UN solo sitio.
 */

const { tools } = require("../config/tools");
const { buildVoiceSystemPrompt } = require("../config/voicePrompt");

const VAPI_API = "https://api.vapi.ai";

// Vapi todavía no soporta el id claude-sonnet-5 (ver CLAUDE.md).
const MODEL = "claude-sonnet-4-6";

async function vapiFetch(apiKey, path, options = {}) {
  const res = await fetch(`${VAPI_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.message || JSON.stringify(body);
    throw new Error(`Vapi ${res.status}: ${Array.isArray(detail) ? detail.join("; ") : detail}`);
  }
  return body;
}

function vapiTools(publicBaseUrl) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
    server: { url: `${publicBaseUrl}/vapi/tools` },
  }));
}

/** Config completa del assistant para un restaurante (misma para crear y actualizar). */
function assistantConfig(restaurantName, publicBaseUrl) {
  return {
    name: `Recepcionista ${restaurantName}`,
    model: {
      provider: "anthropic",
      model: MODEL,
      temperature: 0.6,
      messages: [
        {
          role: "system",
          // {{now}} y {{customer.number}} los interpola Vapi en cada llamada.
          content: buildVoiceSystemPrompt("{{customer.number}}", restaurantName).replace(
            /Fecha y hora actual: [^(]+\(/,
            "Fecha y hora actual: {{now}} ("
          ),
        },
      ],
      tools: vapiTools(publicBaseUrl),
    },
    voice: {
      provider: "11labs",
      voiceId: "21m00Tcm4TlvDq8ikWAM",
      model: "eleven_multilingual_v2",
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
    },
    transcriber: { provider: "deepgram", model: "nova-2", language: "es" },
    startSpeakingPlan: { waitSeconds: 0.5 },
    stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.2, backoffSeconds: 1 },
    firstMessage: `Hola, gracias por llamar a ${restaurantName}. Soy María, ¿en qué puedo ayudarte?`,
  };
}

async function createAssistant(apiKey, restaurantName, publicBaseUrl) {
  return vapiFetch(apiKey, "/assistant", {
    method: "POST",
    body: JSON.stringify(assistantConfig(restaurantName, publicBaseUrl)),
  });
}

async function updateAssistant(apiKey, assistantId, restaurantName, publicBaseUrl) {
  const cfg = assistantConfig(restaurantName, publicBaseUrl);
  // El PATCH de Vapi no acepta algunos campos de creación; mandamos los que sí.
  return vapiFetch(apiKey, `/assistant/${assistantId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: cfg.name,
      model: cfg.model,
      firstMessage: cfg.firstMessage,
    }),
  });
}

async function getAssistant(apiKey, assistantId) {
  return vapiFetch(apiKey, `/assistant/${assistantId}`);
}

/**
 * Lista los assistants de la cuenta. Sirve para comprobar la clave POR SEPARADO
 * del assistant: si esto responde pero getAssistant falla, la clave es correcta
 * y lo que ocurre es que ese assistant pertenece a otra cuenta de Vapi.
 */
async function listAssistants(apiKey) {
  const res = await vapiFetch(apiKey, "/assistant?limit=100");
  return Array.isArray(res) ? res : res?.results || [];
}

/**
 * Intenta obtener un número gratuito de Vapi y ligarlo al assistant.
 * Devuelve null si la cuenta no lo permite (plan/límite): el llamador debe
 * tratarlo como "assistant creado, número pendiente".
 */
async function provisionPhoneNumber(apiKey, assistantId) {
  try {
    return await vapiFetch(apiKey, "/phone-number", {
      method: "POST",
      body: JSON.stringify({ provider: "vapi", assistantId }),
    });
  } catch (err) {
    console.warn("[vapiAdmin] no se pudo asignar número:", err.message);
    return null;
  }
}

module.exports = {
  createAssistant,
  updateAssistant,
  getAssistant,
  listAssistants,
  provisionPhoneNumber,
  assistantConfig,
};
