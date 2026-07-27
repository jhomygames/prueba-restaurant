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
| Origen | Single select | de dónde vino: `panel`, `voz`, `whatsapp`, `thefork`, `demo` |
| ExternalId | Single line text | su id en la plataforma externa; es la clave que evita duplicar una reserva al reprocesar su webhook |

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
