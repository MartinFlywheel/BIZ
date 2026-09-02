@AGENTS.md

# Idioma — PROHIBIDO el voseo argentino

Todo el texto de este repositorio y de las respuestas sobre él va en **español
neutral**. Martín es chileno. Nunca "vos/tenés/podés/pegá/agregá/avisame".
Siempre "tú/tienes/puedes/pega/agrega/avísame".

Aplica antes de escribir, no como pasada de limpieza posterior. Incluye:
- strings visibles en JSX, placeholders, títulos, `alert`/`confirm`
- mensajes de error devueltos por server actions
- comentarios de código y mensajes de commit
- todas las respuestas de chat, incluidas las frases cortas de cierre

Ya se filtró voseo a producción una vez (corregido en `ff20a79`). Antes de hacer
commit de texto visible, revisa los imperativos terminados en `-á`/`-é`.

Nota: quedan restos de voseo escritos por otros actores (por ejemplo "No podés
eliminar tu propia cuenta" en `src/lib/actions/team.ts`). No los barras sin que
Martín lo pida, pero puedes ofrecerlo.
