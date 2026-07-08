require("dotenv").config();

const express = require("express");
const vapiToolsRouter = require("./routes/vapiTools");
const whatsappRouter = require("./routes/whatsapp");
const internalJobsRouter = require("./routes/internalJobs");

const app = express();

// Twilio envía application/x-www-form-urlencoded; Vapi envía JSON.
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use(vapiToolsRouter);
app.use(whatsappRouter);
app.use(internalJobsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
