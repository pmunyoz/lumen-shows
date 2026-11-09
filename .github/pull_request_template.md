<!--
Título del PR: LUM-123 Descripción breve
Rama: feat/LUM-123-descripcion · fix/LUM-123-descripcion
Orden en la suite: contrato → Mobile → Studio → Shows (el consumidor del formato va antes que el productor).
-->

## Jira

LUM-

## Qué cambia y por qué

## Cómo probarlo

## ¿Afecta a un contrato de la suite?

- [ ] No
- [ ] Sí → indica cuál y la versión nueva:
  - [ ] Formato de show (`show.lumen`)
  - [ ] Formato de recinto (`.lumenvenue`)
  - [ ] Catálogo de eventos (`v1/events.json`)
  - [ ] Fórmulas de efectos / vectores de paridad (`parity/`)

Si es que sí:

- [ ] La página del contrato y la matriz de compatibilidad en Confluence están actualizadas
- [ ] Hay una incidencia enlazada en cada app afectada (`blocks` / `is blocked by`)
- [ ] Se siguen aceptando las versiones anteriores del formato, o el corte está documentado
- [ ] La app que consume el formato ya está fusionada (o este PR es esa app)

## Comprobaciones

- [ ] El paquete se publicó con `node scripts/publish.mjs` (no editado a mano)
- [ ] La versión de Lumen Mobile que necesita el show ya está disponible para el público
- [ ] La clave de Jira está en la rama, los commits y el título
