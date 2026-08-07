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

app.get("/health", (req, res) => res.json({ ok: true }));

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
