/**
 * Comprueba que PATCH /api/reservations/:id valida antes de escribir.
 *
 *   node src/server.js            (en otra terminal, con PORT=3111)
 *   node scripts/test-patch-reserva.js
 *
 * Hasta ahora este endpoint escribía directo en la tabla: se podía editar una
 * reserva y ponerla a las tres de la madrugada, o encima de otra que ya tenía
 * esa mesa. Solo el POST comprobaba algo.
 *
 * La excepción que se prueba abajo es deliberada: cambiar SOLO el estado
 * (sentar, completar, anular) no pasa por las comprobaciones. Sentar a alguien
 * que ya está en la puerta no puede fallar porque el reloj diga que cerró.
 */

require("dotenv").config();

const db = require("../src/services/supabaseClient");

const BASE = process.env.TEST_BASE_URL || "http://localhost:3111";
const EMAIL = process.env.TEST_EMAIL || "dueno@elsazonvenezolano.com";
const PASSWORD = process.env.TEST_PASSWORD;

const ctx = { restaurante: "el-sazon-venezolano" };
const FECHA = "2099-06-16";
const creadas = [];

let fallos = 0;
let token = "";

function comprobar(descripcion, condicion, detalle = "") {
  if (condicion) console.log(`  ok   ${descripcion}`);
  else {
    fallos++;
    console.log(`  FALLA ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

async function api(ruta, opciones = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opciones.headers || {}),
    },
  });
  const cuerpo = await res.json().catch(() => ({}));
  return { status: res.status, cuerpo };
}

async function crear(datos) {
  const r = await api("/api/reservations", {
    method: "POST",
    body: JSON.stringify({
      date: FECHA,
      customerName: "ZZTEST patch",
      customerPhone: "",
      notes: "",
      ...datos,
    }),
  });
  if (r.status === 201) creadas.push(r.cuerpo.id);
  return r;
}

async function main() {
  if (!PASSWORD) throw new Error("Falta TEST_PASSWORD en el entorno.");

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`Login falló (${login.status}): ${JSON.stringify(login.cuerpo)}`);
  token = login.cuerpo.token;

  const mesas = await db.listar(ctx, "mesas", { orden: "capacidad.asc" });
  const [m1, m2] = mesas.filter((m) => m.capacidad >= 2 && m.estado !== "Fuera de servicio");
  if (!m1 || !m2) throw new Error("Hacen falta dos mesas utilizables.");
  console.log(`Mesas de prueba: ${m1.nombre} y ${m2.nombre}\nFecha: ${FECHA}\n`);

  const a = await crear({ time: "13:00", pax: 2, tableId: m1.id, customDurationMinutes: 120 });
  comprobar("se crea la reserva base a las 13:00", a.status === 201, JSON.stringify(a.cuerpo));

  const b = await crear({ time: "21:00", pax: 2, tableId: m2.id, customDurationMinutes: 120 });
  comprobar("se crea una segunda a las 21:00 en otra mesa", b.status === 201, JSON.stringify(b.cuerpo));

  console.log("\nPATCH que antes pasaba sin mirar:");

  const madrugada = await api(`/api/reservations/${a.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ time: "03:00" }),
  });
  comprobar(
    "mover a las 03:00 se rechaza",
    madrugada.status === 409 && madrugada.cuerpo.error === "fuera_de_horario",
    `${madrugada.status} ${JSON.stringify(madrugada.cuerpo)}`
  );

  const encima = await api(`/api/reservations/${a.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ time: "21:30", tableId: String(m2.id) }),
  });
  comprobar(
    "moverla encima de la otra se rechaza",
    encima.status === 409 && encima.cuerpo.error === "mesa_ocupada",
    `${encima.status} ${JSON.stringify(encima.cuerpo)}`
  );

  const valido = await api(`/api/reservations/${a.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ time: "14:00" }),
  });
  comprobar("un cambio válido sí pasa", valido.status === 200 && valido.cuerpo.time === "14:00", JSON.stringify(valido.cuerpo));
  comprobar("y recalcula el turno con la fecha buena", valido.cuerpo.shift === "comida", valido.cuerpo.shift);

  console.log("\nLa excepción de los estados:");

  const sentar = await api(`/api/reservations/${a.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "seated", seatedAt: new Date().toISOString() }),
  });
  comprobar("sentar a un comensal nunca se bloquea", sentar.status === 200 && sentar.cuerpo.status === "seated", JSON.stringify(sentar.cuerpo));

  const anular = await api(`/api/reservations/${b.cuerpo.id}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "cancelled" }),
  });
  comprobar("anular tampoco", anular.status === 200 && anular.cuerpo.status === "cancelled", JSON.stringify(anular.cuerpo));

  console.log("\nAislamiento entre restaurantes:");
  const ajena = await api("/api/reservations/999999999", {
    method: "PATCH",
    body: JSON.stringify({ time: "14:00" }),
  });
  comprobar("una reserva que no es tuya da 404", ajena.status === 404, String(ajena.status));
}

async function limpiar() {
  const restos = await db.listar(ctx, "reservas", { filtros: { fecha: FECHA } });
  if (restos.length === 0) return;
  console.log(`\nBorrando ${restos.length} reservas de prueba...`);
  for (const r of restos) await db.borrar(ctx, "reservas", r.id).catch(() => {});
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
