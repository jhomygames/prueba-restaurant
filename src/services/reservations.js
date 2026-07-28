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

const { listRecords, createRecord, updateRecord, quote } = require("./airtableClient");

const TABLE_MESAS = "Mesas";
const TABLE_RESERVAS = "Reservas";

function fechaHoraKey(date, time) {
  return `${date} ${time}`;
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
  };
}

async function findAvailableTable(ctx, date, time, party_size) {
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
    reservasEnEseHorario.flatMap((r) => r.fields.Mesa || [])
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
  { date, time, party_size, customer_name, customer_phone, notes, source, external_id }
) {
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
  };
  if (external_id) fields.ExternalId = String(external_id);

  // typecast por si el catálogo de Origen de esa base aún no tiene el valor.
  const record = await createRecord(ctx.baseId, TABLE_RESERVAS, fields, { typecast: true });

  return { created: true, ...toReservationShape(record), table: mesa.fields.Nombre };
}

async function cancelReservation(ctx, { reservation_id, customer_phone, date }) {
  let record;

  if (reservation_id) {
    record = { id: reservation_id };
  } else {
    const candidates = await listRecords(ctx.baseId, TABLE_RESERVAS, {
      filterByFormula: `AND({ClienteTelefono} = ${quote(customer_phone)}, LEFT({FechaHora}, 10) = ${quote(date)}, {Estado} = 'confirmada')`,
    });
    record = candidates[0];
  }

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
  getUpcomingReservations,
  getRecentlyCompletedVisits,
  markReservation,
};
