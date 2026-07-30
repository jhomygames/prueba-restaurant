/**
 * Añade a cada restaurante los campos que el flujo de n8n/Vapi ya capturaba y
 * nuestro esquema no tenía, para que al conectar Vapi no se pierda nada.
 *
 *   node scripts/add-n8n-fields.js            (todos los restaurantes)
 *   node scripts/add-n8n-fields.js --slug el-sazon-venezolano
 *
 * Qué añade:
 *   Reservas.Turno         comida | cena — turno de servicio
 *   Reservas.CodigoReserva "RES-123456-789" legible por teléfono
 *   Reservas.LopdAcepta    consentimiento de datos (obligatorio en España)
 *   Clientes.IdiomaPreferido / Clientes.LopdAcepta
 *   Tabla Historial        traza de cambios de cada reserva
 *
 * Es idempotente: lo que ya existe se deja intacto, así que se puede volver a
 * ejecutar sin miedo tras dar de alta restaurantes nuevos.
 */

const path = require("path");
const PROJECT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(PROJECT, ".env") });

const PAT = process.env.AIRTABLE_API_KEY;
const REGISTRO = process.env.REGISTRO_BASE_ID;
const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: H, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const CAMPOS_RESERVAS = [
  { name: "Turno", type: "singleSelect", options: { choices: [{ name: "comida" }, { name: "cena" }] } },
  { name: "CodigoReserva", type: "singleLineText" },
  { name: "LopdAcepta", type: "checkbox", options: { icon: "check", color: "greenBright" } },
];

const CAMPOS_CLIENTES = [
  {
    name: "IdiomaPreferido",
    type: "singleSelect",
    options: { choices: ["es", "en", "fr", "de", "it", "pt", "ca"].map((name) => ({ name })) },
  },
  { name: "LopdAcepta", type: "checkbox", options: { icon: "check", color: "greenBright" } },
];

/**
 * Traza de cambios. La versión de n8n guardaba dos JSON completos (antes y
 * después) por cada cambio, lo que obliga a compararlos a ojo para ver qué pasó.
 * Aquí se guarda además un resumen legible ("hora: 21:00 -> 13:30"), que es lo
 * que el personal necesita leer de un vistazo ante una reclamación.
 */
const TABLA_HISTORIAL = {
  name: "Historial",
  description: "Traza de cambios de las reservas (quién, cuándo y qué cambió)",
  fields: [
    { name: "Cuando", type: "singleLineText" },
    { name: "CodigoReserva", type: "singleLineText" },
    { name: "ReservaId", type: "singleLineText" },
    {
      name: "Accion",
      type: "singleSelect",
      options: {
        choices: ["created", "modified", "cancelled", "seated", "completed"].map((name) => ({ name })),
      },
    },
    {
      name: "Canal",
      type: "singleSelect",
      options: {
        choices: ["panel", "voz", "whatsapp", "thefork", "demo", "n8n"].map((name) => ({ name })),
      },
    },
    { name: "Cambios", type: "multilineText" },
    { name: "DatosNuevos", type: "multilineText" },
  ],
};

async function asegurarCampos(baseId, tablaNombre, campos, esquema) {
  const tabla = esquema.tables.find((t) => t.name === tablaNombre);
  if (!tabla) {
    console.log(`    (sin tabla ${tablaNombre}, se omite)`);
    return 0;
  }
  const existentes = new Set(tabla.fields.map((f) => f.name));
  let añadidos = 0;
  for (const campo of campos) {
    if (existentes.has(campo.name)) continue;
    await api(`https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tabla.id}/fields`, {
      method: "POST",
      body: JSON.stringify(campo),
    });
    console.log(`    + ${tablaNombre}.${campo.name}`);
    añadidos++;
  }
  return añadidos;
}

// El catálogo de Origen NO se amplía aquí a propósito: todas las escrituras del
// backend usan `typecast: true`, y Airtable crea la opción que falte ("n8n") la
// primera vez que se usa. Intentar añadirla por la API de esquema falla con 422
// y no aporta nada.

async function main() {
  if (!PAT) throw new Error("Falta AIRTABLE_API_KEY en .env");
  if (!REGISTRO) throw new Error("Falta REGISTRO_BASE_ID en .env");

  const args = process.argv.slice(2);
  const slugFiltro = args.indexOf("--slug") > -1 ? args[args.indexOf("--slug") + 1] : null;

  const { records } = await api(`https://api.airtable.com/v0/${REGISTRO}/Restaurantes`);
  const restaurantes = records
    .map((r) => ({ nombre: r.fields.Nombre, slug: r.fields.Slug, baseId: r.fields.BaseId }))
    .filter((r) => r.baseId)
    .filter((r) => !slugFiltro || r.slug === slugFiltro);

  if (restaurantes.length === 0) throw new Error("Ningún restaurante que actualizar");

  for (const r of restaurantes) {
    console.log(`\n${r.nombre} (${r.slug})`);
    const esquema = await api(`https://api.airtable.com/v0/meta/bases/${r.baseId}/tables`);

    let n = 0;
    n += await asegurarCampos(r.baseId, "Reservas", CAMPOS_RESERVAS, esquema);
    n += await asegurarCampos(r.baseId, "Clientes", CAMPOS_CLIENTES, esquema);

    if (!esquema.tables.some((t) => t.name === "Historial")) {
      await api(`https://api.airtable.com/v0/meta/bases/${r.baseId}/tables`, {
        method: "POST",
        body: JSON.stringify(TABLA_HISTORIAL),
      });
      console.log("    + tabla Historial");
      n++;
    }

    if (n === 0) console.log("    (ya estaba todo al día)");
  }

  console.log("\nListo.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
