/**
 * Cambia el nombre de un agente en Vapi.
 *
 * El nombre es solo la etiqueta del panel: el cliente nunca lo oye (lo que oye
 * es el saludo). Sirve para distinguir de un vistazo cuál es el agente que está
 * atendiendo de verdad, que con varios en la cuenta deja de ser evidente.
 *
 *   node scripts/vapi-renombrar.js <assistantId> "<nombre nuevo>" [slug]
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
  const [assistantId, nombreNuevo, slug = "el-sazon-venezolano"] = process.argv.slice(2);
  if (!assistantId || !nombreNuevo) {
    throw new Error('Uso: node scripts/vapi-renombrar.js <assistantId> "<nombre nuevo>" [slug]');
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

  const antes = await vapi(`/assistant/${assistantId}`);
  console.log(`Antes:   ${antes.name}`);

  // Solo el nombre. Mandar cualquier otro campo en el PATCH arriesga a pisar
  // el guion, que es justo lo que aquí no se quiere tocar.
  const despues = await vapi(`/assistant/${assistantId}`, {
    method: "PATCH",
    body: JSON.stringify({ name: nombreNuevo }),
  });
  console.log(`Después: ${despues.name}`);

  const guionIgual = antes.model?.messages?.[0]?.content === despues.model?.messages?.[0]?.content;
  console.log(guionIgual ? "El guion sigue intacto." : "AVISO: el guion ha cambiado, revísalo.");
})().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
