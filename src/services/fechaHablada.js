/**
 * Fechas dichas en voz alta: interpretarlas y devolverlas.
 *
 * Portado de los flujos de n8n, donde llevaba meses funcionando. Hasta ahora la
 * app le pedía al modelo que convirtiera "mañana" o "el viernes" en una fecha
 * concreta antes de llamar a las herramientas. Funciona casi siempre, y ese
 * "casi" es el problema: cuando falla, la reserva se guarda en otro día y nadie
 * se entera hasta que el cliente aparece. Resolverlo en código quita esa
 * incertidumbre.
 *
 * Todo se calcula en la zona del restaurante, no en la del servidor: si el
 * servidor está en otro huso, "mañana" puede caer en el día equivocado durante
 * unas horas cada noche.
 */

const ZONA_POR_DEFECTO = "Europe/Madrid";

const DIAS = {
  lunes: 1, martes: 2, miercoles: 3, jueves: 4,
  viernes: 5, sabado: 6, domingo: 7,
};

/** Quita acentos y mayúsculas: "Miércoles" y "miercoles" deben ser lo mismo. */
function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Hoy en la zona del restaurante, como 'YYYY-MM-DD'. */
function hoyEnZona(zona = ZONA_POR_DEFECTO) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/** Día de la semana (1 lunes … 7 domingo) de una fecha 'YYYY-MM-DD'. */
function diaSemana(iso) {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 domingo … 6 sábado
  return d === 0 ? 7 : d;
}

function sumarDias(iso, dias) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Convierte lo que dijo el cliente en una fecha 'YYYY-MM-DD', o null si no se
 * entiende. Devolver null es deliberado: preguntar de nuevo es mucho mejor que
 * adivinar mal y reservar otro día.
 */
function resolver(expresion, { zona = ZONA_POR_DEFECTO, hoy = null } = {}) {
  const texto = normalizar(expresion);
  if (!texto) return null;

  const HOY = hoy || hoyEnZona(zona);

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  if (texto === "hoy" || texto === "esta noche" || texto === "hoy mismo") return HOY;
  if (texto.includes("pasado manana")) return sumarDias(HOY, 2);
  if (texto === "manana" || texto === "manana por la noche") return sumarDias(HOY, 1);

  // "el viernes", "el próximo sábado", "el sábado que viene"
  const esProximo = /proxim[oa]|que viene|siguiente/.test(texto);
  for (const [nombre, indice] of Object.entries(DIAS)) {
    if (!texto.includes(nombre)) continue;
    let delta = (indice - diaSemana(HOY) + 7) % 7;
    // "el viernes" dicho un viernes se entiende como el de la semana que viene:
    // nadie llama para reservar dentro de un rato diciendo el día.
    if (delta === 0) delta = 7;
    else if (esProximo && delta < 7) delta += 0; // "próximo viernes" = el más cercano
    return sumarDias(HOY, delta);
  }

  return null;
}

const UNIDADES = [
  "cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho",
  "nueve", "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
  "diecisiete", "dieciocho", "diecinueve", "veinte",
];
const DECENAS = {
  3: "treinta", 4: "cuarenta", 5: "cincuenta",
  6: "sesenta", 7: "setenta", 8: "ochenta", 9: "noventa",
};

// Del 21 al 29 no vale pegar "veinti" + la unidad: tres de ellos llevan tilde
// (veintidós, veintitrés, veintiséis) y el agente los lee en voz alta.
const VEINTIS = [
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
  "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
];

/** 27 -> "veintisiete". Solo hasta 99, que es lo que hace falta para días y años. */
function enPalabras(n) {
  if (n <= 20) return UNIDADES[n];
  if (n < 30) return VEINTIS[n - 20];
  const decena = Math.floor(n / 10);
  const resto = n % 10;
  return resto === 0 ? DECENAS[decena] : `${DECENAS[decena]} y ${UNIDADES[resto]}`;
}

/**
 * "2026-09-19" -> "sábado, diecinueve de septiembre de dos mil veintiséis".
 *
 * El agente lee esto en voz alta. Sin ello diría "dos mil veintiséis guion cero
 * nueve guion diecinueve", que ningún cliente entiende.
 */
function enVozAlta(iso, { zona = ZONA_POR_DEFECTO } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  const fecha = new Date(`${iso}T12:00:00Z`);
  const fmt = (opciones) =>
    new Intl.DateTimeFormat("es-ES", { timeZone: zona, ...opciones }).format(fecha);

  const dia = fmt({ weekday: "long" });
  const mes = fmt({ month: "long" });
  const numeroDia = Number(iso.slice(8, 10));
  const anio = Number(iso.slice(0, 4));

  return `${dia}, ${enPalabras(numeroDia)} de ${mes} de dos mil ${enPalabras(anio - 2000)}`;
}

/** Nombre del día, para respuestas cortas ("el viernes te esperamos"). */
function nombreDelDia(iso, { zona = ZONA_POR_DEFECTO } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  return new Intl.DateTimeFormat("es-ES", { timeZone: zona, weekday: "long" })
    .format(new Date(`${iso}T12:00:00Z`));
}

/** ¿Es una fecha que ya pasó? Se compara en la zona del restaurante. */
function esPasada(iso, { zona = ZONA_POR_DEFECTO, hoy = null } = {}) {
  return iso < (hoy || hoyEnZona(zona));
}

module.exports = {
  resolver,
  enVozAlta,
  nombreDelDia,
  esPasada,
  hoyEnZona,
  _internos: { normalizar, enPalabras, diaSemana, sumarDias },
};
