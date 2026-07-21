/**
 * Cliente mínimo para la API REST de Airtable (https://airtable.com/developers/web/api).
 * Usa fetch nativo (Node >= 18).
 *
 * MULTI-TENANT: cada restaurante tiene SU PROPIA base de Airtable, así que el
 * `baseId` es el primer parámetro OBLIGATORIO de todas las funciones. Es
 * deliberado que sea obligatorio (y que lance si falta): si algún día se olvida
 * de pasar el tenant en una ruta nueva, el código falla en vez de leer/escribir
 * silenciosamente en la base equivocada.
 *
 * Requiere un Personal Access Token (AIRTABLE_API_KEY) con scopes:
 *   data.records:read, data.records:write, schema.bases:read
 * y acceso a todas las bases de restaurantes + la base del Registro.
 */

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

function assertConfigured(baseId) {
  const { AIRTABLE_API_KEY } = process.env;
  if (!AIRTABLE_API_KEY) {
    throw new Error("Airtable no configurado: falta AIRTABLE_API_KEY en el entorno.");
  }
  if (!baseId) {
    throw new Error(
      "Airtable: falta el baseId del restaurante (¿se perdió el contexto del tenant?)."
    );
  }
  return AIRTABLE_API_KEY;
}

async function airtableFetch(baseId, table, path = "", options = {}) {
  const apiKey = assertConfigured(baseId);
  const url = `${AIRTABLE_API_BASE}/${baseId}/${encodeURIComponent(table)}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
async function listRecords(baseId, table, { filterByFormula, sort, maxRecords } = {}) {
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

    const data = await airtableFetch(baseId, table, `?${qs.toString()}`);
    records.push(...data.records);
    offset = data.offset;
  } while (offset);

  return records;
}

async function getRecord(baseId, table, recordId) {
  return airtableFetch(baseId, table, `/${recordId}`);
}

// typecast:true deja que Airtable cree opciones nuevas de single/multiple
// select sobre la marcha (necesario para Estados "pendiente"/"sentada" y
// Alergias que la Meta API no permite pre-crear en selects existentes).
async function createRecord(baseId, table, fields, { typecast = false } = {}) {
  return airtableFetch(baseId, table, "", {
    method: "POST",
    body: JSON.stringify({ fields, typecast }),
  });
}

async function updateRecord(baseId, table, recordId, fields, { typecast = false } = {}) {
  return airtableFetch(baseId, table, `/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast }),
  });
}

async function deleteRecord(baseId, table, recordId) {
  return airtableFetch(baseId, table, `/${recordId}`, { method: "DELETE" });
}

module.exports = { listRecords, getRecord, createRecord, updateRecord, deleteRecord };
