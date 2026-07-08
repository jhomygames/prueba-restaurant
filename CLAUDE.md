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
  apuntando a `/vapi/tools` del backend. Pendiente: asignar un número de teléfono al
  assistant en Vapi (Vapi Phone Number o importar el número de Twilio) para poder recibir
  llamadas reales.
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
