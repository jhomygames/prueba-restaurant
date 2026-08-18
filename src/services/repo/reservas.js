/**
 * Reservas, mesas, clientes y carta sobre Supabase.
 *
 * Devuelve las MISMAS formas que hoy produce la capa de Airtable, para que el
 * panel y el agente no noten el cambio de base. Eso permite migrar por partes:
 * primero la lectura, comprobar que se ve lo mismo, y solo entonces la
 * escritura. Al revés acabaríamos con reservas escritas en un sitio y leídas
 * del otro.
 *
 * `ctx` es siempre { restaurante: 'slug' }. El cliente falla si falta.
 */

const db = require("../supabaseClient");

const T_RESERVAS = "reservas";
const T_MESAS = "mesas";
const T_CLIENTES = "clientes";
const T_CARTA = "carta";

// Supabase guarda fecha y hora en columnas separadas; el resto de la app
// espera "YYYY-MM-DD HH:mm" y campos en inglés. La traducción vive aquí y solo
// aquí, para que un cambio de esquema no se derrame por todo el código.
const ESTADOS = {
  confirmed: "confirmada",
  cancelled: "cancelada",
  completed: "completada",
  pending: "pendiente",
  seated: "sentada",
};

function normalizarHora(hora) {
  const h = String(hora || "").trim();
  const m = h.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : h;
}

/** Fila de Supabase -> forma que ya usan el panel y el agente. */
function aReserva(fila) {
  if (!fila) return null;
  const hora = normalizarHora(fila.hora);
  const estado = ESTADOS[fila.status] || fila.status || "confirmada";
  return {
    id: String(fila.id),
    date: fila.fecha,
    time: hora,
    party_size: fila.personas,
    customer_name: fila.nombre,
    customer_phone: fila.telefono,
    notes: fila.notas || "",
    status: estado,
    table_id: fila.mesa_id ? String(fila.mesa_id) : null,
    reminded_24h: fila.recordatorio_24h === true,
    reminded_1h: fila.recordatorio_1h === true,
    review_requested: fila.resena_pedida === true,
    source: fila.origen || fila.canal || "panel",
    external_id: fila.external_id || null,
    code: fila.id_reserva || null,
    shift: fila.turno || "",
    allergens: fila.alergias || [],
    lopd: fila.lopd_acepta === true,
    // Minutos que ocupa la mesa. `null` = hereda la duración del local, así que
    // cambiarla en Configuración también afecta a las reservas ya hechas.
    duration_min: fila.duracion_min || null,
  };
}

function aMesa(fila) {
  const ESTADOS_MESA = {
    Libre: "free",
    Reservada: "reserved",
    Ocupada: "occupied",
    "Fuera de servicio": "out_of_service",
  };
  return {
    id: String(fila.id),
    name: fila.nombre,
    capacity: fila.capacidad,
    status: ESTADOS_MESA[fila.estado] || "free",
    x: fila.pos_x == null ? 50 : Number(fila.pos_x),
    y: fila.pos_y == null ? 50 : Number(fila.pos_y),
    shape: fila.forma || "square",
    rotation: fila.rotacion || 0,
    zone: fila.zona || "Interior",
  };
}

function aCliente(fila) {
  return {
    id: String(fila.id),
    phone: fila.telefono,
    name: fila.nombre,
    allergens: fila.alergenos_conocidos || [],
    preferences: fila.preferencias || "",
    last_visit: fila.ultima_visita || null,
    visits: fila.visitas || 0,
    lopd: fila.lopd_acepta === true,
  };
}

function aPlato(fila) {
  return {
    id: String(fila.id),
    name: fila.nombre,
    category: fila.categoria || "",
    description: fila.descripcion || "",
    price: fila.precio == null ? null : Number(fila.precio),
    allergens: fila.alergenos || [],
    featured: fila.destacado === true,
    available: fila.disponible !== false,
    order: fila.orden || 0,
  };
}

// ---------- Lectura ----------

/** Reservas de un día concreto, que es lo que pide el panel al cargar. */
async function reservasDelDia(ctx, fecha) {
  const filas = await db.listar(ctx, T_RESERVAS, {
    filtros: { fecha },
    orden: "hora.asc",
  });
  return filas.map(aReserva);
}

/** Todas las reservas a partir de una fecha (por defecto, desde hoy). */
async function reservasDesde(ctx, desde = new Date().toISOString().slice(0, 10)) {
  const filas = await db.listar(ctx, T_RESERVAS, {
    filtros: { fecha: ["gte", desde] },
    orden: "fecha.asc",
  });
  return filas.map(aReserva);
}

async function reservaPorCodigo(ctx, codigo) {
  const filas = await db.listar(ctx, T_RESERVAS, {
    filtros: { id_reserva: codigo },
    limite: 1,
  });
  return aReserva(filas[0]);
}

async function mesas(ctx) {
  const filas = await db.listar(ctx, T_MESAS, { orden: "nombre.asc" });
  return filas.map(aMesa);
}

async function clientes(ctx) {
  const filas = await db.listar(ctx, T_CLIENTES, { orden: "nombre.asc" });
  return filas.map(aCliente);
}

async function clientePorTelefono(ctx, telefono) {
  // Los teléfonos llegan con y sin prefijo según el canal, así que se compara
  // por los últimos 9 dígitos, igual que hace la resolución de restaurante.
  const clave = String(telefono || "").replace(/[^0-9]/g, "").slice(-9);
  if (!clave) return null;
  const todos = await db.listar(ctx, T_CLIENTES);
  const encontrado = todos.find(
    (c) => String(c.telefono || "").replace(/[^0-9]/g, "").slice(-9) === clave
  );
  return encontrado ? aCliente(encontrado) : null;
}

async function carta(ctx, { soloDisponibles = true } = {}) {
  const filas = await db.listar(ctx, T_CARTA, {
    filtros: soloDisponibles ? { disponible: true } : {},
    orden: "orden.asc",
  });
  return filas.map(aPlato);
}

module.exports = {
  reservasDelDia,
  reservasDesde,
  reservaPorCodigo,
  mesas,
  clientes,
  clientePorTelefono,
  carta,
  // Se exportan los traductores porque las pruebas y la migración necesitan
  // comparar forma a forma lo que devuelve cada base.
  _formas: { aReserva, aMesa, aCliente, aPlato },
};
