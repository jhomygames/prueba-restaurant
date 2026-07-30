# Esquema de Airtable (multi-restaurante)

**Arquitectura**: una base de Airtable POR RESTAURANTE (con las tablas Mesas,
Reservas, Clientes y Carta que se describen abajo) + una base central
`Registro` que dice qué restaurantes existen, en qué base viven sus datos y
quién puede entrar a su panel.

Así el aislamiento entre locales es real: no depende de acordarse de filtrar
por un campo "RestauranteId" en cada consulta (un filtro olvidado sería una
fuga de datos entre restaurantes).

Los nombres de tabla y campo deben coincidir exactamente (mayúsculas incluidas)
con lo que usa el código. Para crear una base de restaurante nueva, NO lo hagas
a mano: usa `node scripts/provision-restaurant.js --nombre "..." --email ...`.

## Base central `Registro` (env `REGISTRO_BASE_ID`)

### Tabla `Restaurantes`

| Campo | Tipo | Notas |
|---|---|---|
| Slug | Single line text | identificador corto y único, ej. `gourmeats-madrid` |
| Nombre | Single line text | nombre público; lo dice el agente al contestar |
| BaseId | Single line text | `appXXXX` de la base de datos de ese local |
| GoogleReviewUrl | Single line text | enlace de reseñas que se envía tras la visita |
| StaffWhatsApp | Single line text | número del encargado (transfer_to_human) |
| Activo | Checkbox | los jobs internos solo procesan los activos |
| VapiApiKeyEnc | Long text | API key propia de Vapi, **cifrada** (vacío = usar la central) |
| VapiAssistantId | Single line text | assistant de voz del local |
| VapiPhoneNumberId | Single line text | id del número en Vapi (resuelve el tenant en el webhook) |
| VapiTelefono | Single line text | número legible, informativo |
| TwilioAccountSid | Single line text | cuenta Twilio propia (vacío = usar la central) |
| TwilioAuthTokenEnc | Long text | auth token **cifrado** |
| TwilioWhatsAppFrom | Single line text | `whatsapp:+1...` del local; resuelve el tenant en WhatsApp |
| IntegracionProveedor | Single select | `thefork` / `demo` (vacío = sin plataforma conectada) |
| IntegracionApiKeyEnc | Long text | clave de la plataforma, **cifrada** (hoy opcional) |
| IntegracionRestauranteId | Single line text | id del local EN la plataforma |
| IntegracionWebhookSecretEnc | Long text | token **cifrado** que autentica los avisos entrantes; para TheFork es el `ACCESS_TOKEN` que le entregamos |
| IntegracionActiva | Checkbox | si no está marcada, el webhook responde 403 |
| IntegracionUltimaSync | Single line text | ISO; cursor para los conectores que se sondean |

### Tabla `Usuarios`

| Campo | Tipo | Notas |
|---|---|---|
| Email | Single line text | login, en minúsculas |
| PasswordHash | Single line text | bcrypt (NUNCA texto plano) |
| NombreStaff | Single line text | |
| Rol | Single select | `admin` / `staff` (por ahora informativo) |
| Activo | Checkbox | |
| RestauranteId | Single line text | id del registro en `Restaurantes` |

**Secretos**: los campos `*Enc` se guardan cifrados con AES-256-GCM
(`src/services/secretBox.js`) usando la env `TENANT_SECRETS_KEY`. Airtable no
es un gestor de secretos: así, un acceso de solo lectura a esta base no expone
los tokens de Twilio/Vapi de nadie. La API del panel nunca los devuelve: solo
una versión enmascarada.

---

## Base de cada restaurante (3 + 1 tablas)

## Tabla `Mesas`

| Campo | Tipo | Notas |
|---|---|---|
| Nombre | Single line text | ej. "Mesa 1", "Terraza 3" |
| Capacidad | Number | nº máximo de comensales |
| Zona | Single select | Interior / Terraza / Barra |
| Estado | Single select | Libre / Ocupada / Reservada / Fuera de servicio |

## Tabla `Reservas`

| Campo | Tipo | Notas |
|---|---|---|
| FechaHora | Single line text | formato exacto `YYYY-MM-DD HH:mm`, ej. `2026-07-10 19:30` (NO usar el campo Date nativo de Airtable, ver nota abajo) |
| Personas | Number | nº de comensales |
| ClienteNombre | Single line text | |
| ClienteTelefono | Single line text | formato internacional, ej. `+58412...` |
| Mesa | Link to another record → `Mesas` | mesa asignada |
| Estado | Single select | confirmada / cancelada / completada |
| Notas | Long text | alergias, ocasión especial, etc. |
| Alergias | Multiple select | catálogo de 14 alérgenos; se rellena solo a partir de las notas (ver `src/services/allergens.js`) |
| Origen | Single select | CANAL REAL por el que llegó: `panel`, `voz`, `whatsapp`, `thefork`, `demo`, `n8n` |
| ExternalId | Single line text | su id en la plataforma externa; es la clave que evita duplicar una reserva al reprocesar su webhook |
| CodigoReserva | Single line text | `RES-123456-789`, legible por teléfono; es lo que el cliente apunta y cita para cambiar o anular |
| Turno | Single select | `comida` / `cena`, derivado de la hora (corte a las 17:00) |
| LopdAcepta | Checkbox | el cliente consintió el tratamiento de sus datos (obligatorio en España) |

**Por qué `Origen` guarda el canal y no el conector**: a la sala le importa si
la reserva la pidió alguien por teléfono o por WhatsApp, no si pasó por n8n de
camino. Por eso la deduplicación se hace SOLO por `ExternalId` (ver
`src/services/connectors/index.js`): atarla a `Origen` haría que una reserva de
voz llegada por un conector no se encontrara al reenviarla, y se duplicaría.

**Por qué `FechaHora` es texto y no un campo Date real**: Airtable normaliza
los campos Date a UTC según la config de zona horaria de la base, lo que
complica comparar rangos horarios de forma predecible desde el backend en un
sandbox. Usando texto con formato `YYYY-MM-DD HH:mm` (ceros a la izquierda),
la comparación lexicográfica de strings coincide con el orden cronológico, y
evita ambigüedad de zona horaria. Se puede migrar a un campo Date real más
adelante si se necesita reportes/vistas de calendario nativas de Airtable.

## Tabla `Clientes`

| Campo | Tipo | Notas |
|---|---|---|
| Telefono | Single line text | formato internacional, clave de búsqueda |
| Nombre | Single line text | |
| AlergenosConocidos | Multiple select | opciones = catálogo de 14 alérgenos de `src/config/menu.json` |
| Preferencias | Long text | notas libres |
| UltimaVisita | Single line text o Date | ISO 8601 |
| NumVisitas | Number | |
| IdiomaPreferido | Single select | `es`, `en`, `fr`… el agente de voz puede saludar en el idioma de la última visita |
| LopdAcepta | Checkbox | consentimiento de tratamiento de datos |

**La búsqueda por `Telefono` es tolerante a formatos**: se compara por los 9
últimos dígitos, así que `624114533` y `+34624114533` se reconocen como la
misma persona. Sin eso, cada forma de transcribir el número creaba una ficha
distinta y partía en dos las visitas y los alérgenos conocidos del cliente
(ver `src/services/phone.js`).

## Tabla `Historial`

Traza de cambios de las reservas: quién cambió qué y cuándo. Sirve para
resolver reclamaciones ("yo reservé para seis, no para tres").

| Campo | Tipo | Notas |
|---|---|---|
| Cuando | Single line text | ISO 8601 |
| CodigoReserva | Single line text | la reserva afectada |
| ReservaId | Single line text | su id interno de Airtable |
| Accion | Single select | `created` / `modified` / `cancelled` / `seated` / `completed` |
| Canal | Single select | desde dónde se hizo el cambio |
| Cambios | Long text | resumen legible: `personas: 6 -> 3; hora: 21:00 -> 13:30` |
| DatosNuevos | Long text | estado resultante en JSON |

Un `modified` que no cambió nada NO se registra: pasa cada vez que una
plataforma reenvía el mismo aviso y solo taparía los cambios de verdad.

## Tabla `Carta`

La carta del restaurante (editable desde el panel → "Ver Carta" → "Editar carta").
`src/config/menu.json` queda como semilla inicial y fallback si Airtable no responde.

| Campo | Tipo | Notas |
|---|---|---|
| Nombre | Single line text | |
| Categoria | Single select | Hamburguesa del mes, Entrantes, Burgers, Smash, Chicken burgers, Veggie burgers, Ensaladas, Para los peques, Postres, Cervezas, Refrescos, Vinos, Ginebras, Rones (se pueden crear nuevas al escribir) |
| Descripcion | Long text | |
| Precio | Number (precision 2) | euros; vacío = "según elección" (ej. smash) |
| Alergenos | Multiple select | mismas opciones que `Reservas.Alergias` (14 alérgenos + Vegano/Vegetariano/Sin Sal) |
| Destacado | Checkbox | badge "TOP" en el panel |
| Disponible | Checkbox | solo los marcados los ve el agente y el cliente |
| Orden | Number (precision 0) | orden dentro de la categoría |

**Nota sobre `Disponible`**: Airtable omite los checkbox desmarcados (los devuelve
como `undefined`, no `false`). El backend lo mapea con `=== true` (staffApi.js) y el
agente filtra con `filterByFormula {Disponible} = TRUE()` (menuService.js). Los
alérgenos son de EJEMPLO pendientes de validación por el restaurante (RD 126/2015);
ahora el staff puede corregirlos desde la app.

## Cómo crearla

1. En Airtable, crea una base vacía (nombre sugerido: "Restaurante Sandbox").
2. Crea las 3 tablas de arriba con esos campos exactos.
3. Copia el **Base ID** (Help → API documentation, o en la URL de la base,
   empieza por `app...`).
4. Crea un Personal Access Token en https://airtable.com/create/tokens con:
   - Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
   - Acceso: solo a esta base.
5. Pega ambos en tu `.env` local (nunca en el chat ni en el repo):
   ```
   AIRTABLE_API_KEY=patXXXXXXXXXXXXXX
   AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
   ```

Si prefieres que yo cree las tablas por API una vez tengas el Base ID y el
token en tu `.env`, dímelo y lo automatizo con `curl` contra la Meta API de
Airtable (`POST /v0/meta/bases/{baseId}/tables`).
