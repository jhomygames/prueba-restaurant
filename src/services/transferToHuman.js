/**
 * Notifica al staff del restaurante por WhatsApp cuando un agente (voz o
 * WhatsApp) necesita transferir la conversación a un humano.
 *
 * Requiere STAFF_WHATSAPP_NUMBER (formato whatsapp:+58...) y las credenciales
 * de Twilio en el entorno.
 */

const twilio = require("twilio");

function getTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function notifyStaff({ reason, customer_phone, channel }) {
  const client = getTwilioClient();
  const staffNumber = process.env.STAFF_WHATSAPP_NUMBER;
  const fromNumber = process.env.TWILIO_WHATSAPP_FROM;

  const message =
    `🔔 Transferencia a humano solicitada\n` +
    `Canal: ${channel}\n` +
    `Motivo: ${reason}\n` +
    (customer_phone ? `Cliente: ${customer_phone}` : "Cliente: no identificado");

  if (!client || !staffNumber || !fromNumber) {
    console.warn(
      "[transferToHuman] Twilio/staff no configurado todavía, solo logueando:\n",
      message
    );
    return { notified: false, reason: "twilio_not_configured" };
  }

  await client.messages.create({
    from: fromNumber,
    to: staffNumber,
    body: message,
  });

  return { notified: true };
}

module.exports = { notifyStaff };
