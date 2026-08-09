/**
 * Ejecuta las herramientas que pide el agente durante una llamada, sobre
 * Supabase.
 *
 * Sustituye a `toolDispatcher.js`, que trabajaba contra Airtable. Además de
 * cambiar de base, asume aquí tres cosas que hasta ahora solo hacían los flujos
 * de n8n y que se pierden si el agente pasa a hablar directamente con la app:
 * resolver las fechas dichas en voz alta, respetar el horario de apertura y
 * pasar los grupos grandes al equipo.
 *
 * Cada herramienta devuelve además un `mensaje` en castellano. El agente puede
 * decirlo tal cual, y así la forma de contar un "no" no depende de que el
 * modelo improvise bien ese día.
 */

const escribir = require("./repo/escribir");
const lectura = require("./repo/reservas");
const fecha = require("./fechaHablada");
const horario = require("./horario");
const notificaciones = require("./notificaciones");
const { notifyStaff } = require("./transferToHuman");

// Por encima de esto, la reserva deja de ser una mesa y pasa a ser un evento:
// hay que hablar de menú cerrado, anticipo y montaje de sala.
const GRUPO_GRANDE = 10;

/**
 * Normaliza lo que llega de la llamada. El agente manda lo que entendió, no
 * necesariamente una fecha: "mañana", "el viernes", "el próximo sábado".
 */
function interpretarFecha(valor, local) {
  const zona = local?.zonaHoraria || "Europe/Madrid";
  const resuelta = fecha.resolver(valor, { zona });
  if (!resuelta) {
    return {
      ok: false,
      // El código lo mira el guion del agente para distinguir "no te he
      // entendido" de "ha fallado el sistema": lo primero se resuelve
      // preguntando otra vez, lo segundo pasando la llamada al equipo.
      codigo: "FECHA_AMBIGUA",
      mensaje: "No he terminado de entender qué día me dices. ¿Me confirmas la fecha?",
    };
  }
  if (fecha.esPasada(resuelta, { zona })) {
    return { ok: false, codigo: "FECHA_PASADA", mensaje: "Ese día ya ha pasado. ¿Te busco hueco para otro?" };
  }
  return { ok: true, fecha: resuelta, hablada: fecha.enVozAlta(resuelta, { zona }) };
}

function comprobarGrupo(personas) {
  const n = Number(personas);
  if (!n || n <= 0) return { ok: false, codigo: "PERSONAS_NO_VALIDAS", mensaje: "¿Para cuántas personas sería?" };
  if (n > GRUPO_GRANDE) {
    return {
      ok: false,
      grupoGrande: true,
      codigo: "GRUPO_GRANDE",
      mensaje: `Para grupos de más de ${GRUPO_GRANDE} personas te paso con el equipo, que lo organizan ellos directamente.`,
    };
  }
  return { ok: true, personas: n };
}

async function checkAvailability(local, args) {
  const f = interpretarFecha(args.date, local);
  if (!f.ok) return { available: false, ...f };

  const g = comprobarGrupo(args.party_size);
  if (!g.ok) return { available: false, ...g };

  const apertura = await horario.comprobar(local.ctx, f.fecha, args.time);
  if (!apertura.abierto) {
    return { available: false, date: f.fecha, mensaje: horario.explicar(apertura) };
  }

  const mesa = await escribir.buscarMesaLibre(local.ctx, {
    fecha: f.fecha, hora: args.time, personas: g.personas,
  });

  return {
    available: Boolean(mesa),
    date: f.fecha,
    fecha_hablada: f.hablada,
    time: args.time,
    party_size: g.personas,
    turno: apertura.turno,
    mensaje: mesa
      ? `Sí, tenemos mesa el ${f.hablada} a las ${args.time} para ${g.personas} personas.`
      : `A esa hora lo tenemos completo. ¿Miro otro horario o el día siguiente?`,
  };
}

async function createReservation(local, args, contexto) {
  const f = interpretarFecha(args.date, local);
  if (!f.ok) return { created: false, ...f };

  const g = comprobarGrupo(args.party_size);
  if (!g.ok) {
    // Un grupo grande no es un error: es una llamada que debe atender una
    // persona. Se avisa al equipo en el momento.
    if (g.grupoGrande) {
      await notifyStaff({
        reason: `Grupo de ${args.party_size} personas para el ${f.fecha}`,
        customer_phone: args.customer_phone || contexto.customer_phone,
        channel: contexto.channel,
        restaurant: local,
      }).catch((err) => console.error("[agente] no se pudo avisar al equipo:", err.message));
    }
    return { created: false, ...g };
  }

  const r = await escribir.crearReserva(local.ctx, {
    fecha: f.fecha,
    hora: args.time,
    personas: g.personas,
    nombre: args.customer_name,
    telefono: args.customer_phone || contexto.customer_phone || "",
    notas: args.notes || "",
    canal: contexto.channel || "voz",
    lopd: args.lopd === true,
  });

  if (!r.creada) {
    const mensajes = {
      fuera_de_horario: horario.explicar(r.horario || {}),
      sin_mesa: "A esa hora lo tenemos completo. ¿Miro otro horario?",
      duplicada: r.reserva
        ? `Ya tienes una reserva ese día a las ${r.reserva.time} para ${r.reserva.party_size} personas. ¿Quieres cambiarla?`
        : "Ya tienes una reserva para ese día.",
      datos_incompletos: "Me falta algún dato para cerrar la reserva.",
    };
    return { created: false, reason: r.motivo, reserva: r.reserva, mensaje: mensajes[r.motivo] || "No he podido cerrar la reserva." };
  }

  // El aviso va después de tener la reserva guardada, y no puede tumbarla.
  notificaciones.reservaCreada(r.reserva, { lopd: args.lopd === true }).catch(() => {});

  return {
    created: true,
    ...r.reserva,
    table: r.mesa,
    fecha_hablada: f.hablada,
    mensaje:
      `Perfecto, reserva confirmada para el ${f.hablada} a las ${args.time}, ` +
      `mesa para ${g.personas} personas a nombre de ${args.customer_name}. ` +
      `Tu código es ${r.reserva.code}: apúntalo por si quieres cambiarla o anularla.`,
  };
}

async function modifyReservation(local, args, contexto) {
  let nuevaFecha;
  if (args.new_date) {
    const f = interpretarFecha(args.new_date, local);
    if (!f.ok) return { modified: false, ...f };
    nuevaFecha = f.fecha;
  }

  if (args.new_party_size) {
    const g = comprobarGrupo(args.new_party_size);
    if (!g.ok) return { modified: false, ...g };
  }

  const r = await escribir.modificarReserva(local.ctx, {
    codigo: args.code,
    nuevaFecha,
    nuevaHora: args.new_time,
    nuevasPersonas: args.new_party_size,
    canal: contexto.channel || "voz",
  });

  if (!r.modificada) {
    const mensajes = {
      no_encontrada: "No encuentro ninguna reserva activa con ese código. ¿Me lo repites?",
      sin_cambios: "Esa reserva ya está así, no he cambiado nada.",
      sin_mesa: "No me queda mesa para ese horario. Tu reserva original sigue en pie, ¿miramos otra hora?",
      fuera_de_horario: horario.explicar(r.horario || {}),
    };
    return { modified: false, reason: r.motivo, mensaje: mensajes[r.motivo] || "No he podido cambiar la reserva." };
  }

  notificaciones.reservaModificada(r.antes, r.reserva).catch(() => {});

  const hablada = fecha.enVozAlta(r.reserva.date, { zona: local.zonaHoraria });
  return {
    modified: true,
    ...r.reserva,
    table: r.mesa,
    mensaje:
      `Hecho, tu reserva queda para el ${hablada} a las ${r.reserva.time}, ` +
      `mesa para ${r.reserva.party_size} personas. El código sigue siendo el mismo.`,
  };
}

async function cancelReservation(local, args, contexto) {
  const r = await escribir.cancelarReserva(local.ctx, {
    codigo: args.code,
    canal: contexto.channel || "voz",
  });

  if (!r.cancelada) {
    const mensajes = {
      no_encontrada: "No encuentro ninguna reserva activa con ese código. ¿Me lo confirmas?",
      ya_cancelada: "Esa reserva ya estaba anulada.",
    };
    return { cancelled: false, reason: r.motivo, mensaje: mensajes[r.motivo] || "No he podido anularla." };
  }

  notificaciones.reservaCancelada(r.reserva).catch(() => {});

  return {
    cancelled: true,
    reservation: r.reserva,
    mensaje: `Listo, he anulado tu reserva del ${r.reserva.date} a las ${r.reserva.time}. Esperamos verte pronto.`,
  };
}

async function findReservation(local, args, contexto) {
  const telefono = args.customer_phone || contexto.customer_phone;

  if (args.code) {
    const r = await lectura.reservaPorCodigo(local.ctx, args.code);
    if (!r) return { found: false, mensaje: "No encuentro ninguna reserva con ese código." };
    return { found: true, reservation: r, mensaje: `Tienes reserva el ${r.date} a las ${r.time} para ${r.party_size} personas.` };
  }

  const nombre = args.customer_name || args.name;
  if (!telefono && !nombre) {
    return { found: false, mensaje: "¿Me das tu teléfono o el código de la reserva?" };
  }

  const futuras = await lectura.reservasDesde(local.ctx);
  const phone = require("./phone");
  const activas = futuras.filter((r) => r.status === "confirmada");

  // El teléfono manda: es el dato que identifica sin ambigüedad. El nombre es
  // el respaldo para cuando la reserva se hizo desde otro número o a nombre de
  // otra persona, que es justo cuando el cliente se queda sin salida.
  let suyas = [];
  if (telefono) {
    const clave = phone.digitsKey(telefono);
    suyas = activas.filter((r) => phone.digitsKey(r.customer_phone) === clave);
  }
  if (suyas.length === 0 && nombre) {
    const buscado = sinAcentos(nombre).trim();
    suyas = activas.filter((r) => sinAcentos(r.customer_name).includes(buscado));
  }

  if (suyas.length === 0) {
    return { found: false, mensaje: "No encuentro ninguna reserva a tu nombre para los próximos días." };
  }

  const p = suyas[0];
  return {
    found: true,
    reservation: p,
    reservations: suyas,
    mensaje:
      suyas.length === 1
        ? `Tienes reserva el ${p.date} a las ${p.time} para ${p.party_size} personas. Tu código es ${p.code}.`
        : `Tienes ${suyas.length} reservas. La más próxima es el ${p.date} a las ${p.time}.`,
  };
}

/** Normaliza para comparar sin acentos ni mayúsculas. */
function sinAcentos(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

async function getMenuInfo(local, args) {
  const platos = await lectura.carta(local.ctx);
  let resultado = platos;

  if (args.category) {
    const t = sinAcentos(args.category);
    resultado = resultado.filter((p) => sinAcentos(p.category).includes(t));
  }
  if (args.dish_name) {
    const t = sinAcentos(args.dish_name);
    resultado = resultado.filter((p) => sinAcentos(p.name).includes(t));
  }
  if (args.exclude_allergen) {
    const t = sinAcentos(args.exclude_allergen);
    resultado = resultado.filter((p) => !p.allergens.some((a) => sinAcentos(a).includes(t)));
  }

  return {
    platos: resultado,
    total: resultado.length,
    nota_alergenos:
      "Ante una alergia grave, recomienda siempre confirmarlo con el personal de sala antes de pedir.",
  };
}

async function getCustomerMemory(local, args, contexto) {
  const telefono = args.customer_phone || contexto.customer_phone;
  const cliente = await lectura.clientePorTelefono(local.ctx, telefono);
  return { customer: cliente || null };
}

/**
 * Punto único de entrada. `local` es el restaurante ya resuelto: quien llama
 * aquí es responsable de haberlo identificado, porque sin él no se sabe en qué
 * base de qué restaurante escribir.
 */
async function ejecutar(nombre, args = {}, contexto = {}) {
  const local = contexto.restaurante;
  if (!local || !local.ctx) {
    console.error(`[agente] ${nombre} sin restaurante identificado`);
    return { error: "restaurante_no_identificado" };
  }

  switch (nombre) {
    case "check_availability":  return checkAvailability(local, args);
    case "create_reservation":  return createReservation(local, args, contexto);
    case "modify_reservation":  return modifyReservation(local, args, contexto);
    case "cancel_reservation":  return cancelReservation(local, args, contexto);
    case "find_reservation":    return findReservation(local, args, contexto);
    case "get_menu_info":       return getMenuInfo(local, args);
    case "get_customer_memory": return getCustomerMemory(local, args, contexto);
    case "transfer_to_human":
      return notifyStaff({
        reason: args.reason,
        customer_phone: args.customer_phone || contexto.customer_phone,
        channel: args.channel || contexto.channel,
        restaurant: local,
      });
    default:
      return { error: `Herramienta desconocida: ${nombre}` };
  }
}

module.exports = { ejecutar, GRUPO_GRANDE, _internos: { interpretarFecha, comprobarGrupo } };
