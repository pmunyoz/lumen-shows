#!/usr/bin/env node
// Publica un show exportado por Lumen Studio en el catálogo de eventos (v1/events.json).
//
//   node scripts/publish.mjs <show.json> --event-id <id> --start <ISO> --end <ISO>
//        [--title <texto>] [--venue <texto>] [--lat <n> --lon <n>] [--radius <m>]
//        [--notify-hours <h>] [--notify-radius <m>] [--catalog live|test]
//
// --notify-hours y --notify-radius configuran el aviso de descarga de Lumen Mobile: cuántas horas
// antes del inicio se avisa y el radio de la zona del recinto en la que se avisa. Sin ellas, el
// evento se publica sin esos campos y la app usa sus valores por defecto (3 h y 5 km).
//
// --catalog test publica en el catálogo de pruebas (v1/test/), el que usa Lumen Studio mientras la
// suite sea privada (LUM-56). Por defecto, el catálogo real (v1/).
//
// Las validaciones están en lib/publish-core.mjs, compartidas con el workflow «Publicar evento».

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { META_FIELDS, PublishError, publish } from './lib/publish-core.mjs';

// LUMEN_SHOWS_ROOT solo lo usan los tests, para publicar en una copia temporal.
const ROOT = process.env.LUMEN_SHOWS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPTIONS = [...META_FIELDS, 'catalog'];

const fail = (msg) => {
  console.error(`Error: ${msg}`);
  process.exit(1);
};

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined) fail(`argumento no válido: ${rest[i]}`);
    const name = rest[i].slice(2);
    if (!OPTIONS.includes(name)) fail(`opción desconocida: --${name}`);
    opts[name] = rest[i + 1];
  }
  return { file, opts };
}

const { file, opts } = parseArgs(process.argv.slice(2));
if (!file || !existsSync(file)) fail('indica la ruta del show exportado por Studio (.json).');

const { catalog = 'live', ...meta } = opts;

try {
  const result = publish({ root: ROOT, raw: readFileSync(file), meta, catalog });
  for (const w of result.warnings) console.warn(`Aviso: ${w}`);
  console.log(
    `${result.replaced ? 'Actualizado' : 'Publicado'} ${result.event.eventId} → ${result.packagePath} ` +
      `(${result.event.packageSizeBytes} bytes).`,
  );
  console.log('Revisa los cambios y súbelos: git add -A && git commit && git push');
} catch (err) {
  if (err instanceof PublishError) fail(err.message);
  throw err;
}
