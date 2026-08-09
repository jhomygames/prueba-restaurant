# Volver atrás: el agente de voz

Qué hacer si tras conectar el agente de voz a la app algo va mal y hay que
devolver el teléfono a como estaba (atendido por los flujos de n8n).

## Qué se cambió el 2026-08-09

El teléfono **+34911676905** lo atiende el agente **"Lumos Automation Marta (enlazado)"**
(`b82581ed-3c44-4eca-8629-643abdc26e86`). Su guion **no se tocó**: sigue siendo
el mismo que hablan los clientes. Lo único que cambió es a dónde llaman sus
herramientas.

| Herramienta | Antes | Ahora |
|---|---|---|
| checkAvailability | n8n `/check-availability` | app `/vapi/tools` |
| saveReservation | n8n `/save-reservation` | app `/vapi/tools` |
| findReservation | n8n `/buscar-reserva` | app `/vapi/tools` |
| cancelReservation | n8n `/cancel-reservation` | app `/vapi/tools` |
| modifyReservation | **sin destino** (estaba rota) | app `/vapi/tools` |
| buscar_contexto_cliente | n8n `/buscar-contexto-cliente` | app `/vapi/tools` |
| get_whatsapp_context | n8n `/get-whatsapp-context` | app `/vapi/tools` |
| end_call_tool, transfer_call_tool | nativas de Vapi | **sin tocar** |

También en Supabase, tabla `restaurantes`:

- `vapi_assistant_id` pasó de `e05a8f76…` (agente nuestro, sin uso) a
  `b82581ed…` (Marta). Sin esto, la app no sabe de qué restaurante es la
  llamada.
- `vapi_guion_externo = true`, que impide que el panel sobrescriba su guion.

El `server.url` del **número** (`…/webhook/vapi-assistant-request`) se dejó
como estaba a propósito: por ahí le llegan a n8n los avisos de fin de llamada,
y quitarlo podría dejar sin enviar la petición de reseña.

El sufijo **"(enlazado)"** del nombre marca cuál es el agente que atiende de
verdad y ya escribe en la app. Es solo la etiqueta del panel de Vapi: el
cliente nunca la oye. Si algún día se vuelve atrás, quítalo:

```bash
node scripts/vapi-renombrar.js b82581ed-3c44-4eca-8629-643abdc26e86 "Lumos Automation Marta"
```

## Cómo volver atrás

El respaldo está en `respaldos-vapi/` (no se sube a git). Restaura los
assistants y los números tal y como estaban:

```bash
node scripts/vapi-respaldo.js restaurar respaldos-vapi/vapi-el-sazon-venezolano-<fecha>.json
```

Eso devuelve la configuración de los agentes y del número. **Además** hay que
deshacer el cambio de Supabase, porque el respaldo solo cubre Vapi:

```sql
update public.restaurantes
   set vapi_assistant_id = 'e05a8f76-5afa-4daa-b1b0-0b1dd37025c0',
       vapi_guion_externo = false
 where slug = 'el-sazon-venezolano';
```

Aviso: el respaldo restaura los assistants, pero **las herramientas son objetos
aparte** y el script no las cubre. Para devolverlas a n8n hay que editarlas en
dashboard.vapi.ai, o adaptar `scripts/vapi-apuntar-tools.js` cambiando el
destino. Las URLs originales están en la tabla de arriba.

## El secreto de `/vapi/tools`

Las 7 herramientas llevan un secreto compartido (`server.secret`), que Vapi
manda en la cabecera `x-vapi-secret`. La app solo lo exige cuando existe la
variable `VAPI_WEBHOOK_SECRET`; sin ella acepta cualquier llamada.

**El orden importa**: primero el secreto en Vapi, después la variable en el
servidor. Al revés, la app exigiría una cabecera que Vapi todavía no manda y
rechazaría todas las llamadas mientras tanto.

Para rotarlo (o ponerlo en otro agente):

```bash
node scripts/vapi-poner-secreto.js <assistantId> --aplicar
```

Comprobar si está activo: `/health` → `vapiToolsProtegido: true`.

## Cómo comprobar que sigue bien

```bash
node scripts/vapi-ver-tools.js b82581ed-3c44-4eca-8629-643abdc26e86
node scripts/test-dialecto-marta.js
```

El segundo crea una reserva de prueba contra la base real y la anula al
terminar. Si algo falla, dice qué campo concreto no llega como el guion espera.

La señal de que una reserva entró **por la app** y no por n8n: tiene `mesa_id`
y `origen = 'voz'`. Las que escribía n8n llegaban sin mesa y sin origen.
