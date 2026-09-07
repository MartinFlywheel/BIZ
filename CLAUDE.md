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

# Migraciones SQL — siempre en `supabase/`

**Todo archivo `.sql` de este proyecto vive en `supabase/`, en la raíz del
repo. Sin excepciones y sin subcarpetas.** No los dejes en `scripts/`, ni en
la carpeta temporal, ni pegados solo en el chat: si hay SQL, hay archivo ahí.

Convenciones del archivo:

- **Nombre:** `NNN-descripcion-en-kebab-case.sql`. El `NNN` es el siguiente
  correlativo de tres dígitos — mira el número más alto que ya exista en la
  carpeta y súmale uno. No reutilices ni renumeres los existentes.
- **Idempotente:** `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` antes de `CREATE
  POLICY`. Martín a veces las corre dos veces; la segunda no debe fallar.
- **Encabezado explicando el porqué**, en español neutral: qué problema
  resuelve y qué se decidió y descartó. El resto de la carpeta ya está escrita
  así — sigue ese tono.
- **Funciones:** `SECURITY INVOKER` + `SET search_path = public`, para que las
  políticas RLS se sigan aplicando igual que en las consultas que reemplazan.
  Y `GRANT EXECUTE ... TO authenticated`.

**Nadie las aplica automáticamente.** No hay runner, ni `supabase db push`, ni
paso en el deploy: Martín las pega a mano en el editor SQL de Supabase. Dos
consecuencias que sí son tu responsabilidad:

1. Al terminar una migración, **dile explícitamente que tiene que correrla** y
   pásale el SQL al chat si te lo pide. Si no, el código se despliega contra un
   esquema que no existe.
2. **El código que dependa de una migración debe degradar solo si aún no se
   corrió**, nunca reventar. Es el patrón que ya usa todo el proyecto: revisar
   el código de error de Postgres y caer a la ruta anterior — `42P01`
   (tabla inexistente), `42703` (columna inexistente), o el error de función
   ausente. Ejemplos: `getClientTabCounts` en
   `src/lib/actions/client-tab-counts.ts` y `getCycleProgress` /
   `getSetterGoals` en `src/lib/actions/setter-app.ts`. Desplegar código que
   depende de una migración sin aplicar ya tumbó el CRM una vez.
