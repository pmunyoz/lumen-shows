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
| `scripts/publish.mjs` | Publica un export de Studio y actualiza el catálogo |

## Publicar un evento

```bash
node scripts/publish.mjs ruta/al/show.json \
  --event-id pabellon-2026-12-01 \
  --start 2026-12-01T19:00:00Z --end 2026-12-01T23:59:00Z \
  [--title "Gira 2026"] [--venue "Pabellón"] [--lat 40.4 --lon -3.7 --radius 1000]
git add -A && git commit -m "Publicar pabellon-2026-12-01" && git push
```

El script comprueba el `integrityHash`, la versión (2.x), el tamaño (≤ 5 MB) y el número de syncs
(1-5). Volver a publicar el mismo `eventId` sustituye su entrada. Los paquetes antiguos se conservan
porque puede haber móviles que ya los tengan descargados.

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

`packageUrl` es relativa a `events.json`. `venueLatitude`, `venueLongitude` y `geofenceRadiusMeters`
son opcionales.

## Límites de GitHub Pages

Repositorio de hasta 1 GB y unos 100 GB de tráfico al mes (orientativo). Los paquetes se sirven
comprimidos con gzip: un show de 1,1 MB se transfiere en unos 350 KB, así que un evento de 50.000
personas consume unos 17 GB. Para más volumen, los mismos ficheros sirven en Cloudflare Pages.
