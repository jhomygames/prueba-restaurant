/**
 * Conector de DEMOSTRACIÓN.
 *
 * Simula una plataforma de reservas externa para poder probar todo el circuito
 * (webhook → reserva en el plano → cliente registrado → cancelación) sin
 * depender de credenciales de nadie. Es también la plantilla más corta posible
 * para escribir un conector nuevo.
 *
 * Payload que espera (POST al webhook):
 *   {
 *     "id": "DEMO-123",              // obligatorio: id en la plataforma
 *     "fecha": "2026-08-15",         // YYYY-MM-DD
 *     "hora": "21:00",               // HH:mm
 *     "personas": 4,
 *     "cliente": { "nombre": "Ana López", "telefono": "+34600111222" },
 *     "notas": "Cumpleaños",         // opcional
 *     "estado": "confirmada"         // "confirmada" | "cancelada"
 *   }
 *
 * Autenticación: `?secret=` en la URL contra el secreto del restaurante.
 */

const NOMBRE = "demo";

function parseWebhook(body) {
  if (!body || !body.id) return null; // el pipeline lo tratará como "ignorado"

  const estado = String(body.estado || "confirmada").toLowerCase();
  return {
    provider: NOMBRE,
    externalId: String(body.id),
    date: body.fecha,
    time: body.hora,
    pax: Number(body.personas) || 2,
    customerName: body.cliente?.nombre || "Cliente",
    customerPhone: body.cliente?.telefono || "",
    notes: body.notas || "",
    status: estado.startsWith("cancel") ? "cancelled" : "confirmed",
  };
}

/**
 * El demo funciona por webhook, no por sondeo. Se declara igualmente para que
 * el pipeline pueda tratar a todos los conectores por igual.
 */
async function fetchSince() {
  return [];
}

module.exports = {
  nombre: NOMBRE,
  etiqueta: "Demo (pruebas)",
  authMode: "query", // el secreto viaja en ?secret=
  successStatus: 200,
  parseWebhook,
  fetchSince,
};
