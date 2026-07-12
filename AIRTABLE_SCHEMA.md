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
