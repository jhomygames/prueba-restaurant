# Plan de ejecución — Calendario de ocupación + Horario de servicio

> **EJECUTADO el 2026-08-18.** Las seis fases están hechas y verificadas en local
> (34 comprobaciones automáticas + repaso en navegador). Falta únicamente el
> despliegue, a la espera del visto bueno. El detalle de lo que se hizo, los
> desvíos respecto a este plan y el fallo encontrado durante las pruebas están en
> `REGISTRO_DE_CAMBIOS.md`, sesión 2026-08-18.
>
> Desvíos frente a lo planificado, por si se releen las fases:
> - **No se creó `migraciones/`**: el repo no tiene esa carpeta y la convención es
>   que Supabase registre las migraciones en su propio historial (`apply_migration`).
> - **`agente.js` no necesitó cambios**: al omitir `duracion` y `mesaId`, los
>   valores por defecto ya hacen lo correcto para el canal de voz. Añadirlos
>   habría sido ruido.
> - **La duración no se pasa por parámetro** sino que `escribir.duracionDe()` la
>   busca sola, para que ningún canal pueda olvidarse de ella en silencio.
> - **Añadido `onHorarioGuardado`**, que no estaba en el plan: sin él el calendario
>   se quedaba con el horario viejo tras guardarlo.

> Documento de orquestación. Está escrito para que otro modelo (Sonnet) lo ejecute
> paso a paso sin tener que redescubrir el terreno. Cada fase dice **qué tocar**,
> **qué NO tocar** y **cómo comprobar que funciona antes de pasar a la siguiente**.
>
> Proyecto: `C:\Users\jhoma\Documents\Claude\Agent restaurant Antony project`
> Supabase: proyecto `klbnjqbzdtmbgfejpidq` · tenant en uso: `el-sazon-venezolano`
> Producción: `https://prueba-restaurant-production.up.railway.app`

---

## 0. Lo que ya existe (NO rehacer)

Antes de escribir una línea, esto ya está hecho y funciona. Rehacerlo rompería cosas.

| Pieza | Dónde | Estado |
|---|---|---|
| Tabla `turnos` en Supabase | `restaurante, nombre, hora_inicio, hora_fin, dias smallint[], activo` | Existe, con 2 filas para `el-sazon-venezolano`: `comida 13:00–16:30` y `cena 20:00–23:30`, ambos los 7 días |
| Motor de horario | `src/services/horario.js` | `comprobar()`, `explicar()`, `turnoDe()`, `invalidar()`. Caché en memoria de 5 min |
| Bloqueo al **crear** reserva | `src/services/repo/escribir.js:116` | Ya rechaza fuera de horario con motivo `fuera_de_horario` |
| Bloqueo al **modificar** reserva | `src/services/repo/escribir.js:191` | Ídem |
| Mensaje hablado para el agente | `src/services/agente.js:125,176` | Ya usa `horario.explicar()` |
| Cálculo de pases y solapes en el panel | `app/src/turnos.ts` | `pasesDeMesa()`, `horaDeSalida()`, `pasesQueSePisan()` — **el calendario se construye sobre estas funciones, no se reimplementan** |
| Duración por reserva | `reservas.duracion_min` + slider en el modal | Ya se guarda y se lee |

**Conclusión importante:** la parte de "el asistente de voz no debe aceptar una reserva
a las 18:00 si está cerrado" **ya funciona hoy**. Lo que falta es (a) poder configurarlo
desde el panel en vez de por SQL, y (b) tapar los agujeros que se listan abajo.

---

## 1. Defectos reales encontrados (hay que arreglarlos para que el calendario no mienta)

Estos tres no son mejoras: son la razón por la que el calendario, tal cual está el
backend hoy, mostraría una cosa y el sistema haría otra.

### D1 — `POST /api/reservations` ignora la mesa elegida
`src/routes/staffApi.js:332` construye la llamada a `escribir.crearReserva()` **sin
pasar `b.tableId`**. `crearReserva` entonces autoasigna con `buscarMesaLibre()`.
Resultado: el usuario abre el modal desde la Mesa 3, rellena, guarda… y la reserva
puede acabar en la Mesa 1. Con un calendario por mesa esto es inaceptable.

### D2 — La detección de choques ignora la duración
`src/services/repo/escribir.js:54`:
```js
.filter((r) => aMinutos(r.hora) === aMinutos(hora))
```
Solo considera ocupada una mesa si la reserva empieza **exactamente a la misma hora**.
Una reserva a las 17:00 con 2 h de duración **no** bloquea una a las 18:00 en la misma
mesa. Es justo el caso que el usuario describe: el calendario dibujaría el bloque
17:00–19:00 y el backend dejaría reservar dentro de él.

### D3 — `PATCH /api/reservations/:id` no comprueba nada
`src/routes/staffApi.js:364` escribe directo en la tabla. Se puede editar una reserva
y ponerla a las 03:00 de la madrugada, o encima de otra. Solo el POST valida.

### Nota sobre la duración por defecto
Hoy vive **solo en el navegador** (`localStorage: dinecontrol_default_seated_duration`,
`app/src/App.tsx:69`). El backend no la conoce, así que una reserva de voz nunca tiene
duración y no puede participar en el cálculo de solapes. Hay que subirla al servidor
(Fase 2).

---

## 2. Decisiones de diseño ya tomadas (no reabrir)

1. **No se crea un endpoint `/api/availability`.** El calendario se dibuja en el cliente
   con datos que el panel ya tiene cargados (`reservations`) más los turnos (Fase 3).
   El servidor **revalida** al guardar. Cliente para pintar, servidor para decidir.
2. **`PUT /api/settings/turnos` reemplaza la lista entera**, no CRUD fila a fila.
   Evita estados huérfanos y es lo que la pantalla necesita (se editan las franjas juntas).
3. **El `nombre` de un turno queda restringido a `comida` | `cena`.** Se pueden tener
   varias filas del mismo turno (p. ej. `comida` L-V 13:00–16:00 y `comida` S-D 12:00–17:00),
   pero no inventar nombres nuevos. Motivo: `app/src/types.ts` declara
   `shift?: 'comida' | 'cena'` y `app/src/turnos.ts` construye sobre eso la barra de
   turnos del plano. Ampliarlo sería otro proyecto.
4. **`hora_fin` = última hora a la que se admite una reserva**, no la hora de cierre de
   cocina. Es como `horario.comprobar()` ya se comporta (`minutos <= fin`). La etiqueta
   de la UI debe decir eso literalmente para que nadie configure 23:30 pensando que es
   el cierre y luego sirva mesas a la 01:30.
5. **La duración por defecto pasa a ser del restaurante**, columna nueva
   `restaurantes.duracion_reserva_min` (default 120). El `localStorage` se conserva solo
   como valor inicial mientras carga, para no dejar la pantalla en blanco.

---

## 3. Fases

Ejecutar **en orden**. Cada fase termina con su verificación; si falla, no se sigue.

---

### FASE 1 — Migración de esquema

**Archivo nuevo:** `migraciones/2026-08-18-duracion-reserva.sql` (crear carpeta si no existe)

```sql
alter table restaurantes
  add column if not exists duracion_reserva_min smallint not null default 120;

comment on column restaurantes.duracion_reserva_min is
  'Minutos que se supone que una mesa queda ocupada por una reserva sin duración propia. Lo usa el cálculo de solapes.';

comment on column turnos.hora_fin is
  'Última hora a la que se ADMITE una reserva en este turno, no la hora de cierre.';
```

Aplicar con la herramienta `apply_migration` de Supabase (proyecto `klbnjqbzdtmbgfejpidq`),
no con `execute_sql`.

**Verificación:**
```sql
select slug, duracion_reserva_min from restaurantes;
```
Debe devolver `120` para todos.

**No tocar:** la tabla `turnos` no cambia de estructura. Ya sirve.

---

### FASE 2 — Backend: solapes con duración, mesa respetada, PATCH validado

Esta fase arregla D1, D2 y D3. Es la más delicada: la toca el panel **y** el agente de voz.

#### 2.1 `src/services/repo/restaurantes.js`

En `aRestaurante(fila)` (línea ~29), añadir al objeto devuelto:
```js
duracionReservaMin: Number(fila.duracion_reserva_min) || 120,
```

#### 2.2 `src/services/repo/escribir.js` — reescribir la detección de ocupación

Sustituir `buscarMesaLibre` por una versión consciente de la duración, y añadir una
función pública nueva `mesaLibre()` que responda "¿esta mesa concreta está libre?".

```js
/**
 * ¿Se pisan dos franjas de tiempo? [aIni, aFin) contra [bIni, bFin).
 *
 * Se compara con el fin EXCLUIDO: una reserva que termina a las 19:00 y otra que
 * empieza a las 19:00 no chocan, la mesa se acaba de levantar.
 */
function seSolapan(aIni, aFin, bIni, bFin) {
  return aIni < bFin && bIni < aFin;
}

/** Reservas vivas de un día que ocupan mesa de verdad. */
function ocupanMesa(r) {
  return r.status === "confirmed" || r.status === "seated";
}

/**
 * Franjas ocupadas de un día, por mesa.
 * `duracionDefecto` es la del restaurante: las reservas de voz no traen la suya.
 */
async function franjasOcupadas(ctx, { fecha, duracionDefecto, excluirId = null }) {
  const filas = await db.listar(ctx, T_RESERVAS, { filtros: { fecha } });
  return filas
    .filter(ocupanMesa)
    .filter((r) => String(r.id) !== String(excluirId))
    .filter((r) => r.mesa_id != null)
    .map((r) => {
      const ini = aMinutos(r.hora);
      return {
        mesaId: String(r.mesa_id),
        ini,
        fin: ini + (Number(r.duracion_min) || duracionDefecto),
      };
    });
}
```

`buscarMesaLibre(ctx, { fecha, hora, personas, duracion, excluirId })`:
- calcula `ini = aMinutos(hora)`, `fin = ini + duracion`
- pide `franjasOcupadas`
- una mesa está en uso si **alguna** de sus franjas se solapa con `[ini, fin)`
- devuelve la más pequeña con capacidad suficiente y no `"Fuera de servicio"` (se
  conserva el criterio actual, que es correcto y está comentado en el fichero)

`mesaLibre(ctx, { fecha, hora, duracion, mesaId, excluirId })` → `boolean`:
misma lógica pero para una sola mesa.

**Cuidado — regresión probable:** la firma de `buscarMesaLibre` cambia (nuevo campo
`duracion`). Se llama desde `src/services/agente.js:76` (`check_availability`). Hay que
actualizar esa llamada para pasar `local.duracionReservaMin`. Buscar con
`grep -rn "buscarMesaLibre" src/` y no dejar ninguna sin migrar.

#### 2.3 `crearReserva()` acepta mesa y duración

Nuevos campos en `datos`: `mesaId` (opcional) y `duracionMin` (opcional).

Orden de comprobaciones dentro de `crearReserva` — **respetar este orden**, porque los
mensajes de error del agente dependen de él:
1. `datos_incompletos`
2. `horario.comprobar()` → `fuera_de_horario` *(ya existe, no tocar)*
3. duplicada *(ya existe, no tocar)*
4. **nuevo:** si viene `mesaId`, comprobar `mesaLibre()`. Si no → `{ creada: false, motivo: "mesa_ocupada" }`
5. si no viene `mesaId`, `buscarMesaLibre()` como hasta ahora → `sin_mesa`

Guardar `duracion_min: duracionMin || null` en la fila (null = usa la del restaurante;
no fijarla a 120 aquí, o cambiar el ajuste del local no afectaría a las ya creadas).

#### 2.4 `modificarReserva()` — mismo tratamiento

Añadir `nuevaMesaId` y `nuevaDuracion` a los parámetros; aplicar la misma comprobación
de solape con `excluirId: actual.id`.

#### 2.5 `src/routes/staffApi.js` — POST

En `POST /api/reservations` (línea 332), pasar los campos que faltan:
```js
mesaId: b.tableId || null,
duracionMin: b.customDurationMinutes || null,
```
Y añadir al mapa `explicacion` (línea ~348):
```js
mesa_ocupada: "Esa mesa ya está ocupada en ese horario.",
```

#### 2.6 `src/routes/staffApi.js` — PATCH (D3)

Antes de escribir, si cambia alguno de `date`, `time`, `pax`, `tableId` o
`customDurationMinutes`:
1. leer la reserva actual (`db.obtener`) → 404 si no es de este tenant
2. mezclar los valores nuevos sobre los actuales
3. `horario.comprobar()` → si cerrado, `409 { error: "fuera_de_horario", mensaje: horario.explicar(...) }`
4. `mesaLibre({ ..., excluirId: id })` → si ocupada, `409 { error: "mesa_ocupada", mensaje: ... }`

**Excepción deliberada:** un cambio *solo* de `status` (sentar, completar, cancelar) **no**
pasa por estas comprobaciones. Sentar a un comensal que ya está en la puerta no puede
fallar porque el horario diga que ya cerró.

#### 2.7 Rellenar el hueco del agente de voz

`src/services/agente.js`: en `createReservation` (línea 112) pasar
`duracionMin: null` explícitamente (documenta que hereda la del local) y en
`checkAvailability` (línea 76) pasar `duracion: local.duracionReservaMin`.

**Verificación de la Fase 2** — script en `scripts/`, contra Supabase real, con limpieza
al final (patrón ya usado en `scripts/test-dialecto-marta.js`):
1. crear reserva Mesa X a las 13:00, 120 min → OK
2. crear otra Mesa X a las 14:00 → debe fallar con `mesa_ocupada`
3. crear otra Mesa X a las 15:00 → debe crearse (13:00+120 = 15:00, fin excluido)
4. crear a las 18:00 (entre turnos) → `fuera_de_horario`
5. PATCH de la primera a las 18:00 → 409 `fuera_de_horario`
6. PATCH de la primera a `status: seated` → 200 (la excepción de 2.6)
7. borrar lo creado

---

### FASE 3 — API de turnos y de duración

**Archivo:** `src/routes/settingsApi.js` (ya tiene `router.use("/api/settings", requireAuth)`,
así que cuelgan de ahí y quedan protegidos solos).

#### `GET /api/settings/turnos`
```json
{
  "duracionReservaMin": 120,
  "turnos": [
    { "id": "1", "nombre": "comida", "horaInicio": "13:00", "horaFin": "16:30", "dias": [1,2,3,4,5,6,7], "activo": true }
  ]
}
```
Leer con `db.listar(ctxDe(req), "turnos", { orden: "hora_inicio.asc" })`. Recortar las
horas a `HH:MM` (Postgres devuelve `13:00:00`).

#### `PUT /api/settings/turnos`
Body: `{ duracionReservaMin?: number, turnos: [...] }`. Reemplaza la lista entera.

**Validaciones — devolver `400 { error, mensaje }` en castellano, no un 500:**
- `nombre` ∈ `{"comida","cena"}` → si no: `nombre_invalido`
- `horaInicio` y `horaFin` con formato `HH:MM` → `hora_invalida`
- `horaInicio < horaFin` → `franja_invertida` *(no se admiten turnos que crucen medianoche; si algún día hace falta, es un cambio de modelo, no un parche aquí)*
- `dias` array no vacío ⊂ `[1..7]` → `dias_invalidos`
- **dos franjas activas no pueden solaparse el mismo día** → `franjas_solapadas`
- `duracionReservaMin` entre 15 y 480 → `duracion_invalida`

Escritura: borrar las filas del tenant e insertar las nuevas. Usar
`db.borrar(ctx, "turnos", id)` fila a fila (respeta el filtro de tenant; **no** lanzar un
`delete` a pelo).

**Obligatorio al terminar la escritura:**
```js
horario.invalidar(req.restaurant.slug);
```
Sin esto la caché de 5 min de `horario.js` sigue sirviendo el horario viejo y el usuario
guarda, prueba, y parece que no ha hecho nada.

Si cambia `duracionReservaMin` → `registry.actualizarRestaurante(req.restaurant.id, { duracion_reserva_min: n })`
(esa función ya invalida su propia caché).

#### `app/src/api.ts`
```ts
export interface Turno { id: string; nombre: 'comida' | 'cena'; horaInicio: string; horaFin: string; dias: number[]; activo: boolean; }
export interface ConfigHorario { duracionReservaMin: number; turnos: Turno[]; }

export const fetchTurnos = () => req<ConfigHorario>('/api/settings/turnos');
export const saveTurnos = (c: ConfigHorario) =>
  req<ConfigHorario>('/api/settings/turnos', { method: 'PUT', body: JSON.stringify(c) });
```

**Además (necesario para las Fases 4 y 5):** `req()` en `app/src/api.ts:59` hoy tira el
cuerpo del error dentro de un string. Hay que conservarlo:
```ts
if (!res.ok) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.mensaje || `API ${res.status}`) as Error & { codigo?: string; status?: number };
  err.codigo = body.error;
  err.status = res.status;
  throw err;
}
```
Sin esto, un 409 `mesa_ocupada` llega al usuario como el `alert()` genérico
"No se pudo guardar la reserva en Supabase. Revisa la conexión.", que es mentira.

**Verificación:** `curl` con token real: GET devuelve los dos turnos; PUT con una franja
solapada devuelve 400 con mensaje legible; PUT válido seguido de un intento de reserva
en la franja nueva funciona **en el primer intento** (prueba de que la caché se invalidó).

---

### FASE 4 — UI: tarjeta "Horario de servicio" en Configuración

**Archivo:** `app/src/components/SettingsView.tsx`

Añadir una `<Tarjeta>` nueva (el componente está en la línea 27; hay 5 tarjetas ya, seguir
su patrón exacto de props `icono` / `titulo` / `subtitulo`). Colocarla **la primera**, antes
de la de datos generales: es lo que más se consulta.

Contenido:
- Icono `CalendarClock` de `lucide-react`
- Una fila por franja: selector `Comida | Cena`, `horaInicio`, `horaFin`, 7 casillas
  L M X J V S D, interruptor `activo`, botón de eliminar
- Botón "Añadir franja"
- Campo aparte: **"Duración estándar de una mesa"** (mismo control de rango 15–240 que
  ya usa `ReservationModal.tsx:366`, reutilizar el estilo)
- Un resumen legible arriba, generado de las franjas activas:
  *"Lunes a domingo: comida de 13:00 a 16:30 · cena de 20:00 a 23:30. Fuera de esas
  horas ni el panel ni Marta admiten reservas."*
- Los días sin ninguna franja se listan explícitamente como **cerrados**
- Bajo el campo `horaFin`, texto pequeño: *"Última hora a la que se acepta una reserva"*
- Los errores de validación del servidor se muestran **junto a la fila que los causa**,
  no en un `alert()`

**No tocar** las otras cinco tarjetas ni el `Tarjeta` base.

**Verificación en el navegador (browser pane):** cambiar cena a 20:30, guardar, ir al plano,
intentar una reserva a las 20:00 → debe rechazarla con el mensaje de horario. Devolver el
valor a 20:00 al terminar.

---

### FASE 5 — UI: el calendario de ocupación en el modal de reserva

Es la pieza que pidió el usuario. Va **al final** a propósito: sin las fases 2 y 3 pintaría
bloques que el servidor no respeta.

#### 5.1 Componente nuevo: `app/src/components/TimelineMesa.tsx`

```ts
interface TimelineMesaProps {
  turnos: Turno[];              // los del restaurante (Fase 3)
  fecha: string;                // YYYY-MM-DD
  reservasDelDia: Reservation[]; // ya filtradas por mesa y fecha
  duracionPorDefecto: number;
  horaSeleccionada: string;     // el `time` del formulario
  duracionSeleccionada: number; // el `customDurationMinutes` del formulario
  reservaEditandoId?: string;   // se excluye de los bloques ocupados
  onElegirHora: (hora: string) => void;
}
```

Comportamiento:
- Del array `turnos`, quedarse con los de **ese día de la semana**. Ojo con el cálculo:
  `turnos` usa **1 = lunes … 7 = domingo**, `Date.getDay()` usa **0 = domingo**. La
  conversión ya está resuelta en `src/services/horario.js:27` (`diaSemana`) — replicar
  esa misma fórmula, no improvisar otra.
- Si no hay ninguna franja ese día → estado vacío: *"Ese día el restaurante está cerrado"*
  con un enlace a Configuración. Nada de rejilla vacía.
- Una columna (o sección) por franja, rejilla de **15 minutos**, desde `horaInicio` hasta
  `horaFin`.
- **Bloques ocupados:** para cada reserva de `reservasDelDia` (excluyendo `reservaEditandoId`),
  una barra de `r.time` a `horaDeSalida(r, duracionPorDefecto)` — usar la función que ya
  existe en `app/src/turnos.ts:66`, no reescribirla. Dentro de la barra: nombre del cliente,
  pax, y el rango horario. Ese es literalmente el caso que describió el usuario:
  la reserva de las 17:00 aparece como bloque 17:00–19:00.
- **Barra fantasma** con los valores actuales del formulario (`horaSeleccionada` +
  `duracionSeleccionada`), en color de acento. Si se solapa con algún bloque ocupado, se
  pinta en rojo con el aviso *"Choca con la reserva de {nombre}"*.
- **Clic en un hueco libre → `onElegirHora(hora)`**, que es lo que sincroniza el calendario
  con el campo Hora del formulario. Los huecos ocupados no son clicables.
- Accesible por teclado: cada hueco libre es un `<button>` real, no un `<div onClick>`.

Colores: usar los tokens de marca ya existentes (`brand-primary`, `brand-surface-low`,
`brand-outline`…), no colores sueltos. Estados ocupados en el mismo rojo/ámbar que ya usa
el plano para `reserved` / `occupied`, para que el lenguaje visual sea el mismo.

#### 5.2 `app/src/components/ReservationModal.tsx`

Props nuevas: `reservations: Reservation[]`, `turnos: Turno[]`, `defaultSeatedDuration: number`.

Insertar el `<TimelineMesa>` **justo debajo de la fila Fecha / Hora / Personas**
(actualmente termina en la línea 294), que es donde el usuario señaló en su captura.

Cálculo del array que se le pasa:
```ts
const reservasDeEstaMesa = React.useMemo(
  () => reservations.filter(r => r.tableId === (table?.id ?? '') && r.date === date && estaViva(r)),
  [reservations, table?.id, date]
);
```
`estaViva` se importa de `../turnos`.

`onElegirHora={setTime}` — nada más. La sincronización es esa.

Cuidado: el modal **recalcula cuando cambia `date`**. Si el usuario cambia el día, el
calendario debe repintarse con las reservas del nuevo día. De ahí que `date` esté en las
dependencias del `useMemo`.

#### 5.3 `app/src/App.tsx`

- Estado nuevo `turnos` + `duracionReservaMin`, cargados en el arranque junto al resto
  (buscar dónde se hace `Promise.all` de `fetchTables/fetchReservations/...` y añadirlo ahí).
- `defaultSeatedDuration` (línea 69) pasa a inicializarse del servidor; el `localStorage`
  queda solo como valor mientras carga. **No borrar el `localStorage`**: es la red de
  seguridad si la petición falla.
- Pasar las tres props nuevas al `<ReservationModal>` (línea 1538).
- `handleSaveReservation` (~línea 690): mostrar el mensaje real del error, ahora que
  `api.ts` lo conserva:
  ```ts
  catch (err: any) {
    alert(err?.mensaje || err?.message || 'No se pudo guardar la reserva.');
  }
  ```
  (mejor aún: pasarlo al `NotificationCenter` en vez de un `alert`, si no complica).

**Verificación en el navegador:**
1. Mesa con una reserva a las 13:00 → abrir "nueva reserva" en esa misma mesa: el bloque
   13:00–15:00 se ve ocupado
2. Clic en 15:30 → el campo Hora pasa a 15:30
3. Guardar → se crea **en esa mesa** (comprobar en Supabase que `mesa_id` coincide)
4. Intentar 14:00 → la barra fantasma se pone roja y, si se fuerza el guardado, el
   servidor devuelve `mesa_ocupada` con mensaje legible
5. Cambiar la fecha en el modal → el calendario se repinta

---

### FASE 6 — Cierre

1. `cd app && npm run build` — debe compilar sin errores de TypeScript
2. Repasar que no queda ningún `buscarMesaLibre` con la firma vieja:
   `grep -rn "buscarMesaLibre\|crearReserva\|modificarReserva" src/`
3. Prueba end-to-end del agente de voz con `scripts/` o el simulador de llamada
   (`CallSimulator`): pedir mesa a las 18:00 → Marta debe negarse citando el horario;
   pedirla a las 20:30 → debe aceptarla
4. Añadir la entrada correspondiente a `REGISTRO_DE_CAMBIOS.md` siguiendo el formato de
   las anteriores (qué se cambió, por qué, y qué defecto tapaba)
5. Desplegar y verificar en producción

---

## 4. Riesgos y cómo no tropezar

| Riesgo | Mitigación |
|---|---|
| **La caché de 5 min de `horario.js`** hace pensar que guardar no funciona | `horario.invalidar(slug)` en el PUT. Está escrito en la Fase 3 por esto |
| **Cambiar la firma de `buscarMesaLibre`** rompe el agente de voz en silencio | La Fase 2 obliga a `grep` de todas las llamadas antes de dar por buena la fase |
| **Días de la semana**: Postgres/`turnos` = 1..7 (L..D), JS `getDay()` = 0..6 (D..S) | Reutilizar `diaSemana()` de `horario.js:27`, no reinventarla |
| **Reservas antiguas sin `duracion_min`** | `null` → hereda la del restaurante. Por eso NO se rellena a 120 al crear |
| **Solape en el límite exacto** (una acaba a las 19:00, otra empieza a las 19:00) | Fin excluido: no chocan. Está en `seSolapan()` |
| Hacer la Fase 5 antes que la 2 | El calendario mostraría bloques que el servidor ignora. Es el error más caro posible aquí |
| Tocar el guion de Marta | **No hay que tocarlo.** `vapi_guion_externo` está a `true` y `settingsApi` ya bloquea la sincronización de prompt. Estas fases no cambian ninguna herramienta del agente, solo el comportamiento interno |

---

## 5. Fuera de alcance (dicho explícitamente para que no se cuele)

- Turnos que cruzan medianoche (cena de 21:00 a 01:00). El modelo actual no lo admite y
  meterlo a martillazos rompería `comprobar()`.
- Días festivos y cierres puntuales (vacaciones). Es otra tabla y otra pantalla.
- Arrastrar bloques en el calendario para mover una reserva. Se elige la hora con un clic;
  arrastrar es otra conversación.
- Sustituir `CalendarView.tsx` (la agenda mensual). El calendario nuevo es **del modal y
  de una mesa**; son cosas distintas y conviven.
- Rotación de la `service_role` de Supabase (pendiente aparte, pospuesto a propósito).
