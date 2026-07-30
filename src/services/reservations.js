/**
 * Adaptador de reservas respaldado por Airtable (sandbox). Sustituye al
 * antiguo stub de Covermanager/TheFork: Airtable actúa como base de datos Y
 * como interfaz visual de mesas/reservas para el staff.
 *
 * Requiere las tablas descritas en `make-blueprints/README.md` /
 * `AIRTABLE_SCHEMA.md` dentro de la base referenciada por AIRTABLE_BASE_ID:
 *
 *   Mesas   { Nombre, Capacidad, Zona, Estado }
 *   Reservas{ FechaHora, Personas, ClienteNombre, ClienteTelefono, Mesa (link a Mesas),
 *             Estado (confirmada|cancelada|completada), Notas }
 *
 * `FechaHora` se guarda como texto "YYYY-MM-DD HH:mm" (no como campo Date de
 * Airtable) para evitar líos de zona horaria en el sandbox: al ser un formato
 * con ceros a la izquierda, la comparación lexicográfica de strings coincide
 * con el orden cronológico. TODO: si esto pasa a producción con reservas en
 * distintas zonas horarias, migrar a timestamps reales con zona explícita.
 */

const { listRecords, getRecord, createRecord, updateRecord, quote } = require("./airtableClient");
const allergens = require("./allergens");
const phone = require("./phone");

const TABLE_MESAS = "Mesas";
const TABLE_RESERVAS = "Reservas";

// A partir de esta hora, la reserva es de cena. Coincide con el corte real de
// los datos históricos (comidas 13:00-14:00, cenas 20:00-22:30).
const HORA_CORTE_CENA = 17;

function fechaHoraKey(date, time) {
  return `${date} ${time}`;
}

/**
 * Turno de servicio ("comida" | "cena") a partir de la hora.
 *
 * Es un concepto de negocio que el equipo usa para organizar la sala, y venía
 * en los datos de n8n como campo propio. Aquí se DERIVA de la hora en vez de
 * pedirlo, porque un turno que contradiga a su propia hora solo puede confundir.
 */
function derivarTurno(time) {
  const hora = Number(String(time || "").split(":")[0]);
  if (!Number.isFinite(hora)) return "";
  return hora < HORA_CORTE_CENA ? "comida" : "cena";
}

/**
 * Código legible de reserva, formato "RES-123456-789".
 *
 * Un identificador interno de Airtable ("recXXXXXXXX") no se puede dictar por
 * teléfono. Este sí: el agente de voz lo lee al confirmar y el cliente puede
 * usarlo luego para consultar o anular. Mismo formato que ya generaba n8n, para
 * que los códigos que los clientes tengan apuntados sigan siendo válidos.
 */
function generarCodigo() {
  const seis = String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const tres = String(Math.floor(Math.random() * 1e3)).padStart(3, "0");
  return `RES-${seis}-${tres}`;
}

function toReservationShape(record) {
  const f = record.fields;
  const [date, time] = (f.FechaHora || " ").split(" ");
  return {
    id: record.id,
    date,
    time,
    party_size: f.Personas,
    customer_name: f.ClienteNombre,
    customer_phone: f.ClienteTelefono,
    notes: f.Notas || "",
    status: f.Estado,
    table_id: (f.Mesa && f.Mesa[0]) || null,
    reminded_24h: Boolean(f.Recordatorio24h),
    reminded_1h: Boolean(f.Recordatorio1h),
    review_requested: Boolean(f.ResenaPedida),
    // De dónde vino la reserva. Las creadas antes de existir este campo no lo
    // tienen: se muestran como "panel" por ser lo más probable históricamente.
    source: f.Origen || "panel",
    external_id: f.ExternalId || null,
    code: f.CodigoReserva || null,
    shift: f.Turno || derivarTurno(time),
    allergens: f.Alergias || [],
    lopd: f.LopdAcepta === true,
  };
}

/**
 * `excluirReservaId` sirve al cambiar una reserva existente: su propia mesa no
 * debe contarse como ocupada, o cambiar solo el número de personas sin mover la
 * hora fallaría siempre por chocar consigo misma.
 */
async function findAvailableTable(ctx, date, time, party_size, excluirReservaId = null) {
  const targetFH = fechaHoraKey(date, time);

  const [mesas, reservasEnEseHorario] = await Promise.all([
    listRecords(ctx.baseId, TABLE_MESAS, {
      filterByFormula: `AND({Capacidad} >= ${Number(party_size)}, {Estado} != 'Fuera de servicio')`,
    }),
    listRecords(ctx.baseId, TABLE_RESERVAS, {
      filterByFormula: `AND({FechaHora} = ${quote(targetFH)}, {Estado} = 'confirmada')`,
    }),
  ]);

  const mesaIdsOcupadas = new Set(
    reservasEnEseHorario
      .filter((r) => r.id !== excluirReservaId)
      .flatMap((r) => r.fields.Mesa || [])
  );

  const mesaLibre = mesas.find((m) => !mesaIdsOcupadas.has(m.id));
  return mesaLibre || null;
}

async function checkAvailability(ctx, { date, time, party_size }) {
  const mesa = await findAvailableTable(ctx, date, time, party_size);
  return {
    available: Boolean(mesa),
    date,
    time,
    party_size,
    suggested_table: mesa ? mesa.fields.Nombre : null,
    alternative_times: mesa ? [] : ["19:30", "21:00"],
  };
}

/**
 * Crea una reserva asignando la primera mesa libre.
 *
 * `source` marca el canal de origen (`voz`, `whatsapp`, `panel`, o el nombre de
 * una plataforma externa). `external_id` solo lo usan las integraciones: es el
 * id de la reserva EN la plataforma, y es lo que permite deduplicar cuando el
 * mismo webhook llega dos veces.
 */
async function createReservation(
  ctx,
  { date, time, party_size, customer_name, customer_phone, notes, source, external_id, code, lopd }
) {
  // Un cliente que llama dos veces no debe acabar con dos reservas. Se comprueba
  // por teléfono + día + TURNO, no solo por día: reservar comida y cena el mismo
  // día es legítimo y bloquearlo sería peor que el problema que resuelve.
  //
  // Las reservas de plataformas externas se saltan esta comprobación: ya vienen
  // deduplicadas por su propio id, y ahí un segundo apunte del mismo cliente
  // suele ser una reserva real que la plataforma ya vendió.
  if (!external_id && customer_phone) {
    const duplicada = await findReservationRecord(ctx, {
      customer_phone,
      date,
      shift: derivarTurno(time),
    });
    if (duplicada) {
      return {
        created: false,
        reason: "duplicate",
        existing: toReservationShape(duplicada),
      };
    }
  }

  const mesa = await findAvailableTable(ctx, date, time, party_size);
  if (!mesa) {
    return { created: false, reason: "no_availability" };
  }

  const fields = {
    FechaHora: fechaHoraKey(date, time),
    Personas: party_size,
    ClienteNombre: customer_name,
    ClienteTelefono: customer_phone,
    Mesa: [mesa.id],
    Estado: "confirmada",
    Notas: notes || "",
    Origen: source || "panel",
    Turno: derivarTurno(time),
    CodigoReserva: code || generarCodigo(),
    LopdAcepta: Boolean(lopd),
  };
  if (external_id) fields.ExternalId = String(external_id);

  // Las alergias llegan dictadas dentro de las notas ("alergia al marisco").
  // Se estructuran para que la carta se pueda filtrar y cocina reciba el aviso,
  // SIN tocar la nota original, que sigue siendo la fuente de verdad.
  const extraidos = allergens.extraer(notes);
  if (extraidos.alergenos.length > 0) fields.Alergias = extraidos.alergenos;
  if (extraidos.contextoAlergia && !extraidos.reconocido) {
    console.warn(
      `[reservations] nota de alergia no interpretada (${customer_name}): "${notes}" — queda solo como texto`
    );
  }

  // typecast por si el catálogo de Origen de esa base aún no tiene el valor.
  const record = await createRecord(ctx.baseId, TABLE_RESERVAS, fields, { typecast: true });

  return { created: true, ...toReservationShape(record), table: mesa.fields.Nombre };
}

/**
 * Filtro de teléfono tolerante: el número puede venir como "+34600111222" o
 * como "600111222" según cómo lo transcribiera el agente, así que se comparan
 * los últimos 9 dígitos cuando eso es fiable.
 */
function filtroTelefono(customer_phone) {
  return phone.esClaveFiable(customer_phone)
    ? `RIGHT(REGEX_REPLACE({ClienteTelefono} & "", "[^0-9]", ""), 9) = ${quote(phone.digitsKey(customer_phone))}`
    : `{ClienteTelefono} = ${quote(customer_phone)}`;
}

/**
 * Reservas confirmadas y aún no pasadas de un teléfono, de la más próxima en
 * adelante. Es lo que necesita el cliente que llama preguntando qué tiene
 * reservado sin recordar ni el código ni el día.
 *
 * El corte por fecha se hace en JavaScript y no en la fórmula de Airtable:
 * comparar fechas como texto dentro de la fórmula es frágil, y el número de
 * reservas por teléfono siempre es pequeño.
 */
async function findUpcomingByPhone(ctx, customer_phone) {
  if (!customer_phone) return [];
  const registros = await listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `AND(${filtroTelefono(customer_phone)}, {Estado} = 'confirmada')`,
  });
  const hoy = new Date().toISOString().slice(0, 10);
  return registros
    .map(toReservationShape)
    .filter((r) => r.date >= hoy)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

/**
 * Localiza una reserva confirmada. Se puede identificar de varias formas, de la
 * más precisa a la más tolerante:
 *   reservation_id — id interno (lo usa el panel)
 *   code           — "RES-123456-789", que es lo que el cliente tiene apuntado
 *   customer_phone + date — último recurso cuando no recuerda el código
 *
 * `shift` acota la búsqueda por teléfono a un turno concreto, que es lo que
 * permite distinguir una comida de una cena del mismo cliente y el mismo día.
 *
 * Devuelve el registro crudo de Airtable (o null), porque quien llama a veces
 * necesita los campos originales y no la forma ya traducida.
 */
async function findReservationRecord(ctx, { reservation_id, code, customer_phone, date, shift }) {
  if (reservation_id) {
    return getRecord(ctx.baseId, TABLE_RESERVAS, reservation_id).catch(() => null);
  }

  if (code) {
    const porCodigo = await listRecords(ctx.baseId, TABLE_RESERVAS, {
      filterByFormula: `AND({CodigoReserva} = ${quote(code)}, {Estado} = 'confirmada')`,
      maxRecords: 1,
    });
    return porCodigo[0] || null;
  }

  if (!customer_phone || !date) return null;

  const candidatas = await listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `AND(${filtroTelefono(customer_phone)}, LEFT({FechaHora}, 10) = ${quote(date)}, {Estado} = 'confirmada')`,
  });

  if (shift) {
    const delTurno = candidatas.find((r) => {
      const hora = (r.fields.FechaHora || " ").split(" ")[1] || "";
      return (r.fields.Turno || derivarTurno(hora)) === shift;
    });
    return delTurno || null;
  }
  return candidatas[0] || null;
}

/**
 * Consulta pública de reservas. Con código o con teléfono+fecha devuelve una
 * concreta; con solo el teléfono, todas las que el cliente tenga por delante.
 */
async function findReservation(ctx, criterios = {}) {
  const { code, reservation_id, customer_phone, date } = criterios;

  if (!code && !reservation_id && customer_phone && !date) {
    const proximas = await findUpcomingByPhone(ctx, customer_phone);
    if (proximas.length === 0) return { found: false, reason: "not_found" };
    // `reservation` es la más próxima; `reservations` las trae todas, para que
    // el agente pueda desambiguar si el cliente tiene varias.
    return { found: true, reservation: proximas[0], reservations: proximas };
  }

  const record = await findReservationRecord(ctx, criterios);
  if (!record) return { found: false, reason: "not_found" };
  return { found: true, reservation: toReservationShape(record) };
}

/**
 * Cambia fecha, hora y/o número de personas de una reserva ya existente.
 *
 * Se hace como una modificación y NO como "anular y crear de nuevo": si el alta
 * fallara después de la baja, el cliente se quedaría sin reserva y sin saberlo.
 * Aquí la reserva original solo se toca cuando ya hay mesa para los datos
 * nuevos, así que un fallo deja las cosas como estaban.
 *
 * Los campos que no se envían conservan su valor actual.
 */
async function modifyReservation(ctx, { reservation_id, code, customer_phone, date, ...cambios }) {
  const record = await findReservationRecord(ctx, { reservation_id, code, customer_phone, date });
  if (!record) {
    return { modified: false, reason: "not_found" };
  }

  const antes = toReservationShape(record);
  const nuevaFecha = cambios.new_date || antes.date;
  const nuevaHora = cambios.new_time || antes.time;
  const nuevasPersonas = Number(cambios.new_party_size) || antes.party_size;

  const cambiaSitio =
    nuevaFecha !== antes.date || nuevaHora !== antes.time || nuevasPersonas !== antes.party_size;

  if (!cambiaSitio) {
    return { modified: false, reason: "sin_cambios", reservation: antes };
  }

  const mesa = await findAvailableTable(ctx, nuevaFecha, nuevaHora, nuevasPersonas, record.id);
  if (!mesa) {
    return { modified: false, reason: "no_availability", reservation: antes };
  }

  const actualizado = await updateRecord(
    ctx.baseId,
    TABLE_RESERVAS,
    record.id,
    {
      FechaHora: fechaHoraKey(nuevaFecha, nuevaHora),
      Personas: nuevasPersonas,
      Mesa: [mesa.id],
      Turno: derivarTurno(nuevaHora),
    },
    { typecast: true }
  );

  return {
    modified: true,
    before: antes,
    reservation: toReservationShape(actualizado),
    table: mesa.fields.Nombre,
  };
}

/**
 * Anula una reserva, identificada con los mismos criterios que findReservation.
 */
async function cancelReservation(ctx, { reservation_id, code, customer_phone, date }) {
  const record = await findReservationRecord(ctx, { reservation_id, code, customer_phone, date });

  if (!record) {
    return { cancelled: false, reason: "not_found" };
  }

  const updated = await updateRecord(ctx.baseId, TABLE_RESERVAS, record.id, { Estado: "cancelada" });
  return { cancelled: true, reservation: toReservationShape(updated) };
}

/**
 * Reservas confirmadas cuya hora cae entre `hoursFloor` y `hoursAhead` en el
 * futuro. El rango evita solapes entre el recordatorio de 24h y el de 1h
 * (una reserva a 30 min NO debe recibir el mensaje de "mañana").
 */
async function getUpcomingReservations(ctx, { hoursAhead, hoursFloor = 0 }) {
  const now = Date.now();
  const confirmadas = await listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `{Estado} = 'confirmada'`,
  });

  return confirmadas
    .map(toReservationShape)
    .filter((r) => {
      const resTime = new Date(`${r.date}T${r.time}:00`).getTime();
      const diff = resTime - now;
      return diff > hoursFloor * 60 * 60 * 1000 && diff <= hoursAhead * 60 * 60 * 1000;
    });
}

/**
 * Reservas confirmadas cuya hora ya pasó (hasta `hoursAgo` atrás) y a las que
 * aún no se les pidió reseña. El marcado (ResenaPedida) lo hace internalJobs
 * tras enviar el mensaje, para que la petición sea idempotente entre
 * ejecuciones de Make cada 15 min.
 */
async function getRecentlyCompletedVisits(ctx, { hoursAgo }) {
  const now = Date.now();
  const candidatas = await listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `AND({Estado} = 'confirmada', {ResenaPedida} = FALSE())`,
  });

  return candidatas
    .map(toReservationShape)
    .filter((r) => {
      const resTime = new Date(`${r.date}T${r.time}:00`).getTime();
      const diff = now - resTime;
      return diff > 0 && diff <= hoursAgo * 60 * 60 * 1000;
    });
}

/**
 * Marca flags de control sobre una reserva (Recordatorio24h, Recordatorio1h,
 * ResenaPedida, Estado...). `fields` usa los nombres de campo de Airtable.
 */
async function markReservation(ctx, reservationId, fields) {
  const updated = await updateRecord(ctx.baseId, TABLE_RESERVAS, reservationId, fields);
  return toReservationShape(updated);
}

module.exports = {
  checkAvailability,
  createReservation,
  cancelReservation,
  findReservation,
  findReservationRecord,
  findUpcomingByPhone,
  modifyReservation,
  getUpcomingReservations,
  getRecentlyCompletedVisits,
  markReservation,
  derivarTurno,
  generarCodigo,
  toReservationShape,
};
