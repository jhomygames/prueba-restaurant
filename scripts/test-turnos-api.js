/**
 * Comprueba la API del horario de servicio.
 *
 *   node scripts/test-turnos-api.js
 *
 * Lo que más importa aquí no son las validaciones sino la ÚLTIMA prueba: que al
 * guardar un horario nuevo se invalide la caché de `horario.js`. Sin eso el
 * usuario cambia el horario, prueba al momento, y parece que no ha servido de
 * nada, porque durante cinco minutos se sigue aplicando el anterior.
 *
 * Restaura el horario original al terminar, pase lo que pase.
 */

require("dotenv").config();

const BASE = process.env.TEST_BASE_URL || "http://localhost:3111";
const EMAIL = process.env.TEST_EMAIL || "dueno@elsazonvenezolano.com";
const PASSWORD = process.env.TEST_PASSWORD;

let token = "";
let fallos = 0;
let original = null;

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
    },
  });
  return { status: res.status, cuerpo: await res.json().catch(() => ({})) };
}

const guardar = (turnos, duracionReservaMin = 120) =>
  api("/api/settings/turnos", { method: "PUT", body: JSON.stringify({ turnos, duracionReservaMin }) });

const sinId = (t) => ({ nombre: t.nombre, horaInicio: t.horaInicio, horaFin: t.horaFin, dias: t.dias, activo: t.activo });

const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7];

async function main() {
  if (!PASSWORD) throw new Error("Falta TEST_PASSWORD en el entorno.");

  const login = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status !== 200) throw new Error(`Login falló (${login.status})`);
  token = login.cuerpo.token;

  console.log("Lectura:");
  const get = await api("/api/settings/turnos");
  comprobar("GET devuelve las franjas y la duración", get.status === 200 && Array.isArray(get.cuerpo.turnos), JSON.stringify(get.cuerpo));
  original = get.cuerpo;
  console.log(`  horario actual: ${original.turnos.map((t) => `${t.nombre} ${t.horaInicio}-${t.horaFin}`).join(" · ")}`);
  comprobar("las horas vienen en HH:MM, no HH:MM:SS", original.turnos.every((t) => /^\d{2}:\d{2}$/.test(t.horaInicio)));

  console.log("\nValidaciones (deben dar 400 con mensaje legible):");

  const nombreMalo = await guardar([{ nombre: "merienda", horaInicio: "17:00", horaFin: "19:00", dias: TODOS_LOS_DIAS, activo: true }]);
  comprobar("un turno inventado se rechaza", nombreMalo.status === 400 && nombreMalo.cuerpo.error === "nombre_invalido", JSON.stringify(nombreMalo.cuerpo));

  const invertida = await guardar([{ nombre: "cena", horaInicio: "23:00", horaFin: "01:00", dias: TODOS_LOS_DIAS, activo: true }]);
  comprobar("una franja que cruza medianoche se rechaza", invertida.status === 400 && invertida.cuerpo.error === "franja_invertida", JSON.stringify(invertida.cuerpo));

  const sinDias = await guardar([{ nombre: "comida", horaInicio: "13:00", horaFin: "16:00", dias: [], activo: true }]);
  comprobar("sin días se rechaza", sinDias.status === 400 && sinDias.cuerpo.error === "dias_invalidos", JSON.stringify(sinDias.cuerpo));

  const solapadas = await guardar([
    { nombre: "comida", horaInicio: "13:00", horaFin: "17:00", dias: TODOS_LOS_DIAS, activo: true },
    { nombre: "cena", horaInicio: "16:00", horaFin: "23:00", dias: TODOS_LOS_DIAS, activo: true },
  ]);
  comprobar("dos franjas que se pisan se rechazan", solapadas.status === 400 && solapadas.cuerpo.error === "franjas_solapadas", JSON.stringify(solapadas.cuerpo));

  const duracionMala = await guardar([sinId(original.turnos[0])], 5);
  comprobar("una duración de 5 minutos se rechaza", duracionMala.status === 400 && duracionMala.cuerpo.error === "duracion_invalida", JSON.stringify(duracionMala.cuerpo));

  const horaMala = await guardar([{ nombre: "comida", horaInicio: "25:00", horaFin: "26:00", dias: TODOS_LOS_DIAS, activo: true }]);
  comprobar("una hora imposible se rechaza", horaMala.status === 400 && horaMala.cuerpo.error === "hora_invalida", JSON.stringify(horaMala.cuerpo));

  const tras = await api("/api/settings/turnos");
  comprobar("tras seis rechazos el horario sigue intacto", tras.cuerpo.turnos.length === original.turnos.length, `${tras.cuerpo.turnos.length} vs ${original.turnos.length}`);

  console.log("\nGuardado y caché (lo que de verdad importa):");

  // Cena movida a las 21:00. Si la caché no se invalida, una reserva a las 20:30
  // seguiría aceptándose durante cinco minutos.
  const nuevo = await guardar([
    { nombre: "comida", horaInicio: "13:00", horaFin: "16:30", dias: TODOS_LOS_DIAS, activo: true },
    { nombre: "cena", horaInicio: "21:00", horaFin: "23:30", dias: TODOS_LOS_DIAS, activo: true },
  ]);
  comprobar("se guarda el horario nuevo", nuevo.status === 200, JSON.stringify(nuevo.cuerpo));

  const alMomento = await api("/api/reservations", {
    method: "POST",
    body: JSON.stringify({ date: "2099-06-17", time: "20:30", pax: 2, customerName: "ZZTEST cache", notes: "" }),
  });
  comprobar(
    "una reserva a las 20:30 se rechaza EN EL ACTO (caché invalidada)",
    alMomento.status === 409 && alMomento.cuerpo.error === "fuera_de_horario",
    `${alMomento.status} ${JSON.stringify(alMomento.cuerpo)}`
  );
  comprobar(
    "y el mensaje dice el horario nuevo",
    String(alMomento.cuerpo.mensaje || "").includes("21:00"),
    alMomento.cuerpo.mensaje
  );

  const dentro = await api("/api/reservations", {
    method: "POST",
    body: JSON.stringify({ date: "2099-06-17", time: "21:30", pax: 2, customerName: "ZZTEST cache", notes: "" }),
  });
  comprobar("a las 21:30 sí entra", dentro.status === 201, `${dentro.status} ${JSON.stringify(dentro.cuerpo)}`);
  if (dentro.status === 201) {
    const db = require("../src/services/supabaseClient");
    await db.borrar({ restaurante: "el-sazon-venezolano" }, "reservas", dentro.cuerpo.id).catch(() => {});
  }
}

async function restaurar() {
  if (!original || !token) return;
  console.log("\nRestaurando el horario original...");
  const r = await guardar(original.turnos.map(sinId), original.duracionReservaMin);
  if (r.status !== 200) {
    console.error("  ¡ATENCIÓN! No se pudo restaurar:", JSON.stringify(r.cuerpo));
    fallos++;
    return;
  }
  const comprobacion = await api("/api/settings/turnos");
  const igual =
    comprobacion.cuerpo.turnos.length === original.turnos.length &&
    comprobacion.cuerpo.turnos.every((t, i) => t.horaInicio === original.turnos[i].horaInicio && t.horaFin === original.turnos[i].horaFin);
  console.log(igual ? "  Restaurado." : "  ¡ATENCIÓN! El horario NO quedó como estaba.");
  if (!igual) fallos++;
}

main()
  .catch((err) => {
    fallos++;
    console.error("\nERROR:", err.message);
  })
  .finally(async () => {
    await restaurar().catch((err) => console.error("ERROR restaurando:", err.message));
    console.log(fallos === 0 ? "\nTodo correcto." : `\n${fallos} comprobación(es) fallaron.`);
    process.exit(fallos === 0 ? 0 : 1);
  });
