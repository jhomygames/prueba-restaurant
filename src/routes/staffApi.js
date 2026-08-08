/**
 * API REST del panel de staff (la SPA servida en /).
 *
 * Supabase es la única base de datos. Todo el CRUD de mesas, reservas, carta y
 * la lectura de clientes pasa por aquí.
 *
 * OJO con las formas: el panel y el agente hablan distinto. El agente usa
 * `party_size`, `customer_name`; el panel usa `pax`, `customerName`, `seats`.
 * Por eso este fichero tiene sus PROPIOS traductores en vez de reutilizar los
 * de `repo/reservas`: son dos contratos distintos con el mismo dato, y
 * mezclarlos deja la pantalla en blanco sin decir por qué.
 *
 * MULTI-TENANT: el restaurante sale SIEMPRE del JWT (`req.restaurant.ctx`),
 * nunca de un parámetro de la petición. Es lo único que impide que el usuario
 * de un local lea o escriba en otro, porque en Supabase todos comparten tabla:
 * basta con olvidar el filtro una vez.
 */

const express = require("express");
const db = require("../services/supabaseClient");
const escribir = require("../services/repo/escribir");
const horario = require("../services/horario");
const { requireAuth } = require("./auth");

const router = express.Router();

const MESAS = "mesas";
const RESERVAS = "reservas";
const CLIENTES = "clientes";
const CARTA = "carta";

const MESA_ESTADO_ES = {
  free: "Libre",
  reserved: "Reservada",
  occupied: "Ocupada",
  out_of_service: "Fuera de servicio",
};
const MESA_ESTADO_EN = Object.fromEntries(
  Object.entries(MESA_ESTADO_ES).map(([en, es]) => [es, en])
);

// En la base los estados van en inglés (los escribe n8n); el panel también.
const RES_ESTADOS = ["pending", "confirmed", "seated", "completed", "cancelled"];

router.use("/api", requireAuth);

function manejar(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      console.error(`[staffApi] ${req.method} ${req.path}:`, err.message);
      res.status(500).json({ error: "internal_error", detail: err.message });
    }
  };
}

const ctxDe = (req) => req.restaurant.ctx;

/** Un id de otro restaurante no actualiza nada: para este usuario no existe. */
function siNoExiste(res, fila, error) {
  if (fila) return false;
  res.status(404).json({ error });
  return true;
}

// ---------- Traductores hacia el panel ----------

function aTabla(f) {
  return {
    id: String(f.id),
    name: f.nombre || "",
    seats: f.capacidad || 0,
    status: MESA_ESTADO_EN[f.estado] || "free",
    x: f.pos_x == null ? 50 : Number(f.pos_x),
    y: f.pos_y == null ? 50 : Number(f.pos_y),
    shape: f.forma || "square",
    rotation: f.rotacion || 0,
    zone: f.zona || "Interior",
  };
}

function aReserva(f) {
  const hora = String(f.hora || "").slice(0, 5);
  return {
    id: String(f.id),
    customerName: f.nombre || "",
    customerPhone: f.telefono || "",
    date: f.fecha || "",
    time: hora,
    pax: f.personas || 0,
    tableId: f.mesa_id ? String(f.mesa_id) : "",
    status: RES_ESTADOS.includes(f.status) ? f.status : "confirmed",
    notes: f.notas || "",
    allergies: f.alergias || [],
    autoConfirmMessage: true,
    createdAt: f.created_at || "",
    seatedAt: f.sentada_at || undefined,
    customDurationMinutes: f.duracion_min || undefined,
    source: f.origen || f.canal || "panel",
    externalId: f.external_id || undefined,
    code: f.id_reserva || undefined,
    shift: f.turno || undefined,
    lopdAccepted: f.lopd_acepta === true,
  };
}

function aCliente(f) {
  return {
    id: String(f.id),
    phone: f.telefono || "",
    name: f.nombre || "",
    knownAllergies: f.alergenos_conocidos || [],
    preferences: f.preferencias || "",
    lastVisit: f.ultima_visita || "",
    visits: f.visitas || 0,
  };
}

function aPlato(f) {
  return {
    id: String(f.id),
    name: f.nombre || "",
    category: f.categoria || "",
    description: f.descripcion || "",
    price: f.precio == null ? null : Number(f.precio),
    allergens: f.alergenos || [],
    recommended: f.destacado === true,
    available: f.disponible !== false,
    order: f.orden || 0,
  };
}

// ---------- Mesas ----------

router.get("/api/tables", manejar(async (req, res) => {
  const filas = await db.listar(ctxDe(req), MESAS, { orden: "nombre.asc" });
  res.json(filas.map(aTabla));
}));

router.post("/api/tables", manejar(async (req, res) => {
  const b = req.body || {};
  const fila = await db.crear(ctxDe(req), MESAS, {
    nombre: b.name,
    capacidad: b.seats || 2,
    zona: b.zone || "Interior",
    estado: MESA_ESTADO_ES[b.status] || "Libre",
    pos_x: b.x ?? 50,
    pos_y: b.y ?? 50,
    forma: b.shape || "square",
    rotacion: b.rotation || 0,
  });
  res.status(201).json(aTabla(fila));
}));

router.patch("/api/tables/:id", manejar(async (req, res) => {
  const b = req.body || {};
  const cambios = {};
  if (b.name !== undefined) cambios.nombre = b.name;
  if (b.seats !== undefined) cambios.capacidad = b.seats;
  if (b.zone !== undefined) cambios.zona = b.zone;
  if (b.status !== undefined) cambios.estado = MESA_ESTADO_ES[b.status] || "Libre";
  if (b.x !== undefined) cambios.pos_x = b.x;
  if (b.y !== undefined) cambios.pos_y = b.y;
  if (b.shape !== undefined) cambios.forma = b.shape;
  if (b.rotation !== undefined) cambios.rotacion = b.rotation;

  const fila = await db.actualizar(ctxDe(req), MESAS, req.params.id, cambios);
  if (siNoExiste(res, fila, "mesa_no_encontrada")) return;
  res.json(aTabla(fila));
}));

router.delete("/api/tables/:id", manejar(async (req, res) => {
  await db.borrar(ctxDe(req), MESAS, req.params.id);
  res.json({ ok: true });
}));

// ---------- Reservas ----------

router.get("/api/reservations", manejar(async (req, res) => {
  const { date } = req.query;
  // Sin fecha, de hoy en adelante: cargar el histórico entero cada vez que se
  // abre el panel no le sirve a nadie y se nota en la primera pantalla.
  const filtros = date
    ? { fecha: date }
    : { fecha: ["gte", new Date().toISOString().slice(0, 10)] };
  const filas = await db.listar(ctxDe(req), RESERVAS, { filtros, orden: "fecha.asc" });
  res.json(filas.map(aReserva));
}));

router.post("/api/reservations", manejar(async (req, res) => {
  const b = req.body || {};
  const r = await escribir.crearReserva(ctxDe(req), {
    fecha: b.date,
    hora: b.time,
    personas: b.pax,
    nombre: b.customerName,
    telefono: b.customerPhone || "",
    notas: b.notes || "",
    canal: "panel",
    lopd: b.lopdAccepted === true,
  });

  if (!r.creada) {
    // Al panel lo maneja una persona que está delante: se le dice qué pasa, no
    // un error genérico que la deje adivinando.
    const explicacion = {
      fuera_de_horario: horario.explicar(r.horario || {}),
      sin_mesa: "No queda ninguna mesa libre a esa hora.",
      duplicada: "Ese cliente ya tiene una reserva ese mismo turno.",
      datos_incompletos: "Faltan datos para crear la reserva.",
    };
    return res.status(409).json({
      error: r.motivo,
      mensaje: explicacion[r.motivo] || "No se pudo crear la reserva.",
    });
  }

  const fila = await db.obtener(ctxDe(req), RESERVAS, r.reserva.id);
  res.status(201).json(aReserva(fila));
}));

router.patch("/api/reservations/:id", manejar(async (req, res) => {
  const b = req.body || {};
  const cambios = {};

  if (b.customerName !== undefined) cambios.nombre = b.customerName;
  if (b.customerPhone !== undefined) cambios.telefono = b.customerPhone;
  if (b.date !== undefined) cambios.fecha = b.date;
  if (b.time !== undefined) {
    cambios.hora = b.time;
    // El turno se deriva de la hora en vez de aceptarlo del cliente: así no
    // puede quedar un "comida" a las 22:00 por un despiste al editar.
    cambios.turno = await horario.turnoDe(ctxDe(req), b.date || "1970-01-01", b.time);
  }
  if (b.pax !== undefined) cambios.personas = b.pax;
  if (b.tableId !== undefined) cambios.mesa_id = b.tableId || null;
  if (b.status !== undefined) {
    cambios.status = RES_ESTADOS.includes(b.status) ? b.status : "confirmed";
  }
  if (b.notes !== undefined) cambios.notas = b.notes;
  if (b.allergies !== undefined) cambios.alergias = b.allergies;
  if (b.seatedAt !== undefined) cambios.sentada_at = b.seatedAt;
  if (b.customDurationMinutes !== undefined) cambios.duracion_min = b.customDurationMinutes;
  if (b.lopdAccepted !== undefined) cambios.lopd_acepta = Boolean(b.lopdAccepted);

  const fila = await db.actualizar(ctxDe(req), RESERVAS, req.params.id, cambios);
  if (siNoExiste(res, fila, "reserva_no_encontrada")) return;
  res.json(aReserva(fila));
}));

// ---------- Clientes ----------

router.get("/api/customers", manejar(async (req, res) => {
  const filas = await db.listar(ctxDe(req), CLIENTES, { orden: "nombre.asc" });
  res.json(filas.map(aCliente));
}));

// ---------- Carta ----------

router.get("/api/menu", manejar(async (req, res) => {
  // El panel ve también lo agotado, para poder reactivarlo.
  const filas = await db.listar(ctxDe(req), CARTA, { orden: "orden.asc" });
  res.json(filas.map(aPlato));
}));

router.post("/api/menu", manejar(async (req, res) => {
  const b = req.body || {};
  const fila = await db.crear(ctxDe(req), CARTA, {
    nombre: b.name,
    categoria: b.category || "",
    descripcion: b.description || "",
    precio: b.price ?? null,
    alergenos: b.allergens || [],
    destacado: b.recommended === true,
    disponible: b.available !== false,
    orden: b.order || 0,
  });
  res.status(201).json(aPlato(fila));
}));

router.patch("/api/menu/:id", manejar(async (req, res) => {
  const b = req.body || {};
  const cambios = {};
  if (b.name !== undefined) cambios.nombre = b.name;
  if (b.category !== undefined) cambios.categoria = b.category;
  if (b.description !== undefined) cambios.descripcion = b.description;
  if (b.price !== undefined) cambios.precio = b.price;
  if (b.allergens !== undefined) cambios.alergenos = b.allergens;
  if (b.recommended !== undefined) cambios.destacado = b.recommended;
  if (b.available !== undefined) cambios.disponible = b.available;
  if (b.order !== undefined) cambios.orden = b.order;

  const fila = await db.actualizar(ctxDe(req), CARTA, req.params.id, cambios);
  if (siNoExiste(res, fila, "plato_no_encontrado")) return;
  res.json(aPlato(fila));
}));

router.delete("/api/menu/:id", manejar(async (req, res) => {
  await db.borrar(ctxDe(req), CARTA, req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
