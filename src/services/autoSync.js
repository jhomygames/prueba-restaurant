/**
 * Sondeo periódico de las plataformas que hay que ir a consultar.
 *
 * Por qué dentro del servidor y no en Make, como los recordatorios: los
 * conectores de sondeo (Supabase) son la única vía por la que la app se entera
 * de un cambio hecho a mano en la plataforma. Dejar eso colgando de un servicio
 * externo, con su propio secreto y su plan gratuito de dos escenarios, es un
 * punto de fallo silencioso: si Make deja de disparar, el panel simplemente se
 * queda desactualizado sin que nadie lo note.
 *
 * El endpoint /internal/integrations/sync sigue existiendo: sirve para forzar
 * una pasada desde fuera y no estorba.
 *
 * Solo se sondea a los conectores que lo necesitan. Los que reciben webhook
 * (TheFork, n8n) ya nos avisan y sondearlos sería trabajo perdido.
 */

const registry = require("./registry");
const airtable = require("./airtableClient");
const connectors = require("./connectors");

const MINUTOS_POR_DEFECTO = 5;

let temporizador = null;
let enCurso = false;

function intervaloMs() {
  const m = Number(process.env.AUTO_SYNC_MINUTOS) || MINUTOS_POR_DEFECTO;
  // Menos de un minuto sería martillear la plataforma sin ganar nada.
  return Math.max(1, m) * 60 * 1000;
}

// Último día en que se limpiaron los estados de mesa, por restaurante.
const ultimoReinicio = new Map();

/**
 * Devuelve a "Libre" las mesas que quedaron marcadas como ocupadas o reservadas
 * en un servicio anterior.
 *
 * El campo `Estado` de una mesa no lleva fecha: describe el servicio en curso.
 * Nadie lo devuelve a su sitio al cerrar, así que una mesa que se marcó ocupada
 * el martes seguía apareciendo ocupada el jueves. Aquí se limpia una vez al
 * día, al primer sondeo tras la medianoche.
 *
 * "Fuera de servicio" no se toca: una mesa averiada sigue averiada mañana.
 */
async function reiniciarMesasDelDia(restaurante) {
  const hoy = new Date().toISOString().slice(0, 10);
  if (ultimoReinicio.get(restaurante.id) === hoy) return;

  const ctx = { baseId: restaurante.baseId };
  const mesas = await airtable.listRecords(ctx.baseId, "Mesas", {
    filterByFormula: `OR({Estado} = 'Ocupada', {Estado} = 'Reservada')`,
  });

  for (const m of mesas) {
    await airtable
      .updateRecord(ctx.baseId, "Mesas", m.id, { Estado: "Libre" }, { typecast: true })
      .catch((err) => console.error(`[autoSync] no se pudo liberar ${m.fields.Nombre}:`, err.message));
  }

  ultimoReinicio.set(restaurante.id, hoy);
  if (mesas.length > 0) {
    console.log(`[autoSync] ${restaurante.slug}: ${mesas.length} mesa(s) liberadas al empezar el día`);
  }
}

async function pasada() {
  // Una pasada que tarde más que el intervalo no debe solaparse con la
  // siguiente: duplicaría el trabajo y las llamadas a Airtable.
  if (enCurso) {
    console.warn("[autoSync] la pasada anterior sigue en curso, se salta esta");
    return;
  }
  enCurso = true;
  try {
    const locales = await registry.activeRestaurants();
    for (const restaurante of locales) {
      // Esto no depende del conector: las mesas se quedan colgadas igual en un
      // restaurante que reciba webhooks o que no tenga integración ninguna.
      await reiniciarMesasDelDia(restaurante).catch((err) =>
        console.error(`[autoSync] ${restaurante.slug} reinicio de mesas:`, err.message)
      );

      const adapter = connectors.getAdapter(restaurante.integracion?.proveedor);
      if (!adapter?.soloSondeo) continue; // los de webhook ya nos avisan

      try {
        const r = await connectors.syncTenant(restaurante);
        // "unchanged" e "ignored" son estado estable, no novedades: al sondear
        // se releen las mismas filas una y otra vez, así que aparecerían en
        // TODAS las pasadas. Solo se deja rastro de lo que de verdad cambió;
        // un log cada cinco minutos diciendo lo mismo tapa lo que importa.
        const cambios = (r.resultados || []).filter(
          (x) => x.action !== "unchanged" && x.action !== "ignored"
        );
        if (cambios.length > 0) {
          const resumen = cambios.reduce((acc, x) => {
            acc[x.action] = (acc[x.action] || 0) + 1;
            return acc;
          }, {});
          console.log(`[autoSync] ${restaurante.slug}:`, JSON.stringify(resumen));
        }
      } catch (err) {
        // Que un restaurante falle no debe dejar sin sincronizar a los demás.
        console.error(`[autoSync] ${restaurante.slug} falló:`, err.message);
      }
    }
  } catch (err) {
    console.error("[autoSync] no se pudo listar los restaurantes:", err.message);
  } finally {
    enCurso = false;
  }
}

/** Arranca el sondeo. Idempotente: llamarlo dos veces no crea dos relojes. */
function iniciar() {
  if (temporizador) return;
  const ms = intervaloMs();
  temporizador = setInterval(() => {
    pasada().catch((err) => console.error("[autoSync] error inesperado:", err.message));
  }, ms);
  // No debe impedir que el proceso termine cuando se le pide que pare.
  if (typeof temporizador.unref === "function") temporizador.unref();

  console.log(`[autoSync] sondeo cada ${ms / 60000} min`);
  // Una primera pasada al arrancar, para no esperar al primer intervalo tras
  // un despliegue. Con retraso, para no competir con el arranque del servidor.
  setTimeout(() => pasada().catch(() => {}), 20 * 1000).unref?.();
}

function detener() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

module.exports = { iniciar, detener, pasada };
