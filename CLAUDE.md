# CLAUDE.md — Sistema de Agentes IA para Restaurante (Voz + WhatsApp)

Este archivo resume todo lo decidido y construido hasta ahora en una conversación con
Claude (claude.ai), para que Claude Code pueda continuar sin perder contexto.

## Objetivo del proyecto

Sistema de atención al cliente para un restaurante (mercado Gran Caracas / hispanohablante),
con dos canales que comparten el mismo backend y las mismas herramientas:

- **Agente de voz 24/7 multilingüe** (Vapi + Twilio): reservas, info general, transferencia
  a humano, LOPD compliant, carta y 14 alérgenos obligatorios.
- **WhatsApp conversacional** (Twilio WhatsApp Business API): todo lo del agente de voz +
  recordatorios anti no-show (24h y 1h antes) + solicitud de reseña Google post-visita +
  memoria básica de clientes habituales.

## Decisiones tomadas (no volver a preguntar esto)

- **Sistema de reservas (actualizado 2026-07-08)**: se descartó Covermanager/TheFork para
  la fase de sandbox. Ahora `src/services/reservations.js` y `src/services/customerMemory.js`
  usan **Airtable** como base de datos real (no un stub): una sola base con tablas `Mesas`,
  `Reservas` y `Clientes` (esquema completo en `AIRTABLE_SCHEMA.md`). Airtable sirve doble
  propósito: backend de datos Y la interfaz visual para que el staff vea/edite mesas y
  reservas directamente. Requiere `AIRTABLE_API_KEY` (Personal Access Token) y
  `AIRTABLE_BASE_ID` en `.env`. Supabase queda sin uso por ahora (se puede reintroducir si
  el proyecto escala más allá del sandbox).
- **Base de Airtable creada (2026-07-08)**: Base ID `app4Q8A4HIcFRkFza` (nombre "Restaurant"),
  tablas `Mesas` (id `tblZE4KibHlNAsqBb`, 6 mesas de ejemplo cargadas), `Reservas` (id
  `tbl5P0DjU5QBcq2rk`), `Clientes` (id `tblBtVOq8l0fHb8kw`) — esquema exacto en
  `AIRTABLE_SCHEMA.md`. Sigue existiendo la tabla de plantilla "Table 1" sin usar (no se
  borró automáticamente, requiere confirmación explícita del usuario por ser irreversible).
  Flujo completo probado en producción (Railway): check_availability, create_reservation y
  cancel_reservation contra la base real, funcionando correctamente.
- **Entorno actual**: sandbox de pruebas, no producción. El usuario ya tiene cuentas de
  Twilio y Vapi.
- **Deploy (actualizado 2026-07-08)**: backend desplegado en Railway, URL pública
  `https://prueba-restaurant-production.up.railway.app`. Repo en
  `https://github.com/jhomygames/prueba-restaurant`.
- **Vapi Assistant creado vía API (2026-07-08)**: id `9311abda-3e54-4da5-b211-37406959505f`,
  nombre "Recepcionista Restaurante (sandbox)". Modelo `claude-sonnet-4-6` (provider
  `anthropic` — Vapi todavía no soporta el id `claude-sonnet-5`, ver lista de modelos
  soportados si se necesita actualizar). Voz `11labs` (voiceId `21m00Tcm4TlvDq8ikWAM`,
  modelo `eleven_multilingual_v2`), transcriber `deepgram nova-2` en español. Tools
  apuntando a `/vapi/tools` del backend.
- **Número de teléfono asignado (2026-07-08)**: `+15623959059` (número gratuito de Vapi,
  provider `vapi`, id `fc4ba1ca-6517-427f-ad04-91d9db2b5f65`), ligado directo al assistant
  de arriba. Probado con llamada real: funciona.
- **Carta real cargada (2026-07-09)**: `menu.json` contiene la carta de la hamburguesería
  del enlace Gourmeats del usuario (https://qr.gourmeatsapp.com/slider/beAcEQMYEFlZa1dSFJ2J),
  con los 14 alérgenos asignados POR EJEMPLO según ingredientes típicos — el restaurante
  debe validarlos antes de producción. La página es una SPA de Firestore; la carta se
  extrajo con el navegador (la API bloquea scraping directo).
- **Flujos reforzados (2026-07-09)**: recordatorios y reseñas idempotentes vía flags en
  Airtable (`Recordatorio24h`, `Recordatorio1h`, `ResenaPedida` — checkboxes creados vía
  Meta API en la tabla Reservas). Ventanas de recordatorio sin solape (24h → rango 20-25h;
  1h → 0-1.25h). Las visitas se cuentan al completarse (job de reseñas), no por mensaje.
  Prompts de voz y WhatsApp reescritos: fecha/hora actual inyectada ({{now}} en Vapi,
  server-side en WhatsApp), confirmación de datos antes de reservar, protocolo estricto
  de alérgenos, estilo específico por canal. Vapi además con turn-taking afinado
  (startSpeakingPlan/stopSpeakingPlan) y voz con stability 0.5 / similarityBoost 0.75.
  La voz concreta (voiceId) sigue siendo la default Rachel de 11labs: el usuario quiere
  elegirla escuchándolas en dashboard.vapi.ai → Assistant → Voice.
- **Prompt de voz v2 (2026-07-11)**: reescrito y aplicado vía PATCH al assistant. Cambios
  clave: identidad con nombre ("María"), flujo de reserva en 5 pasos numerados donde el
  paso 3 (preguntar alergias/intolerancias/dietas) y el paso 4 (confirmar todos los datos
  en voz alta y esperar un "sí" explícito) son OBLIGATORIOS antes de create_reservation,
  manejo de modificaciones (cancelar + recrear), protocolo de errores de herramientas
  (transferir a humano sin dramatizar), y límites (no prometer nada no confirmable).
- **Panel de staff integrado (2026-07-12)**: la app "DineControl AI" (antes repo
  jhomygames/Restaurant-Manager) vive ahora en `app/` (React 19 + Vite + Tailwind) y se
  sirve como estáticos desde el mismo Express en `/` (build en `app/dist`, script `build`
  del package.json raíz la compila en Railway). Airtable es la ÚNICA base de datos: la SPA
  ya no usa localStorage para mesas/reservas (solo para decoraciones del plano y el PDF de
  la carta). Consume `src/routes/staffApi.js` (`/api/tables` CRUD completo incl. DELETE,
  `/api/reservations` GET/POST/PATCH, `/api/customers` GET, `/api/call/simulate` mock sin
  Gemini) con polling cada 20 s — así las reservas creadas por voz/WhatsApp aparecen solas
  y generan notificación. El editor del plano persiste en Airtable (drag con debounce
  700 ms; crear/borrar mesa = crear/borrar registro en Mesas). Campos añadidos vía Meta
  API: Mesas.PosX/PosY/Forma/Rotacion; Reservas.SentadaAt/Alergias/DuracionMin. Estados de
  reserva ampliados a pendiente/sentada (se crean vía typecast:true, la Meta API no deja
  ampliar selects). Mapeo ES↔EN en staffApi.js. Las 15 mesas del plano original de la app
  (7 sala + 4 barra + 4 terraza) están sembradas en Airtable. STAFF_API_KEY opcional
  (si se define, la API exige header x-staff-key; sin definir queda abierta — sandbox).
- **Simulador de llamada migrado a Claude (2026-07-12)**: el "Simular LLAMADA AI" del panel
  ya no usa Gemini ni mocks. La recepcionista del simulador ES el agente real: `src/routes/callSim.js`
  ejecuta a María con el prompt de voz compartido (`src/config/voicePrompt.js`, misma versión que
  el assistant de Vapi), las 6 herramientas de `tools.js` y el `toolDispatcher` común, así que
  `create_reservation` escribe DE VERDAD en Airtable y la reserva aparece sola en el plano —
  igual que una llamada real de Vapi, pero sobre texto. Endpoints: `POST /api/call/agent` (un
  turno de María, encadena tool-calls; modelo claude-sonnet-5) y `POST /api/call/customer`
  (cliente rol-play; claude-haiku-4-5). El frontend (`CallSimulator.tsx`) orquesta la conversación
  agente↔cliente automáticamente, muestra la actividad de herramientas y, al crear la reserva,
  refresca el plano. Requiere `ANTHROPIC_API_KEY` (ya presente en Railway; sin ella los endpoints
  devuelven 500 agent_error/customer_error). Si se edita el prompt de voz, replicarlo en Vapi.
- **Automatizaciones**: híbrido Claude Code + Make.com. Toda la lógica de negocio vive en
  el backend (`src/routes/internalJobs.js`); Make.com solo actúa como "reloj" que dispara
  un HTTP POST por horario. Se decidió así para no depender de módulos frágiles de Make
  (iteradores, conectores nativos de Twilio, etc.).
- **Plan de Make es Free** (máx. 2 escenarios simultáneos). Por eso los recordatorios de
  24h y 1h se **fusionaron en un solo escenario** (`/internal/reminders/run` revisa ambas
  ventanas en una sola ejecución). Las reseñas son el segundo escenario.
- **Cuentas de Vapi y Twilio**: el usuario (Jhomar) ya las tiene creadas, con credenciales
  a mano. Pendiente: pegarlas en el `.env` real (nunca committear ese archivo).
- **Hosting del backend**: aún no desplegado. Candidatos: Railway o Render.

## Estado actual de la infraestructura

### Ya ejecutado (por Claude vía Make API, cuenta ya conectada del usuario)
| Recurso | ID | Estado |
|---|---|---|
| Escenario Make "Recordatorios reservas (24h + 1h)" | `6492914` | Creado, **desactivado** (apunta a URL placeholder) |
| Escenario Make "Solicitud de reseña Google" | `6492919` | Creado, **desactivado** (apunta a URL placeholder) |
| Nota de checklist en Notion | [link](https://app.notion.com/p/39795368252481d5a2f9facbc18f26d7) | Con checklist por fase |

Ambos escenarios de Make tienen scheduling `on-demand` por ahora. Al activarlos hay que
ponerlos en modo "regular interval", mínimo 15 min (límite del plan Free).

### Pendiente — requiere acción humana (Claude/Claude Code no tiene acceso de red a estos servicios)
1. Desplegar el backend (`/` de este repo) en Railway o Render → obtener URL pública (sandbox).
2. Crear la base de Airtable siguiendo `AIRTABLE_SCHEMA.md` (tablas Mesas/Reservas/Clientes),
   generar el Personal Access Token, y rellenar `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` en `.env`.
   También rellenar el resto de `.env` con credenciales reales de Twilio, Vapi, Anthropic.
3. En los 2 escenarios de Make (IDs arriba): reemplazar `TU_BACKEND_URL` y
   `PEGA_AQUI_TU_INTERNAL_JOBS_SECRET` por los valores reales, activar, poner intervalo 15 min.
4. Crear el Assistant en Vapi: pegar el system prompt + tools de `src/config/tools.js`,
   Server URL → `https://TU_BACKEND_URL/vapi/tools`.
5. En Twilio: configurar webhook de WhatsApp → `https://TU_BACKEND_URL/whatsapp/webhook`.
6. ~~Conectar reservations.js con Covermanager/TheFork~~ — resuelto: ahora usa Airtable
   (ver `src/services/reservations.js` y `AIRTABLE_SCHEMA.md`).
7. ~~Crear tabla customers en Supabase~~ — resuelto: la memoria de clientes ahora vive en
   la tabla `Clientes` de Airtable (ver `src/services/customerMemory.js`).
8. Cargar la carta real con los 14 alérgenos en `src/config/menu.json`.
9. Añadir verificación de firma de webhooks (Vapi secret / Twilio signature) antes de producción.
10. Mover el historial de conversación de WhatsApp (ahora mismo en memoria del proceso,
    `whatsapp.js`) a Airtable/Redis para que sobreviva reinicios.
11. ~~getRecentlyCompletedVisits stub~~ — resuelto: ahora consulta reservas confirmadas en
    Airtable dentro de la ventana horaria real, ya no reutiliza `getUpcomingReservations`.

## Estructura del proyecto

```
src/
  server.js                 # entrypoint Express
  routes/
    vapiTools.js             # webhook de tool-calls de Vapi (voz)
    whatsapp.js               # webhook de WhatsApp + loop de tool-use de Claude
    internalJobs.js           # endpoints que dispara Make.com (recordatorios, reseñas)
  services/
    airtableClient.js          # cliente REST genérico para Airtable
    reservations.js            # mesas/reservas respaldado por Airtable
    customerMemory.js          # memoria de clientes respaldada por Airtable
    transferToHuman.js        # notifica al staff por WhatsApp
    toolDispatcher.js          # despacha cualquier tool por nombre
  config/
    tools.js                   # esquema de funciones, compartido entre voz y WhatsApp
    menu.json                  # carta + 14 alérgenos (datos de ejemplo, falta cargar los reales)
make-blueprints/
  recordatorios-fusionado.json # blueprint validado del escenario 6492914
  solicitud-resena.json         # blueprint validado del escenario 6492919
  README.md                     # instrucciones de importación/activación
```

## Reglas de seguridad ya aplicadas (mantenerlas)

- Endpoints `/internal/*` protegidos con header `x-internal-secret` (`INTERNAL_JOBS_SECRET`).
- Nunca commitear `.env` real, solo `.env.example`.
- El backend es la única pieza que habla con Covermanager/TheFork, Supabase y Twilio;
  ni Vapi ni Make hablan directo con esos servicios.

## Próximo paso sugerido

Continuar por el punto 1 (deploy) o el punto 6 (conectar Covermanager/TheFork real),
lo que el usuario prefiera. Todo lo demás depende de tener al menos una URL pública del backend.
