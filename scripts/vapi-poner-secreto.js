/**
 * Pone un secreto compartido en las herramientas de un agente de Vapi.
 *
 * Sin él, `/vapi/tools` acepta a cualquiera: el id del agente no es secreto
 * (lo devuelve la propia pantalla de Configuración), así que quien lo tenga
 * puede crear, cambiar y anular reservas del restaurante. Con el secreto, Vapi
 * lo manda en la cabecera `x-vapi-secret` y la app rechaza lo que no lo lleve.
 *
 *   node scripts/vapi-poner-secreto.js <assistantId> [slug]            # simulacro
 *   node scripts/vapi-poner-secreto.js <assistantId> [slug] --aplicar
 *
 * El secreto se genera aquí y se imprime UNA vez: hay que copiarlo a la
 * variable VAPI_WEBHOOK_SECRET del servidor. Se puede fijar uno concreto con
 * --secreto=<valor> (útil para repetir el mismo en otro agente).
 *
 * ORDEN IMPORTANTE: primero aquí, después en el servidor. Al revés, la app
 * empezaría a exigir una cabecera que Vapi todavía no manda y rechazaría todas
 * las llamadas mientras tanto.
 */

require("dotenv").config();

const crypto = require("crypto");
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
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const fijado = args.find((a) => a.startsWith("--secreto="))?.split("=")[1];
  const [assistantId, slug = "el-sazon-venezolano"] = args.filter((a) => !a.startsWith("--"));

  if (!assistantId) throw new Error("Falta el assistantId.");

  const secreto = fijado || crypto.randomBytes(32).toString("hex");
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
  console.log(aplicar ? "\nAPLICANDO\n" : "\nSIMULACRO (usa --aplicar)\n");

  let tocadas = 0;
  for (const id of ids) {
    const t = await vapi(`/tool/${id}`);
    const nombre = t.function?.name || t.name || id;

    // Las nativas de Vapi no llaman a ningún servidor: no hay nada que firmar.
    if (t.type !== "function" || !t.server?.url) {
      console.log(`  -  ${nombre}: sin servidor propio, se deja`);
      continue;
    }

    console.log(`  -> ${nombre}`);
    if (aplicar) {
      // Se reenvía la url junto al secreto: mandar `server` sin ella la borraría.
      await vapi(`/tool/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          server: { url: t.server.url, timeoutSeconds: t.server.timeoutSeconds || 20, secret: secreto },
        }),
      });
    }
    tocadas++;
  }

  if (!aplicar) {
    console.log(`\n${tocadas} herramienta(s) recibirían el secreto. Nada cambiado.`);
    return;
  }

  console.log(`\n${tocadas} herramienta(s) actualizadas.\n`);
  console.log("=".repeat(70));
  console.log("Cópialo AHORA en el servidor (Railway → Variables). No se vuelve a mostrar:");
  console.log(`\n  VAPI_WEBHOOK_SECRET=${secreto}\n`);
  console.log("Trátalo como una contraseña. Hasta que no esté puesto y desplegado,");
  console.log("la app sigue aceptando llamadas sin comprobar nada.");
  console.log("=".repeat(70));
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
