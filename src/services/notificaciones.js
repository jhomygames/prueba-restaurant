/**
 * Avisos al cliente por WhatsApp.
 *
 * El envío sigue en n8n, y con razón: allí está montado el buffer de mensajes,
 * el mutex por teléfono, las plantillas aprobadas de Twilio y el respaldo a SMS
 * si el WhatsApp no se entrega. Rehacer eso aquí sería semanas de trabajo para
 * acabar en el mismo sitio.
 *
 * Lo que cambia es QUIÉN los dispara. Hasta ahora los llamaba el workflow que
 * guardaba la reserva; cuando la app pasa a atender las llamadas, ese workflow
 * deja de ejecutarse y nadie avisaría al cliente. Este módulo ocupa ese hueco.
 *
 * Un aviso que no sale NUNCA debe tumbar la reserva: la reserva ya está hecha y
 * eso es lo que importa. Todos los fallos se registran y se tragan.
 */

const BASE_N8N = "https://lumosautomation.app.n8n.cloud/webhook";

const DESTINOS = {
  creada: `${BASE_N8N}/confirmacion-whatsapp`,
  cancelada: `${BASE_N8N}/notificacion-cancelacion`,
  modificada: `${BASE_N8N}/notificacion-modificacion`,
};

/** Twilio necesita el número en formato internacional; se guarda sin prefijo. */
function aE164(valor) {
  const solo = String(valor || "").replace(/[^\d+]/g, "");
  if (!solo) return "";
  if (solo.startsWith("+")) return solo;
  if (solo.startsWith("34") && solo.length === 11) return `+${solo}`;
  return `+34${solo}`;
}

async function enviar(tipo, datos) {
  const url = DESTINOS[tipo];
  if (!url) {
    console.error(`[notificaciones] tipo desconocido: ${tipo}`);
    return { enviado: false, motivo: "tipo_desconocido" };
  }

  // Sin teléfono no hay a quién avisar, y sin consentimiento no se debe.
  if (!datos.telefono) return { enviado: false, motivo: "sin_telefono" };
  if (datos.lopd === false) return { enviado: false, motivo: "sin_consentimiento" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...datos, telefono: aE164(datos.telefono) }),
    });
    if (!res.ok) {
      console.error(`[notificaciones] ${tipo} devolvió ${res.status}`);
      return { enviado: false, motivo: `http_${res.status}` };
    }
    return { enviado: true };
  } catch (err) {
    console.error(`[notificaciones] no se pudo avisar (${tipo}):`, err.message);
    return { enviado: false, motivo: "error_red" };
  }
}

/** Confirmación tras crear la reserva. */
function reservaCreada(reserva, { lopd = true } = {}) {
  return enviar("creada", {
    id_reserva: reserva.code,
    nombre: reserva.customer_name,
    telefono: reserva.customer_phone,
    fecha: reserva.date,
    hora: reserva.time,
    personas: reserva.party_size,
    lopd_acepta: lopd,
  });
}

function reservaCancelada(reserva) {
  return enviar("cancelada", {
    id_reserva: reserva.code,
    nombre: reserva.customer_name,
    telefono: reserva.customer_phone,
    fecha: reserva.date,
    hora: reserva.time,
    personas: reserva.party_size,
  });
}

/** El aviso de cambio incluye el antes y el después: es lo que da contexto. */
function reservaModificada(antes, despues) {
  return enviar("modificada", {
    id_reserva: despues.code,
    nombre: despues.customer_name,
    telefono: despues.customer_phone,
    fecha_anterior: antes.date,
    hora_anterior: antes.time,
    personas_anterior: antes.party_size,
    fecha_nueva: despues.date,
    hora_nueva: despues.time,
    personas_nueva: despues.party_size,
    turno_nuevo: despues.shift,
  });
}

module.exports = { reservaCreada, reservaCancelada, reservaModificada, enviar, _internos: { aE164, DESTINOS } };
