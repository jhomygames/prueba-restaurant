/**
 * Importa a un restaurante los datos históricos exportados de Supabase (n8n).
 *
 *   node scripts/import-n8n-csv.js --slug el-sazon-venezolano --dir "C:/Users/.../Downloads"
 *   node scripts/import-n8n-csv.js --slug el-sazon-venezolano --dir ... --dry-run
 *
 * Espera encontrar en --dir los ficheros tal como los exporta Supabase:
 *   reservas_rows.csv, clientes_rows.csv, historial_reservas_rows.csv
 *
 * Qué hace además de copiar:
 *   - Normaliza los teléfonos y FUSIONA las fichas de cliente que eran la misma
 *     persona escrita de dos formas ("+34624114533" y "624114533").
 *   - Convierte las alergias dictadas en las notas ("alergia al marisco") al
 *     campo estructurado `Alergias`, sin tocar la nota original.
 *   - Asigna mesa a las reservas futuras que estén confirmadas.
 *   - Avisa de los teléfonos con pinta dudosa en vez de arreglarlos a ciegas.
 *
 * Es idempotente por `CodigoReserva` / teléfono: volver a ejecutarlo actualiza
 * en vez de duplicar.
 */

const fs = require("fs");
const path = require("path");

const PROJECT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(PROJECT, ".env") });

const phone = require(path.join(PROJECT, "src/services/phone"));
const allergens = require(path.join(PROJECT, "src/services/allergens"));
const reservations = require(path.join(PROJECT, "src/services/reservations"));

const PAT = process.env.AIRTABLE_API_KEY;
const REGISTRO = process.env.REGISTRO_BASE_ID;
const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: H, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

/**
 * Parser de CSV que respeta las comillas.
 * No vale con partir por comas: el historial trae JSON dentro de cada celda,
 * con comas y comillas escapadas ("" dentro de un campo entrecomillado).
 */
function parseCSV(texto) {
  const filas = [];
  let fila = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } // "" -> comilla literal
        else entreComillas = false;
      } else campo += c;
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ",") {
      fila.push(campo); campo = "";
    } else if (c === "\n") {
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else if (c !== "\r") {
      campo += c;
    }
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }

  const cabecera = filas.shift() || [];
  return filas
    .filter((f) => f.some((v) => v !== ""))
    .map((f) => Object.fromEntries(cabecera.map((k, i) => [k, f[i] ?? ""])));
}

function leerCSV(dir, nombre) {
  const ruta = path.join(dir, nombre);
  if (!fs.existsSync(ruta)) {
    console.log(`  (no se encontró ${nombre}, se omite)`);
    return [];
  }
  return parseCSV(fs.readFileSync(ruta, "utf8"));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (f) => (args.indexOf(f) > -1 ? args[args.indexOf(f) + 1] : null);
  const slug = get("--slug");
  const dir = get("--dir");
  if (!slug || !dir) {
    console.error('Uso: node scripts/import-n8n-csv.js --slug <slug> --dir "<carpeta con los CSV>" [--dry-run]');
    process.exit(1);
  }
  return { slug, dir, dryRun: args.includes("--dry-run") };
}

async function main() {
  if (!PAT) throw new Error("Falta AIRTABLE_API_KEY en .env");
  const { slug, dir, dryRun } = parseArgs();

  const { records } = await api(`https://api.airtable.com/v0/${REGISTRO}/Restaurantes`);
  const rest = records.find((r) => (r.fields.Slug || "") === slug);
  if (!rest) throw new Error(`No existe el restaurante "${slug}"`);
  const baseId = rest.fields.BaseId;
  const url = (t) => `https://api.airtable.com/v0/${baseId}/${t}`;

  console.log(`\nImportando a ${rest.fields.Nombre} (${baseId})${dryRun ? "  [SIMULACIÓN]" : ""}\n`);

  const avisos = [];

  // ---------- 1. Clientes ----------
  const clientesCSV = leerCSV(dir, "clientes_rows.csv");
  // Agrupar por los 9 últimos dígitos: ahí se ven las fichas duplicadas.
  const porClave = new Map();
  for (const c of clientesCSV) {
    const clave = phone.digitsKey(c.telefono);
    if (!clave) {
      // Una ficha sin teléfono no se puede recuperar nunca: la memoria de
      // clientes busca por número. Importarla solo crearía basura que se
      // duplica en cada ejecución. El nombre no se pierde: sigue en su reserva.
      avisos.push(`cliente sin teléfono, no se importa: "${c.nombre}" (su reserva sí conserva el nombre)`);
      continue;
    }
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(c);
    if (phone.esSospechoso(c.telefono)) {
      avisos.push(`teléfono dudoso en clientes: "${c.telefono}" (${c.nombre})`);
    }
  }

  const existentesCli = (await api(url("Clientes") + "?pageSize=100")).records;
  const indiceCli = new Map(
    existentesCli.map((r) => [phone.digitsKey(r.fields.Telefono), r.id]).filter(([k]) => k)
  );

  let cliNuevos = 0, cliFusionados = 0;
  for (const [clave, grupo] of porClave) {
    // De las fichas duplicadas gana la MÁS RECIENTE: es la última vez que esa
    // persona dijo cómo se llama, así que es el dato más fiable. (Elegir "el
    // nombre más largo" fallaba: en estos datos dejaba "Prueba Fixed Mode" por
    // encima de "Antony Bracamonte", que es la persona de verdad.)
    const mejor = grupo.reduce((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || "")) > 0 ? b : a
    );
    if (grupo.length > 1) {
      cliFusionados++;
      avisos.push(
        `fusionadas ${grupo.length} fichas del mismo número (${clave}): ${grupo.map((g) => g.nombre).join(" / ")} -> "${mejor.nombre}"`
      );
    }
    const fields = {
      Telefono: phone.normalize(mejor.telefono),
      Nombre: mejor.nombre || "",
      IdiomaPreferido: mejor.idioma_preferido || "es",
      LopdAcepta: String(mejor.lopd_acepta).toLowerCase() === "true",
      NumVisitas: Number(mejor.visitas) || 0,
    };
    if (mejor.notas_internas) fields.Preferencias = mejor.notas_internas;

    if (dryRun) { cliNuevos++; continue; }
    const yaId = indiceCli.get(clave);
    if (yaId) {
      await api(`${url("Clientes")}/${yaId}`, { method: "PATCH", body: JSON.stringify({ fields, typecast: true }) });
    } else {
      const creado = await api(url("Clientes"), { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
      indiceCli.set(clave, creado.id);
      cliNuevos++;
    }
  }
  console.log(`Clientes: ${porClave.size} únicos de ${clientesCSV.length} filas (${cliFusionados} fusiones)`);

  // ---------- 2. Reservas ----------
  const reservasCSV = leerCSV(dir, "reservas_rows.csv");
  const existentesRes = (await api(url("Reservas") + "?pageSize=100")).records;
  const indiceRes = new Map(
    existentesRes.map((r) => [r.fields.CodigoReserva, r.id]).filter(([k]) => k)
  );
  const mesas = (await api(url("Mesas"))).records;

  let resNuevas = 0, conAlergias = 0, sinMesa = 0;
  const hoy = new Date().toISOString().slice(0, 10);

  for (const r of reservasCSV) {
    if (!r.fecha || !r.hora) continue;
    const hora = r.hora.slice(0, 5);
    const cancelada = String(r.status).toLowerCase().startsWith("cancel");
    const extraidos = allergens.extraer(r.notas);
    if (extraidos.alergenos.length) conAlergias++;
    if (extraidos.contextoAlergia && !extraidos.reconocido) {
      avisos.push(`alergia sin interpretar en ${r.id_reserva} (${r.nombre}): "${r.notas}"`);
    }
    if (phone.esSospechoso(r.telefono)) {
      avisos.push(`teléfono dudoso en reserva ${r.id_reserva}: "${r.telefono}" (${r.nombre})`);
    }

    const fields = {
      FechaHora: `${r.fecha} ${hora}`,
      Personas: Number(r.personas) || 2,
      ClienteNombre: r.nombre || "",
      ClienteTelefono: phone.normalize(r.telefono),
      Estado: cancelada ? "cancelada" : "confirmada",
      Notas: r.notas || "",
      Origen: r.canal || "n8n",
      ExternalId: r.id_reserva,
      CodigoReserva: r.id_reserva,
      Turno: r.turno || reservations.derivarTurno(hora),
      LopdAcepta: String(r.lopd_acepta).toLowerCase() === "true",
    };
    if (extraidos.alergenos.length) fields.Alergias = extraidos.alergenos;

    // Solo se busca mesa a lo que sigue vivo: colocar reservas pasadas ocuparía
    // el plano con gente que ya cenó hace semanas.
    if (!cancelada && r.fecha >= hoy) {
      const ocupadas = new Set(
        existentesRes
          .filter((x) => x.fields.FechaHora === fields.FechaHora && x.fields.Estado === "confirmada")
          .flatMap((x) => x.fields.Mesa || [])
      );
      const libre = mesas.find(
        (m) => (m.fields.Capacidad || 0) >= fields.Personas && !ocupadas.has(m.id)
      );
      if (libre) fields.Mesa = [libre.id];
      else sinMesa++;
    }

    if (dryRun) { resNuevas++; continue; }
    const yaId = indiceRes.get(r.id_reserva);
    if (yaId) {
      await api(`${url("Reservas")}/${yaId}`, { method: "PATCH", body: JSON.stringify({ fields, typecast: true }) });
    } else {
      const creada = await api(url("Reservas"), { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
      existentesRes.push(creada);
      resNuevas++;
    }
  }
  console.log(`Reservas: ${resNuevas} importadas, ${conAlergias} con alérgenos estructurados, ${sinMesa} sin mesa libre`);

  // ---------- 3. Historial ----------
  const histCSV = leerCSV(dir, "historial_reservas_rows.csv");
  // Clave natural para no duplicar al reejecutar: el instante exacto del cambio
  // más la reserva y la acción. Dos cambios distintos no comparten timestamp.
  const yaEnHistorial = new Set(
    (await api(url("Historial") + "?pageSize=100")).records.map(
      (r) => `${r.fields.Cuando}|${r.fields.CodigoReserva}|${r.fields.Accion}`
    )
  );
  let histN = 0, histOmitidas = 0;
  for (const h of histCSV) {
    if (yaEnHistorial.has(`${h.created_at}|${h.reserva_id}|${h.accion}`)) { histOmitidas++; continue; }
    let antes = null, despues = null;
    try { antes = h.datos_anteriores ? JSON.parse(h.datos_anteriores) : null; } catch { /* dato corrupto: se ignora */ }
    try { despues = h.datos_nuevos ? JSON.parse(h.datos_nuevos) : null; } catch { /* idem */ }

    // El resumen legible se calcula aquí, con los nombres de campo de n8n.
    const cambios = [];
    if (antes && despues) {
      for (const k of ["fecha", "hora", "personas", "nombre", "telefono", "status", "turno"]) {
        if (despues[k] !== undefined && String(antes[k] ?? "") !== String(despues[k] ?? "")) {
          cambios.push(`${k}: ${antes[k] ?? "(vacío)"} -> ${despues[k] ?? "(vacío)"}`);
        }
      }
    }

    const fields = {
      Cuando: h.created_at || "",
      CodigoReserva: h.reserva_id || "",
      Accion: h.accion || "",
      Canal: h.canal || "n8n",
      Cambios: cambios.join("; "),
      DatosNuevos: h.datos_nuevos || "",
    };
    if (dryRun) { histN++; continue; }
    await api(url("Historial"), { method: "POST", body: JSON.stringify({ fields, typecast: true }) });
    histN++;
  }
  console.log(`Historial: ${histN} entradas nuevas${histOmitidas ? `, ${histOmitidas} ya estaban` : ""}`);

  if (avisos.length) {
    console.log(`\n--- ${avisos.length} avisos que conviene revisar a mano ---`);
    avisos.forEach((a) => console.log(`  · ${a}`));
  }
  if (dryRun) console.log("\n(SIMULACIÓN: no se escribió nada)");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
