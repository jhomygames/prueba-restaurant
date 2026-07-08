/**
 * Cliente mínimo para la API REST de Airtable (https://airtable.com/developers/web/api).
 * Usa fetch nativo (Node >= 18). Todas las tablas del sandbox (Mesas, Reservas,
 * Clientes) viven en una sola base, referenciada por AIRTABLE_BASE_ID.
 *
 * Requiere un Personal Access Token (AIRTABLE_API_KEY) con scopes:
 *   data.records:read, data.records:write, schema.bases:read
 */

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

function assertConfigured() {
  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    throw new Error(
      "Airtable no configurado: faltan AIRTABLE_API_KEY / AIRTABLE_BASE_ID en el entorno."
    );
  }
  return { AIRTABLE_API_KEY, AIRTABLE_BASE_ID };
}

async function airtableFetch(table, path = "", options = {}) {
  const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = assertConfigured();
  const url = `${AIRTABLE_API_BASE}/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtable API error ${res.status} en ${table}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Lista registros de una tabla. Pagina automáticamente hasta traer todos
 * (suficiente para el volumen de un sandbox; no usar así en producción con
 * miles de registros).
 */
async function listRecords(table, { filterByFormula, sort, maxRecords } = {}) {
  const records = [];
  let offset;

  do {
    const qs = new URLSearchParams();
    if (filterByFormula) qs.set("filterByFormula", filterByFormula);
    if (maxRecords) qs.set("maxRecords", String(maxRecords));
    if (sort) {
      sort.forEach((s, i) => {
        qs.set(`sort[${i}][field]`, s.field);
        qs.set(`sort[${i}][direction]`, s.direction || "asc");
      });
    }
    if (offset) qs.set("offset", offset);

    const data = await airtableFetch(table, `?${qs.toString()}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

async function getRecord(table, recordId) {
  return airtableFetch(table, `/${recordId}`);
}

async function createRecord(table, fields) {
  const data = await airtableFetch(table, "", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return data;
}

async function updateRecord(table, recordId, fields) {
  const data = await airtableFetch(table, `/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  return data;
}

module.exports = { listRecords, getRecord, createRecord, updateRecord };
