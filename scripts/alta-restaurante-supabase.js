/**
 * Alta de un restaurante nuevo sobre Supabase.
 *
 *   node scripts/alta-restaurante-supabase.js --nombre "Mi Local" [--slug mi-local] [--desde el-sazon-venezolano]
 *
 * Diferencia con el alta sobre Airtable, que es el motivo de todo el cambio:
 * allí había que CREAR UNA BASE nueva con sus cinco tablas, sus tipos de campo
 * y sus enlaces —lento, con pasos que se olvidaban, y una base más que mantener
 * por cada local—. Aquí solo se insertan filas en las tablas que ya existen.
 *
 * El plano y la carta se copian de un restaurante que se toma como plantilla,
 * porque empezar con 17 mesas y una carta razonable es mucho más útil que
 * empezar en blanco; luego cada local las ajusta desde el panel.
 *
 * Es idempotente: si el slug ya tiene mesas, no las duplica.
 */

const path = require("path");
const PROYECTO = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(PROYECTO, ".env") });

const db = require(path.join(PROYECTO, "src/services/supabaseClient"));

function argumentos() {
  const args = process.argv.slice(2);
  const leer = (bandera) => {
    const i = args.indexOf(bandera);
    return i > -1 ? args[i + 1] : null;
  };
  const nombre = leer("--nombre");
  if (!nombre) {
    console.error(
      'Uso: node scripts/alta-restaurante-supabase.js --nombre "Mi Local" [--slug mi-local] [--desde el-sazon-venezolano]'
    );
    process.exit(1);
  }
  const slug =
    leer("--slug") ||
    nombre
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  return { nombre, slug, plantilla: leer("--desde") || "el-sazon-venezolano" };
}

/** Copia filas de un restaurante a otro, quitando lo que no debe heredarse. */
async function copiar(tabla, plantilla, destino, limpiar = (f) => f) {
  const origen = await db.listar({ restaurante: plantilla }, tabla);
  if (origen.length === 0) {
    console.log(`  ${tabla}: la plantilla no tiene filas, se omite`);
    return 0;
  }

  const yaHay = await db.listar({ restaurante: destino }, tabla, { limite: 1 });
  if (yaHay.length > 0) {
    console.log(`  ${tabla}: ya tenía filas, no se duplica`);
    return 0;
  }

  for (const fila of origen) {
    // `id`, `created_at` y `restaurante` los pone la base o el cliente.
    const { id, created_at, restaurante, ...resto } = fila;
    await db.crear({ restaurante: destino }, tabla, limpiar(resto));
  }
  console.log(`  ${tabla}: ${origen.length} filas copiadas`);
  return origen.length;
}

(async () => {
  const { nombre, slug, plantilla } = argumentos();
  console.log(`\nAlta de "${nombre}" (${slug}), copiando de "${plantilla}"\n`);

  // El plano arranca entero libre: heredar el estado del servicio de otro local
  // no tendría ningún sentido.
  await copiar("mesas", plantilla, slug, (m) => ({ ...m, estado: "Libre" }));
  await copiar("carta", plantilla, slug);

  const mesas = await db.listar({ restaurante: slug }, "mesas");
  const carta = await db.listar({ restaurante: slug }, "carta");
  const aforo = mesas.reduce((t, m) => t + (m.capacidad || 0), 0);

  console.log(`\nListo: ${mesas.length} mesas (aforo ${aforo}) y ${carta.length} platos.`);
  console.log("Siguiente paso: crear su usuario de acceso y ajustar plano y carta desde el panel.\n");
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
