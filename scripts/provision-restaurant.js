/**
 * Alta de un restaurante nuevo (multi-tenant).
 *
 *   node scripts/provision-restaurant.js --nombre "Demo Bistro" --email dueno@demo.com [--slug demo-bistro] [--sin-carta]
 *
 * Qué hace:
 *   1. Crea una base de Airtable propia con las 4 tablas del esquema
 *      (Mesas, Reservas, Clientes, Carta) — ver AIRTABLE_SCHEMA.md.
 *   2. Siembra el plano por defecto (15 mesas) y, salvo --sin-carta, una carta
 *      de ejemplo a partir de src/config/menu.json.
 *   3. Registra el restaurante en la base `Registro` y crea su usuario admin
 *      con una contraseña temporal.
 *
 * La configuración de canales (Vapi / WhatsApp) NO se hace aquí: el dueño del
 * local la conecta desde la pestaña Configuración del panel.
 *
 * La contraseña temporal se escribe en un fichero local ignorado por git,
 * nunca por consola ni en el repo.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PROJECT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(PROJECT, ".env") });
const bcrypt = require("bcryptjs");
const menuJson = require(path.join(PROJECT, "src/config/menu.json"));

const PAT = process.env.AIRTABLE_API_KEY;
const REGISTRO = process.env.REGISTRO_BASE_ID;
const WORKSPACE = process.env.AIRTABLE_WORKSPACE_ID || "wsppL40IyC9IFHp7X";

const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: H, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// ---------- Esquema de la base de un restaurante ----------

const ALERGENO_LABEL = {
  gluten: "Gluten", crustaceos: "Crustáceos", huevos: "Huevos", pescado: "Pescado",
  cacahuetes: "Cacahuetes", soja: "Soja", lacteos: "Lácteos",
  frutos_de_cascara: "Frutos de cáscara", apio: "Apio", mostaza: "Mostaza",
  sesamo: "Sésamo", sulfitos: "Sulfitos", altramuces: "Altramuces", moluscos: "Moluscos",
};
const ALERGENOS_CHOICES = [
  ...Object.values(ALERGENO_LABEL), "Vegano", "Vegetariano", "Sin Sal",
].map((name) => ({ name }));

const CHECK = (color) => ({ icon: "check", color });

const TABLAS = [
  {
    name: "Mesas",
    fields: [
      { name: "Nombre", type: "singleLineText" },
      { name: "Capacidad", type: "number", options: { precision: 0 } },
      { name: "Zona", type: "singleSelect", options: { choices: [{ name: "Interior" }, { name: "Terraza" }, { name: "Barra" }] } },
      { name: "Estado", type: "singleSelect", options: { choices: [{ name: "Libre" }, { name: "Ocupada" }, { name: "Reservada" }, { name: "Fuera de servicio" }] } },
      { name: "PosX", type: "number", options: { precision: 1 } },
      { name: "PosY", type: "number", options: { precision: 1 } },
      { name: "Forma", type: "singleSelect", options: { choices: [{ name: "square" }, { name: "circle" }, { name: "rectangle" }, { name: "bar" }] } },
      { name: "Rotacion", type: "number", options: { precision: 0 } },
    ],
  },
  {
    name: "Reservas",
    fields: [
      { name: "FechaHora", type: "singleLineText" },
      { name: "Personas", type: "number", options: { precision: 0 } },
      { name: "ClienteNombre", type: "singleLineText" },
      { name: "ClienteTelefono", type: "singleLineText" },
      { name: "Estado", type: "singleSelect", options: { choices: [{ name: "confirmada" }, { name: "cancelada" }, { name: "completada" }, { name: "pendiente" }, { name: "sentada" }] } },
      { name: "Notas", type: "multilineText" },
      { name: "Recordatorio24h", type: "checkbox", options: CHECK("greenBright") },
      { name: "Recordatorio1h", type: "checkbox", options: CHECK("greenBright") },
      { name: "ResenaPedida", type: "checkbox", options: CHECK("blueBright") },
      { name: "SentadaAt", type: "singleLineText" },
      { name: "Alergias", type: "multipleSelects", options: { choices: ALERGENOS_CHOICES } },
      { name: "DuracionMin", type: "number", options: { precision: 0 } },
      // Integraciones con plataformas externas (TheFork…): de dónde vino la
      // reserva y su id allí, que es lo que evita duplicarla al reprocesar.
      {
        name: "Origen",
        type: "singleSelect",
        options: {
          choices: ["panel", "voz", "whatsapp", "thefork", "demo", "n8n"].map((name) => ({ name })),
        },
      },
      { name: "ExternalId", type: "singleLineText" },
      // Turno de servicio, código legible por teléfono y consentimiento de
      // datos: conceptos que el flujo de voz necesita (ver AIRTABLE_SCHEMA.md).
      { name: "Turno", type: "singleSelect", options: { choices: [{ name: "comida" }, { name: "cena" }] } },
      { name: "CodigoReserva", type: "singleLineText" },
      { name: "LopdAcepta", type: "checkbox", options: CHECK("greenBright") },
    ],
  },
  {
    name: "Clientes",
    fields: [
      { name: "Telefono", type: "singleLineText" },
      { name: "Nombre", type: "singleLineText" },
      { name: "AlergenosConocidos", type: "multipleSelects", options: { choices: ALERGENOS_CHOICES } },
      { name: "Preferencias", type: "multilineText" },
      { name: "UltimaVisita", type: "singleLineText" },
      { name: "NumVisitas", type: "number", options: { precision: 0 } },
      {
        name: "IdiomaPreferido",
        type: "singleSelect",
        options: { choices: ["es", "en", "fr", "de", "it", "pt", "ca"].map((name) => ({ name })) },
      },
      { name: "LopdAcepta", type: "checkbox", options: CHECK("greenBright") },
    ],
  },
  {
    name: "Historial",
    description: "Traza de cambios de las reservas (quién, cuándo y qué cambió)",
    fields: [
      { name: "Cuando", type: "singleLineText" },
      { name: "CodigoReserva", type: "singleLineText" },
      { name: "ReservaId", type: "singleLineText" },
      {
        name: "Accion",
        type: "singleSelect",
        options: {
          choices: ["created", "modified", "cancelled", "seated", "completed"].map((name) => ({ name })),
        },
      },
      {
        name: "Canal",
        type: "singleSelect",
        options: {
          choices: ["panel", "voz", "whatsapp", "thefork", "demo", "n8n"].map((name) => ({ name })),
        },
      },
      { name: "Cambios", type: "multilineText" },
      { name: "DatosNuevos", type: "multilineText" },
    ],
  },
  {
    name: "Carta",
    fields: [
      { name: "Nombre", type: "singleLineText" },
      { name: "Categoria", type: "singleSelect", options: { choices: menuJson.categorias.map((c) => ({ name: c.nombre })) } },
      { name: "Descripcion", type: "multilineText" },
      { name: "Precio", type: "number", options: { precision: 2 } },
      { name: "Alergenos", type: "multipleSelects", options: { choices: ALERGENOS_CHOICES } },
      { name: "Destacado", type: "checkbox", options: { icon: "star", color: "yellowBright" } },
      { name: "Disponible", type: "checkbox", options: CHECK("greenBright") },
      { name: "Orden", type: "number", options: { precision: 0 } },
    ],
  },
];

// Plano por defecto: mismas 15 mesas que el diseño original del panel.
const MESAS_DEFECTO = [
  ["Mesa 1", 4, 15, 15, "square", 0, "Interior"],
  ["Mesa 2", 2, 35, 15, "circle", 0, "Interior"],
  ["Mesa 3", 4, 55, 15, "square", 0, "Interior"],
  ["Mesa 4", 6, 75, 15, "rectangle", 0, "Interior"],
  ["Mesa 5", 4, 15, 40, "circle", 0, "Interior"],
  ["Mesa 6", 8, 38, 40, "rectangle", 90, "Interior"],
  ["Mesa 7", 4, 65, 40, "square", 0, "Interior"],
  ["Barra 1", 1, 88, 55, "bar", 0, "Barra"],
  ["Barra 2", 1, 88, 65, "bar", 0, "Barra"],
  ["Barra 3", 1, 88, 75, "bar", 0, "Barra"],
  ["Barra 4", 1, 88, 85, "bar", 0, "Barra"],
  ["Terraza 1", 2, 15, 75, "circle", 0, "Terraza"],
  ["Terraza 2", 2, 30, 75, "circle", 0, "Terraza"],
  ["Terraza 3", 4, 48, 75, "square", 45, "Terraza"],
  ["Terraza 4", 6, 65, 75, "rectangle", 0, "Terraza"],
];

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i > -1 ? args[i + 1] : null;
  };
  const nombre = get("--nombre");
  const email = get("--email");
  if (!nombre || !email) {
    console.error('Uso: node scripts/provision-restaurant.js --nombre "Mi Restaurante" --email dueno@mail.com [--slug mi-restaurante] [--sin-carta]');
    process.exit(1);
  }
  const slug =
    get("--slug") ||
    nombre.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return { nombre, email: email.toLowerCase(), slug, sinCarta: args.includes("--sin-carta") };
}

async function main() {
  if (!PAT) throw new Error("Falta AIRTABLE_API_KEY en .env");
  if (!REGISTRO) throw new Error("Falta REGISTRO_BASE_ID en .env (ejecuta antes scripts/setup-registro.js)");

  const { nombre, email, slug, sinCarta } = parseArgs();
  const data = (base, t) => `https://api.airtable.com/v0/${base}/${t}`;

  // Evitar duplicados de slug o email
  const yaRest = await api(data(REGISTRO, "Restaurantes"));
  if (yaRest.records.some((r) => (r.fields.Slug || "").toLowerCase() === slug)) {
    throw new Error(`Ya existe un restaurante con el slug "${slug}"`);
  }
  const yaUsers = await api(data(REGISTRO, "Usuarios"));
  if (yaUsers.records.some((r) => (r.fields.Email || "").toLowerCase() === email)) {
    throw new Error(`Ya existe un usuario con el email "${email}"`);
  }

  // 1. Base propia
  const base = await api("https://api.airtable.com/v0/meta/bases", {
    method: "POST",
    body: JSON.stringify({ name: `Restaurante ${nombre}`, workspaceId: WORKSPACE, tables: TABLAS }),
  });
  console.log(`Base creada para ${nombre}: ${base.id}`);

  // 1b. Campo de enlace Reservas.Mesa -> Mesas.
  // No puede ir en la creación de la base: un campo de enlace necesita el id de
  // la tabla destino, que Airtable solo asigna DESPUÉS de crearla. Sin este
  // campo, guardar una reserva falla con "Unknown field name: Mesa".
  const esquema = await api(`https://api.airtable.com/v0/meta/bases/${base.id}/tables`);
  const tblMesas = esquema.tables.find((t) => t.name === "Mesas");
  const tblReservas = esquema.tables.find((t) => t.name === "Reservas");
  await api(`https://api.airtable.com/v0/meta/bases/${base.id}/tables/${tblReservas.id}/fields`, {
    method: "POST",
    body: JSON.stringify({
      name: "Mesa",
      type: "multipleRecordLinks",
      options: { linkedTableId: tblMesas.id },
    }),
  });
  console.log("  campo Reservas.Mesa enlazado a Mesas");

  // 2. Siembra del plano
  const mesas = MESAS_DEFECTO.map(([Nombre, Capacidad, PosX, PosY, Forma, Rotacion, Zona]) => ({
    fields: { Nombre, Capacidad, PosX, PosY, Forma, Rotacion, Zona, Estado: "Libre" },
  }));
  for (let i = 0; i < mesas.length; i += 10) {
    await api(data(base.id, "Mesas"), {
      method: "POST",
      body: JSON.stringify({ records: mesas.slice(i, i + 10), typecast: true }),
    });
  }
  console.log(`  ${mesas.length} mesas sembradas`);

  // 3. Carta de ejemplo (opcional)
  if (!sinCarta) {
    const platos = [];
    let orden = 0;
    for (const cat of menuJson.categorias) {
      for (const p of cat.platos) {
        const fields = {
          Nombre: p.nombre,
          Categoria: cat.nombre,
          Descripcion: p.descripcion || "",
          Alergenos: (p.alergenos || []).map((a) => ALERGENO_LABEL[a] || a),
          Destacado: false,
          Disponible: true,
          Orden: orden++,
        };
        if (typeof p.precio === "number") fields.Precio = p.precio;
        platos.push({ fields });
      }
    }
    for (let i = 0; i < platos.length; i += 10) {
      await api(data(base.id, "Carta"), {
        method: "POST",
        body: JSON.stringify({ records: platos.slice(i, i + 10), typecast: true }),
      });
    }
    console.log(`  ${platos.length} platos de ejemplo sembrados`);
  }

  // 4. Registro + usuario admin
  const tenant = await api(data(REGISTRO, "Restaurantes"), {
    method: "POST",
    body: JSON.stringify({
      fields: { Slug: slug, Nombre: nombre, BaseId: base.id, Activo: true },
      typecast: true,
    }),
  });

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(tempPassword, 10);
  await api(data(REGISTRO, "Usuarios"), {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Email: email,
        PasswordHash: hash,
        NombreStaff: "Administrador",
        Rol: "admin",
        Activo: true,
        RestauranteId: tenant.id,
      },
      typecast: true,
    }),
  });

  const credPath = path.join(PROJECT, "CREDENCIALES_INICIALES.txt");
  const linea =
    `\n--- ${nombre} (${slug}) ---\n` +
    `Email:      ${email}\n` +
    `Contraseña: ${tempPassword}\n` +
    `Base:       ${base.id}\n`;
  fs.appendFileSync(credPath, linea);

  console.log("\nRestaurante dado de alta:");
  console.log(`  Nombre: ${nombre}`);
  console.log(`  Slug:   ${slug}`);
  console.log(`  Base:   ${base.id}`);
  console.log(`  Admin:  ${email}`);
  console.log(`\nLa contraseña temporal se añadió a CREDENCIALES_INICIALES.txt (fichero local, no se sube a git).`);
  console.log(`Siguiente paso: entrar al panel con ese usuario y conectar Vapi/WhatsApp en la pestaña Configuración.`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
