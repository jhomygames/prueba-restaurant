/**
 * Comprueba la fusión de mesas para grupos que no caben en una sola.
 *
 *   node src/server.js   (en otra terminal, con PORT=3111)
 *   node scripts/test-fusion-mesas.js
 *
 * El caso que pidió el restaurante: una reserva de 15 personas debe poder
 * fusionar dos mesas eligiéndolas a mano, no rechazarse ni colarse en
 * silencio (que era el fallo original que se reportó).
 */

require("dotenv").config();

const db = require("../src/services/supabaseClient");

const BASE = process.env.TEST_BASE_URL || "http://localhost:3111";
const EMAIL = process.env.TEST_EMAIL || "dueno@elsazonvenezolano.com";
const PASSWORD = process.env.TEST_PASSWORD;

const ctx = { restaurante: "el-sazon-venezolano" };
const FECHA = "2099-11-20";
const creadas = [];

let fallos = 0;
let token = "";

function comprobar(descripcion, condicion, detalle = "") {
  if (condicion) console.log("  ok   " + descripcion);
  else {
    fallos++;
    console.log("  FALLA " + descripcion + (detalle ? " — " + detalle : ""));
  }
}

async function api(ruta, opciones = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const cuerpo = await res.json().catch(() => ({}));
  return { status: res.status, cuerpo };
}

async function crear(datos) {
  const r = await api("/api/reservations", {
    method: "POST",
    body: JSON.stringify({ date: FECHA, customerName: "ZZFUSION", customerPhone: "", notes: "", ...datos }),
  });
  if (r.status === 201) creadas.push(r.cuerpo.id);
  return r;
}

async function main() {
  if (!PASSWORD) throw new Error("Falta TEST_PASSWORD en el entorno.");

  const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (login.status !== 200) throw new Error(`Login falló (${login.status}): ${JSON.stringify(login.cuerpo)}`);
  token = login.cuerpo.token;

  const mesas = await db.listar(ctx, "mesas", { orden: "capacidad.desc" });
  const [m1, m2, m3] = mesas.filter((m) => m.estado !== "Fuera de servicio");
  console.log(`Mesas: ${m1.nombre} (${m1.capacidad}), ${m2.nombre} (${m2.capacidad}), ${m3.nombre} (${m3.capacidad})\n`);

  console.log("Un grupo de 9 (silla extra) sigue funcionando exactamente igual, sin fusión:");
  // Va primero y solo, a las 11:30 — antes de que ninguna otra prueba de este
  // script toque la única mesa de 8 plazas que necesita el reparto automático.
  const nueve = await crear({ time: "13:00", pax: 9 });
  comprobar("9 personas, reparto automático, se acepta con silla extra", nueve.status === 201, JSON.stringify(nueve.cuerpo).slice(0, 150));
  comprobar("sin secondaryTableId", nueve.status === 201 && !nueve.cuerpo.secondaryTableId, nueve.cuerpo.secondaryTableId);
  if (nueve.status === 201) {
    await db.borrar(ctx, "reservas", nueve.cuerpo.id).catch(() => {});
    creadas.splice(creadas.indexOf(nueve.cuerpo.id), 1);
  }

  console.log("\nEl bug reportado: elegir una mesa a mano y desbordarla sin aviso.");
  const sinFusion = await crear({ time: "13:00", pax: m1.capacidad + 3, tableId: m1.id });
  comprobar(
    "una mesa desbordada por más de 1 SIN fusión ahora se rechaza (antes se colaba)",
    sinFusion.status === 409 && sinFusion.cuerpo.error === "capacidad_insuficiente",
    `${sinFusion.status} ${JSON.stringify(sinFusion.cuerpo)}`
  );

  console.log("\nEl caso pedido: 15 personas, fusionando dos mesas a mano:");
  const quince = m1.capacidad + m2.capacidad >= 15 ? 15 : m1.capacidad + m2.capacidad;
  const fusion = await crear({
    time: "14:00", pax: quince, tableId: m1.id, secondaryTableId: m2.id,
  });
  comprobar("se crea con las dos mesas fusionadas", fusion.status === 201, JSON.stringify(fusion.cuerpo).slice(0, 200));
  comprobar("guarda mesa_id (tableId) correcto", fusion.status === 201 && String(fusion.cuerpo.tableId) === String(m1.id));
  comprobar("guarda secondaryTableId correcto", fusion.status === 201 && String(fusion.cuerpo.secondaryTableId) === String(m2.id));
  comprobar("las notas explican la fusión", fusion.status === 201 && /fusionada/i.test(fusion.cuerpo.notes), fusion.cuerpo.notes);

  console.log("\nLa mesa fusionada (secundaria) queda ocupada para cualquier otra reserva:");
  const chocaConSecundaria = await crear({ time: "14:30", pax: 2, tableId: m2.id });
  comprobar(
    "una reserva normal en la mesa secundaria choca",
    chocaConSecundaria.status === 409 && chocaConSecundaria.cuerpo.error === "mesa_ocupada",
    `${chocaConSecundaria.status} ${JSON.stringify(chocaConSecundaria.cuerpo)}`
  );

  console.log("\nLa mesa secundaria elegida para fusionar, si ya está ocupada, se rechaza:");
  const ocupaSecundaria = await crear({ time: "20:00", pax: 2, tableId: m3.id });
  comprobar("preparación: ocupar m3 a las 20:00", ocupaSecundaria.status === 201);
  const fusionChoca = await crear({ time: "20:15", pax: 12, tableId: m1.id, secondaryTableId: m3.id });
  comprobar(
    "fusionar con una mesa ya ocupada se rechaza (mesa_secundaria_ocupada)",
    fusionChoca.status === 409 && fusionChoca.cuerpo.error === "mesa_secundaria_ocupada",
    `${fusionChoca.status} ${JSON.stringify(fusionChoca.cuerpo)}`
  );

  console.log("\nEditar (PATCH) para añadir una fusión a una reserva ya creada:");
  const base = await crear({ time: "21:00", pax: 4, tableId: m1.id });
  comprobar("preparación: reserva base de 4 en Mesa grande", base.status === 201);
  const patchFusion = await api(`/api/reservations/${base.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pax: m1.capacidad + m2.capacidad, secondaryTableId: m2.id }),
  });
  comprobar(
    "PATCH añade la fusión correctamente",
    patchFusion.status === 200 && String(patchFusion.cuerpo.secondaryTableId) === String(m2.id),
    JSON.stringify(patchFusion.cuerpo).slice(0, 200)
  );

  console.log("\nQuitar la fusión (PATCH con secondaryTableId vacío) la libera:");
  const patchQuitar = await api(`/api/reservations/${base.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ pax: m1.capacidad, secondaryTableId: "" }),
  });
  comprobar(
    "PATCH quita la fusión",
    patchQuitar.status === 200 && !patchQuitar.cuerpo.secondaryTableId,
    JSON.stringify(patchQuitar.cuerpo).slice(0, 200)
  );
  const otraEnM2 = await crear({ time: "21:15", pax: 2, tableId: m2.id });
  comprobar("Mesa 2 vuelve a estar libre tras quitar la fusión", otraEnM2.status === 201, JSON.stringify(otraEnM2.cuerpo).slice(0, 150));
}

async function limpiar() {
  const restos = await db.listar(ctx, "reservas", { filtros: { fecha: FECHA } });
  if (restos.length > 0) {
    console.log(`\nBorrando ${restos.length} reservas de prueba...`);
    for (const r of restos) await db.borrar(ctx, "reservas", r.id).catch(() => {});
  }
  const clientes = await db.listar(ctx, "clientes", {});
  const cl = clientes.filter((c) => /^ZZFUSION/i.test(c.nombre || ""));
  for (const c of cl) await db.borrar(ctx, "clientes", c.id).catch(() => {});
  console.log("Limpio.");
}

main()
  .catch((err) => {
    fallos++;
    console.error("\nERROR:", err.message);
  })
  .finally(async () => {
    await limpiar().catch((err) => console.error("ERROR limpiando:", err.message));
    console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} fallo(s).`);
    process.exit(fallos === 0 ? 0 : 1);
  });
