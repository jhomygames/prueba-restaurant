# Cómo se sabe de qué restaurante es cada llamada

Cada local tiene su propio asistente de Vapi, con su propio número, y su propio
número de WhatsApp. Cuando entra una llamada o un mensaje, alguien tiene que
decidir en qué restaurante se guarda esa reserva.

## Dónde se decide

En **n8n, al principio de cada workflow**. No en la app: la app ya no está en el
camino de la llamada, solo lee lo que quede escrito en Supabase.

Si n8n no pone el restaurante, la fila cae en el valor por defecto y acaba en el
local equivocado. Por eso este paso es lo primero de cada flujo.

## Cómo se decide

Una función en Supabase, `resolver_restaurante`, traduce lo que trae el aviso al
identificador del local:

```sql
select public.resolver_restaurante(
  p_assistant_id   := 'e05a8f76-...',   -- llamadas de voz
  p_whatsapp_to    := 'whatsapp:+34...', -- mensajes de WhatsApp
  p_telefono_local := '+34911676905'     -- respaldo
);
-- devuelve: 'el-sazon-venezolano'
```

Vive en la base y no en cada workflow **para que la regla esté en un solo
sitio**: si mañana cambia la forma de identificar un local, se cambia aquí y no
en los ocho flujos.

Prioridad, del dato más fiable al más tolerante:

1. **Asistente de Vapi** — identifica el local sin ambigüedad.
2. **Número de WhatsApp** — el número *al que* escribió el cliente.
3. **Teléfono del local** — respaldo si el aviso llegara sin asistente.

Los números se comparan por sus **últimos 9 dígitos**, porque cada proveedor los
manda de una forma: `whatsapp:+34911676905`, `+34 911 67 69 05`, `911676905`.
Comparar el texto tal cual fallaría con casi todos.

**Si no reconoce nada devuelve NULL**, a propósito. Es mejor que n8n vea que no
sabe de quién es la reserva a que la escriba en el local equivocado: lo primero
se detecta, lo segundo no.

## Qué añadir en n8n

Un nodo al principio de cada workflow, antes de escribir nada.

**Para las llamadas de voz** (WF01, WF02, WF05, WF06, WF15), el asistente llega
en el propio aviso de Vapi:

```
POST https://<proyecto>.supabase.co/rest/v1/rpc/resolver_restaurante
{
  "p_assistant_id": "{{ $json.body.message.call.assistantId }}"
}
```

**Para WhatsApp**, lo que distingue un local es el número destino:

```
{
  "p_whatsapp_to": "{{ $json.body.To }}"
}
```

El resultado se guarda y se incluye como `restaurante` en cada `insert` o
`update` sobre `reservas`, `clientes` e `historial_reservas`.

**Conviene cortar el flujo si devuelve NULL**, con un aviso al equipo. Una
reserva sin restaurante es peor que una reserva que no se guarda: la segunda se
nota enseguida, la primera aparece semanas después en el panel de otro local.

## Dar de alta un local nuevo

```sql
insert into public.restaurantes
  (slug, nombre, vapi_assistant_id, vapi_telefono, whatsapp_numero)
values
  ('mi-local', 'Mi Local', '<assistant de su Vapi>', '+34...', '+34...');
```

Y después, el plano y la carta:

```bash
node scripts/alta-restaurante-supabase.js --nombre "Mi Local" --slug mi-local
```

Nada más. No hay que crear bases, ni tablas, ni duplicar workflows: los mismos
ocho flujos sirven para todos los locales, porque el restaurante lo resuelven en
tiempo de ejecución.

## Lo que aún falta

- Rellenar `whatsapp_numero` de cada local (hoy está vacío: aún no se ha
  integrado ese canal).
- Añadir el nodo de resolución a los workflows de n8n.
- La app todavía lee de Airtable; cuando pase a Supabase usará esta misma tabla
  para el login y para saber qué local es cada sesión.
