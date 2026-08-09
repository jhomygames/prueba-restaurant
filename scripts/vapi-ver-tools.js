/**
 * Muestra las herramientas de un assistant de Vapi: tipo, nombre, a dónde
 * apuntan y qué parámetros aceptan.
 *
 * Cuando las herramientas viven como objetos aparte (toolIds) y no dentro del
 * modelo, no se ven en la configuración del assistant: hay que ir a buscarlas
 * una a una. Esto lo hace de golpe.
 *
 *   node scripts/vapi-ver-tools.js <assistantId> [slug]
 */

require("dotenv").config();

const { decrypt } = require("../src/services/secretBox");

async function claveDe(slug) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(
    `${url}/rest/v1/restaurantes?slug=eq.${encodeURIComponent(slug)}&select=vapi_api_key_enc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const clave = decrypt((await res.json())[0]?.vapi_api_key_enc);
  if (!clave) throw new Error("No se puede descifrar la clave de Vapi.");
  return clave;
}

(async () => {
  const [assistantId, slug = "el-sazon-venezolano"] = process.argv.slice(2);
  if (!assistantId) throw new Error("Falta el assistantId.");

  const clave = await claveDe(slug);
  const get = async (p) => {
    const r = await fetch(`https://api.vapi.ai${p}`, {
      headers: { Authorization: `Bearer ${clave}` },
    });
    if (!r.ok) throw new Error(`Vapi ${r.status} en ${p}`);
    return r.json();
  };

  const a = await get(`/assistant/${assistantId}`);
  const ids = a.model?.toolIds || a.toolIds || [];
  console.log(`${a.name} — ${ids.length} herramienta(s)\n`);

  for (const id of ids) {
    const t = await get(`/tool/${id}`);
    const nombre = t.function?.name || t.name || "(sin nombre)";
    const destino = t.server?.url || "(sin server url — es nativa de Vapi)";
    console.log(`  ${nombre}`);
    console.log(`    id:     ${t.id}`);
    console.log(`    tipo:   ${t.type}`);
    console.log(`    apunta: ${destino}`);
    const props = t.function?.parameters?.properties;
    if (props) {
      console.log(`    params: ${Object.keys(props).join(", ")}`);
      const req = t.function?.parameters?.required;
      if (req?.length) console.log(`    oblig.: ${req.join(", ")}`);
    }
    if (t.messages?.length) {
      const dichos = t.messages
        .filter((m) => m.contents?.[0]?.text || m.content)
        .map((m) => `${m.type}: "${(m.contents?.[0]?.text || m.content || "").slice(0, 60)}"`);
      if (dichos.length) console.log(`    dice:   ${dichos.join(" | ")}`);
    }
    console.log();
  }
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
