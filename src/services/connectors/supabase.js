/**
 * Conector con la base de Supabase donde escriben los flujos de n8n.
 *
 * A diferencia de los demás, este NO espera que nadie nos avise: va él a
 * preguntar. Es la única forma de enterarse de un cambio hecho a mano en la
 * tabla —alguien edita una reserva desde el editor de Supabase— porque eso no
 * dispara ningún webhook.
 *
 * Qué se trae en cada pasada: las reservas de HOY EN ADELANTE, todas, no solo
 * las nuevas. La tabla `reservas` tiene `created_at` pero no `updated_at`, así
 * que filtrar por fecha de creación perdería justo lo que más importa: una
 * reserva vieja que acaban de cancelar o mover. El conjunto de reservas futuras
 * es pequeño por definición (un restaurante no tiene miles de reservas por
 * delante), y el pipeline ya deduplica por id, así que volver a leerlas todas
 * es barato y no genera duplicados.
 *
 * Credenciales, en la pestaña Configuración:
 *   apiKey                -> clave de Supabase. Usa una restringida de solo
 *                            lectura sobre `reservas`, NUNCA la service_role.
 *   restauranteExternoId  -> referencia del proyecto ("klbnjqbzdtmbgfejpidq")
 *                            o su URL completa.
 */

const n8n = require("./n8n");

const NOMBRE = "supabase";
const TABLA = "reservas";

/** Acepta tanto "abcdef123456" como "https://abcdef123456.supabase.co". */
function urlBase(referencia) {
  const v = String(referencia || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}.supabase.co`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Trae las reservas vigentes y las traduce al formato del pipeline.
 *
 * Se reutiliza el parser del conector de n8n a propósito: la tabla de Supabase
 * y el cuerpo que n8n envía por webhook son la misma forma de datos, así que
 * duplicar el mapeo solo serviría para que un día dejaran de coincidir.
 */
async function fetchSince(creds) {
  const base = urlBase(creds && creds.restauranteExternoId);
  const key = creds && creds.apiKey;

  if (!base || !key) {
    console.error("[supabase] falta la referencia del proyecto o la clave; no se sincroniza");
    return [];
  }

  const url =
    `${base}/rest/v1/${TABLA}` +
    `?select=*&fecha=gte.${hoyISO()}&order=fecha.asc&limit=500`;

  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status}: ${detalle.slice(0, 200)}`);
  }

  const filas = await res.json();
  if (!Array.isArray(filas)) return [];

  return filas
    .map((fila) => {
      const r = n8n.parseWebhook(fila);
      // El proveedor debe ser este conector, no el de n8n: es lo que decide
      // contra qué integración se deduplica y qué credenciales se usan.
      return r ? { ...r, provider: NOMBRE } : null;
    })
    .filter(Boolean);
}

/**
 * Este conector no recibe webhooks: la app pregunta, no la avisan. Se declara
 * igualmente para cumplir el contrato del pipeline, y para que una llamada al
 * webhook público no se quede colgada sin respuesta.
 */
function parseWebhook(body) {
  const r = n8n.parseWebhook(body);
  return r ? { ...r, provider: NOMBRE } : null;
}

module.exports = {
  nombre: NOMBRE,
  etiqueta: "Supabase (base de n8n)",
  authMode: "query",
  successStatus: 200,
  soloSondeo: true,
  parseWebhook,
  verifyAuth: n8n.verifyAuth,
  fetchSince,
  _internals: { urlBase },
};
