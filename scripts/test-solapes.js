/**
 * Comprueba que una reserva ocupa un TRAMO y no un instante.
 *
 *   node scripts/test-solapes.js
 *
 * Antes esto no se sostenía: la mesa solo se consideraba ocupada si otra reserva
 * empezaba a la MISMA hora exacta, así que una de las 18:00 se colaba encima de
 * la de las 17:00. Estas pruebas fijan el comportamiento nuevo para que no se
 * pierda en el próximo cambio.
 *
 * Escribe en Supabase de verdad (no hay entorno de pruebas) y borra todo lo que
 * crea, pase lo que pase. Las reservas van a nombre de "ZZTEST ..." y a una
 * fecha muy lejana para que, si algo quedara suelto, se vea a la legua y no se
 * mezcle con reservas reales.
 */

require("dotenv").config();

const db = require("../src/services/supabaseClient");
const escribir = require("../src/services/repo/escribir");

const ctx = { restaurante: "el-sazon-venezolano" };
const FECHA = "2099-06-15"; // martes, dentro del horario de todos los turnos
const creadas = [];

let fallos = 0;

function comprobar(descripcion, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok   ${descripcion}`);
  } else {
    fallos++;
    console.log(`  FALLA ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function crear(datos) {
  const r = await escribir.crearReserva(ctx, {
    fecha: FECHA,
    nombre: "ZZTEST solapes",
    telefono: "",
    canal: "panel",
    ...datos,
  });
  if (r.creada) creadas.push(r.reserva.id);
  return r;
}

async function main() {
  const mesas = await db.listar(ctx, "mesas", { orden: "capacidad.asc" });
  const mesa = mesas.find((m) => m.capacidad >= 2 && m.estado !== "Fuera de servicio");
  if (!mesa) throw new Error("No hay ninguna mesa utilizable para la prueba.");
  console.log(`Mesa de pruebas: ${mesa.nombre} (id ${mesa.id}, ${mesa.capacidad} plazas)`);
  console.log(`Fecha de pruebas: ${FECHA}\n`);

  console.log("Tramos y solapes:");

  const a = await crear({ hora: "13:00", personas: 2, mesaId: mesa.id, duracionMin: 120 });
  comprobar("13:00 (2h) se crea en la mesa pedida", a.creada && String(a.reserva.table_id) === String(mesa.id), a.motivo);

  const b = await crear({ hora: "14:00", personas: 2, mesaId: mesa.id, duracionMin: 120 });
  comprobar("14:00 choca con la de 13:00 (este era el agujero)", !b.creada && b.motivo === "mesa_ocupada", b.motivo);

  const c = await crear({ hora: "15:00", personas: 2, mesaId: mesa.id, duracionMin: 90 });
  comprobar("15:00 entra: la anterior acaba justo a las 15:00", c.creada, c.motivo);

  console.log("\nHorario de servicio:");

  const d = await crear({ hora: "18:00", personas: 2, duracionMin: 120 });
  comprobar("18:00 se rechaza (entre comida y cena)", !d.creada && d.motivo === "fuera_de_horario", d.motivo);

  const e = await crear({ hora: "04:00", personas: 2, duracionMin: 120 });
  comprobar("04:00 se rechaza (madrugada)", !e.creada && e.motivo === "fuera_de_horario", e.motivo);

  const f = await crear({ hora: "20:30", personas: 2, duracionMin: 120 });
  comprobar("20:30 se acepta (dentro de cena)", f.creada, f.motivo);

  console.log("\nMesa concreta contra reparto automático:");

  const libre = await escribir.mesaLibre(ctx, { fecha: FECHA, hora: "13:30", duracion: 60, mesaId: mesa.id });
  comprobar("mesaLibre() ve ocupada la mesa a las 13:30", !libre.libre && libre.choca === "ZZTEST solapes");

  const g = await crear({ hora: "13:00", personas: 2, duracionMin: 120 });
  comprobar("sin mesa indicada, se reparte a otra distinta", g.creada && String(g.reserva.table_id) !== String(mesa.id), g.motivo);

  const h = await crear({ hora: "13:00", personas: 2, mesaId: "999999999", duracionMin: 60 });
  comprobar("una mesa que no existe NO cae al reparto automático", !h.creada && h.motivo === "mesa_no_encontrada", h.motivo);

  console.log("\nDuración heredada del local:");
  const duracion = await escribir.duracionDe(ctx);
  comprobar("el local declara una duración por defecto", duracion > 0, String(duracion));

  // A las 23:00 la mesa está libre: la reserva de las 20:30 se repartió sola y
  // pudo caer aquí, pero acaba como muy tarde a las 22:30.
  const sinDuracion = await crear({ hora: "23:00", personas: 2, mesaId: mesa.id });
  comprobar(
    "una reserva sin duración propia se guarda con null",
    sinDuracion.creada && sinDuracion.reserva.duration_min === null,
    sinDuracion.creada ? String(sinDuracion.reserva.duration_min) : sinDuracion.motivo
  );

  // mesaLibre no mira el horario de apertura, solo el solape: a las 23:30 la
  // mesa sigue ocupada porque la de las 23:00 hereda los 120 min del local.
  const tras = await escribir.mesaLibre(ctx, { fecha: FECHA, hora: "23:30", duracion: 30, mesaId: mesa.id });
  comprobar(`a las 23:30 la mesa sigue ocupada por la de 23:00 (hereda ${duracion} min)`, !tras.libre);

  // Va al final a propósito: estas dos se reparten solas y ocuparían las mesas
  // que necesitan las pruebas de arriba.
  console.log("\nLa cocina cierra, la sala no:");

  // El horario limita a qué hora EMPIEZA una reserva, no hasta cuándo dura. La
  // cena admite entradas hasta las 23:30; una mesa que entra a esa hora sigue
  // ocupada hasta la 01:30, y eso es correcto: el restaurante sigue abierto
  // aunque la cocina haya cerrado.
  const ultima = await crear({ hora: "23:30", personas: 2, duracionMin: 120 });
  comprobar("una entrada a la última hora con 2h se acepta", ultima.creada, ultima.motivo);

  if (ultima.creada) {
    const mesaUltima = mesas.find((x) => x.nombre === ultima.mesa);
    const tramos = await escribir._internos.tramosOcupados(ctx, { fecha: FECHA, duracionDefecto: 120 });
    const suyo = tramos.find((t) => t.mesaId === String(mesaUltima.id) && t.ini === 23 * 60 + 30);
    comprobar(
      "su tramo pasa de medianoche (23:30 → 01:30) sin recortarse por el cierre",
      suyo && suyo.fin === 25 * 60 + 30,
      suyo ? String(suyo.fin) : "no encontrado"
    );
  }

  const larga = await crear({ hora: "23:00", personas: 2, duracionMin: 240 });
  comprobar("una sobremesa de 4h (acaba a las 03:00) también", larga.creada, larga.motivo);
}

async function limpiar() {
  if (creadas.length === 0) return;
  console.log(`\nBorrando ${creadas.length} reservas de prueba...`);
  for (const id of creadas) {
    await db.borrar(ctx, "reservas", id).catch((err) => console.error(`  no se pudo borrar ${id}:`, err.message));
  }
  // Red de seguridad: que no quede nada de esa fecha pase lo que pase.
  const restos = await db.listar(ctx, "reservas", { filtros: { fecha: FECHA } });
  if (restos.length > 0) {
    console.log(`  quedaban ${restos.length} sueltas, se borran también`);
    for (const r of restos) await db.borrar(ctx, "reservas", r.id).catch(() => {});
  }
  console.log("Limpio.");
}

main()
  .catch((err) => {
    fallos++;
    console.error("\nERROR:", err.message);
  })
  .finally(async () => {
    await limpiar().catch((err) => console.error("ERROR limpiando:", err.message));
    console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) fallaron.`);
    process.exit(fallos === 0 ? 0 : 1);
  });
