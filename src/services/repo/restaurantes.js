/**
 * Directorio de restaurantes y usuarios, sobre Supabase.
 *
 * Sustituye a `registry.js`, que consultaba la base Registro de Airtable. La
 * diferencia importante no es de dónde lee, sino que **el restaurante ya no
 * lleva un `baseId`**: ahora es un `slug` que se usa como filtro en cada
 * consulta. Todo lo que reciba un restaurante debe pasarlo como `ctx`.
 *
 * Se cachea en memoria un minuto porque se consulta en cada petición del panel
 * y en cada llamada del agente, y el directorio cambia de higos a brevas.
 */

const db = require("../supabaseClient");

const T_RESTAURANTES = "restaurantes";
const T_USUARIOS = "usuarios";
const TTL_MS = 60 * 1000;

// Las tablas del directorio no llevan columna `restaurante`: son la tabla que
// define quiénes son los restaurantes. Se consultan sin filtro de tenant.
const SIN_TENANT = { restaurante: null };

let cache = null; // { at, locales }

/** Forma pública de un restaurante. `ctx` es lo que se pasa a todo lo demás. */
function aRestaurante(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    slug: fila.slug,
    nombre: fila.nombre,
    activo: fila.activo === true,
    // Lo que hay que pasar a cualquier consulta de datos de este local.
    ctx: { restaurante: fila.slug },
    vapi: {
      assistantId: fila.vapi_assistant_id || "",
      telefono: fila.vapi_telefono || "",
    },
    whatsapp: { numero: fila.whatsapp_numero || "" },
    googleReviewUrl: fila.google_review_url || "",
    staffWhatsApp: fila.staff_whatsapp || "",
    zonaHoraria: fila.zona_horaria || "Europe/Madrid",
  };
}

async function todos({ forzar = false } = {}) {
  if (!forzar && cache && Date.now() - cache.at < TTL_MS) return cache.locales;
  const filas = await db.listar(SIN_TENANT, T_RESTAURANTES, { orden: "nombre.asc" });
  const locales = filas.map(aRestaurante);
  cache = { at: Date.now(), locales };
  return locales;
}

function invalidar() {
  cache = null;
}

async function porSlug(slug) {
  const s = String(slug || "").toLowerCase();
  return (await todos()).find((r) => r.slug.toLowerCase() === s) || null;
}

async function activos() {
  return (await todos()).filter((r) => r.activo);
}

/** Solo los últimos 9 dígitos: cada canal manda el número de una forma. */
function clave(numero) {
  return String(numero || "").replace(/[^0-9]/g, "").slice(-9);
}

/**
 * Resuelve el local de una llamada de voz.
 *
 * El assistant identifica sin ambigüedad; el número es el respaldo por si el
 * aviso llegara sin él. Se hace en JavaScript y no llamando a la función
 * `resolver_restaurante` de la base porque aquí ya tenemos el directorio en
 * caché: una consulta más por llamada no aporta nada.
 */
async function porVapi({ assistantId, telefono }) {
  const lista = await todos();
  if (assistantId) {
    const porAssistant = lista.find((r) => r.vapi.assistantId === assistantId);
    if (porAssistant) return porAssistant;
  }
  if (telefono) {
    const k = clave(telefono);
    return lista.find((r) => r.vapi.telefono && clave(r.vapi.telefono) === k) || null;
  }
  return null;
}

/**
 * Resuelve el local de un WhatsApp entrante por el número AL QUE escribe el
 * cliente. Twilio lo manda como "whatsapp:+34...".
 */
async function porWhatsApp(destino) {
  const k = clave(destino);
  if (!k) return null;
  return (await todos()).find((r) => r.whatsapp.numero && clave(r.whatsapp.numero) === k) || null;
}

// ---------- Usuarios ----------

function aUsuario(fila) {
  return {
    id: fila.id,
    email: (fila.email || "").toLowerCase(),
    passwordHash: fila.password_hash || "",
    nombre: fila.nombre_staff || "",
    rol: fila.rol || "staff",
    activo: fila.activo === true,
    restaurante: fila.restaurante,
  };
}

/**
 * Busca un usuario por email. Sin caché a propósito: el login es poco frecuente
 * y no queremos servir un hash viejo después de un cambio de contraseña.
 */
async function usuarioPorEmail(email) {
  const objetivo = String(email || "").toLowerCase().trim();
  if (!objetivo) return null;
  const filas = await db.listar(SIN_TENANT, T_USUARIOS, {
    filtros: { email: objetivo },
    limite: 1,
  });
  return filas[0] ? aUsuario(filas[0]) : null;
}

async function usuarioPorId(id) {
  const filas = await db.listar(SIN_TENANT, T_USUARIOS, { filtros: { id }, limite: 1 });
  return filas[0] ? aUsuario(filas[0]) : null;
}

async function crearUsuario(datos) {
  return db.crear(SIN_TENANT, T_USUARIOS, datos);
}

/** Cambio de contraseña y poco más. No toca el restaurante del usuario. */
async function actualizarUsuario(id, cambios) {
  return db.actualizar(SIN_TENANT, T_USUARIOS, id, cambios);
}

async function actualizarRestaurante(id, cambios) {
  const fila = await db.actualizar(SIN_TENANT, T_RESTAURANTES, id, cambios);
  invalidar();
  return aRestaurante(fila);
}

module.exports = {
  todos,
  activos,
  porSlug,
  porVapi,
  porWhatsApp,
  usuarioPorEmail,
  usuarioPorId,
  crearUsuario,
  actualizarUsuario,
  actualizarRestaurante,
  invalidar,
  _formas: { aRestaurante, aUsuario },
};
