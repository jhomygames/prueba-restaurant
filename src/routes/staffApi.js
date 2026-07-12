/**
 * API REST para el panel de staff (la SPA Restaurant-Manager servida en /).
 * Airtable es la única base de datos: todo CRUD de mesas, reservas y la
 * lectura de clientes pasa por aquí, con el mismo esquema que usan los
 * agentes de voz y WhatsApp (ver AIRTABLE_SCHEMA.md).
 *
 * Convención de mapeo con los tipos del frontend (app/src/types.ts):
 *   Mesas:    Nombre/Capacidad/Zona/Estado/PosX/PosY/Forma/Rotacion
 *   Reservas: FechaHora "YYYY-MM-DD HH:mm", Estado ES <-> status EN
 *   Clientes: Telefono/Nombre/AlergenosConocidos/Preferencias/UltimaVisita/NumVisitas
 *
 * Auth: si STAFF_API_KEY está definida, se exige el header x-staff-key.
 * En el sandbox puede dejarse sin definir (API abierta, misma URL pública).
 */

const express = require("express");
const airtable = require("../services/airtableClient");
const customerMemory = require("../services/customerMemory");

const router = express.Router();

const MESAS = "Mesas";
const RESERVAS = "Reservas";
const CLIENTES = "Clientes";

const TABLE_STATUS_ES = { free: "Libre", reserved: "Reservada", occupied: "Ocupada" };
const TABLE_STATUS_EN = { Libre: "free", Reservada: "reserved", Ocupada: "occupied" };

const RES_STATUS_ES = {
  pending: "pendiente",
  confirmed: "confirmada",
  seated: "sentada",
  completed: "completada",
  cancelled: "cancelada",
};
const RES_STATUS_EN = Object.fromEntries(
  Object.entries(RES_STATUS_ES).map(([en, es]) => [es, en])
);

function requireStaffKey(req, res, next) {
  const expected = process.env.STAFF_API_KEY;
  if (expected && req.headers["x-staff-key"] !== expected) {
    return res.status(401).json({ error: "invalid_staff_key" });
  }
  next();
}

router.use("/api", requireStaffKey);

// ---------- Mapeos ----------

function toAppTable(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    name: f.Nombre || "",
    seats: f.Capacidad || 0,
    status: TABLE_STATUS_EN[f.Estado] || "free",
    x: typeof f.PosX === "number" ? f.PosX : 50,
    y: typeof f.PosY === "number" ? f.PosY : 50,
    shape: f.Forma || "square",
    rotation: f.Rotacion || 0,
    zone: f.Zona || "Interior",
  };
}

function toMesaFields(body) {
  const f = {};
  if (body.name !== undefined) f.Nombre = body.name;
  if (body.seats !== undefined) f.Capacidad = body.seats;
  if (body.status !== undefined) f.Estado = TABLE_STATUS_ES[body.status] || "Libre";
  if (body.x !== undefined) f.PosX = body.x;
  if (body.y !== undefined) f.PosY = body.y;
  if (body.shape !== undefined) f.Forma = body.shape;
  if (body.rotation !== undefined) f.Rotacion = body.rotation;
  if (body.zone !== undefined) f.Zona = body.zone;
  return f;
}

function toAppReservation(rec) {
  const f = rec.fields;
  const [date = "", time = ""] = (f.FechaHora || "").split(" ");
  return {
    id: rec.id,
    customerName: f.ClienteNombre || "",
    customerPhone: f.ClienteTelefono || "",
    date,
    time,
    pax: f.Personas || 0,
    tableId: Array.isArray(f.Mesa) && f.Mesa.length ? f.Mesa[0] : "",
    status: RES_STATUS_EN[f.Estado] || "confirmed",
    notes: f.Notas || "",
    allergies: f.Alergias || [],
    autoConfirmMessage: true,
    createdAt: rec.createdTime,
    seatedAt: f.SentadaAt || undefined,
    customDurationMinutes: f.DuracionMin || undefined,
  };
}

function toReservaFields(body) {
  const f = {};
  if (body.customerName !== undefined) f.ClienteNombre = body.customerName;
  if (body.customerPhone !== undefined) f.ClienteTelefono = body.customerPhone;
  if (body.date !== undefined || body.time !== undefined) {
    if (!body.date || !body.time) {
      throw new Error("date y time deben enviarse juntos");
    }
    f.FechaHora = `${body.date} ${body.time}`;
  }
  if (body.pax !== undefined) f.Personas = body.pax;
  if (body.tableId !== undefined) f.Mesa = body.tableId ? [body.tableId] : [];
  if (body.status !== undefined) f.Estado = RES_STATUS_ES[body.status] || "confirmada";
  if (body.notes !== undefined) f.Notas = body.notes;
  if (body.allergies !== undefined) f.Alergias = body.allergies;
  if (body.seatedAt !== undefined) f.SentadaAt = body.seatedAt;
  if (body.customDurationMinutes !== undefined) f.DuracionMin = body.customDurationMinutes;
  return f;
}

function toAppCustomer(rec) {
  const f = rec.fields;
  return {
    id: rec.id,
    phone: f.Telefono || "",
    name: f.Nombre || "",
    knownAllergies: f.AlergenosConocidos || [],
    preferences: f.Preferencias || "",
    lastVisit: f.UltimaVisita || "",
    visits: f.NumVisitas || 0,
  };
}

function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[staffApi] ${req.method} ${req.path}:`, err.message);
      res.status(500).json({ error: "internal_error", detail: err.message });
    }
  };
}

// ---------- Mesas ----------

router.get(
  "/api/tables",
  handle(async (req, res) => {
    const records = await airtable.listRecords(MESAS);
    res.json(records.map(toAppTable));
  })
);

router.post(
  "/api/tables",
  handle(async (req, res) => {
    const rec = await airtable.createRecord(MESAS, toMesaFields(req.body), { typecast: true });
    res.status(201).json(toAppTable(rec));
  })
);

router.patch(
  "/api/tables/:id",
  handle(async (req, res) => {
    const rec = await airtable.updateRecord(MESAS, req.params.id, toMesaFields(req.body), {
      typecast: true,
    });
    res.json(toAppTable(rec));
  })
);

router.delete(
  "/api/tables/:id",
  handle(async (req, res) => {
    await airtable.deleteRecord(MESAS, req.params.id);
    res.json({ deleted: true, id: req.params.id });
  })
);

// ---------- Reservas ----------

router.get(
  "/api/reservations",
  handle(async (req, res) => {
    const opts = { sort: [{ field: "FechaHora", direction: "asc" }] };
    if (req.query.date) {
      opts.filterByFormula = `FIND('${req.query.date}', {FechaHora}) = 1`;
    }
    const records = await airtable.listRecords(RESERVAS, opts);
    res.json(records.map(toAppReservation));
  })
);

router.post(
  "/api/reservations",
  handle(async (req, res) => {
    const rec = await airtable.createRecord(RESERVAS, toReservaFields(req.body), {
      typecast: true,
    });
    // Igual que el flujo de voz/WhatsApp: toda reserva registra al cliente.
    if (req.body.customerPhone) {
      await customerMemory
        .upsertCustomer(req.body.customerPhone, { name: req.body.customerName })
        .catch((err) => console.error("[staffApi] upsertCustomer:", err.message));
    }
    res.status(201).json(toAppReservation(rec));
  })
);

router.patch(
  "/api/reservations/:id",
  handle(async (req, res) => {
    const rec = await airtable.updateRecord(RESERVAS, req.params.id, toReservaFields(req.body), {
      typecast: true,
    });
    res.json(toAppReservation(rec));
  })
);

// ---------- Clientes (solo lectura desde la app) ----------

router.get(
  "/api/customers",
  handle(async (req, res) => {
    const records = await airtable.listRecords(CLIENTES, {
      sort: [{ field: "UltimaVisita", direction: "desc" }],
    });
    res.json(records.map(toAppCustomer));
  })
);

// El simulador de llamada vive ahora en src/routes/callSim.js (migrado a
// Claude: usa el agente real con herramientas, no un mock).

module.exports = router;
