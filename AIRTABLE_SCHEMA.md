# Esquema de Airtable (sandbox)

Una sola base con 3 tablas. Los nombres de tabla y campo deben coincidir
exactamente (mayúsculas incluidas) con lo que usa el código en
`src/services/reservations.js` y `src/services/customerMemory.js`.

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
