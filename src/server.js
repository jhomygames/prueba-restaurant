require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const vapiToolsRouter = require("./routes/vapiTools");
const whatsappRouter = require("./routes/whatsapp");
const internalJobsRouter = require("./routes/internalJobs");
const staffApiRouter = require("./routes/staffApi");
const callSimRouter = require("./routes/callSim");

const app = express();

// Twilio envía application/x-www-form-urlencoded; Vapi envía JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(vapiToolsRouter);
app.use(whatsappRouter);
app.use(internalJobsRouter);
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
});
