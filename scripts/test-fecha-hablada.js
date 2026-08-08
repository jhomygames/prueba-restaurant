/**
 * Pruebas de la resolución de fechas habladas. Sin red ni credenciales.
 *
 * Se fija un "hoy" concreto en vez de usar la fecha real: si no, la prueba
 * pasaría o fallaría según el día que se ejecute, que es justo lo que no se
 * quiere de una prueba.
 */

const path = require("path");
const f = require(path.join(__dirname, "..", "src/services/fechaHablada"));

// Sábado 19 de septiembre de 2026.
const HOY = "2026-09-19";
const opciones = { hoy: HOY };

let fallos = 0;
function check(nombre, obtenido, esperado) {
  const ok = obtenido === esperado;
  console.log(`  ${ok ? "OK  " : "FALLO"} ${nombre}: ${JSON.stringify(obtenido)}` +
    (ok ? "" : ` (esperado ${JSON.stringify(esperado)})`));
  if (!ok) fallos++;
}

console.log(`\nHoy es sábado ${HOY}\n`);

console.log("1) Expresiones básicas:");
check("hoy", f.resolver("hoy", opciones), "2026-09-19");
check("mañana", f.resolver("mañana", opciones), "2026-09-20");
check("pasado mañana", f.resolver("pasado mañana", opciones), "2026-09-21");
check("esta noche", f.resolver("esta noche", opciones), "2026-09-19");
check("fecha ya en formato ISO", f.resolver("2026-12-25", opciones), "2026-12-25");

console.log("\n2) Días de la semana (hoy es sábado):");
check("el lunes", f.resolver("el lunes", opciones), "2026-09-21");
check("el viernes", f.resolver("el viernes", opciones), "2026-09-25");
// Decir "el sábado" un sábado no significa dentro de un rato.
check("el sábado (mismo día)", f.resolver("el sábado", opciones), "2026-09-26");
check("el próximo martes", f.resolver("el próximo martes", opciones), "2026-09-22");
check("el jueves que viene", f.resolver("el jueves que viene", opciones), "2026-09-24");

console.log("\n3) Sin acentos ni mayúsculas, que es como llega del transcriptor:");
check("MIERCOLES", f.resolver("MIERCOLES", opciones), "2026-09-23");
check("Miércoles", f.resolver("Miércoles", opciones), "2026-09-23");
check("manana", f.resolver("manana", opciones), "2026-09-20");

console.log("\n4) Lo que NO se entiende debe dar null, no una fecha inventada:");
check("vacío", f.resolver("", opciones), null);
check("dentro de un rato", f.resolver("dentro de un rato", opciones), null);
check("el día de mi cumpleaños", f.resolver("el día de mi cumpleaños", opciones), null);

console.log("\n5) Decir la fecha en voz alta:");
check("día suelto", f.enVozAlta("2026-09-19"), "sábado, diecinueve de septiembre de dos mil veintiséis");
check("día 1", f.enVozAlta("2026-01-01"), "jueves, uno de enero de dos mil veintiséis");
check("día 31", f.enVozAlta("2026-12-31"), "jueves, treinta y uno de diciembre de dos mil veintiséis");
check("día 21", f.enVozAlta("2026-09-21"), "lunes, veintiuno de septiembre de dos mil veintiséis");
check("fecha inválida", f.enVozAlta("no-es-fecha"), "");

console.log("\n6) Nombre del día y fechas pasadas:");
check("nombre del día", f.nombreDelDia("2026-09-25"), "viernes");
check("ayer ya pasó", f.esPasada("2026-09-18", opciones), true);
check("hoy no ha pasado", f.esPasada("2026-09-19", opciones), false);
check("mañana no ha pasado", f.esPasada("2026-09-20", opciones), false);

console.log(`\n${fallos === 0 ? "TODO CORRECTO" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
