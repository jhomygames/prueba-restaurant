# Registro de cambios

Historial de todo lo construido, sesión por sesión. La sesión más reciente va
arriba.

**Cómo mantenerlo**: al terminar cada sesión de trabajo se añade un bloque nuevo
al principio, con la fecha, qué se hizo, qué se verificó y qué quedó pendiente.
Los fallos encontrados se anotan aunque se hayan corregido en el momento — el
valor del registro está en poder mirar atrás y entender por qué algo es como es.

---

## Índice del sistema (estado actual)

**Qué es**: recepción para restaurantes. Un agente de IA («María») atiende el
teléfono y WhatsApp, gestiona reservas contra disponibilidad real, y un panel
web deja al equipo verlo y editarlo todo en tiempo real. Multi-restaurante: cada
local tiene su acceso, sus datos y su configuración, aislados de los demás.

| Pieza | Dónde vive |
|---|---|
| Backend (Express, Node ≥20) | `src/` |
| Panel web (React 19 + Vite + Tailwind) | `app/` |
| Scripts de mantenimiento | `scripts/` |
| Base de datos | Airtable: una base por restaurante + base central `Registro` |
| Alojamiento | Railway, desde la rama `main` |
| Repositorio | `github.com/jhomygames/prueba-restaurant` |

**Estructura del backend**

```
src/
  server.js                    entrypoint; monta los routers y sirve el panel
  routes/
    auth.js                    login por restaurante (JWT + bcrypt)
    staffApi.js                CRUD del panel (mesas, reservas, clientes, carta)
    settingsApi.js             pestaña Configuración (Vapi, WhatsApp, plataformas)
    vapiTools.js               webhook de herramientas del agente de voz
    whatsapp.js                webhook de WhatsApp + bucle de Claude
    callSim.js                 simulador de llamada del panel
    internalJobs.js            recordatorios, reseñas y sincronización (los llama Make)
    integrations.js            webhook público de plataformas externas
  services/
    airtableClient.js          cliente REST de Airtable (baseId obligatorio) + quote()
    registry.js                resuelve qué restaurante es cada petición
    secretBox.js               cifrado AES-256-GCM y comparación segura
    reservations.js            disponibilidad, alta y cancelación; turno y código
    customerMemory.js          ficha de clientes habituales
    menuService.js             carta con caché por restaurante
    toolDispatcher.js          ejecuta las herramientas del agente
    transferToHuman.js         avisa al encargado por WhatsApp
    vapiAdmin.js               crea y actualiza el agente de voz en Vapi
    phone.js                   normaliza teléfonos y detecta el mismo número
    allergens.js               saca alérgenos estructurados del texto libre
    history.js                 traza de cambios de las reservas
    connectors/                plataformas de reservas externas
      index.js                 pipeline común (dedupe, asignación de mesa…)
      demo.js                  plataforma simulada, para pruebas
      thefork.js               adaptador de TheFork
      n8n.js                   acepta el formato de una tabla de Supabase
  config/
    tools.js                   las 6 herramientas del agente
    voicePrompt.js             instrucciones de María (compartidas con Vapi)
    menu.json                  carta original; hoy es semilla y respaldo

scripts/
  provision-restaurant.js      alta completa de un restaurante nuevo
  add-integration-fields.js    campos de conector (retroactivo)
  add-n8n-fields.js            turno, código, LOPD e Historial (retroactivo)
  import-n8n-csv.js            trae los datos históricos de Supabase
  test-thefork-parser.js       pruebas sin red ni credenciales
```

**Ramas**

- `main` — versión estable, la que Railway despliega.
- `dev/integracion-n8n-vapi` — trabajo en curso: adaptación de n8n y entrada de Vapi.
- `dev/integraciones-terceros` — ya fusionada en `main`.
- Etiqueta `stable-2026-07-27-multitenant` — punto de retorno seguro.

---

## Sesión 2026-08-09 · Vapi apuntado a la app, y revisión de seguridad

**Vapi ya habla con la app.** El asistente de El Rincón Venezolano
(`e05a8f76-…`) tiene sus herramientas apuntando a `/vapi/tools`. Verificado con
una llamada simulada: `check_availability` resolvió «mañana» a 2026-08-10, dio
la fecha hablada correcta y detectó el turno de cena.

### El corte de Railway

Se acabó el crédito de prueba y Railway apagó el servicio: **todas** las rutas
devolvían `Application not found` — un 404 de la plataforma, no de la app. Se
pasó a plan Hobby. Al volver, `/api/settings` seguía dando
`Cannot read properties of undefined (reading 'accountSid')`: Railway servía el
**último build completado**, no el commit ya subido. Un commit vacío forzó la
reconstrucción y se arregló solo.

Lección: cuando producción falla justo después de un corte de plataforma, antes
de tocar código hay que confirmar **qué versión se está sirviendo**.

### Revisión de seguridad e integridad

Lo que está bien: el aislamiento entre restaurantes de `supabaseClient` (tenant
obligatorio, escrituras filtradas por restaurante *además* del id), el panel y
los jobs internos rechazan sin credenciales (401), los secretos se guardan
cifrados y nunca vuelven al navegador, la firma de Twilio se valida, y ni `.env`
ni las credenciales están versionados.

Lo que no, por orden de gravedad:

1. **`/vapi/tools` no autentica a nadie.** `VAPI_WEBHOOK_SECRET` no está puesto,
   y el código lo trata como opcional a propósito para no tumbar un agente en
   activo. Comprobado: responde 200 sin credencial alguna. El assistant id no es
   un secreto — se ve en el panel de Vapi y lo devuelve nuestra propia
   `/api/settings` —, así que cualquiera que lo tenga puede crear, modificar y
   cancelar reservas. **Es el fallo más grave del sistema ahora mismo.**
2. **WhatsApp e integraciones siguen sobre Airtable.** `whatsapp.js` e
   `integrations.js` no se migraron: usan `registry.js` y `toolDispatcher.js`.
   Escribirían en Airtable mientras todo lo demás vive en Supabase. Con la
   arquitectura C WhatsApp lo lleva n8n, así que la ruta puede estar sin uso —
   pero está viva y escribiría en la base equivocada.
3. **`whatsapp_chat_historial` sin protección de filas.** Ahora tiene 0 filas
   (se limpió), así que no hay fuga activa, pero se volverá a llenar de
   conversaciones reales legibles con la clave pública.
4. **`resolver_restaurante` y `check_existing_reservation` las puede ejecutar
   cualquiera** (SECURITY DEFINER, rol `anon`). La segunda revela si un teléfono
   tiene reserva un día dado.

Pendiente por decisión del usuario: rotar la `service_role` (aplazado otra vez)
y la pasada de seguridad/autenticación del final del proyecto.

## 2026-08-09 — El agente de voz pasa a escribir en la app

Resuelto el misterio de las reservas sin mesa. **El teléfono nunca pasaba por
nuestro agente.** El número +34911676905 estaba atado a otro agente, "Lumos
Automation Marta", cuyas herramientas apuntaban a n8n. Sincronizamos el agente
equivocado: el nuestro estaba perfecto, pero nadie le llamaba.

Marta tiene un guion escrito y afinado durante meses, y el usuario quiso
conservarlo. Así que **no se tocó ni una coma**: se repuntaron sus 7
herramientas de n8n a `/vapi/tools`, y se añadió `dialectoMarta.js`, que
traduce su vocabulario (`saveReservation`/`fecha`) al nuestro
(`create_reservation`/`date`) y devuelve las respuestas con los campos que su
guion lee (`disponible`, `fecha_hablada`, `cliente_conocido`, `GRUPO_GRANDE`).

De paso aparecieron dos cosas rotas de antes:

- **`modifyReservation` no tenía destino.** Era una herramienta de tipo función
  sin URL: cuando Marta intentaba modificar una reserva, la llamada no iba a
  ninguna parte. Ahora funciona.
- **`find_reservation` no buscaba por nombre**, aunque su guion lo usa cuando el
  teléfono no encuentra nada — justo cuando el cliente se queda sin salida.

Verificado en producción de punta a punta: reserva creada **con mesa asignada**
y "celiaco" convertido en el alérgeno "Gluten". La prueba se anuló al terminar.

Protección añadida: `vapi_guion_externo` en `restaurantes`. El botón de
sincronizar guion del panel habría sustituido el guion de Marta por la
plantilla genérica, y Vapi no guarda versiones anteriores. Ahora se niega.

Punto de retorno documentado en `VOLVER_ATRAS_VAPI.md`, con respaldo completo
de la cuenta de Vapi en `respaldos-vapi/` (fuera de git).

### La reserva de prueba que salió sin mesa

El usuario hizo una llamada de prueba (RES-997748-032, Marcos, 10-08 a las 21:00)
y la reserva se guardó **sin mesa asignada**. No es un fallo de la app: **esa
reserva no la escribió la app**.

La prueba está en los datos. `crearReserva` siempre rellena `origen`, y cuando no
hay mesa libre **rechaza** la reserva (`sin_mesa`) en vez de guardarla coja. La
fila tiene `origen: null` y `mesa_id: null`, combinación que nuestro código no
puede producir. Mirando el histórico entero: **ninguna de las 12 reservas tiene
mesa**, porque todas las escribió n8n, que nunca tuvo lógica de asignación — el
vacío exacto que motivó la arquitectura C.

La llamada se hizo antes de sincronizar el asistente, así que fue a n8n.

**Verificación pendiente:** repetir la llamada y comprobar que la reserva sale
con mesa y `origen: "voz"`. Si vuelve a salir sin mesa, n8n sigue en el camino de
la llamada y hay que sacarlo.

**A decidir:** la app ahora rechaza la reserva si no hay mesa libre. Es más
correcto que guardarla sin asignar, pero es un cambio de comportamiento.

### Pedido para la próxima sesión (plano por turnos)

1. **Ver el plano por turno** (comida / cena), no solo por día: hoy se mezclan
   las reservas de ambos servicios.
2. **Varios pases por mesa en el mismo turno.** Una mesa se ocupa dos o tres
   veces en una cena, y el plano no lo refleja: hace falta ver que una mesa tiene
   otra reserva más tarde. Parte de `duracion_min` (el tiempo estimado para
   liberar la mesa), que hoy se guarda **siempre a null** — habrá que darle valor
   por defecto antes de poder calcular los pases.

---

## Sesión 2026-08-08 (noche) · Supabase en producción

La migración está desplegada y verificada. El camino tuvo dos vueltas atrás que
conviene tener escritas.

### Producción llevaba rota desde la sesión anterior

Al ir a desplegar se descubrió que **el código de Supabase ya estaba subido**,
de un push anterior, pero Railway no tenía las credenciales: el panel devolvía
500 en el login y el equipo llevaba tiempo sin ver sus reservas.

**Error de método**: se dio por hecho que "no estaba desplegado" sin
comprobarlo. Había que haber mirado el estado real de producción antes de
asumirlo, no después.

Se restauró el servicio revirtiendo **solo los dos commits de las rutas**, y
dejando intacta toda la capa nueva. El criterio: unos minutos con datos algo
desfasados en Airtable son preferibles a un panel que no carga — lo primero se
nota y se explica, lo segundo deja al equipo a ciegas en pleno servicio.

### El diagnóstico que hacía falta

Tras un segundo intento fallido —el usuario había añadido las variables pero el
servidor seguía sin verlas—, se dejó de desplegar a ciegas: `/health` pasa a
informar de **qué variables están puestas**, con su longitud y un aviso si
llevan comillas o espacios pegados. Nunca su valor.

Como decir «FALTA» no basta cuando alguien jura haberla puesto, se añadió
además la lista de **nombres** de variables que contienen «supa». Así «no
aparece» se convierte en «la tienes, pero se llama de otra forma».

Resultó ser más simple: faltaba pulsar Deploy en Railway. Pero el diagnóstico se
queda, porque este problema se repetirá con cada restaurante nuevo.

### Verificado en producción

Panel: login como **El Rincón Venezolano**, 17 mesas, 38 platos, 10 clientes.

Y una llamada real al agente:

- *«¿Tenéis mesa el próximo viernes a las nueve para cuatro?»* → resuelve la
  fecha hablada y confirma disponibilidad.
- *«¿Y a las cinco de la mañana?»* → «A esa hora está cerrado. Ese día abrimos
  de 13:00 a 16:30 y de 20:00 a 23:30».
- *«¿Qué tenéis sin gluten?»* → 21 platos.
- Un assistant desconocido → `restaurante_no_identificado`, sin escribir nada.

### Estado

Commit `b5e06de` en `main`, desplegado. **La app funciona íntegramente sobre
Supabase**: panel, login, agente, escritura y notificaciones.

**Pendiente**: apuntar Vapi a la app (empezando por `check_availability`, la
única de solo lectura) y jubilar los cinco workflows de reservas sin borrarlos.
Y la fase de seguridad al cierre del proyecto.

---

## Sesión 2026-08-08 (tarde) · La app entera sobre Supabase

Se completó la migración: escritura, directorio, login, agente, notificaciones y
panel. **Todo probado en local contra la base real; falta desplegar**, y para eso
hacen falta dos variables de entorno que solo puede poner el usuario.

### Lo que se construyó

| Pieza | Qué hace |
|---|---|
| `repo/escribir.js` | Crear, modificar y cancelar reservas, y la ficha de cliente |
| `repo/restaurantes.js` | Directorio de locales, resolución por Vapi/WhatsApp y login |
| `agente.js` | Ejecuta las herramientas de la llamada; sustituye a `toolDispatcher` |
| `notificaciones.js` | Dispara los avisos de WhatsApp que hasta ahora lanzaba n8n |
| `staffApi.js` | El panel, reescrito sobre Supabase |

### Decisiones que no se leen en el código

- **Se elige la mesa más pequeña que sirva.** Sentar a dos personas en la de
  ocho deja el servicio sin sitio para un grupo que llame media hora después.
- **Al modificar, la reserva original solo se toca si hay dónde ponerla.** Es
  mejor que el cliente conserve la suya a que la pierda por un cambio que no
  cupo.
- **Los alérgenos del cliente se acumulan**, no se sobrescriben: que no
  mencione su alergia en la segunda reserva no significa que se le haya pasado.
- **Cada herramienta devuelve el mensaje en castellano listo para decir.** Así
  la forma de dar un «no» no depende de que el modelo improvise bien ese día.
- **Un aviso que falla nunca tumba la reserva**, y no se envía nada sin
  consentimiento ni sin teléfono.

### Dos fallos propios

**El panel se quedó en blanco.** Reutilicé los traductores del agente asumiendo
que una sola forma servía para los dos. No es así: el agente usa `party_size`,
`customer_name`; el panel usa `pax`, `customerName`, `seats`, `knownAllergies`.
Son dos contratos distintos sobre el mismo dato. Lo delató abrir el navegador y
leer la consola — **las pruebas de API pasaban todas**, porque comprobaban que el
backend respondía, no que el panel supiera leerlo.

**Los números en palabras salían sin tilde.** Construía las decenas pegando
«veinti» + la unidad, y tres llevan acento (veintidós, veintitrés, veintiséis).
El agente los lee en voz alta. Lo cazó la prueba.

### Corrección de algo que ya estaba mal

La resolución de la llamada usaba el `phoneNumberId` de Vapi como respaldo, pero
ese identificador es interno suyo y **nunca lo tuvimos guardado**: ese respaldo
no funcionaba. Ahora usa el número al que llamó el cliente, que sí tenemos.

### Verificado

Contra la base real, con los datos de prueba borrados: cliente de datos y
aislamiento entre locales (en lectura y en escritura), lectura, escritura
completa, directorio y login (con la contraseña de siempre, migrada tal cual),
el agente en una conversación entera —fecha hablada, rechazo a las 05:00, grupo
de 20 al equipo, alta, consulta, cambio, carta sin gluten y anulación—, y el
panel recorriendo sus cuatro pestañas.

Sin regresiones: el parser de TheFork sigue pasando.

### Estado

Commit `3dea7c1` en `main`. **No desplegado.**

**Bloqueado por el usuario**: hay que añadir en Railway `SUPABASE_URL` y
`SUPABASE_SERVICE_KEY`. Sin ellas la app falla al arrancar — se comprobó a
propósito que falla en claro y no en silencio, que es lo correcto, pero
significa que desplegar antes de configurarlas tumbaría producción.

**Después**: apuntar Vapi a la app empezando por `check_availability` (la única
herramienta de solo lectura), y jubilar los cinco workflows de reservas sin
borrarlos.

---

## Sesión 2026-08-08 · Supabase como base principal, y las mesas por día

Dos frentes: arreglar un fallo que el usuario venía notando, y empezar la
migración a Supabase como base única.

### Las mesas se quedaban ocupadas varios días

El fallo reportado era real y tenía **tres capas**:

1. El campo `Estado` de una mesa **no lleva fecha**: describe el servicio en
   curso, pero se usaba como si valiera para cualquier día. El plano pintaba una
   mesa ocupada en TODAS las fechas del calendario.
2. Los contadores de arriba hacían lo mismo — verificado antes de tocar nada:
   el 20 de agosto marcaba *4 ocupadas* por algo que pasó el día 7.
3. **Nadie las liberaba nunca.** Había 9 mesas colgadas entre los dos locales,
   arrastradas de servicios anteriores.

Ahora el estado guardado solo cuenta para hoy; cualquier otro día, lo único que
ocupa una mesa es una reserva de esa fecha. El sondeo las libera una vez al día
tras la medianoche. "Fuera de servicio" no se toca: una mesa averiada sigue
averiada mañana.

**De paso**, ese estado faltaba en el mapeo entre Airtable y el panel, así que
una mesa averiada llegaba como *libre* aunque el backend sí la excluía al
asignar. Dos vistas distintas de la misma realidad.

### Supabase pasa a ser la base principal

El objetivo, en palabras del usuario: que dar de alta un restaurante nuevo sea
copiar lo que ya hay, no crear otra base de datos.

Eso cambia cómo se separan los locales:

| | Airtable | Supabase |
|---|---|---|
| Separación | una **base** por local | una **columna** `restaurante` |
| Alta | crear base, 5 tablas, tipos, enlaces | insertar filas |
| Aislamiento | lo garantiza la infraestructura | **lo garantiza el código** |

Esa última fila es la contrapartida y conviene tenerla presente: Supabase **no
se queja** de una consulta sin filtrar, simplemente devuelve las filas de todos
los locales. Por eso el restaurante es el primer argumento y es obligatorio,
igual que lo era `baseId`: sin él la llamada falla en el acto. Las escrituras
filtran por restaurante **además** del id, así que un id de otro local no
modifica nada. Ambas cosas verificadas contra la base real.

Lo construido:

- **Esquema**: tablas `mesas` (17 filas del plano real), `carta` (38 platos),
  `restaurantes`, `usuarios`, `turnos`; y los campos que le faltaban a
  `reservas` y `clientes`. Todo **aditivo**: no se tocó nada de lo que usan los
  flujos de n8n, así que siguieron funcionando durante el cambio.
- **`supabaseClient.js`** y **`repo/reservas.js`**: acceso a datos y lectura,
  devolviendo las mismas formas que producía Airtable — es lo que permite
  migrar por partes en vez de todo de golpe.
- **`resolver_restaurante()`**: traduce assistant de Vapi, número de WhatsApp o
  teléfono del local a su slug. Vive en la base y no en cada workflow para que
  la regla esté en un sitio. Devuelve NULL si no reconoce nada, a propósito: es
  mejor que n8n vea que no sabe de quién es la reserva a que la escriba en el
  local equivocado.
- **`scripts/alta-restaurante-supabase.js`**: probado, da de alta un local con
  plano y carta en segundos.

### Dos protecciones que solo existían en n8n

Portadas a la app, con pruebas, porque sin ellas apuntar Vapi a la app sería un
paso atrás:

- **Fechas habladas**: *"mañana"*, *"el próximo viernes"* resueltas en código y
  no pidiéndoselo al modelo. Lo que no se entiende devuelve `null` — preguntar
  otra vez es mejor que adivinar mal. Se calcula en la zona del restaurante: con
  husos distintos, "mañana" cae en el día equivocado unas horas cada noche.
- **Horario de apertura**: la app aceptaba reservas a las cinco de la mañana. Se
  modela por turnos y no como un único intervalo porque un restaurante cierra
  entre comida y cena. Un local sin horario configurado no se bloquea.

**Fallo propio**: construía los números en palabras pegando "veinti" + la
unidad, y en español tres llevan tilde (veintidós, veintitrés, veintiséis). El
agente los lee en voz alta, así que se habría notado. Lo cazó la prueba.

### La decisión de arquitectura

Al ir a rehacer los workflows apareció una bifurcación. Se plantearon tres vías
y se eligió la **C**:

- **A** — n8n escribe directo en Supabase: tendría que reimplementar asignación
  de mesa, alérgenos, código y anti-duplicados. Duplicado y sin probar.
- **B** — n8n llama a la app: menos trabajo, pero deja la lógica partida en dos
  para siempre. *Se propuso primero; era la respuesta cómoda, no la mejor.*
- **C** — **elegida**: la voz va directa a la app; WhatsApp y notificaciones se
  quedan en n8n, que hace bien ese trabajo (buffer, mutex, plantillas de Twilio,
  reintento a SMS). n8n no queda como conector de base de datos: queda como capa
  de mensajería.

### Estado

Commit `3e03db7` en `main`. Las mesas por día están desplegadas y verificadas.
La migración a Supabase está a medias **y no afecta a producción todavía**: la
app sigue leyendo de Airtable.

**Pendiente**: capa de escritura sobre Supabase; cambiar los servicios y el
login; que la app dispare los tres webhooks de notificación de n8n; migrar los
datos vivos; y por último apuntar Vapi a la app, empezando por
`check_availability` que es de solo lectura.

**Sigue pendiente de decisión**: `whatsapp_chat_historial` sin protección de
filas, y rotar la `service_role` de Supabase.

---

## Sesión 2026-08-07 · La app se alimenta de Supabase, y se desconecta de Vapi

Cambio de rumbo: las reservas ya no llegan a la app por el canal de voz, sino
leyendo la base de Supabase donde las dejan los flujos de n8n.

### Por qué la llamada de ayer «no se registró»

Se registró — en Supabase. La reserva `RES-335529-185` estaba ahí, creada por
voz. El agente de Vapi seguía apuntando a los workflows de n8n, que escriben en
esa base; la app nunca estuvo en ese circuito. Se comprobó además simulando una
llamada con el formato exacto de Vapi: la reserva de 5 personas apareció en el
panel con mesa, código y alergias. Nuestra parte funcionaba.

### Conector de Supabase

A diferencia de los demás, **va a preguntar en vez de esperar aviso**. Es la
única forma de enterarse de un cambio hecho a mano en la tabla, porque eso no
dispara ningún webhook.

Se trae las reservas de **hoy en adelante, todas**, no solo las nuevas: la tabla
tiene `created_at` pero no `updated_at`, así que filtrar por fecha de creación
perdería justo lo que más importa —una reserva vieja que acaban de cancelar o
mover—. El conjunto de reservas futuras es pequeño por definición.

Reutiliza el traductor del conector de n8n a propósito: la tabla de Supabase y
lo que n8n manda por webhook son la misma forma de datos, y duplicar el mapeo
solo serviría para que un día dejaran de coincidir.

### La clave publicable no servía, y fallaba en silencio

Al probarla devolvía **`200 OK` con lista vacía**. No un error: la tabla tiene
protección de filas y ninguna regla permite leer a esa clave. El conector habría
trabajado «correctamente» trayendo cero reservas para siempre.

Se plantearon tres salidas (clave secreta nueva, la `service_role` actual, o
abrir la tabla a la clave pública). Se descartó la tercera en la propuesta: los
nombres y teléfonos de los clientes quedarían legibles por cualquiera. **El
usuario eligió la `service_role` actual**, que es la que ya está expuesta en los
workflows; queda pendiente rotarla, y entonces bastará con pegar la nueva.

### Sondeo automático dentro del servidor

`autoSync.js`, cada 5 minutos. **No se dejó en Make**, como los recordatorios,
porque el sondeo es la única vía por la que la app se entera de un cambio en
Supabase: colgarlo de un servicio externo, con su propio secreto y su plan
gratuito de dos escenarios, sería un punto de fallo silencioso — si Make deja de
disparar, el panel se queda desactualizado sin que nadie lo note.

Se añadió también un botón de **sincronizar ahora**: al terminar de configurar
una integración no había forma de ver si funcionaba, porque el disparador
periódico vive fuera y el dueño del restaurante no tiene su secreto.

### Dos escrituras inútiles, detectadas al mirar los números

Cada pasada reportaba `actualizadas: 2` sin que nada hubiera cambiado. Al releer
las mismas filas una y otra vez, el pipeline **reescribía todas las reservas** y
volvía a marcar como cancelada una que ya lo estaba. Con tres reservas da igual;
con un servicio lleno son cientos de escrituras cada cuarto de hora. Ahora se
compara antes de escribir. El registro también ignora el estado estable: un
aviso cada cinco minutos diciendo lo mismo tapa lo que importa.

### Desconexión de Vapi

La app deja de gestionar agentes: las rutas que llaman a `api.vapi.ai` responden
409 con explicación, y la tarjeta del panel lo dice en vez de desaparecer sin
más. Reversible con `VAPI_GESTION_HABILITADA=1`.

**`/vapi/tools` sigue vivo a propósito**: es el endpoint que usan los workflows
de n8n que enlazamos en la sesión anterior. Apagarlo los rompería.

### Verificado contra la base real

Se creó una fila de prueba en Supabase (no se tocó ninguna real), y se comprobó
el ciclo completo: **alta** → aparece con mesa y con la alergia extraída del
texto; **modificación** (2 personas 21:00 → 7 personas 22:30) → se refleja;
**cancelación** → se refleja. Después se borró de ambos lados. Dos pasadas
seguidas sin cambios no escriben nada.

En producción: Vapi devuelve 409, el sondeo manual sigue funcionando y
`/vapi/tools` sigue respondiendo.

### Seguridad, pendiente de decisión del usuario

La tabla **`whatsapp_chat_historial` tiene la protección de filas desactivada**:
46 conversaciones legibles por cualquiera con la clave pública. No se tocó —
activarla sin definir permisos bloquearía todos los accesos y rompería el flujo
de WhatsApp.

### Estado

Commit `fac6c5d` en `main`, desplegado y verificado.

**Pendiente**: rotar la `service_role` de Supabase; decidir qué hacer con
`whatsapp_chat_historial`; y, cuando se retome lo multi-restaurante, añadir una
columna de restaurante a la tabla `reservas` (hoy es de un solo local, así que
la app **no** puede leer Supabase en directo sin que todos vean lo mismo).

---

## Sesión 2026-08-03 · Una cuenta de Vapi por restaurante

El objetivo se concretó: cada restaurante tendrá **su propia cuenta de Vapi**
con su propio agente, no un agente dentro de una cuenta compartida. La
arquitectura ya lo soportaba (clave y agente por local, cifrados y separados),
pero faltaban piezas para poder usarla de verdad.

### Lo que faltaba y se añadió

- **Probar una clave sin guardarla.** Antes había que guardarla para saber si
  valía, pisando la anterior en cada intento. Ahora el panel la comprueba antes
  y, si es válida, **lista los agentes de esa cuenta** con un botón para
  vincular el correcto.
- **Poder fijar el `assistantId`.** Solo se establecía al crear un agente nuevo,
  así que un local que traía su cuenta con su agente ya hecho no tenía forma de
  apuntarlo. Ahora se puede, y **se valida contra la cuenta de la clave**:
  guardar un id de otra cuenta dejaría el local «configurado» pero mudo.
- **El respaldo a la clave central deja de ser silencioso.** Si la clave del
  local existía pero no se podía descifrar, se caía a la central — es decir,
  operaba contra otra cuenta de Vapi sin avisar. En un modelo de cuentas
  separadas eso es inaceptable: ahora falla en voz alta.

### El diagnóstico, que costó llegar

Una clave daba 401 y el mensaje de Vapi no aclaraba nada. El camino:

1. Primero se descartó que el fallo fuera nuestro: la clave enmascarada del
   panel sale de **descifrar** lo guardado, así que verla bien demuestra que el
   ciclo guardar→cifrar→descifrar funciona y que a Vapi le llega exactamente lo
   pegado. Además se limpia de espacios al guardar.
2. Se separó el test en dos pasos —listar agentes (prueba solo la clave) y
   luego buscar el concreto— porque un único 401 confundía «clave inválida» con
   «clave correcta de otra cuenta».
3. Se añadió la **forma** de la clave (longitud, si es UUID) sin exponerla:
   confirmó 36 caracteres y UUID válido.
4. Se sondearon varios recursos de la API con la misma clave.

**El dato decisivo**: Vapi responde `unauthorized` ante un UUID inventado, pero
`Invalid Key. Hot tip, you may be using the private key…` ante una clave que sí
reconoce. Son mensajes distintos, y esa diferencia dice si la clave existe pero
es del tipo equivocado, o si no es suya en absoluto.

**Error propio, anotado**: llegué a descartar esa hipótesis diciendo que el
aviso salía también sin mandar clave. Era falso — había mirado solo el código
401, sin leer el cuerpo de la respuesta. Leyéndolo, sí distingue.

### Verificado

La clave de la cuenta original **funciona**: el probador la acepta y lista sus
agentes para elegir. Eso valida todo el mecanismo de punta a punta. La clave de
la cuenta nueva sigue rechazada; el usuario ha pedido otra a Vapi.

### Estado

Commit `1a42868` en `main`, desplegado. También se aclaró en el panel que la
clave debe ser la **privada** (el campo no lo indicaba, y las dos claves de Vapi
son UUID indistinguibles a simple vista).

**Pendiente para la próxima sesión**:

- Probar la clave nueva de Vapi y vincular el agente de esa cuenta a El Sazón
  Venezolano.
- **Secreto de webhook por local**: hoy `VAPI_WEBHOOK_SECRET` es único y global.
  Con cuentas de Vapi distintas, cada restaurante necesita el suyo. Es el último
  hueco real del modelo multi-cuenta.
- Apuntar el agente a los webhooks de n8n (o a la app directamente, lo que
  antes exige añadir horarios de apertura a la app).
- Rotar la clave `service_role` de Supabase, aún expuesta en los workflows.

---

## Sesión 2026-07-31 · Enlace de los workflows de n8n con la app

Los 8 workflows de n8n que atendían las llamadas pasan a guardar en Airtable en
vez de en Supabase y Google Sheets. Se trabajó sobre copias (carpeta «prueba
Jhomar»); los originales siguen intactos y activos.

### La arquitectura no era la que esperábamos

No era solo Supabase: los datos estaban repartidos entre **Supabase** (reservas
y clientes), **Google Sheets** (los turnos y un espejo de las reservas) y n8n
para los WhatsApp. La hoja pertenece a otro restaurante, «El Rincón».

Y los workflows tenían lógica que la app **no** tenía:

| n8n hacía | La app |
|---|---|
| Resuelve «mañana», «el viernes», «próximo sábado» en código | Se lo pedía al modelo en el prompt |
| Dice la fecha en voz alta («domingo, veinte de septiembre…») | No lo hacía |
| Valida el horario de apertura | **No: habría reservado a las 5 de la mañana** |
| Grupos de más de 10 → pasa al equipo | No |
| Evita que el mismo cliente reserve dos veces el mismo día | No |
| Modificación atómica de una reserva | Decía «anula y vuelve a crear» |

Por eso los workflows **no se sustituyeron, se enlazaron**: n8n conserva esa
lógica y la app pasa a ser la base de datos. Lo que faltaba se implementó en la
app, donde vale para todos los canales y no solo para el de voz.

### Lo que se añadió a la app

- **Anti-duplicados** al crear una reserva. Se comprueba por teléfono + día +
  **turno**, no solo por día como hacía n8n: reservar comida y cena el mismo día
  es legítimo y bloquearlo sería peor que el problema que resuelve. Las reservas
  de plataformas externas se saltan la comprobación porque ya vienen
  deduplicadas por su propio id.
- **`modify_reservation`**, como modificación real y no como «anular y crear de
  nuevo»: si el alta fallara después de la baja, el cliente se quedaría sin
  reserva sin saberlo. La original solo se toca cuando ya hay mesa para los
  datos nuevos.
- **`find_reservation`**, que busca por código, por teléfono+fecha, o solo por
  teléfono (devolviendo todas las reservas futuras del cliente).
- `findAvailableTable` admite excluir una reserva del cálculo de ocupación: sin
  eso, cambiar solo el número de personas sin mover la hora fallaría siempre por
  chocar la reserva consigo misma.
- Comparación en tiempo constante del secreto compartido de Vapi/n8n.

### Dos fallos que ya venían de antes

- **Todas las ramas de error de `save_reservation` estaban rotas.** El nodo de
  respuesta leía siempre de `resultado_ok`, que solo se ejecuta cuando todo va
  bien. Faltan datos, fuera de horario, sin disponibilidad… ninguna llegaba a
  decirle nada al cliente: el agente recibía un fallo técnico. Corregido en las
  copias; **los originales siguen con ese fallo**.
- **El teléfono se enviaba a Twilio sin prefijo internacional**, lo que impide
  entregar el WhatsApp. Corregido en las tres notificaciones.

### Seguridad

Los workflows llevan la **clave `service_role` de Supabase escrita a mano** en
las cabeceras de varios nodos (en dos formatos distintos, uno por workflow).
Esa clave salta todas las reglas de seguridad de la base y queda en el historial
de versiones y en los logs. **Está pendiente de rotar por parte del usuario.**

### Verificado

Cadena completa contra los webhooks reales y el servidor desplegado: reservar →
buscar por teléfono sin dar fecha → cambiar a 5 personas (la app reasignó de
Terraza 3 a Mesa 6, más grande) → mover de fecha y hora (turno recalculado a
comida) → anular → comprobar que ya no aparece. Más las ramas de error:
duplicado, datos incompletos, fuera de horario y grupo grande.

En Airtable quedó todo: código, mesa, turno, origen y **las alergias extraídas
del texto libre** («Alergia al gluten» → etiqueta `Gluten`).

Sin regresiones: las pruebas de voz, duplicados, conector n8n y conectores
demo/TheFork siguen pasando.

**Un fallo propio, anotado por si vuelve**: dos pruebas dieron error por buscar
campos con el nombre equivocado (`codigo`/`turno` en vez de `code`/`shift`, y
`Codigo` en vez de `CodigoReserva`). El código estaba bien; el test, no.
También hubo un test cuya limpieza borraba con una clave vacía y fallaba en
silencio, dejando residuos que hacían fallar la ejecución siguiente.

### Estado

Commit `043925d` en `main`, desplegado y verificado. Los 8 workflows copiados
apuntan a la app y están publicados.

**Pendiente**: apuntar el asistente de Vapi a los webhooks de las copias (o a
nuestra URL directamente), y rotar la clave de Supabase.

---

## Sesión 2026-07-30 (tarde) · Conexión del agente de voz y despliegue

Se registró el agente de Vapi que hoy funciona con n8n y se desplegó todo el
trabajo del esquema de n8n a producción.

### El agente quedó vinculado a su restaurante

El `assistantId` de Vapi se guardó en la ficha de **El Sazón Venezolano**, que
es lo que permite al backend saber a qué restaurante pertenece cada llamada.
Basta con ese dato: el `phoneNumberId` es solo un respaldo por si el asistente
no viniera identificado.

**Aclaración sobre lo que se recibió**: lo que llegó etiquetado como «Phone
number ID» era en realidad el número de teléfono (+34 911 67 69 05), no el
identificador interno de Vapi, que es un UUID. El número se guardó como
teléfono de contacto y la vinculación se hizo por `assistantId`, así que no
bloqueó nada.

### Verificado contra producción

Diez comprobaciones simulando llamadas reales de Vapi (formato
`server-tool-calls`) **contra el servidor desplegado**, no solo en local:

- El `assistantId` resuelve al restaurante correcto y devuelve su
  disponibilidad real.
- Un `assistantId` desconocido **no cae en otro restaurante**: responde
  `restaurante_no_identificado` en vez de escribir donde no debe.
- Una reserva creada por voz sale con su mesa, su turno (`cena`), su código
  (`RES-061704-861`) y las alergias sacadas del texto libre («Alergia al
  gluten» → `Gluten`).
- La ficha del cliente se guarda en la base del Sazón; Gourmeats queda intacto.
- La memoria del cliente se recupera en la llamada siguiente.
- La carta consultada es la suya, y la cancelación por voz funciona.

Sin regresiones: las pruebas de TheFork, del conector demo y del conector n8n
siguen pasando.

### Un fallo que era mío, no del código

Las dos primeras comprobaciones de código y turno dieron error. No era el
sistema: mi prueba buscaba las propiedades `codigo` y `turno`, cuando la
respuesta las expone como `code` y `shift`. Los datos sí se estaban guardando
correctamente en Airtable. Queda anotado porque es justo el tipo de «fallo»
que puede llevar a tocar código que funciona.

### Estado

Commit `3827964` en `main`, **desplegado y verificado en producción**. Con esto
el backend está listo para recibir llamadas de Vapi.

**Pendiente para completar la integración**: apuntar el asistente de Vapi a
nuestra URL de herramientas (lo hace el usuario desde el panel de Vapi, o
nosotros si pega su API key en la pestaña Configuración).

---

## Sesión 2026-07-30 · Adaptación del esquema de n8n (preparar la entrada de Vapi)

Se recibieron las tres tablas que el flujo de n8n usaba en Supabase
(`reservas`, `clientes`, `historial_reservas`) para adaptarlas y poder conectar
Vapi contra nuestro sistema sin perder nada por el camino.

### Lo que el análisis de esos datos reveló

**Un cliente partido en dos.** El mismo número aparecía como `+34624114533` y
como `624114533`, y como la ficha se busca por teléfono, cada forma creaba un
cliente distinto. Resultado: visitas y **alérgenos conocidos divididos entre dos
fichas**, que es justo lo que la memoria de clientes debe evitar. Ahora la
búsqueda compara por los 9 últimos dígitos y los reconoce como la misma persona.

**Alergias encerradas en texto libre.** "Alergia al marisco y al pescado" no se
puede filtrar ni avisar a cocina. Se traducen a los 14 alérgenos oficiales, con
dos reglas: la nota original nunca se sustituye, y ante la duda se marca de más
("marisco" coloquial → crustáceos *y* moluscos). Lo que no se entiende se
reporta en vez de darse por leído — en los datos había un "Alergia al boco" que
ahora sale como aviso a revisar.

**Números imposibles.** `6871134476` (un dígito de más) y `542389123` (empieza
por 5, que no existe en España). Se marcan para revisión **sin corregirlos a
ciegas**: un número mal "arreglado" es peor que uno sin tocar.

### Campos que faltaban y se añadieron

| Concepto | Por qué importa |
|---|---|
| `CodigoReserva` | `RES-123456-789`: un id interno de Airtable no se puede dictar por teléfono; este sí |
| `Turno` | comida/cena, derivado de la hora (no se pide, para que no contradiga a su propia hora) |
| `LopdAcepta` | consentimiento de datos, obligatorio en España |
| `IdiomaPreferido` | el agente puede saludar en el idioma de la última visita |
| Tabla `Historial` | traza de cambios para resolver reclamaciones |

El historial guarda además un **resumen legible** (`personas: 6 -> 3`), no solo
dos JSON que haya que comparar a ojo como hacía n8n.

### Conector n8n

Acepta el objeto tal cual se insertaba en Supabase, con sus nombres de columna,
para que en n8n solo haya que cambiar un nodo. Tolera nombres alternativos
porque fallar por una "s" de más obligaría a depurar dentro de n8n a ciegas.

**Decisión de diseño**: `Origen` guarda el canal real (`voz`, `whatsapp`), no
"n8n" — a la sala le importa si el cliente llamó o escribió, no la fontanería.
Eso obligó a cambiar la deduplicación, que antes casaba `(Origen, ExternalId)`
y ahora usa solo `ExternalId`; de lo contrario una reserva de voz llegada por
n8n no se encontraría al reenviarla y se duplicaría.

### Datos históricos importados

Las 17 reservas, 8 clientes y 24 entradas de historial están ya en El Sazón
Venezolano, con teléfonos normalizados, alérgenos estructurados y mesa asignada
a las que siguen en pie. El script es idempotente.

**Dos fallos propios corregidos durante la verificación:**
- La fusión de fichas duplicadas elegía "el nombre más largo" y se quedaba con
  *"Prueba Fixed Mode"* en vez de *"Antony Bracamonte"*. Ahora gana la ficha más
  reciente, que es la última vez que esa persona dijo cómo se llama.
- Clientes e historial se duplicaban al reejecutar. Las fichas sin teléfono ya
  no se importan (no se pueden buscar nunca, solo serían basura) y el historial
  se deduplica por instante + reserva + acción.

### Guion de voz actualizado

María ahora pide el consentimiento de datos, dicta el código de reserva al
confirmar y lo pide primero al cancelar.

### Verificado

Los 10 bloques del circuito completo contra el servidor: datos importados
visibles en el panel, alta desde el formato exacto de Supabase, teléfono en otro
formato reconocido como el mismo cliente, reenvío sin duplicar, cancelación,
secreto incorrecto rechazado y traza sin ruido. Comprobado también en pantalla.

Sin regresiones: las 26 pruebas de TheFork y el circuito del conector demo
siguen pasando.

### Estado

Commit `13a4914` en la rama `dev/integracion-n8n-vapi`. **No desplegado**: los
campos nuevos ya existen en las bases de Airtable (son inofensivos para el
código en producción, que simplemente los ignora), pero el código que los usa
espera a que Vapi esté probado.

**Pendiente**: el Assistant ID y el Phone Number ID de Vapi, que aporta el
usuario; la API key va directamente en la pestaña Configuración, nunca por chat.

---

## Sesión 2026-07-27 (noche) · Despliegue de las integraciones

La rama `dev/integraciones-terceros` se fusionó en `main` y se desplegó. Antes
de subir se comprobó que ningún secreto entrara en el diff.

**Verificado en producción, no solo en local:**

- Lo que ya funcionaba sigue igual: login de los dos restaurantes, 15 mesas y
  38 platos de Gourmeats, y sus 8 reservas ahora con su origen marcado.
- El arreglo del escapado: un email con apóstrofo devuelve `401` en vez del
  `500` que daba antes.
- La capa nueva: el webhook existe y exige autenticación (`401` sin secreto),
  un restaurante inexistente da `404`, y la pestaña Configuración ya ofrece las
  dos plataformas.
- **Prueba real de punta a punta**: se activó el conector demo desde la API,
  se envió una reserva por el webhook público y apareció en el panel con su
  mesa asignada y su etiqueta de origen. Datos de prueba borrados después.

**Detalle a recordar**: Railway compila el panel por su cuenta, así que el
identificador del archivo generado NO coincide con el del build local. Para
saber si un despliegue ya está vivo hay que mirar el comportamiento (por
ejemplo, que una ruta nueva deje de dar 404), no comparar ese identificador.

**Estado**: el conector demo queda activo en el restaurante de pruebas, listo
para enganchar el flujo de n8n.

---

## Sesión 2026-07-27 (tarde) · Revisión de código

**Qué se hizo**: repaso del código de las integraciones con ojos frescos, antes
de darlo por bueno.

### Fallo grave encontrado y corregido: el escapado de Airtable no funcionaba

Al probar el escapado de comillas descubrí que **la forma que usábamos era
inválida**: Airtable no admite `\'` dentro de una cadena entre comillas simples.
Cualquier valor con un apóstrofo rompía la consulta entera con un error 422.

Consecuencias reales que tenía:

- Una reserva de TheFork con un id que contuviera `'` habría hecho fallar la
  deduplicación → error 500 → TheFork reintentando en bucle.
- Un cliente llamado *O'Brien* rompía la búsqueda de su ficha.
- Un email con apóstrofo rompía el login (fallaba cerrado, sin filtrar datos,
  pero devolvía 500 en vez de 401).

El fallo **no era solo del código nuevo**: estaba también en el login por email,
en la búsqueda de clientes por teléfono, en la cancelación de reservas y en el
filtro por fecha del panel — algunos sin ningún escapado.

**Corrección**: función `quote()` en `airtableClient.js` que entrecomilla con
comillas dobles y escapa correctamente, aplicada en los cinco sitios. Verificado
creando registros con ids conflictivos (`O'Brien-123`, comillas dobles, barras
invertidas) y comprobando que se encuentran exactamente. Añadido al test
permanente para que no vuelva.

### Otros tres arreglos

- **Comparación de secretos en tiempo constante** también en el conector demo
  (antes usaba `===`, que se detiene en el primer carácter distinto y permitiría
  deducir el secreto midiendo tiempos). Ahora hay un `safeCompare` compartido.
- **La sincronización encadenada ya no puede tumbar los recordatorios**: si
  falla, se reporta dentro de la respuesta en vez de devolver un 500 que haría
  parecer que los recordatorios tampoco se enviaron.
- **El cursor de sincronización solo se escribe si hubo algo que sincronizar**:
  antes tiraba la caché del registro cada 15 minutos sin motivo.

**Verificado**: sintaxis de todo el backend, los 26 casos del parser de TheFork,
y el circuito end-to-end completo del conector demo otra vez tras los cambios.

---

## Sesión 2026-07-27 (mañana) · Integraciones con plataformas de reservas

**Objetivo**: que las reservas hechas en TheFork y similares aparezcan solas en
el panel. Trabajo en la rama `dev/integraciones-terceros`, sin desplegar.

### Antes: copia de seguridad

Se creó un punto de retorno antes de empezar: etiqueta
`stable-2026-07-27-multitenant` en GitHub, rama de trabajo separada, y una copia
física de la carpeta (`… - BACKUP 2026-07-27 (estable)`).

### Lo que se construyó

- **Capa de conectores** (`src/services/connectors/`): cada plataforma es un
  adaptador pequeño; el pipeline común hace el trabajo de verdad — deduplicar
  por id externo, asignar mesa con la misma lógica que el agente de voz,
  registrar al cliente y manejar cancelaciones.
- **Decisión de diseño**: si no hay mesa libre, la reserva **entra igualmente
  sin asignar** en vez de rechazarse. La plataforma ya se la vendió al cliente;
  rechazarla dejaría a alguien plantado en la puerta.
- **Adaptador de TheFork**, contra la forma real de su POS-API (verificada en su
  documentación pública): ellos nos llaman a la URL que registremos como
  `receiptOpeningUrl`, con `Authorization: Bearer`, y esperan un **204 sin
  cuerpo**. Traslada las alergias del cliente a las notas de la reserva, así el
  protocolo de alérgenos funciona igual venga de donde venga la reserva.
- **Adaptador demo**, para poder probar todo el circuito sin depender de nadie.
- **Webhook público** `POST /integrations/:provider/webhook/:slug` — el
  restaurante se identifica por la URL, nunca por el contenido del mensaje.
- **Endpoint de sondeo** para plataformas sin webhook, encadenable al escenario
  de recordatorios de Make con `?with_sync=1` (el plan gratuito solo permite dos
  escenarios).
- **Tarjeta «Plataformas de reservas»** en Configuración: elegir plataforma,
  copiar la dirección y el token, regenerar el token, desconectar.
- **Origen visible**: cada reserva ahora sabe de dónde vino (panel, voz,
  WhatsApp, TheFork…) y se muestra como etiqueta en el calendario.

### Verificado

- 22 casos del parser de TheFork contra el payload de ejemplo de su
  documentación — sin necesitar cuenta de partner.
- Circuito completo con el conector demo: alta, reenvío del mismo aviso (no
  duplica), cancelación, secreto incorrecto, plataforma equivocada, restaurante
  sin integración, reserva de 99 personas sin mesa disponible, y aislamiento
  frente al otro restaurante.
- Comprobado en pantalla: las reservas aparecen con su etiqueta de origen.

### Pendiente

- Conseguir la cuenta de partner de TheFork (tarea del usuario).
- Con ella: confirmar los valores reales de `reservationStatus` y si existen
  flujos separados de actualización/cancelación (esas páginas de la
  documentación dieron 403).
- Fuera de alcance por ahora: publicar disponibilidad *hacia* la plataforma.

---

## Sesión 2026-07-26 · Multi-restaurante, tutorial y arreglo del alta

### Sistema multi-restaurante con login

Se pasó de un solo restaurante a varios, cada uno con su acceso y sus datos.

- **Arquitectura elegida**: una base de Airtable por restaurante, más una base
  central `Registro`. Se descartó la alternativa (una sola base con un campo
  «restaurante» en cada tabla) porque bastaría olvidar un filtro una vez para
  que un local viera datos de otro.
- **Login** con email y contraseña (cifrada con bcrypt), sesión de 7 días.
- **Pestaña Configuración**: cada local conecta su propio Vapi y su propio
  WhatsApp; las credenciales se guardan cifradas y nunca se devuelven al
  navegador.
- **Los canales sin sesión** resuelven el restaurante a su manera: la voz por el
  agente que atendió, WhatsApp por el número que recibió el mensaje.
- **Script de alta** de restaurantes: crea la base, siembra 15 mesas y la carta,
  y genera el usuario administrador.

**Verificado**: login correcto e incorrecto, aislamiento entre dos restaurantes,
intento de acceder a datos ajenos por URL, formulario y token manipulado — todos
bloqueados. Secretos comprobados como ilegibles en Airtable.

### Fallo encontrado: el alta creaba restaurantes rotos

Al probar el Demo Bistro, guardar una reserva fallaba. Causa: **el script de
alta olvidaba crear el campo que enlaza cada reserva con su mesa**. Un campo de
enlace necesita el identificador de la tabla destino, que Airtable solo asigna
*después* de crear la base, así que no podía ir en la creación inicial. Se
arregló en el script (segundo paso) y en la base ya creada.

### Tutorial para principiantes

Documento paso a paso para dar de alta restaurantes sin saber programar, y
versión visual en HTML.

---

## Sesión 2026-07-21 · Aislamiento entre restaurantes y despliegue

- Se completó la puesta en producción del sistema multi-restaurante.
- **Corrección**: tocar un registro de otro restaurante devolvía `500` en vez de
  `404`. Estaba bloqueado igualmente, pero el código de estado engañaba. Airtable
  responde `403 INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` sin distinguir «no
  existe» de «no es tuyo» — que es justo lo que interesa.
- **Incidencia externa**: la base original de Airtable empezó a devolver error
  503 en todas sus tablas y tampoco cargaba en la web de Airtable. El usuario la
  duplicó y el sistema se apuntó a la copia (`appbBnqDLwBR1YCMd`), con los datos
  íntegros.

---

## Sesión 2026-07-12 · Panel de staff, carta editable y simulador real

### El panel entra en el sistema

La aplicación «DineControl AI» (antes un repositorio aparte) pasó a vivir dentro
del proyecto y a servirse desde el mismo servidor. Airtable se convirtió en la
única base de datos: el panel dejó de guardar mesas y reservas en el navegador.

El editor del plano persiste de verdad: mover una mesa la guarda (con retardo,
para no escribir en cada píxel del arrastre), y crear o borrar una mesa afecta a
la base.

### Carta editable

La carta pasó de estar escrita en el código a vivir en Airtable, editable desde
el panel. Lo que cambia el equipo, María lo dice por teléfono en menos de un
minuto. Se descubrió que el panel mostraba 10 platos de ejemplo que no tenían
nada que ver con la carta real del restaurante.

### El simulador de llamadas deja de ser un decorado

Antes simulaba una conversación con datos inventados. Ahora **la recepcionista
del simulador es el agente real**: mismas instrucciones, mismas herramientas, y
la reserva se crea de verdad en Airtable. Es una llamada auténtica, pero escrita.

### Auditoría: 8 fallos corregidos

El más grave: la función que libera mesas por retraso **cancelaba en la base de
datos todas las reservas pasadas del día** al abrir el panel por la tarde. Se
acotó a la ventana real de un cliente que no se presenta (entre 15 minutos y 2
horas de retraso).

Otros: notificaciones que podían duplicarse, botón de editar que no respondía en
reservas sin mesa, reservas canceladas que se mostraban como confirmadas, y un
refresco que podía pisarse a sí mismo con la red lenta.

### Plano adaptado a móvil

Las mesas se solapaban en pantallas estrechas. Ahora el plano mantiene sus
proporciones y se desplaza, con un control de zoom del 70 % al 200 %.

---

## Sesión 2026-07-09 · Carta real, flujos idempotentes y prompts

- **Carta real cargada** desde el enlace del restaurante, con los 14 alérgenos
  obligatorios asignados plato a plato (como ejemplo razonado: el restaurante
  debe validarlos).
- **Recordatorios y reseñas idempotentes**: Make dispara cada 15 minutos y nada
  marcaba lo ya enviado — un cliente habría recibido decenas de mensajes al día.
  Se añadieron marcas en la base de datos.
- **Ventanas de recordatorio sin solape**: una reserva a 30 minutos vista recibía
  también el mensaje de «tu reserva de mañana».
- **Las visitas se cuentan al completarse**, no en cada mensaje de WhatsApp (el
  contador se inflaba).
- **Prompts reescritos**: fecha y hora actuales inyectadas (el agente no sabía
  qué día era), confirmación de datos en voz alta antes de reservar, protocolo
  estricto de alérgenos y estilo específico por canal. Turnos de conversación
  afinados para que la voz suene natural.

---

## Sesión 2026-07-08 · Construcción inicial

Punto de partida: un documento de especificación sin código.

- **Backend** en Express compartido por los dos canales (voz y WhatsApp), con
  las mismas 6 herramientas y un único despachador, para que el comportamiento
  sea idéntico venga la reserva de donde venga.
- **Airtable como base de datos real** en lugar de los sistemas de reservas
  comerciales que se habían planteado, sirviendo a la vez de interfaz para el
  equipo.
- **Agente de voz creado** en Vapi con su número de teléfono, probado con una
  llamada real.
- **Automatizaciones** en Make como simple reloj: toda la lógica vive en el
  backend, Make solo dispara la llamada por horario.
- **Fallo encontrado**: la información del cliente no se guardaba al reservar.
  Se corrigió para que toda reserva registre también al cliente.

### Decisiones que siguen vigentes

- Los secretos nunca se escriben en el chat ni en el repositorio.
- El horario de las reservas se guarda como texto `YYYY-MM-DD HH:mm` para evitar
  líos de zona horaria; el orden alfabético coincide con el cronológico.
- El plan gratuito de Make solo permite dos escenarios, así que los
  recordatorios de 24 h y 1 h van fusionados en uno.
