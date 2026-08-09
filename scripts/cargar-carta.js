/**
 * Sustituye la carta de un restaurante por la de un fichero JSON.
 *
 *   node scripts/cargar-carta.js <fichero.json> [slug]
 *   node scripts/cargar-carta.js <fichero.json> [slug] --aplicar
 *
 * Sin `--aplicar` solo enseña lo que haría. Antes de borrar nada guarda la
 * carta actual en `respaldos/`: es la única copia si algo sale torcido.
 *
 * LOS ALÉRGENOS SE DEDUCEN DEL TEXTO de cada plato con el mismo extractor que
 * usa el agente de voz. Es una ayuda, no una ficha técnica: donde la carta no
 * nombra un ingrediente, el alérgeno no aparece. Tiene que revisarlos el
 * restaurante antes de fiarse de ellos con un cliente alérgico.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const db = require("../src/services/supabaseClient");
const allergens = require("../src/services/allergens");

const CARTA = "carta";

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const [fichero, slug = "el-sazon-venezolano"] = args.filter((a) => !a.startsWith("--"));

  if (!fichero) throw new Error("Uso: node scripts/cargar-carta.js <fichero.json> [slug] [--aplicar]");

  const platos = JSON.parse(fs.readFileSync(fichero, "utf8"));
  const ctx = { restaurante: slug };

  const actuales = await db.listar(ctx, CARTA);
  console.log(`Carta actual de ${slug}: ${actuales.length} platos.`);
  console.log(`Carta nueva: ${platos.length} platos.\n`);

  // Se le da la categoría además del nombre y la descripción. Hace falta:
  // "Copa Saga — Verdejo, Rueda" no dice en ningún sitio que sea vino, y sin
  // eso no se marcarían sus sulfitos. Lo mismo con las cervezas.
  const preparados = platos.map((p, i) => {
    const texto = `${p.categoria}. ${p.nombre}. ${p.descripcion || ""}`;
    const { alergenos } = allergens.extraer(texto);
    return {
      nombre: p.nombre,
      categoria: p.categoria,
      descripcion: p.descripcion || "",
      precio: p.precio ?? null,
      alergenos,
      // Ninguno destacado: cuáles son los platos de la casa lo decide el
      // restaurante desde el panel, no yo desde un script.
      destacado: false,
      disponible: true,
      orden: i + 1,
    };
  });

  const sinAlergenos = preparados.filter((p) => p.alergenos.length === 0);
  const porCategoria = preparados.reduce((acc, p) => {
    acc[p.categoria] = (acc[p.categoria] || 0) + 1;
    return acc;
  }, {});

  console.log("Por categoría:");
  for (const [c, n] of Object.entries(porCategoria)) console.log(`  ${String(n).padStart(3)}  ${c}`);
  console.log(`\nSin ningún alérgeno detectado: ${sinAlergenos.length} platos`);
  console.log(sinAlergenos.map((p) => `  · ${p.nombre}`).join("\n"));

  if (!aplicar) {
    console.log("\nSIMULACRO. Nada cambiado. Usa --aplicar para hacerlo de verdad.");
    return;
  }

  // Respaldo antes de tocar: en Supabase no hay papelera.
  const dirRespaldos = path.join(__dirname, "..", "respaldos");
  fs.mkdirSync(dirRespaldos, { recursive: true });
  const respaldo = path.join(dirRespaldos, `carta-${slug}-${Date.now()}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(actuales, null, 2), "utf8");
  console.log(`\nRespaldo de la carta anterior: ${respaldo}`);

  console.log("Borrando la carta anterior...");
  for (const p of actuales) await db.borrar(ctx, CARTA, p.id);

  console.log("Cargando la nueva...");
  let hechos = 0;
  for (const p of preparados) {
    await db.crear(ctx, CARTA, p);
    hechos++;
    if (hechos % 25 === 0) console.log(`  ${hechos}/${preparados.length}`);
  }

  const final = await db.listar(ctx, CARTA);
  console.log(`\nListo: ${final.length} platos en la carta de ${slug}.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
