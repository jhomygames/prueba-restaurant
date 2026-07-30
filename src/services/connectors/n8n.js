/**
 * Conector para flujos de n8n.
 *
 * Pensado para quien ya tiene un flujo de n8n montado (con Vapi, WAPI o lo que
 * sea) que hoy escribe en Supabase. En vez de rehacer ese flujo, se sustituye
 * el nodo de Supabase por un HTTP Request a nuestro webhook, y aquí se acepta
 * EXACTAMENTE el mismo objeto que se insertaba en la tabla `reservas`, con sus
 * nombres de columna. Así no hay que transformar nada en n8n.
 *
 * Payload que espera (los nombres son los de la tabla de Supabase):
 *   {
 *     "id_reserva":  "RES-741449-553",   // obligatorio: identifica la reserva
 *     "fecha":       "2026-12-18",
 *     "hora":        "13:30",
 *     "personas":    3,
 *     "nombre":      "Juan García",
 *     "telefono":    "+34624114533",
 *     "notas":       "Alergia al marisco",
 *     "status":      "confirmed",        // confirmed | cancelled | pending
 *     "turno":       "comida",           // opcional: se deduce de la hora
 *     "lopd_acepta": true,
 *     "canal":       "voz"               // voz | whatsapp | web
 *   }
 *
 * Tolera nombres alternativos (`id`, `date`, `time`, `pax`, `cliente.nombre`…)
 * porque no todos los flujos de n8n nombran igual sus campos, y fallar por una
 * "s" de más obligaría a depurar dentro de n8n a ciegas.
 *
 * Autenticación: `?secret=` en la URL. n8n lo pega en la URL del nodo HTTP
 * Request sin configuración extra.
 */

const { safeCompare } = require("../secretBox");

const NOMBRE = "n8n";

// Los que significan "esta reserva ya no va".
const ESTADOS_CANCELADOS = new Set([
  "cancelled", "canceled", "cancelada", "cancelado", "anulada",
  "no_show", "noshow", "rejected", "rechazada",
]);

// Canales que nuestro campo Origen ya entiende. Cualquier otro cae a "n8n",
// que sigue siendo cierto y no inventa un canal que no existe.
const CANALES = new Set(["voz", "whatsapp", "panel"]);

function primero(...valores) {
  return valores.find((v) => v !== undefined && v !== null && v !== "") ?? "";
}

/** "13:30", "13:30:00" y "2026-12-18T13:30:00Z" -> "13:30" */
function normalizarHora(valor) {
  const s = String(valor || "").trim();
  if (!s) return "";
  const iso = s.match(/T(\d{2}:\d{2})/);
  if (iso) return iso[1];
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;
  return "";
}

/** "2026-12-18" y "2026-12-18T13:30:00Z" -> "2026-12-18" */
function normalizarFecha(valor) {
  const s = String(valor || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

function parseWebhook(body) {
  if (!body) return null;

  const externalId = primero(body.id_reserva, body.codigo, body.id, body.reservation_id);
  if (!externalId) return null; // sin identificador no se puede deduplicar

  const estado = String(primero(body.status, body.estado, "confirmed")).toLowerCase();
  const canalCrudo = String(primero(body.canal, body.channel, "")).toLowerCase();

  return {
    provider: NOMBRE,
    externalId: String(externalId),
    date: normalizarFecha(primero(body.fecha, body.date)),
    time: normalizarHora(primero(body.hora, body.time)),
    pax: Number(primero(body.personas, body.pax, body.party_size, body.comensales)) || 2,
    customerName: String(primero(body.nombre, body.cliente?.nombre, body.customer_name, "Cliente")).trim(),
    customerPhone: String(primero(body.telefono, body.cliente?.telefono, body.customer_phone, body.phone)),
    notes: String(primero(body.notas, body.notes, body.observaciones, "")),
    status: ESTADOS_CANCELADOS.has(estado) ? "cancelled" : "confirmed",
    // Extras propios de este conector, que el pipeline traslada a la reserva.
    code: String(externalId).startsWith("RES-") ? String(externalId) : "",
    shift: String(primero(body.turno, body.shift, "")).toLowerCase(),
    lopd: body.lopd_acepta === true || body.lopd === true,
    // El origen real de la reserva es el canal por el que habló el cliente; que
    // haya pasado por n8n es un detalle de fontanería, no lo que el equipo
    // necesita ver en el panel.
    channel: CANALES.has(canalCrudo) ? canalCrudo : NOMBRE,
  };
}

function verifyAuth(req, expectedSecret) {
  return safeCompare(req.query?.secret, expectedSecret);
}

/** Funciona por webhook: n8n empuja, nosotros no sondeamos. */
async function fetchSince() {
  return [];
}

module.exports = {
  nombre: NOMBRE,
  etiqueta: "n8n (flujo propio)",
  authMode: "query",
  successStatus: 200,
  parseWebhook,
  verifyAuth,
  fetchSince,
  _internals: { normalizarHora, normalizarFecha, ESTADOS_CANCELADOS },
};
