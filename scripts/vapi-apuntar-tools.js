/**
 * Reapunta las herramientas de un agente de Vapi hacia la app.
 *
 * Cambia SOLO el destino (`server.url`) de cada herramienta: no toca su nombre,
 * ni sus parámetros, ni las frases que dice mientras se ejecuta, ni el guion
 * del agente. El agente sigue hablando igual; solo cambia quién le contesta.
 *
 * Las herramientas nativas de Vapi (colgar, transferir) se dejan intactas: no
 * llaman a ningún servidor.
 *
 *   node scripts/vapi-apuntar-tools.js <assistantId> [slug]        # simulacro
 *   node scripts/vapi-apuntar-tools.js <assistantId> [slug] --aplicar
 *
 * Sin --aplicar solo enseña lo que haría. Antes de aplicar, guarda un respaldo
 * con scripts/vapi-respaldo.js.
 */

require("dotenv").config();

const { decrypt } = require("../src/services/secretBox");

const DESTINO = `${(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "")}/vapi/tools`;

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
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const [assistantId, slug = "el-sazon-venezolano"] = args.filter((a) => !a.startsWith("--"));

  if (!assistantId) throw new Error("Falta el assistantId.");
  if (!DESTINO.startsWith("http")) {
    throw new Error("Falta PUBLIC_BASE_URL: no se sabe a qué dirección apuntar las herramientas.");
  }

  const clave = await claveDe(slug);
  const vapi = async (ruta, opciones = {}) => {
    const r = await fetch(`https://api.vapi.ai${ruta}`, {
      ...opciones,
      headers: {
        Authorization: `Bearer ${clave}`,
        "Content-Type": "application/json",
        ...(opciones.headers || {}),
      },
    });
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Vapi ${r.status}: ${JSON.stringify(cuerpo).slice(0, 200)}`);
    return cuerpo;
  };

  const a = await vapi(`/assistant/${assistantId}`);
  const ids = a.model?.toolIds || a.toolIds || [];
  console.log(`${a.name} — ${ids.length} herramienta(s)`);
  console.log(`Destino: ${DESTINO}`);
  console.log(aplicar ? "\nAPLICANDO CAMBIOS\n" : "\nSIMULACRO (usa --aplicar para hacerlo de verdad)\n");

  for (const id of ids) {
    const t = await vapi(`/tool/${id}`);
    const nombre = t.function?.name || t.name || id;

    // Las nativas de Vapi (endCall, transferCall) no tienen servidor al que
    // apuntar: tocarlas solo puede romperlas.
    if (t.type !== "function") {
      console.log(`  -  ${nombre}: nativa de Vapi (${t.type}), se deja como está`);
      continue;
    }
    if (t.server?.url === DESTINO) {
      console.log(`  =  ${nombre}: ya apunta a la app`);
      continue;
    }

    console.log(`  -> ${nombre}: ${t.server?.url || "(sin destino)"}`);
    console.log(`       pasa a ${DESTINO}`);

    if (aplicar) {
      await vapi(`/tool/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ server: { url: DESTINO, timeoutSeconds: 20 } }),
      });
      console.log(`       hecho`);
    }
  }

  console.log(aplicar ? "\nListo." : "\nNada cambiado.");
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
