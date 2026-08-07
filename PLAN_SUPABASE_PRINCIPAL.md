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

### Pendiente

1. **Cliente de datos de Supabase** con la misma interfaz que `airtableClient`,
   para que los servicios puedan cambiar de base sin reescribirse.
2. **Cambiar los servicios** (`reservations`, `customerMemory`, `menuService`,
   `history`) para que usen Supabase.
3. **Migrar los datos vivos** que hoy solo están en Airtable.
4. **Reinicio diario de mesas** también sobre Supabase (hoy corre en Airtable).
5. **Apagar el conector de Supabase** cuando la app lea directamente: dejaría de
   tener sentido copiar de Supabase a Airtable si Airtable ya no es la base.

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
