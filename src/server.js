require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const vapiToolsRouter = require("./routes/vapiTools");
const whatsappRouter = require("./routes/whatsapp");
const internalJobsRouter = require("./routes/internalJobs");
const staffApiRouter = require("./routes/staffApi");
const callSimRouter = require("./routes/callSim");
const { router: authRouter } = require("./routes/auth");
const settingsApiRouter = require("./routes/settingsApi");
const integrationsRouter = require("./routes/integrations");

const app = express();

// Twilio envía application/x-www-form-urlencoded; Vapi envía JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/**
 * Estado del servicio y de su configuración.
 *
 * Informa de qué variables de entorno están puestas, NUNCA de su valor: solo
 * si existen y cuántos caracteres tienen. Sin esto, una variable mal escrita o
 * pegada con comillas se manifiesta como un 500 genérico, y la única forma de
 * averiguarlo es ir desplegando a ciegas.
 */
app.get("/health", (req, res) => {
  const presente = (v) => {
    const valor = process.env[v];
    if (!valor) return "FALTA";
    // Un valor entre comillas o con espacios pegados es un fallo habitual al
    // copiarlo en el panel de un servicio, y se nota en la longitud.
    const sospechoso = /^["']|["']$|^\s|\s$/.test(valor);
    return `ok (${valor.length} car.${sospechoso ? ", OJO: comillas o espacios" : ""})`;
  };

  // Decir "FALTA" no basta cuando el usuario jura haberla puesto: casi siempre
  // el nombre no es exactamente el esperado (SUPABASE_KEY en vez de
  // SUPABASE_SERVICE_KEY, minúsculas, un espacio). Listar los NOMBRES de las
  // que se le parecen convierte "no aparece" en "la tienes, pero se llama así".
  const parecidas = Object.keys(process.env)
    .filter((k) => /supa|SUPA/i.test(k))
    .sort();

  res.json({
    ok: true,
    config: {
      SUPABASE_URL: presente("SUPABASE_URL"),
      SUPABASE_SERVICE_KEY: presente("SUPABASE_SERVICE_KEY"),
      AIRTABLE_API_KEY: presente("AIRTABLE_API_KEY"),
      AUTH_JWT_SECRET: presente("AUTH_JWT_SECRET"),
      PUBLIC_BASE_URL: presente("PUBLIC_BASE_URL"),
      VAPI_WEBHOOK_SECRET: presente("VAPI_WEBHOOK_SECRET"),
    },
    // Mientras esto sea false, /vapi/tools atiende a quien llame. El id del
    // agente no es un secreto —lo devuelve la propia pantalla de
    // Configuración—, así que quien lo tenga puede crear y anular reservas.
    vapiToolsProtegido: Boolean(process.env.VAPI_WEBHOOK_SECRET),
    // Solo nombres, nunca valores.
    variablesConSupabaseEnElNombre: parecidas.length ? parecidas : "ninguna",
    totalVariables: Object.keys(process.env).length,
  });
});

app.use(vapiToolsRouter);
app.use(whatsappRouter);
app.use(internalJobsRouter);
// Webhooks de plataformas externas: públicos, con su propia autenticación.
app.use(integrationsRouter);
// El login va ANTES de los routers protegidos (sus rutas son públicas).
app.use(authRouter);
app.use(settingsApiRouter);
app.use(callSimRouter);
app.use(staffApiRouter);

// Panel de staff (SPA Restaurant-Manager): build de Vite en app/dist.
// Fallback a index.html para rutas de la SPA; las rutas de API van antes.
const spaDist = path.join(__dirname, "..", "app", "dist");
if (fs.existsSync(spaDist)) {
  app.use(express.static(spaDist));
  app.get("*", (req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(spaDist, "index.html"));
  });
} else {
  console.warn("[server] app/dist no existe; el panel de staff no se servirá (¿falta npm run build?).");
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  // Mantiene al día las reservas de las plataformas que hay que ir a consultar
  // (Supabase). Las que avisan por webhook no pasan por aquí.
  require("./services/autoSync").iniciar();
});
