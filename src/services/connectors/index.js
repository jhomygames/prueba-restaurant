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
const allergens = require("../allergens");
const { decrypt } = require("../secretBox");

const history = require("../history");

const demo = require("./demo");
const thefork = require("./thefork");
const n8n = require("./n8n");
const supabase = require("./supabase");

const TABLE_RESERVAS = "Reservas";

const ADAPTERS = { demo, thefork, n8n, supabase };

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

/**
 * Busca una reserva ya importada. Es lo que hace que reenviar el mismo webhook
 * no cree duplicados.
 *
 * Se busca SOLO por ExternalId, no por (Origen, ExternalId). Motivo: `Origen`
 * guarda el canal real por el que habló el cliente ("voz", "whatsapp"), no el
 * conector que trajo el dato — para el equipo de sala importa si la reserva la
 * pidió alguien por teléfono, no que pasara por n8n de camino. Atarse a Origen
 * haría que una reserva de voz llegada por n8n no se encontrara al reenviarla,
 * y se duplicaría. ExternalId solo lo escriben los conectores y cada plataforma
 * usa su propio formato de id, así que por sí solo ya identifica sin ambigüedad.
 */
async function findByExternalId(ctx, provider, externalId) {
  const { quote } = airtable;
  const records = await airtable.listRecords(ctx.baseId, TABLE_RESERVAS, {
    filterByFormula: `{ExternalId} = ${quote(externalId)}`,
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
  // Canal real del cliente si el adaptador lo sabe (n8n lo manda); si no, el
  // nombre de la plataforma, que es lo más concreto que se puede afirmar.
  const origen = r.channel || r.provider;

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
    await history.registrar(ctx, {
      accion: "cancelled",
      canal: origen,
      reservaId: existente.id,
      codigo: existente.fields.CodigoReserva || r.code || "",
      antes: existente.fields,
      despues: { Estado: "cancelada" },
    });
    return { action: "cancelled", id: existente.id };
  }

  // --- Ya la teníamos: actualizar los datos que puedan haber cambiado ---
  if (existente) {
    const nuevos = {
      FechaHora: `${r.date} ${r.time}`,
      Personas: r.pax,
      ClienteNombre: r.customerName,
      Notas: r.notes || "",
      Turno: r.shift || reservations.derivarTurno(r.time),
    };
    await airtable.updateRecord(ctx.baseId, TABLE_RESERVAS, existente.id, nuevos, { typecast: true });
    await history.registrar(ctx, {
      accion: "modified",
      canal: origen,
      reservaId: existente.id,
      codigo: existente.fields.CodigoReserva || r.code || "",
      antes: existente.fields,
      despues: nuevos,
    });
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
    source: origen,
    external_id: r.externalId,
    code: r.code || "",
    lopd: r.lopd,
  });

  let id = creada.id;

  // Sin mesa libre NO se rechaza: la plataforma ya se la vendió al cliente.
  // Entra sin mesa y el staff la coloca a mano (el panel la muestra igual).
  let codigo = creada.code;

  if (!creada.created) {
    codigo = r.code || reservations.generarCodigo();
    const extraidos = allergens.extraer(r.notes);
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
        Origen: origen,
        ExternalId: String(r.externalId),
        Turno: r.shift || reservations.derivarTurno(r.time),
        CodigoReserva: codigo,
        LopdAcepta: Boolean(r.lopd),
        ...(extraidos.alergenos.length > 0 ? { Alergias: extraidos.alergenos } : {}),
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
      .upsertCustomer(ctx, r.customerPhone, { name: r.customerName, lopd: r.lopd })
      .catch((err) => console.error("[connectors] error guardando cliente:", err.message));
  }

  await history.registrar(ctx, {
    accion: "created",
    canal: origen,
    reservaId: id,
    codigo,
    despues: { FechaHora: `${r.date} ${r.time}`, Personas: r.pax, ClienteNombre: r.customerName },
  });

  return { action: "created", id, code: codigo, sinMesa: !creada.created };
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

  // Solo escribimos el cursor si hubo algo que sincronizar: cada escritura
  // invalida la caché del registro, y no tiene sentido tirarla cada 15 minutos
  // por una consulta que no trajo nada.
  if (externas.length > 0) {
    await registry
      .updateRestaurant(restaurant.id, { IntegracionUltimaSync: new Date().toISOString() })
      .catch((err) => console.error("[connectors] no se pudo guardar UltimaSync:", err.message));
  }

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
