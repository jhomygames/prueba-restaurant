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

const { listRecords, createRecord, updateRecord, quote } = require("./airtableClient");
const phone = require("./phone");

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
    // El idioma importa para la voz: el agente puede saludar en el idioma en
    // que ya se atendió a esta persona la última vez.
    language: f.IdiomaPreferido || "es",
    lopd: f.LopdAcepta === true,
  };
}

/**
 * Busca la ficha del cliente tolerando formatos distintos del mismo número.
 *
 * Un match exacto no basta: el agente de voz transcribe unas veces
 * "+34624114533" y otras "624114533", y con comparación literal cada variante
 * creaba una ficha nueva, partiendo en dos las visitas y — peor — los alérgenos
 * conocidos de esa persona. Se compara por los 9 últimos dígitos.
 *
 * Si aparecen varias fichas del mismo número (datos heredados de n8n), se
 * devuelve la más asentada (más visitas) y se avisa por consola para poder
 * fusionarlas a mano; no se borra nada automáticamente.
 */
async function findCustomerRecord(ctx, telefono) {
  const clave = phone.digitsKey(telefono);
  if (!clave) return null;

  const formula = phone.esClaveFiable(telefono)
    ? `RIGHT(REGEX_REPLACE({Telefono} & "", "[^0-9]", ""), 9) = ${quote(clave)}`
    : `{Telefono} = ${quote(telefono)}`; // muy corto para comparar por sufijo

  const matches = await listRecords(ctx.baseId, TABLE_CLIENTES, {
    filterByFormula: formula,
    maxRecords: 10,
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    console.warn(
      `[customerMemory] ${matches.length} fichas para el mismo número (${clave}): conviene fusionarlas`
    );
  }
  return matches.reduce((mejor, r) =>
    (r.fields.NumVisitas || 0) > (mejor.fields.NumVisitas || 0) ? r : mejor
  );
}

async function getCustomer(ctx, phone) {
  const record = await findCustomerRecord(ctx, phone);
  return toCustomerShape(record);
}

async function upsertCustomer(ctx, telefono, fields) {
  const existing = await findCustomerRecord(ctx, telefono);
  // Se guarda normalizado para que las fichas nuevas nazcan ya homogéneas.
  const phoneGuardar = phone.normalize(telefono);

  const airtableFields = {};
  if (fields.name !== undefined) airtableFields.Nombre = fields.name;
  if (fields.known_allergens !== undefined) airtableFields.AlergenosConocidos = fields.known_allergens;
  if (fields.preferences !== undefined) airtableFields.Preferencias = fields.preferences;
  if (fields.last_visit_at !== undefined) airtableFields.UltimaVisita = fields.last_visit_at;
  if (fields.visit_count !== undefined) airtableFields.NumVisitas = fields.visit_count;
  if (fields.language !== undefined) airtableFields.IdiomaPreferido = fields.language;
  if (fields.lopd !== undefined) airtableFields.LopdAcepta = Boolean(fields.lopd);

  let record;
  if (existing) {
    record = await updateRecord(ctx.baseId, TABLE_CLIENTES, existing.id, airtableFields, {
      typecast: true,
    });
  } else {
    record = await createRecord(
      ctx.baseId,
      TABLE_CLIENTES,
      { Telefono: phoneGuardar, ...airtableFields },
      { typecast: true }
    );
  }
  return toCustomerShape(record);
}

async function recordVisit(ctx, phone) {
  const existing = await getCustomer(ctx, phone);
  const visitCount = (existing?.visit_count || 0) + 1;
  return upsertCustomer(ctx, phone, {
    visit_count: visitCount,
    last_visit_at: new Date().toISOString(),
  });
}

module.exports = { getCustomer, upsertCustomer, recordVisit, findCustomerRecord };
