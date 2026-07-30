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
