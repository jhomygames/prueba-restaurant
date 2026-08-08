/**
 * Cliente de datos sobre Supabase (PostgREST).
 *
 * Sustituye a `airtableClient`. La diferencia de fondo no es el proveedor sino
 * cómo se separan los restaurantes:
 *
 *   Airtable  -> una BASE distinta por restaurante (`baseId`)
 *   Supabase  -> una sola base, y una COLUMNA `restaurante` en cada tabla
 *
 * Eso es lo que hace que dar de alta un local nuevo pase de "crear una base con
 * sus cinco tablas" a "insertar unas filas".
 *
 * A cambio, el aislamiento ya no lo garantiza la infraestructura sino el
 * código: si una consulta olvida filtrar por `restaurante`, devuelve datos de
 * todos los locales. Por eso **el tenant es siempre el primer argumento y
 * obligatorio**, igual que lo era `baseId`: una llamada que lo omita falla en
 * el acto en vez de leer o escribir donde no debe.
 */

/**
 * Tablas que NO llevan columna `restaurante`, y por tanto no se filtran por él.
 *
 * Son excepciones justificadas una a una, no una lista de comodidad. Cualquier
 * tabla con datos de un local concreto debe quedar fuera de aquí: estar en esta
 * lista significa renunciar al aislamiento.
 *
 *   restaurantes  — es la tabla que DEFINE los locales; filtrarla por local no
 *                   tiene sentido.
 *   usuarios      — el login busca por email antes de saber de qué local es
 *                   quien entra. Tiene columna `restaurante`, pero como dato,
 *                   no como filtro: es lo que se usa DESPUÉS para montar la
 *                   sesión.
 *   historial_reservas — la traza de n8n, que no distingue local todavía.
 */
const TABLAS_SIN_TENANT = new Set(["restaurantes", "usuarios", "historial_reservas"]);

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      "Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY: la app no puede acceder a la base de datos."
    );
  }
  return { url: url.replace(/\/+$/, ""), key };
}

function cabeceras(extra = {}) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * El tenant nunca es opcional. Se comprueba aquí y no en cada llamada porque
 * olvidarlo no da error en Supabase: simplemente devuelve las filas de todos
 * los restaurantes, que es el fallo más caro posible en un sistema como este.
 */
function exigirTenant(ctx, tabla) {
  if (TABLAS_SIN_TENANT.has(tabla)) return null;
  const r = typeof ctx === "string" ? ctx : ctx && ctx.restaurante;
  if (!r) {
    throw new Error(
      `Consulta a "${tabla}" sin restaurante: se leerían o escribirían datos de todos los locales.`
    );
  }
  return r;
}

async function pedir(ruta, opciones = {}) {
  const { url } = config();
  const res = await fetch(`${url}/rest/v1/${ruta}`, {
    ...opciones,
    headers: cabeceras(opciones.headers),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(`Supabase ${res.status} en ${ruta}: ${detalle.slice(0, 300)}`);
  }
  // Un DELETE o un PATCH sin `return=representation` no devuelven cuerpo.
  const texto = await res.text();
  return texto ? JSON.parse(texto) : null;
}

/**
 * Escapa un valor para usarlo dentro de un filtro de PostgREST.
 *
 * Sin esto, un nombre con una coma («Pérez, Ana») partiría el filtro en dos
 * condiciones y la consulta devolvería lo que no debe. Es el mismo tipo de
 * fallo que ya nos mordió con las fórmulas de Airtable.
 */
function valor(v) {
  const s = String(v == null ? "" : v);
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Lee filas de una tabla.
 *
 * @param ctx      { restaurante } — obligatorio salvo en tablas compartidas
 * @param tabla    nombre de la tabla
 * @param opciones filtros: objeto { columna: valor } o { columna: ['gte', valor] }
 *                 orden:   "fecha.asc"
 *                 limite:  número máximo de filas
 *                 columnas: lista a devolver (por defecto todas)
 */
async function listar(ctx, tabla, opciones = {}) {
  const tenant = exigirTenant(ctx, tabla);
  const partes = [`select=${opciones.columnas || "*"}`];

  if (tenant) partes.push(`restaurante=eq.${encodeURIComponent(tenant)}`);

  for (const [columna, condicion] of Object.entries(opciones.filtros || {})) {
    const [operador, v] = Array.isArray(condicion) ? condicion : ["eq", condicion];
    partes.push(`${columna}=${operador}.${encodeURIComponent(v)}`);
  }

  if (opciones.orden) partes.push(`order=${opciones.orden}`);
  if (opciones.limite) partes.push(`limit=${opciones.limite}`);

  return (await pedir(`${tabla}?${partes.join("&")}`)) || [];
}

/** Una fila por su id, o null si no existe. */
async function obtener(ctx, tabla, id) {
  const filas = await listar(ctx, tabla, { filtros: { id }, limite: 1 });
  return filas[0] || null;
}

/** Inserta y devuelve la fila creada, con el restaurante ya puesto. */
async function crear(ctx, tabla, fila) {
  const tenant = exigirTenant(ctx, tabla);
  const cuerpo = tenant ? { ...fila, restaurante: tenant } : fila;
  const filas = await pedir(tabla, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(cuerpo),
  });
  return Array.isArray(filas) ? filas[0] : filas;
}

/**
 * Actualiza una fila. El filtro incluye SIEMPRE el restaurante además del id:
 * así, un id de otro local no modifica nada en vez de escribir donde no debe.
 */
async function actualizar(ctx, tabla, id, cambios) {
  const tenant = exigirTenant(ctx, tabla);
  const filtro = [`id=eq.${encodeURIComponent(id)}`];
  if (tenant) filtro.push(`restaurante=eq.${encodeURIComponent(tenant)}`);

  const filas = await pedir(`${tabla}?${filtro.join("&")}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(cambios),
  });
  return Array.isArray(filas) ? filas[0] : filas;
}

/** Borra una fila, con la misma protección de tenant que `actualizar`. */
async function borrar(ctx, tabla, id) {
  const tenant = exigirTenant(ctx, tabla);
  const filtro = [`id=eq.${encodeURIComponent(id)}`];
  if (tenant) filtro.push(`restaurante=eq.${encodeURIComponent(tenant)}`);
  await pedir(`${tabla}?${filtro.join("&")}`, { method: "DELETE" });
  return true;
}

module.exports = { listar, obtener, crear, actualizar, borrar, valor, exigirTenant };
