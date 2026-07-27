/**
 * Motor de integraciones con plataformas de reservas externas.
 *
 * Cada plataforma (TheFork, Covermanager…) es un ADAPTADOR pequeño que solo
 * sabe traducir su formato al nuestro. Todo lo demás — deduplicar, asignar
 * mesa, registrar al cliente, manejar cancelaciones — vive aquí una sola vez.
 *
 * Reserva normalizada (lo que devuelve cualquier adaptador):
 *   { provider, externalId, date:'YYYY-MM-DD', time:'HH:mm', pax,
 *     customerName, customerPhone?, notes?, status:'confirmed'|'cancelled' }
 */

const airtable = require("../airtableClient");
const reservations = require("../reservations");
const customerMemory = require("../customerMemory");
const registry = require("../registry");
const { decrypt } = require("../secretBox");

const demo = require("./demo");
const thefork = require("./thefork");

const TABLE_RESERVAS = "Reservas";

const ADAPTERS = { demo, thefork };

function getAdapter(nombre) {
  return ADAPTERS[String(nombre || "").toLowerCase()] || null;
}

/** Lista de proveedores disponibles, para pintar el selector del panel. */
function listAdapters() {
  return Object.values(ADAPTERS).map((a) => ({
    id: a.nombre,
    label: a.etiqueta,
    authMode: a.authMode,
  }));
}

/** Escapa comillas simples para meter un valor en una fórmula de Airtable. */
function esc(v) {
  return String(v).replace(/'/g, "\\'");
}

/**
 * Busca una reserva ya importada de esa plataforma. Es lo que hace que reenviar
 * el mismo webhook no cree duplicados.
 */
async function findByExternalId(ctx, provider, externalId) {
  const records = await airtable.listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `AND({Origen} = '${esc(provider)}', {ExternalId} = '${esc(externalId)}')`,
    maxRecords: 1,
  });
  return records[0] || null;
}

/**
 * Mete (o actualiza) en el restaurante una reserva venida de fuera.
 *
 * Devuelve `{ action }` donde action es:
 *   'created'    — reserva nueva registrada
 *   'updated'    — ya existía y se actualizó (p. ej. cambió la hora)
 *   'cancelled'  — ya existía y se marcó como cancelada
 *   'ignored'    — cancelación de algo que nunca llegamos a registrar
 */
async function upsertExternalReservation(ctx, r) {
  if (!r || !r.externalId || !r.date || !r.time) {
    return { action: "ignored", reason: "payload_incompleto" };
  }

  const existente = await findByExternalId(ctx, r.provider, r.externalId);

  // --- Cancelación ---
  if (r.status === "cancelled") {
    if (!existente) return { action: "ignored", reason: "cancelacion_de_reserva_desconocida" };
    await airtable.updateRecord(
      ctx.baseId,
      TABLE_RESERVAS,
      existente.id,
      { Estado: "cancelada" },
      { typecast: true }
    );
    return { action: "cancelled", id: existente.id };
  }

  // --- Ya la teníamos: actualizar los datos que puedan haber cambiado ---
  if (existente) {
    await airtable.updateRecord(
      ctx.baseId,
      TABLE_RESERVAS,
      existente.id,
      {
        FechaHora: `${r.date} ${r.time}`,
        Personas: r.pax,
        ClienteNombre: r.customerName,
        Notas: r.notes || "",
      },
      { typecast: true }
    );
    return { action: "updated", id: existente.id };
  }

  // --- Reserva nueva: intentar asignarle mesa ---
  const creada = await reservations.createReservation(ctx, {
    date: r.date,
    time: r.time,
    party_size: r.pax,
    customer_name: r.customerName,
    customer_phone: r.customerPhone || "",
    notes: r.notes || "",
    source: r.provider,
    external_id: r.externalId,
  });

  let id = creada.id;

  // Sin mesa libre NO se rechaza: la plataforma ya se la vendió al cliente.
  // Entra sin mesa y el staff la coloca a mano (el panel la muestra igual).
  if (!creada.created) {
    const record = await airtable.createRecord(
      ctx.baseId,
      TABLE_RESERVAS,
      {
        FechaHora: `${r.date} ${r.time}`,
        Personas: r.pax,
        ClienteNombre: r.customerName,
        ClienteTelefono: r.customerPhone || "",
        Estado: "confirmada",
        Notas: r.notes || "",
        Origen: r.provider,
        ExternalId: String(r.externalId),
      },
      { typecast: true }
    );
    id = record.id;
    console.warn(
      `[connectors] ${r.provider} ${r.externalId}: sin mesa libre para ${r.pax} pax el ${r.date} ${r.time}, entra sin asignar`
    );
  }

  // Memoria de clientes, igual que en voz y WhatsApp.
  if (r.customerPhone) {
    await customerMemory
      .upsertCustomer(ctx, r.customerPhone, { name: r.customerName })
      .catch((err) => console.error("[connectors] error guardando cliente:", err.message));
  }

  return { action: "created", id, sinMesa: !creada.created };
}

/** Credenciales descifradas del conector de un restaurante. */
function integrationCredentials(restaurant) {
  const i = restaurant?.integracion;
  if (!i) return null;
  return {
    provider: i.proveedor,
    apiKey: i.apiKeyEnc ? decrypt(i.apiKeyEnc) : "",
    webhookSecret: i.webhookSecretEnc ? decrypt(i.webhookSecretEnc) : "",
    restauranteExternoId: i.restauranteExternoId || "",
    activa: i.activa === true,
    ultimaSync: i.ultimaSync || "",
  };
}

/**
 * Sondea la plataforma de un restaurante en busca de reservas nuevas.
 * Solo aplica a conectores que implementen `fetchSince` de verdad; los que
 * funcionan por webhook (TheFork, demo) devuelven lista vacía y esto no hace nada.
 */
async function syncTenant(restaurant) {
  const creds = integrationCredentials(restaurant);
  if (!creds || !creds.activa || !creds.provider) {
    return { restaurante: restaurant.slug, skipped: "sin_integracion" };
  }
  const adapter = getAdapter(creds.provider);
  if (!adapter) {
    return { restaurante: restaurant.slug, skipped: "proveedor_desconocido" };
  }

  const ctx = { baseId: restaurant.baseId };
  const desde = creds.ultimaSync || new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const externas = await adapter.fetchSince(creds, desde);
  const resultados = [];
  for (const r of externas) {
    try {
      resultados.push(await upsertExternalReservation(ctx, r));
    } catch (err) {
      console.error(`[connectors] ${restaurant.slug} ${r.externalId}:`, err.message);
      resultados.push({ action: "error", externalId: r.externalId });
    }
  }

  await registry
    .updateRestaurant(restaurant.id, { IntegracionUltimaSync: new Date().toISOString() })
    .catch((err) => console.error("[connectors] no se pudo guardar UltimaSync:", err.message));

  return { restaurante: restaurant.slug, proveedor: creds.provider, procesadas: resultados.length, resultados };
}

module.exports = {
  getAdapter,
  listAdapters,
  upsertExternalReservation,
  integrationCredentials,
  syncTenant,
  findByExternalId,
};
