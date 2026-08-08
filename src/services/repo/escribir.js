/**
 * Escritura de reservas y clientes sobre Supabase.
 *
 * Aquí vive lo que hace que una reserva sea una reserva y no una fila: buscar
 * mesa libre, sacar los alérgenos del texto que dictó el cliente, generar el
 * código que se le lee en voz alta, y no crear dos reservas para la misma
 * persona en el mismo turno.
 *
 * Está en la app y no en los flujos de n8n a propósito: es la lógica que hay
 * que poder probar y cambiar en un solo sitio, y que debe comportarse igual
 * venga la reserva del teléfono, de WhatsApp o del panel.
 */

const db = require("../supabaseClient");
const lectura = require("./reservas");
const allergens = require("../allergens");
const horario = require("../horario");
const phone = require("../phone");

const T_RESERVAS = "reservas";
const T_MESAS = "mesas";
const T_CLIENTES = "clientes";
const T_HISTORIAL = "historial_reservas";

/** "RES-123456-789". Es lo que el cliente apunta y luego dice por teléfono. */
function generarCodigo() {
  const t = Date.now().toString().slice(-6);
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `RES-${t}-${r}`;
}

function aMinutos(hora) {
  const m = String(hora || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Primera mesa libre con capacidad suficiente a esa hora.
 *
 * `excluirId` sirve al modificar una reserva: su propia mesa no debe contarse
 * como ocupada, o cambiar solo el número de personas sin mover la hora fallaría
 * siempre por chocar la reserva consigo misma.
 */
async function buscarMesaLibre(ctx, { fecha, hora, personas, excluirId = null }) {
  const [mesas, ocupadas] = await Promise.all([
    db.listar(ctx, T_MESAS, { orden: "capacidad.asc" }),
    db.listar(ctx, T_RESERVAS, { filtros: { fecha, status: "confirmed" } }),
  ]);

  const enUso = new Set(
    ocupadas
      .filter((r) => String(r.id) !== String(excluirId))
      // Solo estorban las reservas de esa misma hora: la mesa se libera después.
      .filter((r) => aMinutos(r.hora) === aMinutos(hora))
      .map((r) => String(r.mesa_id))
  );

  // La más pequeña que sirva: sentar a dos personas en la mesa de ocho deja el
  // servicio sin sitio para un grupo grande que llame media hora más tarde.
  return (
    mesas.find((m) => m.capacidad >= personas && m.estado !== "Fuera de servicio" && !enUso.has(String(m.id))) ||
    null
  );
}

/** Reserva activa del mismo cliente ese día y turno, si la hay. */
async function buscarDuplicada(ctx, { telefono, fecha, turno }) {
  if (!telefono) return null;
  const clave = phone.digitsKey(telefono);
  const delDia = await db.listar(ctx, T_RESERVAS, {
    filtros: { fecha, status: "confirmed" },
  });
  return (
    delDia.find(
      (r) =>
        phone.digitsKey(r.telefono) === clave &&
        (r.turno || "") === turno
    ) || null
  );
}

async function registrarHistorial(ctx, { codigo, accion, canal, antes, despues }) {
  try {
    await db.crear(ctx, T_HISTORIAL, {
      reserva_id: codigo || "",
      accion,
      canal: canal || "panel",
      datos_anteriores: antes || null,
      datos_nuevos: despues || null,
    });
  } catch (err) {
    // Una reserva sin traza es un problema menor; una reserva que no se guarda
    // porque falló la traza sería grave.
    console.error(`[repo] no se pudo registrar "${accion}":`, err.message);
  }
}

/**
 * Crea una reserva.
 *
 * Devuelve { creada, motivo?, reserva?, mesa? }. Los motivos por los que puede
 * no crearse son deliberadamente distintos, porque el agente dice cosas muy
 * diferentes en cada caso: cerrado, sin mesa, o ya tiene una.
 */
async function crearReserva(ctx, datos) {
  const {
    fecha, hora, personas, nombre, telefono = "",
    notas = "", canal = "panel", codigo = "", lopd = false, externalId = null,
  } = datos;

  if (!fecha || !hora || !personas || !nombre) {
    return { creada: false, motivo: "datos_incompletos" };
  }

  // 1. ¿Abre el restaurante a esa hora?
  const apertura = await horario.comprobar(ctx, fecha, hora);
  if (!apertura.abierto) {
    return { creada: false, motivo: "fuera_de_horario", horario: apertura };
  }
  const turno = apertura.turno || (aMinutos(hora) < 17 * 60 ? "comida" : "cena");

  // 2. ¿Ya tiene reserva ese turno? Las que vienen de una plataforma externa se
  //    saltan la comprobación: ya vienen deduplicadas por su propio id.
  if (!externalId) {
    const duplicada = await buscarDuplicada(ctx, { telefono, fecha, turno });
    if (duplicada) {
      return { creada: false, motivo: "duplicada", reserva: lectura._formas.aReserva(duplicada) };
    }
  }

  // 3. Mesa
  const mesa = await buscarMesaLibre(ctx, { fecha, hora, personas });
  if (!mesa && !externalId) {
    return { creada: false, motivo: "sin_mesa" };
  }

  const codigoFinal = codigo || generarCodigo();
  const extraidos = allergens.extraer(notas);

  const fila = await db.crear(ctx, T_RESERVAS, {
    id_reserva: codigoFinal,
    fecha,
    hora,
    turno,
    personas,
    nombre,
    telefono,
    notas,
    status: "confirmed",
    canal,
    origen: canal,
    lopd_acepta: Boolean(lopd),
    // Sin mesa NO se rechaza cuando viene de fuera: la plataforma ya se la
    // vendió al cliente, y dejarla sin asignar es mejor que perderla.
    mesa_id: mesa ? mesa.id : null,
    alergias: extraidos.alergenos,
    external_id: externalId,
  });

  if (telefono) {
    await upsertCliente(ctx, { telefono, nombre, lopd, alergenos: extraidos.alergenos })
      .catch((err) => console.error("[repo] error guardando cliente:", err.message));
  }

  await registrarHistorial(ctx, {
    codigo: codigoFinal, accion: "created", canal,
    despues: { fecha, hora, personas, nombre, mesa: mesa ? mesa.nombre : null },
  });

  return {
    creada: true,
    reserva: lectura._formas.aReserva(fila),
    mesa: mesa ? mesa.nombre : null,
    sinMesa: !mesa,
  };
}

/** Cambia fecha, hora o personas. La reserva solo se toca si hay dónde ponerla. */
async function modificarReserva(ctx, { codigo, nuevaFecha, nuevaHora, nuevasPersonas, canal = "panel" }) {
  const actual = await lectura.reservaPorCodigo(ctx, codigo);
  if (!actual) return { modificada: false, motivo: "no_encontrada" };

  const fecha = nuevaFecha || actual.date;
  const hora = nuevaHora || actual.time;
  const personas = Number(nuevasPersonas) || actual.party_size;

  if (fecha === actual.date && hora === actual.time && personas === actual.party_size) {
    return { modificada: false, motivo: "sin_cambios", reserva: actual };
  }

  const apertura = await horario.comprobar(ctx, fecha, hora);
  if (!apertura.abierto) {
    return { modificada: false, motivo: "fuera_de_horario", horario: apertura, reserva: actual };
  }

  const mesa = await buscarMesaLibre(ctx, { fecha, hora, personas, excluirId: actual.id });
  if (!mesa) {
    // La original se queda como estaba: es mejor que el cliente conserve su
    // reserva a que la pierda por un cambio que no se pudo hacer.
    return { modificada: false, motivo: "sin_mesa", reserva: actual };
  }

  const fila = await db.actualizar(ctx, T_RESERVAS, actual.id, {
    fecha, hora, personas,
    turno: apertura.turno || actual.shift,
    mesa_id: mesa.id,
  });

  await registrarHistorial(ctx, {
    codigo, accion: "modified", canal,
    antes: { fecha: actual.date, hora: actual.time, personas: actual.party_size },
    despues: { fecha, hora, personas },
  });

  return { modificada: true, antes: actual, reserva: lectura._formas.aReserva(fila), mesa: mesa.nombre };
}

async function cancelarReserva(ctx, { codigo, canal = "panel" }) {
  const actual = await lectura.reservaPorCodigo(ctx, codigo);
  if (!actual) return { cancelada: false, motivo: "no_encontrada" };
  if (actual.status === "cancelada") {
    return { cancelada: false, motivo: "ya_cancelada", reserva: actual };
  }

  const fila = await db.actualizar(ctx, T_RESERVAS, actual.id, { status: "cancelled" });
  await registrarHistorial(ctx, {
    codigo, accion: "cancelled", canal,
    antes: { status: "confirmed" }, despues: { status: "cancelled" },
  });
  return { cancelada: true, reserva: lectura._formas.aReserva(fila) };
}

/**
 * Crea o actualiza la ficha del cliente.
 *
 * Los alérgenos se acumulan en vez de sobrescribirse: que alguien no mencione
 * su alergia al pedir la segunda reserva no significa que se le haya pasado.
 */
async function upsertCliente(ctx, { telefono, nombre, lopd = false, alergenos = [] }) {
  if (!telefono) return null;

  const existente = await lectura.clientePorTelefono(ctx, telefono);
  const hoy = new Date().toISOString().slice(0, 10);

  if (!existente) {
    return db.crear(ctx, T_CLIENTES, {
      telefono, nombre,
      idioma_preferido: "es",
      visitas: 1,
      lopd_acepta: Boolean(lopd),
      alergenos_conocidos: alergenos,
      ultima_visita: hoy,
    });
  }

  const juntos = [...new Set([...(existente.allergens || []), ...alergenos])];
  return db.actualizar(ctx, T_CLIENTES, existente.id, {
    nombre: nombre || existente.name,
    visitas: (existente.visits || 0) + 1,
    ultima_visita: hoy,
    alergenos_conocidos: juntos,
    ...(lopd ? { lopd_acepta: true } : {}),
  });
}

module.exports = {
  crearReserva,
  modificarReserva,
  cancelarReserva,
  upsertCliente,
  buscarMesaLibre,
  registrarHistorial,
  _internos: { generarCodigo, aMinutos, buscarDuplicada },
};
