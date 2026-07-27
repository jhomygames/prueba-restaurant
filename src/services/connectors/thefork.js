/**
 * Conector TheFork (POS-API).
 *
 * Implementado contra el flujo "Create Orders" documentado en
 * https://docs.thefork.io/POS-API/Flow/create-order (consultado 2026-07).
 *
 * Cómo funciona de verdad, según esa documentación:
 *
 *   - TheFork LLAMA a nuestro sistema, no al revés: cuando alguien reserva en
 *     TheFork, hacen POST a la URL que el restaurante registró con ellos
 *     (la llaman `receiptOpeningUrl`).
 *   - Autenticación: mandan `Authorization: Bearer {ACCESS_TOKEN}`, donde el
 *     token es el que el restaurante les entregó durante el alta. Nosotros lo
 *     guardamos cifrado y comparamos.
 *   - Éxito = responder 204 SIN cuerpo. Cualquier otra cosa y reintentan.
 *
 * Campos del payload (confirmados en la doc): orderId, customerId, createdAt,
 * updatedAt, dateOfMeal, startTime, partySize, duration, reservationStatus,
 * mealStatus, customer{id,firstName,lastName,allergies,dietaryRestrictions},
 * offer, prepayment, tables.
 */

const crypto = require("crypto");

const NOMBRE = "thefork";

// Valores de `reservationStatus` que significan "esta reserva ya no va".
// TODO (confirmar con cuenta de partner): la documentación pública no lista el
// catálogo completo. Ante un valor desconocido preferimos tratarlo como activa
// y registrarlo en el log: es mejor mostrar una reserva de más (el staff la ve
// y decide) que perder una silenciosamente.
const ESTADOS_CANCELADOS = new Set([
  "cancelled",
  "canceled",
  "cancelled_by_customer",
  "cancelled_by_restaurant",
  "no_show",
  "noshow",
  "rejected",
  "refused",
]);

/** "17:00:00" o "2026-08-15T17:00:00Z" → "17:00" */
function normalizarHora(valor) {
  if (!valor) return "";
  const s = String(valor);
  const conT = s.match(/T(\d{2}:\d{2})/);
  if (conT) return conT[1];
  const suelta = s.match(/^(\d{1,2}):(\d{2})/);
  if (suelta) return `${suelta[1].padStart(2, "0")}:${suelta[2]}`;
  return s;
}

/** "2026-08-15T00:00:00Z" o "2026-08-15" → "2026-08-15" */
function normalizarFecha(valor) {
  if (!valor) return "";
  const s = String(valor);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

/**
 * Junta alergias y restricciones dietéticas en una nota legible para el staff.
 * Esto es valioso: TheFork ya trae la alergia declarada por el cliente, así que
 * el restaurante la ve igual que si la hubiera preguntado María por teléfono.
 */
function notasDesdeCliente(customer, notasBase) {
  const partes = [];
  if (notasBase) partes.push(notasBase);

  const lista = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : v || "");
  const alergias = lista(customer?.allergies);
  const dietas = lista(customer?.dietaryRestrictions);

  if (alergias) partes.push(`Alergias (TheFork): ${alergias}`);
  if (dietas) partes.push(`Dieta (TheFork): ${dietas}`);
  return partes.join(" · ");
}

function parseWebhook(body) {
  if (!body || !body.orderId) return null;

  const estadoCrudo = String(body.reservationStatus || "").toLowerCase();
  const cancelada = ESTADOS_CANCELADOS.has(estadoCrudo);
  if (estadoCrudo && !cancelada && estadoCrudo !== "confirmed" && estadoCrudo !== "validated") {
    // No lo conocemos: lo tratamos como activa, pero dejamos rastro para poder
    // ampliar el catálogo cuando veamos valores reales.
    console.warn(`[thefork] reservationStatus no reconocido: "${estadoCrudo}" (se trata como activa)`);
  }

  const nombre = [body.customer?.firstName, body.customer?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    provider: NOMBRE,
    externalId: String(body.orderId),
    date: normalizarFecha(body.dateOfMeal),
    time: normalizarHora(body.startTime),
    pax: Number(body.partySize) || 2,
    customerName: nombre || "Cliente TheFork",
    // La doc no incluye teléfono en el payload de create-order; si algún día
    // llega, lo aprovechamos sin cambiar nada más.
    customerPhone: body.customer?.phoneNumber || body.customer?.phone || "",
    notes: notasDesdeCliente(body.customer, body.notes),
    status: cancelada ? "cancelled" : "confirmed",
  };
}

/**
 * Compara el Bearer recibido contra el token esperado en tiempo constante,
 * para no filtrar información por cuánto tarda la comparación.
 */
function verifyAuth(req, expectedToken) {
  if (!expectedToken) return false;
  const header = req.headers?.authorization || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!recibido) return false;

  const a = Buffer.from(recibido);
  const b = Buffer.from(String(expectedToken));
  if (a.length !== b.length) return false; // timingSafeEqual exige igual longitud
  return crypto.timingSafeEqual(a, b);
}

/** TheFork empuja, no se sondea. Se declara para encajar en el pipeline común. */
async function fetchSince() {
  return [];
}

module.exports = {
  nombre: NOMBRE,
  etiqueta: "TheFork",
  authMode: "bearer",
  successStatus: 204, // TheFork exige 204 sin cuerpo
  parseWebhook,
  verifyAuth,
  fetchSince,
  // Expuesto solo para pruebas del parser
  _internals: { normalizarFecha, normalizarHora, ESTADOS_CANCELADOS },
};
