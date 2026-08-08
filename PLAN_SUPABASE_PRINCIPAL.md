# Supabase como base principal

Objetivo: que Supabase sustituya a Airtable como base de datos de la app,
manteniendo la estructura que la app necesita para funcionar.

## Arquitectura de destino

```
Cliente ──llama──► Vapi ──► n8n ──┐
        ──WhatsApp─────────► n8n ─┤
                                  ├──► Supabase ◄──── la app (lee y escribe)
        notificaciones ◄─── n8n ◄─┘
```

La app **no** recibe llamadas ni WhatsApp: eso sigue en n8n, igual que ahora.
Las notificaciones (confirmación, recordatorios, reseña) también siguen en n8n.
Lo único que cambia es de dónde lee y dónde escribe la app.

### Quién escribe la reserva: decisión pendiente

Hay dos formas de que la reserva llegue a Supabase, y no son equivalentes:

**A. n8n escribe directamente en Supabase** (como hacían los workflows
originales). Es el camino más corto, pero n8n tendría que asumir lo que hoy
hace la app al crear una reserva: **asignar mesa** mirando cuáles están libres a
esa hora, **extraer los alérgenos** del texto libre, **generar el código**
`RES-…` y **detectar duplicados** del mismo cliente y turno. Reimplementar eso
en nodos de n8n es mucho trabajo y quedaría duplicado.

**B. n8n llama a la app y la app escribe en Supabase** (como está cableado
ahora). Un salto más, pero toda esa lógica sigue viviendo en un solo sitio y ya
está probada. Supabase sigue siendo la única fuente de verdad; lo único que
cambia respecto a hoy es que la app escribe ahí en vez de en Airtable.

**Recomendación: B.** El coste de A no es el rodeo que se ahorra, sino perder o
duplicar cuatro comportamientos que ya funcionan. Con B, el trabajo que queda es
solo cambiar de base la capa de datos de la app — nada de tocar los ocho flujos.

## Estado

### Hecho — esquema y datos en Supabase

Migración `estructura_app_mesas_carta_y_campos_reservas`. Todo **aditivo**: no
se modificó ni se borró nada de lo que usan los flujos de n8n, así que estos
siguieron funcionando durante el cambio.

| Tabla | Qué se hizo |
|---|---|
| `mesas` | **Nueva.** 17 mesas del plano, con posición, forma, zona y capacidad |
| `carta` | **Nueva.** 38 platos con sus alérgenos, precio y categoría |
| `reservas` | + `mesa_id`, `origen`, `external_id`, `alergias`, `duracion_min`, `sentada_at`, `resena_pedida`, `restaurante` |
| `clientes` | + `alergenos_conocidos`, `preferencias`, `ultima_visita`, `restaurante` |

Decisiones que conviene recordar:

- **`restaurante` está en todas las tablas desde el principio**, aunque hoy solo
  haya un local. Añadirla ahora es gratis; hacerlo cuando ya hay datos en uso
  obliga a una migración incómoda.
- **`mesas.estado` describe el servicio en curso, no el calendario.** Es el
  mismo criterio que se corrigió en Airtable: una mesa ocupada el martes no lo
  está el jueves. Se reinicia a diario y solo "Fuera de servicio" es permanente.
- **Las tablas nuevas nacen con protección de filas activada**, como las que ya
  existían. Sin políticas, solo las claves de servicio leen — que es lo que usan
  la app y n8n. La clave pública no ve nada, y eso es lo correcto tratándose de
  nombres y teléfonos.
- Los índices creados responden a las dos consultas reales: el panel pide "las
  reservas de este día" y el agente "las de este día y turno".

### Hecho — acceso a datos

- **`supabaseClient.js`**: el cliente. El restaurante es el primer argumento y
  es obligatorio, igual que lo era `baseId`. Sin él la llamada falla en el acto,
  porque Supabase no se queja de una consulta sin filtrar: devuelve las filas de
  todos los locales, que es el fallo más caro posible aquí. Las escrituras
  filtran por restaurante **además** del id, así que un id de otro local no
  modifica nada.
- **`repo/reservas.js`**: la capa de lectura. Devuelve exactamente las mismas
  formas que hoy produce Airtable, que es lo que permite migrar por partes.
- **`restaurantes` y `usuarios`**: el directorio de locales y sus accesos.
- **`resolver_restaurante()`**: traduce assistant de Vapi, número de WhatsApp o
  teléfono del local a su slug. Ver `IDENTIFICAR_RESTAURANTE.md`.
- **`scripts/alta-restaurante-supabase.js`**: alta de un local en segundos,
  copiando plano y carta de una plantilla. Sin crear bases.

### Pendiente

1. **Escritura**: `crearReserva`, `modificarReserva`, `cancelarReserva`,
   `upsertCliente` sobre Supabase, con la misma lógica que hoy (asignación de
   mesa, alérgenos, código, anti-duplicados).
2. **Cambiar los servicios** (`reservations`, `customerMemory`, `menuService`,
   `history`, `registry`) para que usen la capa nueva.
3. **Login contra `usuarios`** en vez de la base Registro de Airtable.
4. **Migrar los datos vivos** que hoy solo están en Airtable.
5. **Reinicio diario de mesas** también sobre Supabase.
6. **Apagar el conector de Supabase**: copiar de Supabase a Airtable deja de
   tener sentido cuando Airtable ya no es la base.

### Riesgo a vigilar

Mientras convivan las dos bases hay **dos fuentes de verdad**. El orden de la
migración importa: primero lectura desde Supabase, comprobar que el panel
muestra lo mismo, y solo entonces mover la escritura. Hacerlo al revés dejaría
reservas escritas en un sitio y leídas del otro.

## Pendiente de decisión del usuario

`whatsapp_chat_historial` sigue **sin protección de filas**: 46 conversaciones
legibles por cualquiera con la clave pública. Activarla sin definir políticas
bloquearía todos los accesos y rompería el flujo de WhatsApp, así que la
decisión es suya:

```sql
alter table public.whatsapp_chat_historial enable row level security;
```
