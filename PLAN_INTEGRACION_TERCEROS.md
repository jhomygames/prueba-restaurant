# Plan de acción: integraciones con plataformas de reservas (TheFork y similares)

> Plan autocontenido para ejecutar en una sesión nueva (Opus). Leer entero antes de
> empezar. Objetivo: que las reservas hechas en plataformas de terceros (TheFork,
> Covermanager, Google Reserve…) aparezcan automáticamente en nuestra app — en el
> plano, el calendario y la memoria de clientes — igual que las que crea María.
>
> ⚠️ **REGLA DE ESTA EJECUCIÓN: NO HACER `git push`.** Commits locales sí; el push
> a main (y por tanto el deploy a Railway) queda pendiente de confirmación explícita
> del usuario. La verificación final se hace EN LOCAL.
>
> Al terminar: actualizar CLAUDE.md y AIRTABLE_SCHEMA.md y borrar este archivo.

## Contexto del proyecto (imprescindible)

- Repo: este directorio = `jhomygames/prueba-restaurant`. Producción en
  `https://prueba-restaurant-production.up.railway.app` (NO tocar en esta ejecución).
- Sistema MULTI-TENANT: base central `Registro` (`REGISTRO_BASE_ID` en `.env`) con
  tablas `Restaurantes` y `Usuarios`; cada restaurante tiene SU base de Airtable
  (campo `BaseId`). Tenants actuales: `gourmeats-madrid` (base `appbBnqDLwBR1YCMd`)
  y `demo-bistro` (base `appJwX5Ww6SmDbbag`). Ver AIRTABLE_SCHEMA.md.
- Piezas clave existentes:
  - `src/services/airtableClient.js` — REST Airtable; `baseId` OBLIGATORIO como
    primer parámetro de todas las funciones (lanza si falta).
  - `src/services/registry.js` — resuelve tenants; caché 60 s; `updateRestaurant`
    invalida; `twilioCredentials`/`vapiApiKey` con fallback a envs centrales.
  - `src/services/secretBox.js` — AES-256-GCM (`TENANT_SECRETS_KEY`) para
    credenciales por tenant; campos `*Enc` en el Registro; `mask()` para la UI.
  - `src/services/reservations.js` — `findAvailableTable(ctx,…)`,
    `createReservation(ctx,…)` (asigna Mesa y estado `confirmada`),
    `toReservationShape`. FechaHora = texto `YYYY-MM-DD HH:mm`.
  - `src/routes/staffApi.js` — API del panel bajo `requireAuth` (tenant del JWT);
    patrón `handle()` que mapea 404/403 de Airtable a `404 no_encontrado`.
  - `src/routes/internalJobs.js` — jobs disparados por Make (header
    `x-internal-secret`), iteran `registry.activeRestaurants()` aislando errores
    por tenant.
  - `src/routes/settingsApi.js` + `app/src/components/SettingsView.tsx` — pestaña
    Configuración con tarjetas por integración (patrón a imitar: PUT valida antes
    de guardar, secretos cifrados, GET solo enmascarado, rate-limit
    `tooManyActions`).
  - Panel: `app/src/App.tsx` con polling 20 s (`refreshFromServer`) que ya
    notifica reservas nuevas; `CalendarView.tsx` pinta cada reserva con badges.
- Trampas conocidas: checkboxes de Airtable desmarcados llegan `undefined`
  (comparar `=== true`); opciones de selects solo crecen con `typecast:true`;
  Node >= 20; NO commitear `app/package-lock.json`; los campos de enlace
  (`multipleRecordLinks`) no pueden crearse en el POST inicial de una base (el
  script de alta los crea en un segundo paso — mismo patrón si hiciera falta).
- Secretos: NUNCA en chat/repo/logs. `.env` local tiene Airtable + secrets keys.

## Realidad de TheFork (verificado contra docs.thefork.io/POS-API, 2026-07)

**TheFork SÍ envía un webhook real hacia el POS del restaurante — confirmado
leyendo `docs.thefork.io/POS-API/Flow/create-order`.** Esto cambia el plan: el
adaptador `thefork` deja de ser "mapeo especulativo tras un flag" y pasa a ser
un **receptor de webhook con forma de payload conocida**.

Lo confirmado en la documentación pública (Flow "Create Orders"):

- **Dirección**: TheFork inicia la llamada HTTP hacia el restaurante, no al
  revés. Cita textual: *"If a new reservation is made for a specific restaurant
  on TheFork, we call the `receiptOpeningUrl` with an HTTP POST request to your
  system."*
- **Autenticación del webhook entrante**: TheFork añade
  `Authorization: Bearer {ACCESS_TOKEN}` a la petición, donde el token es "el
  que le enviamos previamente" — es decir, un token que EL RESTAURANTE (o su
  proveedor de POS) le entrega a TheFork durante el alta, y luego TheFork lo
  reenvía en cada llamada para que el receptor pueda verificarlo. Nuestro
  adaptador debe comparar ese Bearer contra el valor guardado
  (`IntegracionWebhookSecret`), igual que ya se planeaba, solo que el mecanismo
  concreto ya está confirmado (Bearer, no HMAC de firma).
- **Payload confirmado** (JSON): `orderId`, `customerId`, `createdAt`,
  `updatedAt`, `dateOfMeal`, `startTime`, `partySize`, `duration`,
  `reservationStatus`, `mealStatus`, `customer` (id, firstName, lastName,
  allergies, dietaryRestrictions), `offer`, `prepayment`, `tables`. Mapea
  directo a la reserva normalizada: `externalId=orderId`,
  `date=dateOfMeal`, `time=startTime`, `pax=partySize`,
  `customerName = firstName + lastName`, `notes` incluye `allergies` +
  `dietaryRestrictions` (dato valioso: llega ya la alergia, igual que el
  protocolo de voz/WhatsApp).
- **Respuesta esperada**: TheFork exige `204 No Content` como éxito. Si el
  webhook devuelve otra cosa, probablemente reintenta — el handler debe
  devolver 204 explícito, no el 200 genérico que usan los demás endpoints.
- **No confirmado (bloqueado por 403 al consultar esas páginas)**: el proceso
  exacto para que el restaurante consiga el `ACCESS_TOKEN` y registre su
  `receiptOpeningUrl` (probablemente sigue requiriendo alta como partner/POS
  certificado de TheFork — no hay evidencia de que sea autoservicio). Tampoco
  se confirmaron los flows de actualización/cancelación (`update-order`,
  `cancel-order` — nombres supuestos por analogía, no verificados). **Antes de
  activar el conector en producción, hay que confirmar estos dos puntos con
  cuenta de partner real; el código se escribe ya mismo con la forma
  confirmada, dejando un TODO solo en lo no confirmado.**

Esto NO cambia la arquitectura general (sigue habiendo un conector `demo` para
verificar todo sin depender de terceros), pero sí sube la prioridad y el
detalle del adaptador `thefork`: ya no es un mapeo a ciegas, es una
implementación real del lado receptor a falta de las credenciales para probarla
en vivo.

## Arquitectura de la capa de conectores

**Dirección v1: SOLO entrada** (sus reservas aparecen en nuestra app). La salida
(publicar disponibilidad o empujar cambios hacia la plataforma) es v2 y queda
fuera de alcance — anotarla como pendiente en CLAUDE.md.

**Dos vías de entrada, ambas soportadas por el mismo pipeline:**
- **Webhook** (`POST /integrations/:provider/webhook/:slug`): la plataforma nos
  avisa en el momento — así es como funciona TheFork de verdad (confirmado
  arriba). El `:slug` identifica el tenant; el `ACCESS_TOKEN`/Bearer que manda
  TheFork se valida contra `IntegracionWebhookSecret`. Ruta principal para
  TheFork.
- **Polling** (`POST /internal/integrations/sync`, disparado por Make igual que
  los recordatorios): para proveedores sin webhook. Recorre tenants activos con
  conectores configurados y pide "reservas desde la última sincronización".

**Pipeline común (corazón del plan):**
```
payload del proveedor
  → adapter.parse() → ReservaNormalizada
      { externalId, provider, date:'YYYY-MM-DD', time:'HH:mm', pax,
        customerName, customerPhone?, notes?, status:'confirmed|cancelled', raw? }
  → upsertExternalReservation(ctx, normalizada)
      - dedupe por (Origen, ExternalId): si existe, actualizar estado/datos
      - si es nueva y confirmada: asignar Mesa con findAvailableTable();
        si no hay mesa libre, crearla SIN mesa (el panel ya muestra "Sin asignar"
        y el staff la asigna a mano — nunca rechazar la reserva)
      - registrar el cliente (customerMemory.upsertCustomer) si trae teléfono
      - si status=cancelled: marcar la reserva existente como cancelada
```

**Idempotencia**: el dedupe por `ExternalId` hace que webhooks repetidos o un
polling solapado no dupliquen reservas (mismo espíritu que los flags
Recordatorio24h).

## Fase 1 — Esquema

1. **Bases de restaurante** (script `scripts/add-integration-fields.js`, idempotente,
   recorre TODAS las bases del Registro + actualizar también `scripts/provision-restaurant.js`
   para que las bases nuevas nazcan con esto):
   - `Reservas.Origen` — singleSelect: `panel`, `voz`, `whatsapp`, `thefork`,
     `demo` (los valores nuevos también entran solos vía typecast, pero crearlo
     explícito documenta el catálogo).
   - `Reservas.ExternalId` — singleLineText (id de la reserva en la plataforma;
     vacío para reservas propias).
2. **Registro.Restaurantes** — campos de conector por tenant:
   - `IntegracionProveedor` — singleSelect (`thefork`, `demo`; vacío = sin integración)
   - `IntegracionApiKeyEnc` — multilineText (cifrado con secretBox)
   - `IntegracionRestauranteId` — singleLineText (id del local EN la plataforma)
   - `IntegracionWebhookSecret` — singleLineText (token aleatorio por tenant que
     valida los webhooks entrantes; se genera al activar la integración)
   - `IntegracionActiva` — checkbox
   - `IntegracionUltimaSync` — singleLineText (ISO; cursor del polling)
3. **Marcar el origen en los canales existentes** (unificación, barata y valiosa):
   `create_reservation` del toolDispatcher escribe `Origen` según el canal
   (`voz` si viene de vapiTools/callSim, `whatsapp` si viene del loop de WhatsApp
   — el contexto ya distingue el canal), y `staffApi` escribe `Origen: 'panel'`.
   `toReservationShape`/`toAppReservation` exponen `origen`/`source`.

## Fase 2 — Backend: conectores

Nuevo directorio `src/services/connectors/`:

- `index.js` — registro de adaptadores `{ demo, thefork }` + el pipeline común
  `upsertExternalReservation(ctx, normalizada)` y `syncTenant(restaurant)`
  (resuelve adapter, descifra credenciales, llama `fetchSince`, upserta cada una,
  actualiza `IntegracionUltimaSync`).
- `demo.js` — adaptador de demostración:
  - `parseWebhook(body)` → normalizada (payload documentado en el propio archivo)
  - `fetchSince(creds, sinceISO)` → devuelve [] (el demo funciona por webhook)
  - Sirve para la verificación end-to-end sin depender de terceros.
- `thefork.js` — adaptador TheFork, implementado contra la forma CONFIRMADA del
  webhook "Create Orders" de `docs.thefork.io/POS-API/Flow/create-order`:
  - `parseWebhook(body)` → mapea el payload real:
    `externalId = body.orderId`, `date = body.dateOfMeal`,
    `time = body.startTime`, `pax = body.partySize`,
    `customerName = \`${body.customer.firstName} ${body.customer.lastName}\``,
    `status`: `reservationStatus` → `confirmed`/`cancelled` (mapear los valores
    reales de `reservationStatus` que traiga el payload de prueba; si el valor
    no es reconocido, tratar como `confirmed` y loguear el valor visto — mejor
    aceptar de más que perder una reserva),
    `notes`: concatenar `allergies` + `dietaryRestrictions` si vienen rellenos
    (ej. `"Alergias (TheFork): gluten, frutos de cáscara"`) — así el protocolo
    de alérgenos del restaurante no depende del canal.
  - `verifyAuth(req, expectedToken)` — TheFork manda
    `Authorization: Bearer {ACCESS_TOKEN}`; comparar contra
    `IntegracionWebhookSecret` descifrado con comparación en tiempo constante
    (`crypto.timingSafeEqual`), no `===` directo.
  - `fetchSince()` — no aplica (TheFork empuja, no se sondea); dejar la función
    devolviendo `[]` para que encaje en el pipeline común sin ramas especiales.
  - Responder **204 sin cuerpo** en éxito (no 200 — TheFork lo exige así según
    la documentación; los demás adaptadores sí pueden usar 200).
  - `// TODO (confirmar con cuenta de partner real antes de producción):` el
    catálogo exacto de valores de `reservationStatus`/`mealStatus`, y si existen
    flows separados de update/cancel con otro payload (no verificados por 403
    al consultar esas páginas) — si aparecen, tratarlos como el mismo
    `orderId` con `reservationStatus` distinto primero, y solo crear un parser
    aparte si el payload real difiere.

Rutas:

- `src/routes/integrations.js`:
  - `POST /integrations/:provider/webhook/:slug` — SIN JWT (viene de fuera).
    Resuelve tenant por slug, exige `IntegracionActiva === true` y
    `IntegracionProveedor === :provider`. La validación del emisor es por
    ADAPTADOR, no genérica: `thefork` la hace vía el header
    `Authorization: Bearer` (ver `thefork.verifyAuth`); `demo` (y cualquier
    proveedor sin Bearer) usa `?secret=` en la query contra
    `IntegracionWebhookSecret`. Parsea con el adapter y upserta. Código de
    respuesta también por adaptador: `thefork` → 204 sin cuerpo; el resto → 200.
    Registrar en log cada reserva recibida (id + fecha, nunca nombre/teléfono).
  - Añadir al pipeline la notificación natural: no hace falta nada nuevo — el
    polling de 20 s del panel ya detecta la reserva nueva y notifica.
- `internalJobs.js` — nuevo `POST /internal/integrations/sync` (mismo
  `requireInternalSecret`): itera tenants activos con `IntegracionActiva` y
  proveedor con `fetchSince`, aislando errores por tenant como los recordatorios.
  OJO plan Free de Make = máx 2 escenarios: NO crear un tercer escenario; añadir
  la llamada a sync DENTRO del escenario de recordatorios existente es tentador
  pero frágil — mejor: el endpoint existe y se documenta que con el plan Free se
  puede invocar manualmente o fusionar en `/internal/reminders/run` con un flag
  `?with_sync=1` (elegir esta última: un solo POST de Make lo dispara todo).

## Fase 3 — Configuración por restaurante (UI)

`settingsApi.js` — nueva sección (mismo patrón que Vapi/WhatsApp):
- `GET /api/settings` — añade bloque `integracion: { provider, activa,
  restauranteExternoId, apiKeyMasked, webhookUrl }` donde `webhookUrl` es la URL
  completa con slug y secret ya rellenos (para copiar y pegar en la plataforma).
- `PUT /api/settings/integration` `{ provider, apiKey?, restauranteExternoId? }`
  — cifra la key, genera `IntegracionWebhookSecret` si no existe (crypto random),
  activa. `provider: null` desactiva y limpia.
- `POST /api/settings/integration/test` — para `thefork`: intenta un GET de
  validación con las credenciales (si la API es accesible); para `demo`: siempre ok.
- Rate-limit con el `tooManyActions` existente.

`SettingsView.tsx` — nueva tarjeta **"Plataformas de reservas"**:
- Selector de proveedor (TheFork / Demo), campos API key (password) e id del
  restaurante en la plataforma, badge de estado, la URL del webhook con botón
  copiar y el rótulo correcto según lo confirmado: para TheFork, el campo que
  el restaurante debe pegar en SU panel de TheFork se llama literalmente
  **`receiptOpeningUrl`** — usar ese nombre en la ayuda de la tarjeta, no un
  genérico "webhook URL", para que quien lo configure reconozca el campo exacto
  del panel de TheFork. Botón "Probar conexión", botón desconectar.
- Aviso honesto y visible para TheFork: "Requiere una cuenta de partner/POS de
  TheFork — el token de acceso (`ACCESS_TOKEN`) te lo entrega TheFork durante
  ese alta, no se genera aquí." (Evita que el usuario busque un botón de
  autoservicio que no existe.)

## Fase 4 — Visibilidad en el panel

- `toAppReservation` expone `source` (`panel|voz|whatsapp|thefork|demo`).
- `CalendarView.tsx`: badge de origen junto al estado (p. ej. chip "TheFork" en
  su color, "Voz", "WhatsApp"; `panel` no necesita chip). Estética de los chips
  de alérgenos ya existentes.
- `FloorPlan.tsx`: nada (el nombre del cliente ya aparece); opcionalmente un
  puntito de color por origen si resulta barato.
- La notificación de reserva nueva del polling ya existe; mejorar el texto para
  incluir el origen ("Nueva reserva desde TheFork: …").
- `types.ts`: `Reservation.source?: string`.

## Fase 5 — Verificación end-to-end (EN LOCAL, sin push)

1. `node -c` de todo lo tocado + `npx tsc --noEmit` + build de la app.
2. Ejecutar `scripts/add-integration-fields.js` (añade campos a las DOS bases y
   al Registro). Verificar por API que los campos existen.
3. Backend local. Con el tenant `demo-bistro`:
   - Activar la integración `demo` vía `PUT /api/settings/integration` (login
     con las credenciales de CREDENCIALES_INICIALES.txt).
   - Simular la plataforma: `curl POST /integrations/demo/webhook/demo-bistro?secret=…`
     con un payload de reserva → comprobar que aparece en `/api/reservations`
     con `source: 'demo'`, mesa asignada, y el cliente en `/api/customers`.
   - Reenviar el MISMO webhook → verificar que NO se duplica (dedupe).
   - Webhook de cancelación del mismo externalId → la reserva pasa a cancelada.
   - Webhook con secret incorrecto → 401. Con la integración desactivada → 403.
   - Sin mesas libres (payload con pax=99) → se crea sin mesa, no falla.
3b. **Adaptador `thefork` en aislado** (sin credenciales reales, se puede
    verificar el PARSER igualmente): escribir un test/script que tome el
    payload de ejemplo real de `docs.thefork.io/POS-API/Flow/create-order`
    (cURL con reserva de 2 personas, 17:00, prepago 140€, alergias) pegado tal
    cual en un fixture, y llamar `thefork.parseWebhook(fixture)` directamente
    (sin pasar por HTTP) → verificar que la normalizada sale con
    `pax=2, time='17:00', notes` conteniendo las alergias del fixture. Esto
    prueba el mapeo de campos SIN necesitar la cuenta de partner. Probar
    también `verifyAuth` con un Bearer correcto e incorrecto (timing-safe).
4. Panel en el navegador: la reserva demo se ve en el calendario con su chip de
   origen, y la tarjeta de Configuración muestra la integración activa con su
   webhook copiable.
5. Aislamiento: el webhook de `demo-bistro` no crea nada en Gourmeats.
6. Limpiar los datos de prueba de la base demo.
7. **Commit local. NO push.** Informar al usuario de que el push + deploy queda
   pendiente de su confirmación (y que el webhook público solo funcionará tras
   desplegar).

## Seguridad — reglas duras

- El webhook entrante NUNCA se fía del payload para identificar el tenant: el
  tenant sale del slug de la URL + secreto por tenant; el proveedor declarado en
  la URL debe coincidir con `IntegracionProveedor` del tenant.
- API keys de plataformas: cifradas con secretBox, jamás devueltas (solo mask),
  jamás logueadas. El payload crudo del webhook puede loguearse SIN datos
  personales (id + fecha, no nombre/teléfono).
- Respuestas del webhook: 200 al procesar, 401/403 en auth, 200 con `{ignored:true}`
  para payloads que no sepamos parsear (evitar tormentas de reintentos del
  proveedor); loguear siempre el motivo.
- `/internal/*` mantiene `x-internal-secret`.

## Fuera de alcance (anotar como pendientes, no hacer)

- Sincronización de SALIDA (publicar disponibilidad hacia TheFork, empujar
  cancelaciones nuestras hacia la plataforma) — v2, requiere cuenta partner.
- Adaptadores reales de Covermanager/Google Reserve (el esqueleto queda listo).
- Reconciliación de doble reserva (misma persona reserva por voz Y por TheFork).
