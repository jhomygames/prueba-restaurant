// Fase 1: crea la base central `Registro` (Restaurantes + Usuarios),
// registra el restaurante actual como tenant 1 y crea su usuario admin.
// Idempotente: si la base ya existe (REGISTRO_BASE_ID en .env), la reutiliza.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const PROJECT = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(PROJECT, ".env") });
const bcrypt = require("bcryptjs");

const PAT = process.env.AIRTABLE_API_KEY;
const WORKSPACE = "wsppL40IyC9IFHp7X";
const TENANT1_BASE = "app4Q8A4HIcFRkFza";
const ADMIN_EMAIL = "jhomygames12@gmail.com";

const H = { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" };

async function api(url, opts = {}) {
  const res = await fetch(url, { headers: H, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const RESTAURANTES_FIELDS = [
  { name: "Slug", type: "singleLineText" },
  { name: "Nombre", type: "singleLineText" },
  { name: "BaseId", type: "singleLineText" },
  { name: "GoogleReviewUrl", type: "singleLineText" },
  { name: "StaffWhatsApp", type: "singleLineText" },
  { name: "Activo", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  { name: "VapiApiKeyEnc", type: "multilineText" },
  { name: "VapiAssistantId", type: "singleLineText" },
  { name: "VapiPhoneNumberId", type: "singleLineText" },
  { name: "VapiTelefono", type: "singleLineText" },
  { name: "TwilioAccountSid", type: "singleLineText" },
  { name: "TwilioAuthTokenEnc", type: "multilineText" },
  { name: "TwilioWhatsAppFrom", type: "singleLineText" },
];

const USUARIOS_FIELDS = [
  { name: "Email", type: "singleLineText" },
  { name: "PasswordHash", type: "singleLineText" },
  { name: "NombreStaff", type: "singleLineText" },
  {
    name: "Rol",
    type: "singleSelect",
    options: { choices: [{ name: "admin" }, { name: "staff" }] },
  },
  { name: "Activo", type: "checkbox", options: { icon: "check", color: "greenBright" } },
  { name: "RestauranteId", type: "singleLineText" }, // id del record en Restaurantes
];

async function main() {
  let baseId = process.env.REGISTRO_BASE_ID;

  if (!baseId) {
    const created = await api("https://api.airtable.com/v0/meta/bases", {
      method: "POST",
      body: JSON.stringify({
        name: "Registro Restaurantes",
        workspaceId: WORKSPACE,
        tables: [
          { name: "Restaurantes", fields: RESTAURANTES_FIELDS },
          { name: "Usuarios", fields: USUARIOS_FIELDS },
        ],
      }),
    });
    baseId = created.id;
    console.log("Base Registro creada:", baseId);

    // Guardar en .env local
    const envPath = path.join(PROJECT, ".env");
    let env = fs.readFileSync(envPath, "utf8");
    if (!/^REGISTRO_BASE_ID=/m.test(env)) {
      env = env.trimEnd() + `\nREGISTRO_BASE_ID=${baseId}\n`;
      fs.writeFileSync(envPath, env);
      console.log("REGISTRO_BASE_ID añadido al .env local");
    }
  } else {
    console.log("Reutilizando REGISTRO_BASE_ID existente:", baseId);
  }

  const data = (t) => `https://api.airtable.com/v0/${baseId}/${t}`;

  // ---- Tenant 1: el restaurante actual ----
  const existing = await api(data("Restaurantes"));
  let tenant = existing.records.find((r) => r.fields.BaseId === TENANT1_BASE);

  if (!tenant) {
    tenant = await api(data("Restaurantes"), {
      method: "POST",
      body: JSON.stringify({
        fields: {
          Slug: "gourmeats-madrid",
          Nombre: "Hamburguesería Gourmeats",
          BaseId: TENANT1_BASE,
          GoogleReviewUrl: process.env.GOOGLE_REVIEW_URL || "",
          StaffWhatsApp: "",
          Activo: true,
          VapiAssistantId: "9311abda-3e54-4da5-b211-37406959505f",
          VapiPhoneNumberId: "fc4ba1ca-6517-427f-ad04-91d9db2b5f65",
          VapiTelefono: "+15623959059",
        },
        typecast: true,
      }),
    });
    console.log("Tenant 1 registrado:", tenant.id);
  } else {
    console.log("Tenant 1 ya existía:", tenant.id);
  }

  // ---- Usuario admin del tenant 1 ----
  const users = await api(data("Usuarios"));
  const existingUser = users.records.find(
    (r) => (r.fields.Email || "").toLowerCase() === ADMIN_EMAIL
  );

  if (existingUser) {
    console.log("El usuario admin ya existe, no se toca la contraseña.");
    return;
  }

  // Contraseña temporal: se escribe SOLO en un fichero local ignorado por git.
  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const hash = await bcrypt.hash(tempPassword, 10);

  await api(data("Usuarios"), {
    method: "POST",
    body: JSON.stringify({
      fields: {
        Email: ADMIN_EMAIL,
        PasswordHash: hash,
        NombreStaff: "Jhomar",
        Rol: "admin",
        Activo: true,
        RestauranteId: tenant.id,
      },
      typecast: true,
    }),
  });

  const credPath = path.join(PROJECT, "CREDENCIALES_INICIALES.txt");
  fs.writeFileSync(
    credPath,
    `Acceso inicial al panel (CÁMBIALO tras entrar y borra este archivo)\n\n` +
      `Restaurante: Hamburguesería Gourmeats\n` +
      `Email:       ${ADMIN_EMAIL}\n` +
      `Contraseña:  ${tempPassword}\n`
  );
  console.log("Usuario admin creado. Contraseña temporal escrita en CREDENCIALES_INICIALES.txt");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
