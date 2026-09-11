# API del agente (`/api/agent/v1/*`)

Puerta para que un sistema externo (el agente de WhatsApp) cree y consulte
leads del CRM. Cada llamada va con una llave por cliente.

## Autenticación

Cabecera en todas las llamadas:

```
Authorization: Bearer bzk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

La llave determina el cliente: no hay que mandar `client_id`. Para crear
una llave, en el editor SQL de Supabase (requiere la migración 060):

```sql
SELECT crear_api_key_cliente('<uuid del cliente>', 'agente whatsapp');
```

Devuelve el texto de la llave una única vez. Para anularla:

```sql
SELECT revocar_api_key_cliente('<id de la llave>');
```

Respuestas de error comunes: `401` llave ausente, inválida o revocada;
`503` la migración 060 no se ha corrido.

## Teléfonos

Todas las rutas identifican a la persona por `phone`. Se acepta en
cualquier formato (`+56 9 1234 5678`, `912345678`, `56912345678`) y se
normaliza a E.164. Sin código de país se asume Chile. En la ruta GET, el
`+` va codificado como `%2B`.

## Rutas

Cada llave acepta hasta 120 llamadas por minuto. Pasado el límite responde
`429` hasta que pase el minuto.

### `POST /api/agent/v1/leads/search`

```json
{ "phone": "+56912345678" }
```

Busca a la persona. Es la forma recomendada, porque el teléfono va en el
cuerpo y no queda en los registros de acceso. También existe
`GET /api/agent/v1/leads?phone=%2B56912345678` con la misma respuesta.
Siempre responde `200`:

```json
{ "found": false, "telefono": "+56912345678" }
```

```json
{
  "found": true,
  "lead": {
    "id": "…",
    "nombre": "Ana Pérez",
    "telefono": "+56912345678",
    "instagram": "anaperez",
    "etapa": "calendly_enviado",
    "etapa_nombre": "Calendly Enviado",
    "etiquetas": ["Calendly Enviado"],
    "setter": "Camila",
    "agenda": { "fecha": "2026-09-15T15:00:00+00:00", "estado": "Pendiente" },
    "creado_en": "2026-09-11T14:02:11+00:00"
  }
}
```

El agente nunca recibe notas internas, correo ni valor de cierre. De la
persona que atiende (`setter`) solo llega el primer nombre, porque el agente
puede decírselo al contacto.

### `POST /api/agent/v1/leads`

Crea o completa a la persona.

```json
{
  "phone": "+56912345678",
  "full_name": "Ana Pérez",
  "ig_username": "@anaperez",
  "email": "ana@x.cl",
  "source": "whatsapp",
  "referral": { "source_id": "120211...", "headline": "Yoga facial", "source_type": "ad" }
}
```

`referral` es opcional: los datos del anuncio que originó el contacto, tal
como los entrega WhatsApp. Se guarda al crear la persona o si no tenía uno.
Requiere la migración 065; sin ella el lead se crea igual, sin ese dato.

- Si existe por teléfono, o por Instagram, completa los datos que falten.
  Nunca pisa un dato existente con otro.
- Si no existe, la crea en la primera etapa del cliente y responde `201`.
- Respuesta: `{ "created": true|false, "lead": { … } }`.

### `POST /api/agent/v1/leads/qualify`

Marca como lead calificado. Equivale al nodo "lead-calificado" de ManyChat:
asigna un setter con el reparto balanceado si no tiene, y registra la
interacción que el CRM usa para mostrar el lead al setter correcto.

```json
{ "phone": "+56912345678", "answers": { "Facturación": "5M", "Rubro": "Clínica" } }
```

Respuesta: `{ "qualified": true, "setter_asignado_ahora": true, "sin_setters_disponibles": false, "lead": { … } }`.
Llamarla dos veces no duplica nada. Responde `404` si la persona no existe.

### `POST /api/agent/v1/leads/stage`

Cambia la etapa. Solo acepta las etapas del cliente que el agente tiene
permitido poner, por id o por nombre: `nuevo_contacto`, `seguimiento`,
`conversando`, `micro_vsl_enviado`, `vsl_chat`, `pitcheado`,
`calendly_enviado`, `seguimiento_1`, `seguimiento_2`, `propuesta_enviada` y
`no_calificado`. Quedan fuera `agendado`, que la pone sola la lectura de
Calendly, y `cierre`, que decide el closer.

```json
{ "phone": "+56912345678", "stage": "calendly_enviado" }
```

Respuesta: `{ "etapa_anterior": "conversando", "lead": { … } }`. Con una
etapa desconocida responde `422` y la lista `etapas_validas`.

### `POST /api/agent/v1/leads/tags`

Pone o quita etiquetas, las mismas que usan los setters en el CRM.

```json
{ "phone": "+56912345678", "add": ["Calendly Enviado"], "remove": ["Seguimiento 1"] }
```

Con una etiqueta desconocida responde `422` y la lista `etiquetas_validas`.

## Calendly

La cita se asocia al lead por teléfono. Para eso el tipo de evento en
Calendly debe tener una pregunta cuyo texto contenga "teléfono", "celular",
"WhatsApp" o "phone", y el enlace que manda el agente debe prellenarla:

```
https://calendly.com/<cuenta>/<evento>?name=Ana%20P%C3%A9rez&a1=%2B56912345678
```

`a1` es la primera pregunta personalizada del evento. Si el teléfono es la
segunda, usar `a2`, y así.

## Auditoría

Cada llamada queda en `webhook_logs` con `source = 'agent'` y
`event_type = 'agent:<acción>'`. Los leads creados por el agente llevan
`first_touch_type = 'agent:<source>'`, que además los protege de la
limpieza nocturna de leads sin actividad.
