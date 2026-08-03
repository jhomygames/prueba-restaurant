/**
 * Registro central de restaurantes (multi-tenant).
 *
 * Una base de Airtable aparte (REGISTRO_BASE_ID) con dos tablas:
 *   Restaurantes: quién es cada local, en qué base viven sus datos y cómo
 *                 están configurados sus canales (Vapi / Twilio).
 *   Usuarios:     staff que puede entrar al panel (login por local).
 *
 * Se cachea en memoria (TTL corto) porque se consulta en cada request del
 * panel y en cada tool-call de los agentes. Cualquier escritura desde la
 * pestaña Configuración llama a invalidate().
 */

const airtable = require("./airtableClient");
const { decrypt } = require("./secretBox");

const T_RESTAURANTES = "Restaurantes";
const T_USUARIOS = "Usuarios";
const TTL_MS = 60 * 1000;

let cache = null; // { at, restaurants: [...] }

function registroBaseId() {
  const id = process.env.REGISTRO_BASE_ID;
  if (!id) {
    throw new Error(
      "REGISTRO_BASE_ID no está configurado: el sistema multi-restaurante no puede resolver tenants."
    );
  }
  return id;
}

function toRestaurant(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    slug: f.Slug || "",
    nombre: f.Nombre || "",
    baseId: f.BaseId || "",
    googleReviewUrl: f.GoogleReviewUrl || "",
    staffWhatsApp: f.StaffWhatsApp || "",
    activo: f.Activo === true,
    vapi: {
      assistantId: f.VapiAssistantId || "",
      phoneNumberId: f.VapiPhoneNumberId || "",
      telefono: f.VapiTelefono || "",
      apiKeyEnc: f.VapiApiKeyEnc || "",
    },
    twilio: {
      accountSid: f.TwilioAccountSid || "",
      authTokenEnc: f.TwilioAuthTokenEnc || "",
      whatsappFrom: f.TwilioWhatsAppFrom || "",
    },
    // Conector con una plataforma de reservas externa (TheFork, etc.)
    integracion: {
      proveedor: f.IntegracionProveedor || "",
      apiKeyEnc: f.IntegracionApiKeyEnc || "",
      restauranteExternoId: f.IntegracionRestauranteId || "",
      webhookSecretEnc: f.IntegracionWebhookSecretEnc || "",
      activa: f.IntegracionActiva === true,
      ultimaSync: f.IntegracionUltimaSync || "",
    },
  };
}

async function allRestaurants({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.restaurants;
  const records = await airtable.listRecords(registroBaseId(), T_RESTAURANTES);
  const restaurants = records.map(toRestaurant);
  cache = { at: Date.now(), restaurants };
  return restaurants;
}

function invalidate() {
  cache = null;
}

async function findById(id) {
  return (await allRestaurants()).find((r) => r.id === id) || null;
}

async function findBySlug(slug) {
  const s = String(slug || "").toLowerCase();
  return (await allRestaurants()).find((r) => r.slug.toLowerCase() === s) || null;
}

/** Resuelve el tenant de una llamada de Vapi por su assistant o su número. */
async function findByVapi({ assistantId, phoneNumberId }) {
  const list = await allRestaurants();
  return (
    (assistantId && list.find((r) => r.vapi.assistantId === assistantId)) ||
    (phoneNumberId && list.find((r) => r.vapi.phoneNumberId === phoneNumberId)) ||
    null
  );
}

/**
 * Resuelve el tenant de un WhatsApp entrante por el número AL QUE escribe el
 * cliente (el número del local). Twilio lo manda como "whatsapp:+1...".
 */
async function findByWhatsAppTo(to) {
  const norm = (v) => String(v || "").replace(/^whatsapp:/, "").replace(/[^\d+]/g, "");
  const target = norm(to);
  if (!target) return null;
  return (await allRestaurants()).find((r) => norm(r.twilio.whatsappFrom) === target) || null;
}

async function activeRestaurants() {
  return (await allRestaurants()).filter((r) => r.activo && r.baseId);
}

/**
 * Credenciales efectivas de Twilio para un restaurante: las suyas si las tiene
 * configuradas, si no las centrales del entorno (útil en el sandbox, donde un
 * único número de Twilio sirve a todos).
 */
function twilioCredentials(restaurant) {
  const own = restaurant && restaurant.twilio;
  if (own && own.accountSid && own.authTokenEnc && own.whatsappFrom) {
    const authToken = decrypt(own.authTokenEnc);
    if (authToken) {
      return {
        accountSid: own.accountSid,
        authToken,
        from: own.whatsappFrom,
        source: "tenant",
      };
    }
  }
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM) {
    return {
      accountSid: TWILIO_ACCOUNT_SID,
      authToken: TWILIO_AUTH_TOKEN,
      from: TWILIO_WHATSAPP_FROM,
      source: "central",
    };
  }
  return null;
}

/**
 * API key efectiva de Vapi.
 *
 * Cada restaurante tiene su PROPIA cuenta de Vapi, no un agente dentro de una
 * cuenta compartida. Por eso, si el local tiene clave configurada, esa manda y
 * no se cae nunca a la central: hacerlo significaría operar contra la cuenta
 * equivocada —leer o modificar agentes de otro— sin que nadie se entere.
 *
 * Que la clave del local exista pero no se pueda descifrar es un fallo que hay
 * que ver, no que disimular: normalmente significa que TENANT_SECRETS_KEY ha
 * cambiado y el dueño tiene que volver a pegarla.
 *
 * La central solo se usa cuando el local no ha configurado ninguna, que es el
 * caso del sandbox y de los locales aún sin cuenta propia.
 */
function vapiApiKey(restaurant) {
  const enc = restaurant && restaurant.vapi && restaurant.vapi.apiKeyEnc;
  if (enc) {
    const key = decrypt(enc);
    if (key) return { key, source: "tenant" };
    console.error(
      `[registry] ${restaurant.slug} tiene clave de Vapi guardada pero no se puede descifrar; ` +
        `NO se usa la central para no operar contra otra cuenta.`
    );
    return null;
  }
  if (process.env.VAPI_PRIVATE_API_KEY) {
    return { key: process.env.VAPI_PRIVATE_API_KEY, source: "central" };
  }
  return null;
}

// ---------- Usuarios ----------

function toUser(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    email: (f.Email || "").toLowerCase(),
    passwordHash: f.PasswordHash || "",
    nombre: f.NombreStaff || "",
    rol: f.Rol || "staff",
    activo: f.Activo === true,
    restauranteId: f.RestauranteId || "",
  };
}

async function findUserByEmail(email) {
  const target = String(email || "").toLowerCase().trim();
  if (!target) return null;
  // Sin caché: el login es poco frecuente y no queremos servir hashes viejos
  // tras un cambio de contraseña.
  const records = await airtable.listRecords(registroBaseId(), T_USUARIOS, {
    filterByFormula: `LOWER({Email}) = ${airtable.quote(target)}`,
    maxRecords: 1,
  });
  return records[0] ? toUser(records[0]) : null;
}

async function findUserById(id) {
  const rec = await airtable.getRecord(registroBaseId(), T_USUARIOS, id);
  return rec ? toUser(rec) : null;
}

async function updateUser(id, fields) {
  return airtable.updateRecord(registroBaseId(), T_USUARIOS, id, fields, { typecast: true });
}

async function updateRestaurant(id, fields) {
  const rec = await airtable.updateRecord(registroBaseId(), T_RESTAURANTES, id, fields, {
    typecast: true,
  });
  invalidate();
  return toRestaurant(rec);
}

async function createRestaurant(fields) {
  const rec = await airtable.createRecord(registroBaseId(), T_RESTAURANTES, fields, {
    typecast: true,
  });
  invalidate();
  return toRestaurant(rec);
}

async function createUser(fields) {
  return airtable.createRecord(registroBaseId(), T_USUARIOS, fields, { typecast: true });
}

module.exports = {
  registroBaseId,
  allRestaurants,
  activeRestaurants,
  invalidate,
  findById,
  findBySlug,
  findByVapi,
  findByWhatsAppTo,
  twilioCredentials,
  vapiApiKey,
  findUserByEmail,
  findUserById,
  updateUser,
  updateRestaurant,
  createRestaurant,
  createUser,
};
