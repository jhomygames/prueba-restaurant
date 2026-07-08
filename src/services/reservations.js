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

const { listRecords, createRecord, updateRecord } = require("./airtableClient");

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
  };
}

async function findAvailableTable(date, time, party_size) {
  const targetFH = fechaHoraKey(date, time);

  const [mesas, reservasEnEseHorario] = await Promise.all([
    listRecords(TABLE_MESAS, {
      filterByFormula: `AND({Capacidad} >= ${Number(party_size)}, {Estado} != 'Fuera de servicio')`,
    }),
    listRecords(TABLE_RESERVAS, {
      filterByFormula: `AND({FechaHora} = '${targetFH}', {Estado} = 'confirmada')`,
    }),
  ]);

  const mesaIdsOcupadas = new Set(
    reservasEnEseHorario.flatMap((r) => r.fields.Mesa || [])
  );

  const mesaLibre = mesas.find((m) => !mesaIdsOcupadas.has(m.id));
  return mesaLibre || null;
}

async function checkAvailability({ date, time, party_size }) {
  const mesa = await findAvailableTable(date, time, party_size);
  return {
    available: Boolean(mesa),
    date,
    time,
    party_size,
    suggested_table: mesa ? mesa.fields.Nombre : null,
    alternative_times: mesa ? [] : ["19:30", "21:00"],
  };
}

async function createReservation({ date, time, party_size, customer_name, customer_phone, notes }) {
  const mesa = await findAvailableTable(date, time, party_size);
  if (!mesa) {
    return { created: false, reason: "no_availability" };
  }

  const record = await createRecord(TABLE_RESERVAS, {
    FechaHora: fechaHoraKey(date, time),
    Personas: party_size,
    ClienteNombre: customer_name,
    ClienteTelefono: customer_phone,
    Mesa: [mesa.id],
    Estado: "confirmada",
    Notas: notes || "",
  });

  return { created: true, ...toReservationShape(record), table: mesa.fields.Nombre };
}

async function cancelReservation({ reservation_id, customer_phone, date }) {
  let record;

  if (reservation_id) {
    record = { id: reservation_id };
  } else {
    const candidates = await listRecords(TABLE_RESERVAS, {
      filterByFormula: `AND({ClienteTelefono} = '${customer_phone}', LEFT({FechaHora}, 10) = '${date}', {Estado} = 'confirmada')`,
    });
    record = candidates[0];
  }

  if (!record) {
    return { cancelled: false, reason: "not_found" };
  }

  const updated = await updateRecord(TABLE_RESERVAS, record.id, { Estado: "cancelada" });
  return { cancelled: true, reservation: toReservationShape(updated) };
}

async function getUpcomingReservations({ hoursAhead }) {
  const now = Date.now();
  const confirmadas = await listRecords(TABLE_RESERVAS, {
    filterByFormula: `{Estado} = 'confirmada'`,
  });

  return confirmadas
    .map(toReservationShape)
    .filter((r) => {
      const resTime = new Date(`${r.date}T${r.time}:00`).getTime();
      const diff = resTime - now;
      return diff > 0 && diff <= hoursAhead * 60 * 60 * 1000;
    });
}

async function getRecentlyCompletedVisits({ hoursAgo }) {
  const now = Date.now();
  const confirmadas = await listRecords(TABLE_RESERVAS, {
    filterByFormula: `{Estado} = 'confirmada'`,
  });

  return confirmadas
    .map(toReservationShape)
    .filter((r) => {
      const resTime = new Date(`${r.date}T${r.time}:00`).getTime();
      const diff = now - resTime;
      return diff > 0 && diff <= hoursAgo * 60 * 60 * 1000;
    });
}

module.exports = {
  checkAvailability,
  createReservation,
  cancelReservation,
  getUpcomingReservations,
  getRecentlyCompletedVisits,
};
