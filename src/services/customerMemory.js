/**
 * Memoria básica de clientes habituales, respaldada por Airtable (sandbox).
 *
 * Tabla `Clientes` en la misma base que Mesas/Reservas:
 *   { Telefono, Nombre, AlergenosConocidos (multi-select), Preferencias,
 *     UltimaVisita (fecha ISO), NumVisitas }
 *
 * `Telefono` no es la primary key real de Airtable (Airtable siempre usa un
 * recordId interno), así que buscamos por fórmula sobre el campo Telefono.
 */

const { listRecords, createRecord, updateRecord } = require("./airtableClient");

const TABLE_CLIENTES = "Clientes";

function toCustomerShape(record) {
  if (!record) return null;
  const f = record.fields;
  return {
    id: record.id,
    phone: f.Telefono,
    name: f.Nombre || null,
    known_allergens: f.AlergenosConocidos || [],
    preferences: f.Preferencias || "",
    last_visit_at: f.UltimaVisita || null,
    visit_count: f.NumVisitas || 0,
  };
}

async function findCustomerRecord(phone) {
  const matches = await listRecords(TABLE_CLIENTES, {
    filterByFormula: `{Telefono} = '${phone}'`,
    maxRecords: 1,
  });
  return matches[0] || null;
}

async function getCustomer(phone) {
  const record = await findCustomerRecord(phone);
  return toCustomerShape(record);
}

async function upsertCustomer(phone, fields) {
  const existing = await findCustomerRecord(phone);

  const airtableFields = {};
  if (fields.name !== undefined) airtableFields.Nombre = fields.name;
  if (fields.known_allergens !== undefined) airtableFields.AlergenosConocidos = fields.known_allergens;
  if (fields.preferences !== undefined) airtableFields.Preferencias = fields.preferences;
  if (fields.last_visit_at !== undefined) airtableFields.UltimaVisita = fields.last_visit_at;
  if (fields.visit_count !== undefined) airtableFields.NumVisitas = fields.visit_count;

  let record;
  if (existing) {
    record = await updateRecord(TABLE_CLIENTES, existing.id, airtableFields);
  } else {
    record = await createRecord(TABLE_CLIENTES, { Telefono: phone, ...airtableFields });
  }
  return toCustomerShape(record);
}

async function recordVisit(phone) {
  const existing = await getCustomer(phone);
  const visitCount = (existing?.visit_count || 0) + 1;
  return upsertCustomer(phone, {
    visit_count: visitCount,
    last_visit_at: new Date().toISOString(),
  });
}

module.exports = { getCustomer, upsertCustomer, recordVisit };
