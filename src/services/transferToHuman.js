/**
 * Notifica al staff del restaurante por WhatsApp cuando un agente (voz o
 * WhatsApp) necesita transferir la conversación a un humano.
 *
 * Multi-tenant: usa las credenciales de Twilio y el número del encargado DEL
 * RESTAURANTE que atiende la conversación (configurados en su pestaña
 * Configuración); si el local no tiene las suyas, cae en las centrales del
 * entorno. Sin credenciales, solo loguea (comportamiento del sandbox).
 */

const twilio = require("twilio");
const registry = require("./registry");

async function notifyStaff({ reason, customer_phone, channel, restaurant }) {
  const nombre = (restaurant && restaurant.nombre) || "el restaurante";
  const message =
    `🔔 Transferencia a humano solicitada (${nombre})\n` +
    `Canal: ${channel}\n` +
    `Motivo: ${reason}\n` +
    (customer_phone ? `Cliente: ${customer_phone}` : "Cliente: no identificado");

  const creds = registry.twilioCredentials(restaurant);
  const staffNumber =
    (restaurant && restaurant.staffWhatsApp) || process.env.STAFF_WHATSAPP_NUMBER;

  if (!creds || !staffNumber) {
    console.warn(
      "[transferToHuman] Twilio/staff no configurado para este restaurante, solo logueando:\n",
      message
    );
    return { notified: false, reason: "twilio_not_configured" };
  }

  const client = twilio(creds.accountSid, creds.authToken);
  await client.messages.create({
    from: creds.from,
    to: staffNumber.startsWith("whatsapp:") ? staffNumber : `whatsapp:${staffNumber}`,
    body: message,
  });

  return { notified: true };
}

module.exports = { notifyStaff };
