// Lógica común de publicación (LUM-57): la usan `scripts/publish.mjs` (en local) y
// `scripts/publish-event.mjs` (workflow «Publicar evento», que lanza Lumen Studio). Así las dos vías
// validan igual y dejan el mismo catálogo y el mismo paquete.
//
// El paquete se copia sin modificar a <catálogo>/shows/<showId>-<hash12>.json: el nombre cambia con el
// contenido, así que ninguna caché sirve una versión antigua. Los paquetes anteriores no se borran
// (puede haber móviles que ya los tengan descargados).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_PACKAGE_BYTES = 5 * 1024 * 1024; // = SecurityConstants.maxShowPackageSizeBytes de la app
export const SYNC_HZ = [18500, 19000, 19500, 18200, 17800]; // = SYNC_HZ de lumen-studio/src/app/core/cues.ts
export const EVENT_ID_RX = /^[a-z0-9][a-z0-9-]{2,63}$/;
export const NOTIFY_HOURS = { min: 0.5, max: 24 }; // horas antes del inicio
export const NOTIFY_RADIUS_M = { min: 500, max: 50_000 }; // metros alrededor del recinto
export const DEFAULT_GEOFENCE_M = 1000;

/**
 * Catálogos: `live` es el que leen las apps de las tiendas; `test` es el de pruebas mientras la suite
 * sea privada (LUM-56), que solo lee Lumen Mobile en desarrollo.
 */
export const CATALOGS = {
  live: 'v1',
  test: 'v1/test',
};

/** Metadatos del evento que se aceptan, con el nombre de la opción de `publish.mjs`. */
export const META_FIELDS = [
  'event-id',
  'start',
  'end',
  'title',
  'venue',
  'lat',
  'lon',
  'radius',
  'notify-hours',
  'notify-radius',
];

/** Error de validación: el mensaje se muestra tal cual a quien publica. */
export class PublishError extends Error {
  name = 'PublishError';
}

const fail = (msg) => {
  throw new PublishError(msg);
};

const isoDate = (value, name) => {
  const d = new Date(value ?? '');
  if (value === undefined || value === '' || Number.isNaN(d.getTime())) {
    fail(`--${name} debe ser una fecha ISO 8601 (p. ej. 2026-12-01T19:00:00Z).`);
  }
  return d.toISOString();
};

const num = (value, name) => {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim() || Number.NaN);
  if (!Number.isFinite(n)) fail(`--${name} debe ser un número.`);
  return n;
};

const inRange = (value, name, { min, max }, unit) => {
  const n = num(value, name);
  if (n < min || n > max) fail(`--${name} debe estar entre ${min} y ${max} ${unit}.`);
  return n;
};

/** Mismo cálculo que Studio (showDocument) y la app (hasValidIntegrity). */
export const integrityOf = (show) =>
  createHash('sha256')
    .update(JSON.stringify({ ...show, integrityHash: '' }), 'utf8')
    .digest('hex');

/** Valida el paquete exportado por Studio. Devuelve el show y los avisos (no impiden publicar). */
export function validatePackage(raw) {
  if (raw.length > MAX_PACKAGE_BYTES) fail(`el paquete ocupa ${raw.length} bytes (máximo ${MAX_PACKAGE_BYTES}).`);

  let show;
  try {
    show = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('el fichero no es JSON válido.');
  }
  if (!show || typeof show !== 'object' || Array.isArray(show)) fail('el fichero no es un show de Lumen Studio.');

  if (show.integrityHash !== integrityOf(show)) {
    fail('el integrityHash no coincide con el contenido: vuelve a exportar desde Studio.');
  }

  const major = Number(String(show.version ?? '').split('.')[0]);
  if (major !== 2) fail(`versión de show ${show.version} no admitida por la app (2.x).`);

  const syncs = show.syncPoints ?? [];
  if (syncs.length === 0 || syncs.length > SYNC_HZ.length) {
    fail(`el show tiene ${syncs.length} syncs (1-${SYNC_HZ.length}).`);
  }

  const warnings = [];
  if (!show.seatMap) warnings.push('el show no trae seatMap; los móviles estimarán la posición por sector.');
  return { show, warnings };
}

/**
 * Valida los metadatos del evento (cadenas de la línea de órdenes o valores del JSON del workflow) y
 * devuelve los campos normalizados del catálogo, más los avisos.
 */
export function parseMeta(meta) {
  const unknown = Object.keys(meta).filter((k) => !META_FIELDS.includes(k));
  if (unknown.length) fail(`opción desconocida: --${unknown[0]}`);

  const eventId = meta['event-id'];
  if (typeof eventId !== 'string' || !EVENT_ID_RX.test(eventId)) {
    fail('--event-id: minúsculas, números y guiones (3-64).');
  }

  const startAtUtc = isoDate(meta.start, 'start');
  const endAtUtc = isoDate(meta.end, 'end');
  if (endAtUtc <= startAtUtc) fail('--end debe ser posterior a --start.');

  const has = (k) => meta[k] !== undefined && meta[k] !== null && meta[k] !== '';
  const hasCoordinates = has('lat') || has('lon');
  const warnings = [];

  const fields = {
    eventId,
    startAtUtc,
    endAtUtc,
    ...(has('title') ? { title: String(meta.title) } : {}),
    ...(has('venue') ? { venueName: String(meta.venue) } : {}),
    ...(hasCoordinates
      ? {
          venueLatitude: num(meta.lat, 'lat'),
          venueLongitude: num(meta.lon, 'lon'),
          geofenceRadiusMeters: num(has('radius') ? meta.radius : DEFAULT_GEOFENCE_M, 'radius'),
        }
      : {}),
    ...(has('notify-hours')
      ? { reminderHoursBefore: inRange(meta['notify-hours'], 'notify-hours', NOTIFY_HOURS, 'horas') }
      : {}),
    ...(has('notify-radius')
      ? { reminderRadiusMeters: inRange(meta['notify-radius'], 'notify-radius', NOTIFY_RADIUS_M, 'metros') }
      : {}),
  };

  if (fields.reminderRadiusMeters !== undefined && !hasCoordinates) {
    warnings.push('--notify-radius sin --lat/--lon no tiene efecto; la app avisará solo por hora.');
  }
  return { fields, warnings };
}

export const packageName = (show) => `${show.showId}-${show.integrityHash.slice(0, 12)}.json`;

/** Entrada del catálogo, con el orden de campos de siempre. */
export function buildEvent(show, sizeBytes, fields) {
  const { eventId, startAtUtc, endAtUtc, title, venueName, ...optional } = fields;
  return {
    eventId,
    showId: show.showId,
    version: show.version,
    title: title ?? show.name,
    venueName: venueName ?? show.venue,
    packageUrl: `shows/${packageName(show)}`,
    packageIntegrityHash: show.integrityHash,
    packageSizeBytes: sizeBytes,
    startAtUtc,
    endAtUtc,
    ...optional,
  };
}

/** Sustituye (o añade) la entrada del evento y ordena por inicio. */
export function upsertEvent(catalog, event, now) {
  const events = catalog.events.filter((e) => e.eventId !== event.eventId);
  const replaced = events.length !== catalog.events.length;
  events.push(event);
  events.sort((a, b) => a.startAtUtc.localeCompare(b.startAtUtc));
  return { catalog: { ...catalog, updatedAt: now.toISOString(), events }, replaced };
}

const emptyCatalog = () => ({ format: 'lumen-events', version: 1, updatedAt: new Date(0).toISOString(), events: [] });

/**
 * Publica el paquete `raw` (bytes del export de Studio) con los metadatos `meta` en el catálogo
 * `catalog` del repositorio `root`. Valida todo antes de escribir: si algo falla, no toca nada.
 */
export function publish({ root, raw, meta, catalog = 'live', now = new Date() }) {
  const dir = CATALOGS[catalog];
  if (!dir) fail(`catálogo desconocido: ${catalog} (${Object.keys(CATALOGS).join(' o ')}).`);

  const { show, warnings: packageWarnings } = validatePackage(raw);
  const { fields, warnings: metaWarnings } = parseMeta(meta);
  const event = buildEvent(show, raw.length, fields);

  const catalogFile = join(root, dir, 'events.json');
  const current = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, 'utf8')) : emptyCatalog();
  const { catalog: next, replaced } = upsertEvent(current, event, now);

  const showsDir = join(root, dir, 'shows');
  mkdirSync(showsDir, { recursive: true });
  writeFileSync(join(showsDir, packageName(show)), raw);
  writeFileSync(catalogFile, JSON.stringify(next, null, 2) + '\n');

  return {
    event,
    replaced,
    catalog,
    catalogPath: `${dir}/events.json`,
    packagePath: `${dir}/shows/${packageName(show)}`,
    warnings: [...packageWarnings, ...metaWarnings],
  };
}
