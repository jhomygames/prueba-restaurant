/**
 * Traza de cambios de las reservas.
 *
 * El flujo de n8n ya guardaba esto (tabla `historial_reservas`) y tenía razón:
 * ante una reclamación —"yo reservé para seis, no para tres"— hace falta poder
 * demostrar qué se registró, cuándo y por qué canal.
 *
 * Diferencia con la versión de n8n: allí se guardaban dos JSON completos (antes
 * y después) por cada cambio, y para ver qué había pasado había que compararlos
 * campo a campo a ojo. Aquí se guarda ADEMÁS un resumen legible
 * ("personas: 6 -> 3; hora: 21:00 -> 13:30"), que es lo que alguien necesita
 * leer de un vistazo. El JSON del estado nuevo se conserva igualmente.
 *
 * Escribir el historial NUNCA debe tumbar la operación principal: si Airtable
 * falla al registrar la traza, la reserva ya está hecha y eso es lo que importa.
 * Por eso todos los errores se registran por consola y se tragan.
 */

const { listRecords, createRecord, quote } = require("./airtableClient");

const TABLE_HISTORIAL = "Historial";

// Campos que interesa vigilar, con su nombre en lenguaje llano.
const ETIQUETAS = {
  FechaHora: "fecha y hora",
  Personas: "personas",
  ClienteNombre: "nombre",
  ClienteTelefono: "teléfono",
  Estado: "estado",
  Notas: "notas",
  Mesa: "mesa",
  Turno: "turno",
};

/** "personas: 6 -> 3; hora: 21:00 -> 13:30" */
function resumirCambios(antes, despues) {
  if (!antes) return "";
  const partes = [];
  for (const [campo, etiqueta] of Object.entries(ETIQUETAS)) {
    const a = Array.isArray(antes[campo]) ? antes[campo].join(",") : antes[campo];
    const d = Array.isArray(despues[campo]) ? despues[campo].join(",") : despues[campo];
    if (d === undefined) continue; // no se tocó en esta actualización
    if (String(a ?? "") !== String(d ?? "")) {
      partes.push(`${etiqueta}: ${a || "(vacío)"} -> ${d || "(vacío)"}`);
    }
  }
  return partes.join("; ");
}

/**
 * Registra un cambio.
 *
 * @param {object} ctx        { baseId }
 * @param {object} evento
 *   accion   'created' | 'modified' | 'cancelled' | 'seated' | 'completed'
 *   canal    de dónde vino el cambio ('panel', 'voz', 'n8n'…)
 *   reservaId / codigo   identificadores de la reserva
 *   antes    campos previos (opcional; sin ellos no hay resumen que hacer)
 *   despues  campos nuevos
 */
async function registrar(ctx, { accion, canal, reservaId, codigo, antes, despues }) {
  try {
    const cambios = resumirCambios(antes, despues || {});

    // Un "modificado" que no modificó nada no es un hecho que valga la pena
    // guardar: pasa cada vez que una plataforma reenvía el mismo aviso, y
    // llenaría la traza de ruido que tapa los cambios de verdad.
    if (accion === "modified" && antes && !cambios) return;
    await createRecord(
      ctx.baseId,
      TABLE_HISTORIAL,
      {
        Cuando: new Date().toISOString(),
        CodigoReserva: codigo || "",
        ReservaId: reservaId || "",
        Accion: accion,
        Canal: canal || "panel",
        Cambios: cambios,
        DatosNuevos: JSON.stringify(despues || {}, null, 2),
      },
      { typecast: true }
    );
  } catch (err) {
    // Una reserva registrada sin traza es un problema menor; una reserva que no
    // se guarda porque falló la traza sería un problema grave.
    console.error(`[history] no se pudo registrar "${accion}":`, err.message);
  }
}

/** Historial de una reserva, del cambio más reciente al más antiguo. */
async function deReserva(ctx, { reservaId, codigo }) {
  const filtro = codigo
    ? `{CodigoReserva} = ${quote(codigo)}`
    : `{ReservaId} = ${quote(reservaId)}`;
  const records = await listRecords(ctx.baseId, TABLE_HISTORIAL, { filterByFormula: filtro });
  return records
    .map((r) => ({
      id: r.id,
      when: r.fields.Cuando || "",
      action: r.fields.Accion || "",
      channel: r.fields.Canal || "",
      changes: r.fields.Cambios || "",
    }))
    .sort((a, b) => String(b.when).localeCompare(String(a.when)));
}

module.exports = { registrar, deReserva, resumirCambios };
