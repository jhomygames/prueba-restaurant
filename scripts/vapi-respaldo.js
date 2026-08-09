/**
 * Copia de seguridad y restauración de la configuración de Vapi.
 *
 * Existe porque cambiar un assistant o un número de teléfono en Vapi es una
 * operación sin deshacer: no hay historial ni papelera. Antes de tocar la línea
 * de un restaurante que está atendiendo llamadas hay que poder volver atrás con
 * una orden, no reconstruyendo a mano lo que había.
 *
 *   node scripts/vapi-respaldo.js guardar [slug]
 *   node scripts/vapi-respaldo.js restaurar <fichero.json>
 *
 * El fichero se escribe en `respaldos-vapi/` (ignorado por git: es
 * configuración de una cuenta ajena, no del proyecto). NUNCA guarda la clave.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { decrypt } = require("../src/services/secretBox");

const VAPI_API = "https://api.vapi.ai";
const DIR = path.join(__dirname, "..", "respaldos-vapi");

async function claveDe(slug) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY.");

  const res = await fetch(
    `${url}/rest/v1/restaurantes?slug=eq.${encodeURIComponent(slug)}&select=vapi_api_key_enc`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const filas = await res.json();
  const enc = filas[0]?.vapi_api_key_enc;
  if (!enc) throw new Error(`${slug} no tiene clave de Vapi guardada.`);

  const clave = decrypt(enc);
  if (!clave) {
    throw new Error(
      "No se puede descifrar la clave: TENANT_SECRETS_KEY de este .env no coincide con la de producción."
    );
  }
  return clave;
}

async function vapi(clave, ruta, opciones = {}) {
  const res = await fetch(`${VAPI_API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${clave}`,
      "Content-Type": "application/json",
      ...(opciones.headers || {}),
    },
  });
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Vapi ${res.status} en ${ruta}: ${JSON.stringify(cuerpo).slice(0, 300)}`);
  }
  return cuerpo;
}

/** Campos que Vapi calcula y rechaza si se los devuelves en un PATCH. */
const CALCULADOS = ["id", "orgId", "createdAt", "updatedAt", "isServerUrlSecretSet"];

function limpiar(objeto) {
  const copia = { ...objeto };
  CALCULADOS.forEach((k) => delete copia[k]);
  return copia;
}

async function guardar(slug) {
  const clave = await claveDe(slug);

  const assistants = await vapi(clave, "/assistant?limit=100");
  const numeros = await vapi(clave, "/phone-number");

  const respaldo = {
    guardadoEn: new Date().toISOString(),
    slug,
    assistants: Array.isArray(assistants) ? assistants : assistants?.results || [],
    numeros: Array.isArray(numeros) ? numeros : [],
  };

  fs.mkdirSync(DIR, { recursive: true });
  const nombre = `vapi-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const destino = path.join(DIR, nombre);
  fs.writeFileSync(destino, JSON.stringify(respaldo, null, 2), "utf8");

  console.log(`Respaldo guardado en respaldos-vapi/${nombre}`);
  console.log(`  ${respaldo.assistants.length} assistant(s), ${respaldo.numeros.length} número(s).`);
  respaldo.assistants.forEach((a) =>
    console.log(`   - ${a.name} (${a.id}): ${a.model?.tools?.length ?? 0} herramienta(s)`)
  );
  respaldo.numeros.forEach((n) =>
    console.log(`   - ${n.number} -> assistant ${n.assistantId || "(ninguno)"}, server ${n.server?.url || "(ninguno)"}`)
  );
  return destino;
}

/**
 * Devuelve la cuenta al estado del fichero.
 *
 * Restaura assistants y números por separado y sigue adelante si uno falla: es
 * preferible recuperar tres de cuatro y saber cuál falta, a abortar y quedarse
 * con la cuenta a medias.
 */
async function restaurar(fichero) {
  const respaldo = JSON.parse(fs.readFileSync(fichero, "utf8"));
  const clave = await claveDe(respaldo.slug);

  console.log(`Restaurando el estado del ${respaldo.guardadoEn}...\n`);
  let fallos = 0;

  for (const a of respaldo.assistants) {
    try {
      await vapi(clave, `/assistant/${a.id}`, {
        method: "PATCH",
        body: JSON.stringify(limpiar(a)),
      });
      console.log(`  OK  assistant ${a.name}`);
    } catch (err) {
      fallos++;
      console.error(`  ERROR assistant ${a.name}: ${err.message}`);
    }
  }

  for (const n of respaldo.numeros) {
    try {
      // Del número solo se devuelve lo que se puede cambiar; el resto lo
      // gestiona el proveedor y Vapi rechaza que se lo mandes.
      await vapi(clave, `/phone-number/${n.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          assistantId: n.assistantId ?? null,
          squadId: n.squadId ?? null,
          server: n.server ?? null,
        }),
      });
      console.log(`  OK  número ${n.number}`);
    } catch (err) {
      fallos++;
      console.error(`  ERROR número ${n.number}: ${err.message}`);
    }
  }

  console.log(fallos === 0 ? "\nRestaurado por completo." : `\nRestaurado con ${fallos} fallo(s).`);
}

(async () => {
  const [orden, arg] = process.argv.slice(2);
  if (orden === "guardar") {
    await guardar(arg || "el-sazon-venezolano");
  } else if (orden === "restaurar") {
    if (!arg) throw new Error("Falta el fichero: node scripts/vapi-respaldo.js restaurar <fichero.json>");
    await restaurar(arg);
  } else {
    console.log("Uso:\n  node scripts/vapi-respaldo.js guardar [slug]\n  node scripts/vapi-respaldo.js restaurar <fichero.json>");
  }
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
