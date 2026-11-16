#!/usr/bin/env node
// Paso del workflow «Publicar evento» (.github/workflows/publish-event.yml, LUM-57): publica el paquete
// que Lumen Studio ha subido a una rama `publish/<eventId>`, con las mismas validaciones que
// `publish.mjs` (lib/publish-core.mjs).
//
// Entrada (variables de entorno, nunca interpoladas en el shell del workflow):
//   PACKAGE_FILE   ruta del paquete descargado de la rama
//   EVENT_ID       id del evento
//   EVENT_META     JSON con el resto de metadatos, con los nombres de las opciones de publish.mjs
//                  ({"start": "...", "end": "...", "title": "...", "lat": 40.4, ...})
//   CATALOG        test | live
//
// Salida: los errores como anotaciones `::error::` (Studio las lee de la ejecución) y, si va bien, el
// resumen del paso y las salidas `package_path`, `catalog_path` y `replaced`.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublishError, publish } from './lib/publish-core.mjs';

// LUMEN_SHOWS_ROOT solo lo usan los tests, para publicar en una copia temporal.
const ROOT = process.env.LUMEN_SHOWS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

/** Las anotaciones no admiten saltos de línea ni `%` sin escapar. */
const escape = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

const fail = (msg) => {
  console.log(`::error title=Publicar evento::${escape(msg)}`);
  process.exit(1);
};

let meta;
try {
  meta = JSON.parse(env.EVENT_META || '{}');
} catch {
  fail('los metadatos del evento no son JSON válido.');
}
if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail('los metadatos del evento deben ser un objeto JSON.');
if ('event-id' in meta) fail('el id del evento va en su propio campo, no en los metadatos.');

let raw;
try {
  raw = readFileSync(env.PACKAGE_FILE ?? '');
} catch {
  fail('no se encuentra el paquete del show en la rama de publicación.');
}

try {
  const result = publish({
    root: ROOT,
    raw,
    meta: { ...meta, 'event-id': env.EVENT_ID },
    catalog: env.CATALOG || 'test',
  });

  for (const w of result.warnings) console.log(`::warning title=Publicar evento::${escape(w)}`);

  if (env.GITHUB_OUTPUT) {
    appendFileSync(
      env.GITHUB_OUTPUT,
      `package_path=${result.packagePath}\ncatalog_path=${result.catalogPath}\nreplaced=${result.replaced}\n`,
    );
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      [
        `### ${result.replaced ? 'Actualizado' : 'Publicado'} \`${result.event.eventId}\` (catálogo ${result.catalog})`,
        '',
        `- Catálogo: \`${result.catalogPath}\``,
        `- Paquete: \`${result.packagePath}\` (${result.event.packageSizeBytes} bytes)`,
        `- Show: \`${result.event.showId}\` ${result.event.version}, hash \`${result.event.packageIntegrityHash}\``,
        '',
      ].join('\n'),
    );
  }
  console.log(`${result.replaced ? 'Actualizado' : 'Publicado'} ${result.event.eventId} → ${result.packagePath}`);
} catch (err) {
  if (err instanceof PublishError) fail(err.message);
  throw err;
}
