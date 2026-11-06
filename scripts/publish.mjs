#!/usr/bin/env node
// Publica un show exportado por Lumen Studio en el catálogo de eventos (v1/events.json).
//
//   node scripts/publish.mjs <show.json> --event-id <id> --start <ISO> --end <ISO>
//        [--title <texto>] [--venue <texto>] [--lat <n> --lon <n>] [--radius <m>]
//
// El paquete se copia sin modificar a v1/shows/<showId>-<hash12>.json: el nombre cambia con el
// contenido, así que ninguna caché sirve una versión antigua. Los paquetes anteriores no se borran
// (puede haber móviles que ya los tengan descargados).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'v1', 'events.json');
const SHOWS_DIR = join(ROOT, 'v1', 'shows');
const MAX_PACKAGE_BYTES = 5 * 1024 * 1024; // = SecurityConstants.maxShowPackageSizeBytes de la app
const SYNC_HZ = [18500, 19000, 19500, 18200, 17800]; // = SYNC_HZ de lumen-studio/src/app/core/cues.ts
const EVENT_ID_RX = /^[a-z0-9][a-z0-9-]{2,63}$/;

const fail = (msg) => {
  console.error(`Error: ${msg}`);
  process.exit(1);
};

function parseArgs(argv) {
  const [file, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined) fail(`argumento no válido: ${rest[i]}`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  return { file, opts };
}

const isoDate = (value, name) => {
  const d = new Date(value ?? '');
  if (Number.isNaN(d.getTime())) fail(`--${name} debe ser una fecha ISO 8601 (p. ej. 2026-12-01T19:00:00Z).`);
  return d.toISOString();
};

const num = (value, name) => {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`--${name} debe ser un número.`);
  return n;
};

const { file, opts } = parseArgs(process.argv.slice(2));
if (!file || !existsSync(file)) fail('indica la ruta del show exportado por Studio (.json).');
if (!EVENT_ID_RX.test(opts['event-id'] ?? '')) fail('--event-id: minúsculas, números y guiones (3-64).');

const raw = readFileSync(file);
if (raw.length > MAX_PACKAGE_BYTES) fail(`el paquete ocupa ${raw.length} bytes (máximo ${MAX_PACKAGE_BYTES}).`);

let show;
try {
  show = JSON.parse(raw.toString('utf8'));
} catch {
  fail('el fichero no es JSON válido.');
}

// Mismo cálculo que Studio (showDocument) y la app (hasValidIntegrity).
const expected = createHash('sha256').update(JSON.stringify({ ...show, integrityHash: '' }), 'utf8').digest('hex');
if (show.integrityHash !== expected) fail('el integrityHash no coincide con el contenido: vuelve a exportar desde Studio.');

const major = Number(String(show.version ?? '').split('.')[0]);
if (major !== 2) fail(`versión de show ${show.version} no admitida por la app (2.x).`);
if (!show.seatMap) console.warn('Aviso: el show no trae seatMap; los móviles estimarán la posición por sector.');
const syncs = show.syncPoints ?? [];
if (syncs.length === 0 || syncs.length > SYNC_HZ.length) fail(`el show tiene ${syncs.length} syncs (1-${SYNC_HZ.length}).`);

const startAtUtc = isoDate(opts.start, 'start');
const endAtUtc = isoDate(opts.end, 'end');
if (endAtUtc <= startAtUtc) fail('--end debe ser posterior a --start.');

const packageName = `${show.showId}-${show.integrityHash.slice(0, 12)}.json`;
writeFileSync(join(SHOWS_DIR, packageName), raw);

const event = {
  eventId: opts['event-id'],
  showId: show.showId,
  version: show.version,
  title: opts.title ?? show.name,
  venueName: opts.venue ?? show.venue,
  packageUrl: `shows/${packageName}`,
  packageIntegrityHash: show.integrityHash,
  packageSizeBytes: raw.length,
  startAtUtc,
  endAtUtc,
  ...(opts.lat !== undefined || opts.lon !== undefined
    ? {
        venueLatitude: num(opts.lat, 'lat'),
        venueLongitude: num(opts.lon, 'lon'),
        geofenceRadiusMeters: num(opts.radius ?? 1000, 'radius'),
      }
    : {}),
};

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
const events = catalog.events.filter((e) => e.eventId !== event.eventId);
const replaced = events.length !== catalog.events.length;
events.push(event);
events.sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));

writeFileSync(
  CATALOG,
  JSON.stringify({ ...catalog, updatedAt: new Date().toISOString(), events }, null, 2) + '\n',
);

console.log(`${replaced ? 'Actualizado' : 'Publicado'} ${event.eventId} → v1/shows/${packageName} (${raw.length} bytes).`);
console.log('Revisa los cambios y súbelos: git add -A && git commit && git push');
