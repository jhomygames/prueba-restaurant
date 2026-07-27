/**
 * Prueba del parser de TheFork contra la forma de payload documentada en
 * https://docs.thefork.io/POS-API/Flow/create-order
 *
 *   node scripts/test-thefork-parser.js
 *
 * No necesita credenciales ni red: comprueba que traducimos bien sus campos a
 * los nuestros, que es lo único que podemos verificar antes de tener una
 * cuenta de partner.
 */

const path = require("path");
const thefork = require(path.join(__dirname, "..", "src/services/connectors/thefork"));

let fallos = 0;
function check(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  console.log(`  ${ok ? "OK  " : "FALLO"} ${nombre}: ${JSON.stringify(real)}${ok ? "" : ` (esperado ${JSON.stringify(esperado)})`}`);
  if (!ok) fallos++;
}

// Payload con la forma del ejemplo de la documentación: reserva de 2 personas
// a las 17:00, con prepago y alergias del cliente.
const CREATE_ORDER = {
  orderId: "3f2a91c4-77e1-4f0b-9d55-6a1c2b8e4d77",
  customerId: "restaurant-9981",
  createdAt: "2026-08-10T09:12:33Z",
  updatedAt: "2026-08-10T09:12:33Z",
  dateOfMeal: "2026-08-15",
  startTime: "17:00:00",
  partySize: 2,
  duration: 90,
  reservationStatus: "CONFIRMED",
  mealStatus: "NOT_STARTED",
  customer: {
    id: "cust-4417",
    firstName: "Marta",
    lastName: "Ibáñez",
    allergies: ["gluten", "frutos de cáscara"],
    dietaryRestrictions: ["vegetariano"],
  },
  offer: { type: "PERCENTAGE", name: "-30% carta", discountPercentage: 30, price: 0, currency: "EUR" },
  prepayment: { amount: 140, currency: "EUR" },
  tables: [{ name: "T12", areaName: "Sala principal" }],
};

console.log("\n1) Reserva nueva (create-order):");
const r = thefork.parseWebhook(CREATE_ORDER);
check("provider", r.provider, "thefork");
check("externalId", r.externalId, CREATE_ORDER.orderId);
check("date", r.date, "2026-08-15");
check("time", r.time, "17:00");
check("pax", r.pax, 2);
check("customerName", r.customerName, "Marta Ibáñez");
check("status", r.status, "confirmed");
console.log(`  ---  notas: "${r.notes}"`);
if (!r.notes.includes("gluten") || !r.notes.includes("vegetariano")) {
  console.log("  FALLO: las alergias/dietas no llegaron a las notas");
  fallos++;
} else {
  console.log("  OK   alergias y dieta trasladadas a las notas de la reserva");
}

console.log("\n2) Variantes de formato de fecha/hora:");
const conISO = thefork.parseWebhook({
  ...CREATE_ORDER,
  dateOfMeal: "2026-08-15T00:00:00Z",
  startTime: "2026-08-15T21:30:00Z",
});
check("date desde ISO", conISO.date, "2026-08-15");
check("time desde ISO", conISO.time, "21:30");
const horaCorta = thefork.parseWebhook({ ...CREATE_ORDER, startTime: "9:05" });
check("hora sin cero inicial", horaCorta.time, "09:05");

console.log("\n3) Cancelación:");
const cancelada = thefork.parseWebhook({ ...CREATE_ORDER, reservationStatus: "CANCELLED" });
check("status cancelado", cancelada.status, "cancelled");
const noShow = thefork.parseWebhook({ ...CREATE_ORDER, reservationStatus: "NO_SHOW" });
check("status no-show", noShow.status, "cancelled");

console.log("\n4) Estado desconocido (debe conservarse la reserva, no perderla):");
const raro = thefork.parseWebhook({ ...CREATE_ORDER, reservationStatus: "ALGO_NUEVO" });
check("status desconocido -> confirmed", raro.status, "confirmed");

console.log("\n5) Payload que no reconocemos:");
check("sin orderId -> null", thefork.parseWebhook({ hola: "mundo" }), null);
check("body vacío -> null", thefork.parseWebhook(null), null);

console.log("\n6) Autenticación por Bearer:");
const TOKEN = "a".repeat(64);
check("token correcto", thefork.verifyAuth({ headers: { authorization: `Bearer ${TOKEN}` } }, TOKEN), true);
check("token incorrecto", thefork.verifyAuth({ headers: { authorization: `Bearer ${"b".repeat(64)}` } }, TOKEN), false);
check("otra longitud", thefork.verifyAuth({ headers: { authorization: "Bearer corto" } }, TOKEN), false);
check("sin header", thefork.verifyAuth({ headers: {} }, TOKEN), false);
check("sin token esperado", thefork.verifyAuth({ headers: { authorization: `Bearer ${TOKEN}` } }, ""), false);

console.log(`\n${fallos === 0 ? "TODO CORRECTO" : `${fallos} FALLO(S)`}\n`);
process.exit(fallos === 0 ? 0 : 1);
