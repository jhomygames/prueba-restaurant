/**
 * Prueba el traductor del agente de voz contra la base real, sin pasar por Vapi.
 *
 * Comprueba lo que de verdad importa de una traducción: que los campos que lee
 * el guion (`disponible`, `fecha_hablada`, `cliente_conocido`, `codigo`...)
 * llegan con el nombre exacto que espera. Un campo bien calculado pero mal
 * nombrado es indistinguible de uno que falta.
 *
 *   node scripts/test-dialecto-marta.js
 */

require("dotenv").config();

const dialecto = require("../src/services/dialectoMarta");
const registry = require("../src/services/repo/restaurantes");

// Distinto en cada ejecución: la reserva se anula al final, pero la ficha del
// cliente se queda (y debe quedarse). Con un número fijo, la segunda pasada
// encontraría al "desconocido" del primer paso ya fichado.
const TELEFONO = `+3460${Math.floor(1000000 + Math.random() * 8999999)}`;
let fallos = 0;

function comprobar(titulo, condicion, detalle) {
  console.log(`  ${condicion ? "OK  " : "FALLO"} ${titulo}`);
  if (!condicion) {
    fallos++;
    if (detalle !== undefined) console.log(`        ${JSON.stringify(detalle)}`);
  }
}

(async () => {
  const local = await registry.porSlug("el-sazon-venezolano");
  if (!local) throw new Error("No se encuentra el restaurante.");
  const ctx = { restaurante: local, customer_phone: TELEFONO, channel: "voz" };

  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  console.log("\n1. checkAvailability con hueco");
  const d1 = await dialecto.ejecutar("checkAvailability", { fecha: "mañana", hora: "21:00", personas: 2 }, ctx);
  comprobar("devuelve 'disponible' (no 'available')", "disponible" in d1, Object.keys(d1));
  comprobar("hay mesa", d1.disponible === true, d1);
  comprobar("trae fecha_hablada", Boolean(d1.fecha_hablada), d1);

  console.log("\n2. checkAvailability con grupo grande");
  const d2 = await dialecto.ejecutar("checkAvailability", { fecha: "mañana", hora: "21:00", personas: 25 }, ctx);
  comprobar("codigo GRUPO_GRANDE", d2.codigo === "GRUPO_GRANDE", d2);

  console.log("\n3. checkAvailability con fecha que no se entiende");
  const d3 = await dialecto.ejecutar("checkAvailability", { fecha: "cuando sea", hora: "21:00", personas: 2 }, ctx);
  comprobar("codigo FECHA_AMBIGUA", d3.codigo === "FECHA_AMBIGUA", d3);

  console.log("\n4. buscar_contexto_cliente con un desconocido");
  const d4 = await dialecto.ejecutar("buscar_contexto_cliente", {}, ctx);
  comprobar("cliente_conocido presente", "cliente_conocido" in d4, d4);
  comprobar("no le conoce", d4.cliente_conocido === false, d4);
  comprobar("reserva_activa presente", "reserva_activa" in d4, d4);

  console.log("\n5. get_whatsapp_context");
  const d5 = await dialecto.ejecutar("get_whatsapp_context", {}, ctx);
  comprobar("hay_contexto presente", "hay_contexto" in d5, d5);

  console.log("\n6. saveReservation (crea de verdad, luego se anula)");
  const d6 = await dialecto.ejecutar(
    "saveReservation",
    { nombre: "Prueba Dialecto", fecha: "mañana", hora: "21:00", personas: 2, lopd_acepta: true, notas: "soy alérgico a los frutos secos" },
    ctx
  );
  comprobar("guardada", d6.guardada === true, d6);
  comprobar("trae fecha_hablada", Boolean(d6.fecha_hablada), d6);
  comprobar("asigna mesa", Boolean(d6.mesa), d6);
  comprobar("el mensaje NO dice el código", !/RES-/.test(d6.mensaje || ""), d6.mensaje);

  console.log("\n7. buscar_contexto_cliente ahora que ya es cliente");
  const d7 = await dialecto.ejecutar("buscar_contexto_cliente", {}, ctx);
  comprobar("ahora le conoce", d7.cliente_conocido === true, d7);
  comprobar("ve la reserva activa", d7.reserva_activa === true, d7);
  // Se guarda con el nombre oficial del alérgeno ("Frutos de cáscara"), no con
  // las palabras que dijo el cliente ("frutos secos"): es lo que hay que
  // contrastar contra la carta.
  comprobar("recuerda la alergia", /frutos/i.test(d7.alergias_notas || ""), d7.alergias_notas);

  console.log("\n8. findReservation por teléfono");
  const d8 = await dialecto.ejecutar("findReservation", {}, ctx);
  comprobar("encontrada", d8.encontrada === true, d8);
  comprobar("trae id_reserva", Boolean(d8.reservas?.[0]?.id_reserva), d8);

  console.log("\n9. findReservation por nombre, sin teléfono");
  const d9 = await dialecto.ejecutar(
    "findReservation",
    { nombre: "Prueba Dialecto" },
    { ...ctx, customer_phone: null }
  );
  comprobar("encontrada por nombre", d9.encontrada === true, d9);

  const codigo = d8.reservas?.[0]?.id_reserva;

  console.log("\n10. modifyReservation");
  const d10 = await dialecto.ejecutar(
    "modifyReservation",
    { id_reserva: codigo, nuevas_personas: 4 },
    ctx
  );
  comprobar("modificada", d10.modificada === true, d10);
  comprobar("trae fecha_hablada_nueva", Boolean(d10.fecha_hablada_nueva), d10);

  console.log("\n11. cancelReservation (limpia la prueba)");
  const d11 = await dialecto.ejecutar("cancelReservation", { id_reserva: codigo, canal: "voz" }, ctx);
  comprobar("cancelada", d11.cancelada === true, d11);

  console.log(
    fallos === 0
      ? `\nTodo correcto. Reserva de prueba ${codigo} creada y anulada.`
      : `\n${fallos} comprobación(es) fallida(s). Reserva de prueba: ${codigo}`
  );
  process.exit(fallos === 0 ? 0 : 1);
})().catch((err) => {
  console.error("\nERROR:", err.message);
  process.exit(1);
});
