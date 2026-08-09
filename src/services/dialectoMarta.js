/**
 * Traductor entre el agente de voz "Marta" y las herramientas de la app.
 *
 * Marta es el agente que ya atiende el teléfono del restaurante, con un guion
 * escrito y afinado durante meses. Sus herramientas se llaman de otra manera
 * que las nuestras (`saveReservation` en vez de `create_reservation`, `fecha`
 * en vez de `date`) porque nacieron apuntando a los flujos de n8n.
 *
 * Este módulo existe para no tener que elegir entre las dos cosas: el guion se
 * queda **exactamente como está** —es el que funciona con los clientes— y la
 * app se adapta a su vocabulario. Traducir nombres y campos aquí cuesta un
 * fichero; reescribir el guion cuesta la confianza de que sigue sonando igual.
 *
 * La traducción va en los dos sentidos:
 *  - de lo que pide Marta a lo que entiende `agente.js`
 *  - de lo que responde `agente.js` a los campos que su guion espera leer
 *    (`disponible`, `fecha_hablada`, `cliente_conocido`, `codigo`...)
 */

const agente = require("./agente");
const lectura = require("./repo/reservas");
const db = require("./supabaseClient");
const fechaHablada = require("./fechaHablada");

/** Nombres que usa el guion de Marta. Sirve para saber si hay que traducir. */
const HERRAMIENTAS = new Set([
  "checkAvailability",
  "saveReservation",
  "modifyReservation",
  "cancelReservation",
  "findReservation",
  "buscar_contexto_cliente",
  "get_whatsapp_context",
]);

function esDeMarta(nombre) {
  return HERRAMIENTAS.has(nombre);
}

/**
 * Quita el código de reserva de un mensaje hablado.
 *
 * El guion de Marta prohíbe expresamente decir el id_reserva en voz alta, pero
 * nuestros mensajes lo incluyen porque el agente anterior sí lo dictaba. Se
 * recorta aquí en vez de cambiar el mensaje original, que sigue siendo el
 * correcto para los canales donde el código sí se comunica (WhatsApp, panel).
 */
function sinCodigo(mensaje) {
  return String(mensaje || "")
    .replace(/\s*Tu código es [A-Z0-9-]+:?[^.]*\./i, "")
    .trim();
}

// ---------- Traducción de cada herramienta ----------

async function checkAvailability(args, contexto) {
  const r = await agente.ejecutar(
    "check_availability",
    { date: args.fecha, time: args.hora, party_size: args.personas },
    contexto
  );
  return {
    disponible: r.available === true,
    fecha_hablada: r.fecha_hablada,
    hora: r.time,
    personas: r.party_size,
    turno: r.turno,
    codigo: r.codigo,
    mensaje: r.mensaje,
  };
}

async function saveReservation(args, contexto) {
  const r = await agente.ejecutar(
    "create_reservation",
    {
      customer_name: args.nombre,
      date: args.fecha,
      time: args.hora,
      party_size: args.personas,
      notes: args.notas || "",
      lopd: args.lopd_acepta === true,
      // Por defecto es el número desde el que llama; solo se usa otro si el
      // cliente lo pidió expresamente.
      customer_phone: args.telefono_alternativo || contexto.customer_phone,
    },
    contexto
  );

  if (!r.created) {
    return { guardada: false, codigo: r.codigo || r.reason, mensaje: r.mensaje };
  }
  return {
    guardada: true,
    fecha_hablada: r.fecha_hablada,
    hora: r.time,
    personas: r.party_size,
    mesa: r.table,
    mensaje: sinCodigo(r.mensaje),
  };
}

async function modifyReservation(args, contexto) {
  const r = await agente.ejecutar(
    "modify_reservation",
    {
      code: args.id_reserva,
      new_date: args.nueva_fecha,
      new_time: args.nueva_hora,
      new_party_size: args.nuevas_personas,
    },
    contexto
  );

  if (!r.modified) {
    return { modificada: false, codigo: r.codigo || r.reason, mensaje: r.mensaje };
  }
  return {
    modificada: true,
    // El guion lee este campo concreto para decir la fecha nueva en voz alta.
    fecha_hablada_nueva: fechaHablada.enVozAlta(r.date),
    hora: r.time,
    personas: r.party_size,
    mensaje: r.mensaje,
  };
}

async function cancelReservation(args, contexto) {
  const r = await agente.ejecutar("cancel_reservation", { code: args.id_reserva }, contexto);
  return r.cancelled
    ? { cancelada: true, mensaje: r.mensaje }
    : { cancelada: false, codigo: r.codigo || r.reason, mensaje: r.mensaje };
}

/** Forma de una reserva tal y como la lee el guion de Marta. */
function aFormaMarta(r, zona) {
  return {
    id_reserva: r.code,
    fecha: r.date,
    fecha_hablada: fechaHablada.enVozAlta(r.date, { zona }),
    hora: r.time,
    personas: r.party_size,
    nombre: r.customer_name,
  };
}

async function findReservation(args, contexto) {
  const zona = contexto.restaurante?.zonaHoraria;
  const r = await agente.ejecutar(
    "find_reservation",
    { customer_name: args.nombre, customer_phone: contexto.customer_phone },
    contexto
  );

  if (!r.found) return { encontrada: false, reservas: [], mensaje: r.mensaje };

  const lista = (r.reservations || [r.reservation]).filter(Boolean);
  return {
    encontrada: true,
    total: lista.length,
    // El id_reserva viaja en los datos porque el guion lo necesita para
    // modificar o cancelar, pero fuera del mensaje: lo que va en `mensaje` es
    // lo que el agente puede leer en voz alta, y el código no se dice.
    reservas: lista.map((x) => aFormaMarta(x, zona)),
    mensaje: sinCodigo(r.mensaje),
  };
}

/**
 * Todo lo que conviene saber del cliente antes de la primera frase.
 *
 * El guion la llama en silencio nada más descolgar, así que reúne de una vez
 * lo que si no serían dos consultas: quién es y si ya tiene mesa reservada.
 * Nunca falla hacia arriba: si algo va mal, se responde "no le conozco" y la
 * llamada sigue su curso normal, que es preferible a cortarla.
 */
async function buscarContextoCliente(_args, contexto) {
  const local = contexto.restaurante;
  const zona = local?.zonaHoraria;
  const telefono = contexto.customer_phone;

  const vacio = { cliente_conocido: false, reserva_activa: false };
  if (!local?.ctx || !telefono) return vacio;

  try {
    const [cliente, futuras] = await Promise.all([
      lectura.clientePorTelefono(local.ctx, telefono),
      lectura.reservasDesde(local.ctx),
    ]);

    const phone = require("./phone");
    const clave = phone.digitsKey(telefono);
    const suya = futuras.find(
      (r) => r.status === "confirmada" && phone.digitsKey(r.customer_phone) === clave
    );

    return {
      cliente_conocido: Boolean(cliente),
      nombre: cliente?.name || "",
      visitas: cliente?.visits || 0,
      alergias_notas: (cliente?.allergens || []).join(", "),
      lopd_aceptado: cliente?.lopd === true,
      reserva_activa: Boolean(suya),
      ...(suya
        ? {
            id_reserva: suya.code,
            reserva_fecha: suya.date,
            reserva_fecha_hablada: fechaHablada.enVozAlta(suya.date, { zona }),
            reserva_hora: suya.time,
            reserva_personas: suya.party_size,
          }
        : {}),
    };
  } catch (err) {
    console.error("[dialectoMarta] buscar_contexto_cliente:", err.message);
    return vacio;
  }
}

/**
 * ¿Escribió este cliente por WhatsApp antes de llamar?
 *
 * El historial lo escribe n8n, con el teléfono como `session_id`. Aquí solo se
 * mira si existe conversación: el contenido no hace falta para decidir, y no
 * leerlo evita pasearlo por sitios donde no pinta nada.
 */
async function getWhatsappContext(_args, contexto) {
  const telefono = contexto.customer_phone;
  if (!telefono) return { hay_contexto: false };

  try {
    const clave = String(telefono).replace(/[^0-9]/g, "").slice(-9);
    const filas = await db.listar(
      { restaurante: null },
      "whatsapp_chat_historial",
      { filtros: { session_id: ["like", `*${clave}*`] }, limite: 1 }
    );
    return { hay_contexto: filas.length > 0 };
  } catch (err) {
    console.error("[dialectoMarta] get_whatsapp_context:", err.message);
    return { hay_contexto: false };
  }
}

/**
 * Ejecuta una herramienta con el vocabulario de Marta.
 *
 * `contexto` es el mismo que recibe `agente.ejecutar`: lleva el restaurante ya
 * resuelto y el teléfono de quien llama.
 */
async function ejecutar(nombre, args = {}, contexto = {}) {
  switch (nombre) {
    case "checkAvailability":       return checkAvailability(args, contexto);
    case "saveReservation":         return saveReservation(args, contexto);
    case "modifyReservation":       return modifyReservation(args, contexto);
    case "cancelReservation":       return cancelReservation(args, contexto);
    case "findReservation":         return findReservation(args, contexto);
    case "buscar_contexto_cliente": return buscarContextoCliente(args, contexto);
    case "get_whatsapp_context":    return getWhatsappContext(args, contexto);
    default:
      return { error: `Herramienta desconocida en el dialecto de Marta: ${nombre}` };
  }
}

module.exports = { ejecutar, esDeMarta, HERRAMIENTAS, _internos: { sinCodigo, aFormaMarta } };
