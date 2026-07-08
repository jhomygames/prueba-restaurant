# Blueprints de Make.com

Estos JSON son el export real de los dos escenarios ya creados en la cuenta de
Make del usuario (verificado vía API el 2026-07-08):

| Escenario | ID | Archivo | Estado |
|---|---|---|---|
| Recordatorios reservas (24h + 1h) | `6492914` | `recordatorios-fusionado.json` | Creado, desactivado, scheduling `on-demand` |
| Solicitud de reseña Google | `6492919` | `solicitud-resena.json` | Creado, desactivado, scheduling `on-demand` |

No hace falta importarlos de nuevo si ya existen en la cuenta — estos archivos
son solo respaldo/documentación. Si se necesitara recrearlos en otra cuenta:
Make > Scenarios > Create new > Import Blueprint > pegar el JSON.

## Activación (pendiente, requiere el backend desplegado)

Para cada uno de los 2 escenarios:

1. Editar el módulo HTTP y reemplazar:
   - `https://TU_BACKEND_URL/internal/reminders/run` (o `/internal/reviews/run`)
     por la URL pública real del backend (Railway/Render).
   - `PEGA_AQUI_TU_INTERNAL_JOBS_SECRET` por el valor real de
     `INTERNAL_JOBS_SECRET` configurado en el backend.
2. Cambiar el scheduling de `on-demand` a "regular interval", **mínimo 15
   minutos** (límite del plan Free de Make, que solo permite 2 escenarios
   simultáneos — por eso los recordatorios de 24h y 1h están fusionados en un
   solo escenario que revisa ambas ventanas en cada ejecución).
3. Activar el escenario (`isActive: true`).

Este paso requiere tener ya la URL pública del backend, así que depende de
completar el despliegue (punto 1 del CLAUDE.md).
