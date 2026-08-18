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
const registry = require("./restaurantes");

const T_RESERVAS = "reservas";
const T_MESAS = "mesas";
const T_CLIENTES = "clientes";
const T_HISTORIAL = "historial_reservas";

// Último recurso si el restaurante no se puede leer. Dos horas es lo que ya
// usaba el panel por defecto, así que no cambia el comportamiento de nadie.
const DURACION_DEFECTO = 120;

/**
 * Cuánto se supone que ocupa una mesa en este local.
 *
 * Se busca aquí dentro y no se pide por parámetro a propósito: hay cuatro
 * caminos que crean reservas (panel, voz, WhatsApp, plataformas externas) y
 * basta con que uno se olvide de pasarla para que sus reservas dejen de contar
 * en el cálculo de solapes, en silencio. El directorio ya va cacheado un minuto.
 */
async function duracionDe(ctx) {
  try {
    const local = await registry.porSlug(ctx.restaurante);
    return local?.duracionReservaMin || DURACION_DEFECTO;
  } catch (err) {
    console.error("[repo] no se pudo leer la duración del local:", err.message);
    return DURACION_DEFECTO;
  }
}

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
 * ¿Se pisan dos tramos de tiempo? [aIni, aFin) contra [bIni, bFin).
 *
 * El final va EXCLUIDO a propósito: una reserva que termina a las 19:00 y otra
 * que empieza a las 19:00 no chocan, la mesa se acaba de levantar. Con el final
 * incluido no se podría encadenar un pase detrás de otro, que es justo lo que un
 * restaurante quiere hacer en hora punta.
 */
function seSolapan(aIni, aFin, bIni, bFin) {
  return aIni < bFin && bIni < aFin;
}

/** Las que ocupan mesa de verdad. Anuladas y terminadas ya no estorban. */
function ocupaMesa(fila) {
  return fila.status === "confirmed" || fila.status === "seated";
}

/**
 * Tramos ocupados de un día, mesa por mesa.
 *
 * Una reserva no es un instante sino un tramo: las 17:00 con dos horas ocupan
 * hasta las 19:00. Antes esto se comparaba por hora de inicio exacta, así que
 * una reserva a las 18:00 se colaba encima de la de las 17:00 sin que nadie
 * dijera nada.
 *
 * `duracionDefecto` es la del restaurante: las reservas que entran por teléfono
 * no traen duración propia, y sin este respaldo no participarían en el cálculo.
 */
async function tramosOcupados(ctx, { fecha, duracionDefecto, excluirId = null }) {
  const filas = await db.listar(ctx, T_RESERVAS, { filtros: { fecha } });
  return filas
    .filter(ocupaMesa)
    .filter((r) => r.mesa_id != null)
    .filter((r) => String(r.id) !== String(excluirId))
    .map((r) => {
      const ini = aMinutos(r.hora);
      return {
        mesaId: String(r.mesa_id),
        nombre: r.nombre || "",
        ini,
        fin: ini + (Number(r.duracion_min) || duracionDefecto),
      };
    });
}

/**
 * Primera mesa libre con capacidad suficiente durante todo el tramo.
 *
 * `excluirId` sirve al modificar una reserva: su propio tramo no debe contarse
 * como ocupado, o cambiar solo el número de personas sin mover la hora fallaría
 * siempre por chocar la reserva consigo misma.
 */
async function buscarMesaLibre(ctx, { fecha, hora, personas, duracion, excluirId = null }) {
  // La duración de ESTA reserva y la que se supone a las que ya están son dos
  // cosas distintas: que alguien pida una mesa cuatro horas no alarga las
  // reservas ajenas que no declararon la suya.
  const duracionDefecto = await duracionDe(ctx);
  const ini = aMinutos(hora);
  const fin = ini + (Number(duracion) || duracionDefecto);

  const [mesas, tramos] = await Promise.all([
    db.listar(ctx, T_MESAS, { orden: "capacidad.asc" }),
    tramosOcupados(ctx, { fecha, duracionDefecto, excluirId }),
  ]);

  const enUso = new Set(
    tramos.filter((t) => seSolapan(ini, fin, t.ini, t.fin)).map((t) => t.mesaId)
  );

  // La más pequeña que sirva: sentar a dos personas en la mesa de ocho deja el
  // servicio sin sitio para un grupo grande que llame media hora más tarde.
  return (
    mesas.find((m) => m.capacidad >= personas && m.estado !== "Fuera de servicio" && !enUso.has(String(m.id))) ||
    null
  );
}

/**
 * ¿Está libre ESTA mesa concreta durante todo el tramo?
 *
 * Es lo que hace falta cuando la mesa la elige una persona en el panel: ahí no
 * se busca "alguna libre", se pregunta por la que ha señalado con el dedo.
 *
 * Devuelve { libre, choca? } — el nombre de quien la ocupa sirve para decirle a
 * quien está delante con quién está chocando, no solo que no puede.
 */
async function mesaLibre(ctx, { fecha, hora, duracion, mesaId, excluirId = null }) {
  const duracionDefecto = await duracionDe(ctx);
  const ini = aMinutos(hora);
  const fin = ini + (Number(duracion) || duracionDefecto);

  const tramos = await tramosOcupados(ctx, { fecha, duracionDefecto, excluirId });
  const choque = tramos.find(
    (t) => t.mesaId === String(mesaId) && seSolapan(ini, fin, t.ini, t.fin)
  );

  return { libre: !choque, choca: choque ? choque.nombre : null };
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
    // Mesa señalada a dedo desde el panel. Sin ella se busca la primera libre,
    // que es lo que necesitan la voz y WhatsApp.
    mesaId = null,
    // Duración propia de esta reserva. `null` = hereda la del local, y sigue
    // heredándola si el local la cambia mañana.
    duracionMin = null,
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

  // 3. Mesa. Si viene señalada, se comprueba ESA; si no, se busca cualquiera.
  let mesa = null;
  if (mesaId) {
    const { libre, choca } = await mesaLibre(ctx, { fecha, hora, duracion: duracionMin, mesaId });
    if (!libre) return { creada: false, motivo: "mesa_ocupada", choca };
    mesa = await db.obtener(ctx, T_MESAS, mesaId);
    // Una mesa de otro restaurante no existe para este: no se cae al reparto
    // automático, porque eso guardaría la reserva en un sitio que nadie pidió.
    if (!mesa) return { creada: false, motivo: "mesa_no_encontrada" };
  } else {
    mesa = await buscarMesaLibre(ctx, { fecha, hora, personas, duracion: duracionMin });
    if (!mesa && !externalId) {
      return { creada: false, motivo: "sin_mesa" };
    }
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
    duracion_min: duracionMin || null,
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
async function modificarReserva(ctx, { codigo, nuevaFecha, nuevaHora, nuevasPersonas, nuevaMesaId, nuevaDuracion, canal = "panel" }) {
  const actual = await lectura.reservaPorCodigo(ctx, codigo);
  if (!actual) return { modificada: false, motivo: "no_encontrada" };

  const fecha = nuevaFecha || actual.date;
  const hora = nuevaHora || actual.time;
  const personas = Number(nuevasPersonas) || actual.party_size;
  const duracion = nuevaDuracion || actual.duration_min || null;

  if (
    fecha === actual.date && hora === actual.time && personas === actual.party_size &&
    !nuevaMesaId && !nuevaDuracion
  ) {
    return { modificada: false, motivo: "sin_cambios", reserva: actual };
  }

  const apertura = await horario.comprobar(ctx, fecha, hora);
  if (!apertura.abierto) {
    return { modificada: false, motivo: "fuera_de_horario", horario: apertura, reserva: actual };
  }

  let mesa = null;
  if (nuevaMesaId) {
    const { libre, choca } = await mesaLibre(ctx, {
      fecha, hora, duracion, mesaId: nuevaMesaId, excluirId: actual.id,
    });
    if (!libre) return { modificada: false, motivo: "mesa_ocupada", choca, reserva: actual };
    mesa = await db.obtener(ctx, T_MESAS, nuevaMesaId);
    if (!mesa) return { modificada: false, motivo: "mesa_no_encontrada", reserva: actual };
  } else {
    mesa = await buscarMesaLibre(ctx, { fecha, hora, personas, duracion, excluirId: actual.id });
    if (!mesa) {
      // La original se queda como estaba: es mejor que el cliente conserve su
      // reserva a que la pierda por un cambio que no se pudo hacer.
      return { modificada: false, motivo: "sin_mesa", reserva: actual };
    }
  }

  const fila = await db.actualizar(ctx, T_RESERVAS, actual.id, {
    fecha, hora, personas,
    turno: apertura.turno || actual.shift,
    mesa_id: mesa.id,
    // Solo si se pidió cambiarla: si no, se deja como estaba (incluido el `null`
    // que significa "la que diga el local").
    ...(nuevaDuracion ? { duracion_min: nuevaDuracion } : {}),
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
  mesaLibre,
  duracionDe,
  registrarHistorial,
  _internos: { generarCodigo, aMinutos, buscarDuplicada, seSolapan, tramosOcupados },
};
