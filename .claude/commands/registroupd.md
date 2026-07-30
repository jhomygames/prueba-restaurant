---
description: Actualiza REGISTRO_DE_CAMBIOS.md con el trabajo de esta sesión
---

Actualiza `REGISTRO_DE_CAMBIOS.md` con lo trabajado en esta sesión.

## Antes de escribir

Reúne los hechos en vez de reconstruirlos de memoria:

1. `git log --oneline main..HEAD` y `git status --short` — qué cambió de verdad.
2. `git branch --show-current` — dónde vive el trabajo.
3. Repasa la conversación buscando: qué se verificó y **cómo**, qué falló por el
   camino, y qué decisiones se tomaron con su porqué.

Si el argumento `$ARGUMENTS` trae contexto extra (un tema concreto, una sesión
antigua que faltaba), tenlo en cuenta.

## Dónde va

Un bloque nuevo **al principio**, justo debajo del separador `---` que cierra
el índice del sistema, antes de la sesión más reciente. El orden es del más
nuevo al más viejo.

Si ya existe un bloque de hoy, **amplíalo** en vez de crear otro. Si dentro del
mismo día hay fases muy distintas, distínguelas: `## Sesión 2026-07-27 (tarde)`.

## Qué contar

```markdown
## Sesión AAAA-MM-DD · Título corto de lo que se hizo

Una o dos frases situando el objetivo de la sesión.

### Subtítulos por bloque de trabajo

Qué se construyó y, cuando la decisión no sea evidente, POR QUÉ se hizo así.

### Verificado

Qué se comprobó y cómo. No "funciona", sino qué prueba se corrió y qué demostró.

### Estado

Commit y rama. Si está desplegado o no, y qué queda pendiente.
```

## Reglas

- **Los fallos se registran aunque estén corregidos**, incluidos los míos. El
  valor del documento está en poder mirar atrás y entender por qué el código es
  como es; un registro que solo cuenta aciertos no sirve para eso.
- **Distingue lo verificado de lo asumido.** Si algo no se llegó a probar, dilo.
- **Explica el porqué de las decisiones**, no solo el qué. El "qué" ya está en
  el código; el "por qué" solo está aquí.
- **Escribe para alguien que no estuvo.** Sin jerga interna ni referencias a
  "lo que hablamos antes".
- **Actualiza también el índice de arriba** (estructura de archivos, ramas) si
  la sesión añadió módulos, scripts o ramas nuevas.
- No copies el diff. Esto es el relato, no el código.

## Al terminar

Commitea solo el registro, con un mensaje del estilo
`Registro: <tema de la sesión>`. Si hay más cambios sin commitear, pregunta
antes de incluirlos: puede que estén a medias a propósito.
