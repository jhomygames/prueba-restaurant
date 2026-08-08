/**
 * Horario de apertura: en qué turno cae una hora, y si el restaurante abre.
 *
 * Esta comprobación no existía en la app. Vivía solo en los flujos de n8n —y
 * encima leyendo la hoja de otro restaurante, así que todos compartían horario—.
 * Sin ella la app acepta una reserva a las cinco de la mañana sin rechistar.
 *
 * Se modela por turnos y no como un único "abre a las X, cierra a las Y" porque
 * un restaurante cierra entre comida y cena: un solo intervalo dejaría reservar
 * a las cinco de la tarde.
 */

const db = require("./supabaseClient");

const TABLA = "turnos";
const TTL_MS = 5 * 60 * 1000;

// El horario cambia de higos a brevas, y se consulta en cada reserva.
const cache = new Map(); // restaurante -> { at, turnos }

function aMinutos(hora) {
  const m = String(hora || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Día de la semana de 'YYYY-MM-DD' en el formato de la tabla: 1 lunes … 7 domingo. */
function diaSemana(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

async function turnosDe(ctx) {
  const clave = ctx.restaurante;
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.at < TTL_MS) return guardado.turnos;

  const turnos = await db.listar(ctx, TABLA, {
    filtros: { activo: true },
    orden: "hora_inicio.asc",
  });
  cache.set(clave, { at: Date.now(), turnos });
  return turnos;
}

function invalidar(restaurante) {
  if (restaurante) cache.delete(restaurante);
  else cache.clear();
}

/**
 * ¿Se puede reservar ese día a esa hora?
 *
 * Devuelve { abierto, turno, motivo, alternativas }. Cuando está cerrado da las
 * horas de apertura de ese día: al cliente le sirve mucho más "abrimos de 13:00
 * a 16:30 y de 20:00 a 23:30" que un "no" a secas.
 */
async function comprobar(ctx, fecha, hora) {
  const minutos = aMinutos(hora);
  if (minutos === null) {
    return { abierto: false, motivo: "hora_invalida", turno: null, alternativas: [] };
  }

  const turnos = await turnosDe(ctx);

  // Sin horario configurado NO se bloquea: un restaurante recién dado de alta
  // no puede quedarse sin poder reservar por algo que aún no ha rellenado.
  if (turnos.length === 0) {
    return { abierto: true, turno: null, motivo: "sin_horario_configurado", alternativas: [] };
  }

  const dia = diaSemana(fecha);
  const delDia = turnos.filter((t) => (t.dias || []).includes(dia));

  if (delDia.length === 0) {
    return { abierto: false, motivo: "cerrado_ese_dia", turno: null, alternativas: [] };
  }

  const encontrado = delDia.find((t) => {
    const inicio = aMinutos(t.hora_inicio);
    const fin = aMinutos(t.hora_fin);
    return minutos >= inicio && minutos <= fin;
  });

  if (encontrado) {
    return { abierto: true, turno: encontrado.nombre, motivo: null, alternativas: [] };
  }

  return {
    abierto: false,
    motivo: "fuera_de_horario",
    turno: null,
    alternativas: delDia.map((t) => ({
      turno: t.nombre,
      desde: String(t.hora_inicio).slice(0, 5),
      hasta: String(t.hora_fin).slice(0, 5),
    })),
  };
}

/** Frase para que el agente la diga tal cual. */
function explicar(resultado) {
  if (resultado.abierto) return "";
  if (resultado.motivo === "cerrado_ese_dia") {
    return "Ese día tenemos cerrado. ¿Le va bien otro día?";
  }
  if (resultado.motivo === "hora_invalida") {
    return "No he entendido bien la hora, ¿me la repite?";
  }
  const franjas = (resultado.alternativas || [])
    .map((a) => `de ${a.desde} a ${a.hasta}`)
    .join(" y ");
  return franjas
    ? `A esa hora está cerrado. Ese día abrimos ${franjas}. ¿Le busco hueco?`
    : "A esa hora está cerrado. ¿Le busco otro horario?";
}

/**
 * Turno que corresponde a una hora, sin comprobar si está abierto.
 * Sustituye a la regla fija de "antes de las 17:00 es comida" cuando el
 * restaurante tiene su horario configurado.
 */
async function turnoDe(ctx, fecha, hora) {
  const r = await comprobar(ctx, fecha, hora);
  if (r.turno) return r.turno;
  return aMinutos(hora) < 17 * 60 ? "comida" : "cena";
}

module.exports = { comprobar, explicar, turnoDe, invalidar, _internos: { aMinutos, diaSemana } };
