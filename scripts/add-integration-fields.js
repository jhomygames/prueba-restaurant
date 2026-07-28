/**
 * Añade los campos necesarios para las integraciones con plataformas de
 * reservas de terceros (TheFork, Covermanager…).
 *
 *   node scripts/add-integration-fields.js
 *
 * Idempotente: se puede ejecutar tantas veces como haga falta; si un campo ya
 * existe, lo salta. Toca DOS sitios:
 *
 *   1. La base de CADA restaurante registrado:
 *        Reservas.Origen      — de dónde vino la reserva
 *        Reservas.ExternalId  — su id en la plataforma externa (para deduplicar)
 *
 *   2. La base central `Registro` (tabla Restaurantes): la configuración del
 *      conector de cada local.
 *
 * Los restaurantes nuevos ya nacen con todo esto (ver provision-restaurant.js).
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

const meta = (baseId, p = "") => `https://api.airtable.com/v0/meta/bases/${baseId}/tables${p}`;

// Catálogo de orígenes. Los valores nuevos también entrarían solos vía
// typecast, pero declararlos aquí documenta de dónde puede venir una reserva.
const ORIGENES = ["panel", "voz", "whatsapp", "thefork", "demo"];
const PROVEEDORES = ["thefork", "demo"];

const CAMPOS_RESERVAS = [
  {
    name: "Origen",
    type: "singleSelect",
    options: { choices: ORIGENES.map((name) => ({ name })) },
  },
  { name: "ExternalId", type: "singleLineText" },
];

const CAMPOS_REGISTRO = [
  {
    name: "IntegracionProveedor",
    type: "singleSelect",
    options: { choices: PROVEEDORES.map((name) => ({ name })) },
  },
  { name: "IntegracionApiKeyEnc", type: "multilineText" },
  { name: "IntegracionRestauranteId", type: "singleLineText" },
  { name: "IntegracionWebhookSecretEnc", type: "multilineText" },
  {
    name: "IntegracionActiva",
    type: "checkbox",
    options: { icon: "check", color: "greenBright" },
  },
  { name: "IntegracionUltimaSync", type: "singleLineText" },
];

/** Crea los campos que falten en una tabla. Devuelve cuántos creó. */
async function ensureFields(baseId, tableName, campos) {
  const schema = await api(meta(baseId));
  const tabla = schema.tables.find((t) => t.name === tableName);
  if (!tabla) {
    console.log(`  ⚠ la tabla ${tableName} no existe en ${baseId}, se salta`);
    return 0;
  }
  let creados = 0;
  for (const campo of campos) {
    if (tabla.fields.some((f) => f.name === campo.name)) {
      console.log(`  · ${tableName}.${campo.name} ya existe`);
      continue;
    }
    await api(meta(baseId, `/${tabla.id}/fields`), {
      method: "POST",
      body: JSON.stringify(campo),
    });
    console.log(`  ✓ ${tableName}.${campo.name} creado`);
    creados++;
  }
  return creados;
}

async function main() {
  if (!PAT) throw new Error("Falta AIRTABLE_API_KEY en .env");
  if (!REGISTRO) throw new Error("Falta REGISTRO_BASE_ID en .env");

  // --- 1. Base central: configuración del conector por restaurante ---
  console.log(`\nRegistro central (${REGISTRO}):`);
  await ensureFields(REGISTRO, "Restaurantes", CAMPOS_REGISTRO);

  // --- 2. Base de cada restaurante ---
  const restaurantes = await api(`https://api.airtable.com/v0/${REGISTRO}/Restaurantes`);
  for (const rec of restaurantes.records) {
    const nombre = rec.fields.Nombre || rec.fields.Slug || rec.id;
    const baseId = rec.fields.BaseId;
    if (!baseId) {
      console.log(`\n${nombre}: sin BaseId, se salta`);
      continue;
    }
    console.log(`\n${nombre} (${baseId}):`);
    try {
      await ensureFields(baseId, "Reservas", CAMPOS_RESERVAS);
    } catch (err) {
      // Una base caída no debe impedir actualizar el resto.
      console.error(`  ✗ error en ${nombre}: ${err.message}`);
    }
  }

  console.log("\nListo.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
