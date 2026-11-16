# Lumen Shows

Catálogo público de eventos de Lumen, servido con GitHub Pages en
`https://pmunyoz.github.io/lumen-shows/v1/`. Lumen Mobile descarga `events.json` y, antes del
concierto, el paquete del show, que guarda en el móvil para funcionar sin red en el recinto.

> Todo lo que se publica aquí es público: cualquiera puede descargar el timeline de un show.

## Estructura

| Ruta | Contenido |
|---|---|
| `v1/events.json` | Catálogo: lista de eventos con horario, recinto y paquete |
| `v1/shows/<showId>-<hash12>.json` | Paquetes exportados por Lumen Studio, sin modificar e inmutables |
| `v1/test/` | Catálogo de pruebas (mismo formato): lo que publica Lumen Studio mientras la suite sea privada. Solo lo lee Lumen Mobile en desarrollo |
| `scripts/publish.mjs` | Publica un export de Studio y actualiza el catálogo |
| `scripts/lib/publish-core.mjs` | Validaciones y escritura del catálogo, comunes a `publish.mjs` y al workflow |
| `.github/workflows/publish-event.yml` | Workflow «Publicar evento»: publica sin clonar el repositorio |

## Publicar un evento

```bash
node scripts/publish.mjs ruta/al/show.json \
  --event-id pabellon-2026-12-01 \
  --start 2026-12-01T19:00:00Z --end 2026-12-01T23:59:00Z \
  [--title "Gira 2026"] [--venue "Pabellón"] [--lat 40.4 --lon -3.7 --radius 1000] \
  [--notify-hours 3 --notify-radius 5000] [--catalog test]
git add -A && git commit -m "Publicar pabellon-2026-12-01" && git push
```

El script comprueba el `integrityHash`, la versión (2.x), el tamaño (≤ 5 MB) y el número de syncs
(1-5). Volver a publicar el mismo `eventId` sustituye su entrada. Los paquetes antiguos se conservan
porque puede haber móviles que ya los tengan descargados.

`--notify-hours` y `--notify-radius` configuran el aviso de Lumen Mobile para descargar el show
antes del concierto: desde cuántas horas antes del inicio (0,5–24) y en qué radio alrededor del
recinto en metros (500–50.000). Son opcionales; sin ellas la app usa 3 horas y 5 km. El radio
solo tiene efecto si el evento lleva `--lat` y `--lon`: sin coordenadas, la app avisa solo por hora.
Una opción desconocida o mal escrita hace fallar el script en lugar de ignorarse.

`--catalog test` publica en el catálogo de pruebas (`v1/test/`); sin ella, en el real (`v1/`).

## Publicar sin clonar: workflow «Publicar evento»

Lumen Studio publica con el workflow [`publish-event.yml`](.github/workflows/publish-event.yml)
(LUM-57), que también se puede lanzar a mano desde **Actions**:

1. Sube el paquete del show, sin modificar, a `incoming/show.json` de una rama `publish/<eventId>`.
2. Lanza el workflow con `event_id`, `catalog` (`test` o `live`), `event` (los metadatos en JSON,
   con los nombres de las opciones de `publish.mjs`: `{"start": "…", "end": "…", "lat": 40.4, …}`),
   `branch` y, opcional, `request_id` (aparece en el nombre de la ejecución).
3. El workflow valida igual que `publish.mjs`, hace commit del catálogo en `main` y borra la rama. Si
   algo no es válido no toca el catálogo, y el motivo queda como anotación de error de la ejecución.

Hace falta permiso de escritura en el repositorio: Studio usa un token *fine-grained* con
**Contents** y **Actions** de lectura y escritura solo sobre `lumen-shows`. Mientras la suite sea
privada, Studio publica en el catálogo de pruebas.

## Tests

```bash
npm test
```

## Formato de `events.json` (v1)

```json
{
  "format": "lumen-events",
  "version": 1,
  "updatedAt": "2026-11-06T10:00:00.000Z",
  "events": [{
    "eventId": "pabellon-2026-12-01",
    "showId": "show_de_demostraci_n",
    "version": "2.1.0",
    "title": "Show de demostración",
    "venueName": "Pabellón",
    "packageUrl": "shows/show_de_demostraci_n-1a2b3c4d5e6f.json",
    "packageIntegrityHash": "…",
    "packageSizeBytes": 1105023,
    "startAtUtc": "2026-12-01T19:00:00.000Z",
    "endAtUtc": "2026-12-01T23:59:00.000Z"
  }]
}
```

`packageUrl` es relativa a `events.json`. Campos opcionales:

| Campo | Opción de `publish.mjs` | Significado |
|---|---|---|
| `venueLatitude`, `venueLongitude` | `--lat`, `--lon` | Coordenadas del recinto |
| `geofenceRadiusMeters` | `--radius` (por defecto 1000) | Radio en el que la app activa el show en el recinto |
| `reminderHoursBefore` | `--notify-hours` | Horas antes de `startAtUtc` desde las que se avisa para descargar (la app usa 3 si falta) |
| `reminderRadiusMeters` | `--notify-radius` | Radio en metros de la zona del aviso, independiente de `geofenceRadiusMeters` (la app usa 5000 si falta) |

## Límites de GitHub Pages

Repositorio de hasta 1 GB y unos 100 GB de tráfico al mes (orientativo). Los paquetes se sirven
comprimidos con gzip: un show de 1,1 MB se transfiere en unos 350 KB, así que un evento de 50.000
personas consume unos 17 GB. Para más volumen, los mismos ficheros sirven en Cloudflare Pages.
