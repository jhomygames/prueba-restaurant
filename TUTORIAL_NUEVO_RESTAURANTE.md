# Cómo dar de alta un restaurante nuevo (guía para principiantes)

Esta guía te lleva de la mano para añadir un restaurante al sistema. No hace
falta saber programar: solo copiar y pegar un par de comandos y luego rellenar
un formulario en la web.

Cada restaurante que añades queda **totalmente separado** de los demás: sus
mesas, reservas, clientes y carta son suyos, y el dueño entra con su propio
usuario y contraseña.

---

## Antes de empezar (solo la primera vez)

Necesitas tener el proyecto en tu ordenador y abierto en una "terminal" (la
ventana negra donde se escriben comandos). Si ya has ejecutado comandos antes en
esta carpeta, salta este apartado.

1. Abre la carpeta del proyecto:
   `C:\Users\jhoma\Documents\Claude\Agent restaurant Antony project`
2. Abre una terminal ahí. En Windows: escribe `cmd` en la barra de direcciones
   del explorador de archivos (donde pone la ruta de la carpeta) y pulsa Enter.
3. Comprueba que el archivo `.env` existe en esa carpeta. Es el que guarda las
   llaves de acceso a Airtable. Si no está, el sistema no sabrá dónde crear las
   cosas — avísame y lo revisamos.

> **Qué es cada cosa, en simple:**
> - **Airtable** = el "Excel en la nube" donde se guardan mesas, reservas y carta.
> - **El Registro** = una libreta central que apunta qué restaurantes existen.
> - **Vapi** = el servicio que pone la voz al teléfono (la recepcionista María).
> - **Twilio** = el servicio que envía y recibe los WhatsApp.

---

## Paso 1 — Crear el restaurante (1 comando)

En la terminal, dentro de la carpeta del proyecto, escribe este comando
cambiando el nombre y el email por los del restaurante real:

```bash
node scripts/provision-restaurant.js --nombre "La Tasca de Ana" --email ana@latasca.com
```

- `--nombre` → el nombre del restaurante tal cual quieres que suene (María lo
  dirá al contestar el teléfono). Va **entre comillas**.
- `--email` → el correo del dueño o encargado. Será su usuario para entrar al
  panel.

Al pulsar Enter, el sistema hace todo el trabajo pesado solo (tarda ~30 segundos):
crea su base de datos, le pone 15 mesas de ejemplo, le copia una carta de
ejemplo, y crea su usuario de acceso.

Cuando termina, verás algo así:

```
Restaurante dado de alta:
  Nombre: La Tasca de Ana
  Slug:   la-tasca-de-ana
  Base:   appXXXXXXXXXXXXXX
  Admin:  ana@latasca.com

La contraseña temporal se añadió a CREDENCIALES_INICIALES.txt
```

### Opciones útiles

- Si el restaurante prefiere **empezar con la carta vacía** (para escribirla él
  desde cero), añade `--sin-carta` al final:
  ```bash
  node scripts/provision-restaurant.js --nombre "La Tasca de Ana" --email ana@latasca.com --sin-carta
  ```

---

## Paso 2 — Coger la contraseña de acceso

El comando anterior guardó la contraseña en un archivo llamado
**`CREDENCIALES_INICIALES.txt`**, dentro de la carpeta del proyecto. Ábrelo con
el Bloc de notas y busca el bloque del restaurante que acabas de crear:

```
--- La Tasca de Ana (la-tasca-de-ana) ---
Email:      ana@latasca.com
Contraseña: aB3xK9mP2qR
```

Ese email y esa contraseña son las que le das al dueño del restaurante.

> ⚠️ **Importante sobre seguridad:**
> - Esa contraseña es **temporal**. Dile al dueño que la cambie al entrar
>   (Paso 4), y que no la comparta.
> - Ese archivo `.txt` no se sube a internet (está protegido), pero conviene
>   **borrarlo** una vez le has pasado la contraseña al dueño.

---

## Paso 3 — Entrar al panel

El dueño (o tú, para probar) abre la dirección del panel en el navegador:

**https://prueba-restaurant-production.up.railway.app**

Aparece una pantalla de inicio de sesión. Escribe el **email** y la
**contraseña** del Paso 2 y pulsa **Entrar**.

Ya dentro, verás el nombre del restaurante arriba a la izquierda, su plano de
mesas, el calendario, la carta y la pestaña **Configuración**. Todo lo que veas
es de ese restaurante y de nadie más.

---

## Paso 4 — Cambiar la contraseña (recomendado)

1. Arriba, pulsa la pestaña **Configuración**.
2. Baja hasta la última tarjeta, **Cuenta**.
3. Escribe la contraseña temporal en "Contraseña actual" y la nueva (mínimo 8
   caracteres) en "Contraseña nueva". Pulsa **Cambiar contraseña**.

---

## Paso 5 — Ajustar los datos del restaurante

En la pestaña **Configuración**, la primera tarjeta (**Restaurante**) permite:

- **Nombre**: cómo se llama el local. Es lo que dice María por teléfono.
- **URL de reseñas de Google**: el enlace donde los clientes dejan su reseña
  (se les envía tras la visita). Es opcional.
- **WhatsApp del encargado**: el número que recibe un aviso cuando el agente
  necesita pasar la llamada a una persona. Opcional.

Cambia lo que quieras y pulsa **Guardar cambios**.

---

## Paso 6 — Conectar el teléfono con voz (Vapi) — opcional

Esto le da al restaurante su **recepcionista telefónica 24/7**. Si de momento no
lo necesita, sáltalo: el resto funciona igual.

En la tarjeta **Agente de Voz (Vapi)**:

1. Si el restaurante tiene su propia cuenta de Vapi, pega su **API key** en el
   campo y pulsa **Guardar key**. (Si no, se usa la cuenta central; pregúntame
   si dudas.)
2. Pulsa **Crear agente de voz**. El sistema crea la recepcionista con el nombre
   del restaurante y, si la cuenta lo permite, le asigna un número de teléfono.
3. Cuando termine, verás el teléfono del restaurante en grande. Ese es el número
   al que llamarán los clientes.

> Si sale un aviso de "número pendiente", significa que la cuenta de Vapi no dio
> un número automático. El agente está creado; solo falta asignarle un número
> desde la web de Vapi (dashboard.vapi.ai). Avísame y te ayudo.

Los otros botones:
- **Sincronizar instrucciones**: úsalo si cambias el nombre del restaurante, para
  que María lo diga actualizado.
- **Probar conexión**: comprueba que todo está bien enlazado.

---

## Paso 7 — Conectar WhatsApp (Twilio) — opcional

Esto permite recibir reservas y enviar recordatorios por WhatsApp.

En la tarjeta **WhatsApp (Twilio)**:

1. Rellena **Account SID**, **Auth Token** y **Número emisor** con los datos de
   la cuenta de Twilio del restaurante.
2. Pulsa **Guardar y validar**. El sistema comprueba con Twilio que las claves
   son correctas *antes* de guardarlas: si están mal, te avisa.
3. Copia la **URL del webhook** (el botón de copiar al lado) y pégala en la
   configuración de Twilio del restaurante, en el apartado
   *Messaging → When a message comes in*. Esa URL es la misma para todos los
   locales: el sistema sabe distinguir cada restaurante por su número.
4. Para probar, escribe un número en "Enviar mensaje de prueba a" y pulsa
   **Enviar prueba**.

> Tus claves de Twilio se guardan **cifradas**: ni siquiera aparecen en pantalla
> una vez guardadas (solo se ven unos puntos). Nadie puede leerlas.

---

## Paso 8 — Personalizar la carta

En la pestaña **Ver Carta**, pulsa **Editar carta**. Desde ahí puedes:

- **Añadir plato**: nombre, precio, categoría, alérgenos, etc.
- **Editar** o **eliminar** cualquier plato.
- Marcar un plato como **no disponible**: desaparece para el cliente y para el
  agente, pero sigues viéndolo en modo edición.

Todo lo que cambies aquí, María lo sabe por teléfono en menos de un minuto.

---

## ¡Listo!

El restaurante ya está funcionando: tiene su panel, su plano de mesas, su carta,
y (si lo configuraste) su teléfono y su WhatsApp. Repite el Paso 1 con otros
datos para añadir tantos restaurantes como quieras.

---

## Preguntas frecuentes

**¿Puedo tener varios restaurantes abiertos a la vez en el mismo navegador?**
Sí, pero en el mismo navegador solo hay una sesión activa. Si quieres ver dos a
la vez, abre uno en una ventana normal y otro en una ventana de incógnito.

**Me equivoqué en el nombre / email al crear el restaurante.**
El nombre se cambia en la pestaña Configuración (Paso 5). El email de acceso no
se cambia solo desde el panel; avísame y lo corrijo en el Registro.

**Quiero "borrar" un restaurante.**
No se recomienda borrar la base de datos (es irreversible). Lo correcto es
marcarlo como **inactivo** en el Registro: deja de recibir recordatorios y de
poder entrar, pero sus datos quedan guardados por si vuelve. Pídemelo y lo hago.

**El dueño olvidó su contraseña.**
Se le puede restablecer. Avísame y genero una nueva contraseña temporal para él.

**¿Necesito una cuenta de Vapi y otra de Twilio por cada restaurante?**
No es obligatorio. Si un local no pone las suyas, usa las cuentas centrales del
sistema. Poner las propias sirve cuando el restaurante quiere su propio número o
llevar su propio gasto por separado.
