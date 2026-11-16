// Tests de la publicación (LUM-57): `npm test`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { integrityOf, parseMeta, PublishError, publish, validatePackage } from './publish-core.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO = join(REPO, 'v1', 'shows', 'show_de_demostraci_n-c32c54df3be4.json');
const demoRaw = readFileSync(DEMO);
const NOW = new Date('2026-11-13T10:00:00.000Z');
const META = { 'event-id': 'prueba-sala', start: '2026-12-01T19:00:00Z', end: '2026-12-01T23:00:00Z' };

const roots = [];
/** Copia mínima del repositorio: catálogo real vacío. */
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'lumen-shows-'));
  roots.push(root);
  mkdirSync(join(root, 'v1', 'shows'), { recursive: true });
  writeFileSync(
    join(root, 'v1', 'events.json'),
    JSON.stringify({ format: 'lumen-events', version: 1, updatedAt: NOW.toISOString(), events: [] }, null, 2) + '\n',
  );
  return root;
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** Show válido a partir del de demostración, con los cambios de `patch` y el hash recalculado. */
function showWith(patch) {
  const show = { ...JSON.parse(demoRaw.toString('utf8')), ...patch };
  show.integrityHash = integrityOf(show);
  return Buffer.from(JSON.stringify(show));
}

const snapshot = (root) => {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else files[p.slice(root.length).replace(/\\/g, '/')] = readFileSync(p, 'utf8');
    }
  };
  walk(join(root, 'v1'));
  return files;
};

describe('paquete', () => {
  it('acepta el export de Studio sin modificar', () => {
    const { show, warnings } = validatePackage(demoRaw);
    assert.equal(show.showId, 'show_de_demostraci_n');
    assert.deepEqual(warnings, []);
  });

  it('rechaza un paquete modificado después de exportar', () => {
    const show = JSON.parse(demoRaw.toString('utf8'));
    show.name = 'Cambiado a mano';
    assert.throws(() => validatePackage(Buffer.from(JSON.stringify(show))), /integrityHash no coincide/);
  });

  it('rechaza versiones que no son 2.x, sin syncs o con más de 5', () => {
    assert.throws(() => validatePackage(showWith({ version: '3.0.0' })), /versión de show 3\.0\.0/);
    assert.throws(() => validatePackage(showWith({ syncPoints: [] })), /0 syncs/);
    assert.throws(() => validatePackage(showWith({ syncPoints: [1, 2, 3, 4, 5, 6] })), /6 syncs/);
  });

  it('rechaza lo que no es JSON y avisa si falta el seatMap', () => {
    assert.throws(() => validatePackage(Buffer.from('no es json')), /no es JSON válido/);
    assert.match(validatePackage(showWith({ seatMap: undefined })).warnings[0], /seatMap/);
  });
});

describe('metadatos del evento', () => {
  it('acepta cadenas de la línea de órdenes y números del JSON del workflow', () => {
    const cli = parseMeta({ ...META, lat: '40.4', lon: '-3.7', 'notify-hours': '2' }).fields;
    const json = parseMeta({ ...META, lat: 40.4, lon: -3.7, 'notify-hours': 2 }).fields;
    assert.deepEqual(cli, json);
    assert.equal(cli.geofenceRadiusMeters, 1000);
  });

  it('valida id, fechas, rangos y opciones desconocidas', () => {
    assert.throws(() => parseMeta({ ...META, 'event-id': 'Con Mayúsculas' }), /--event-id/);
    assert.throws(() => parseMeta({ ...META, end: META.start }), /--end debe ser posterior/);
    assert.throws(() => parseMeta({ ...META, start: 'mañana' }), /--start debe ser una fecha/);
    assert.throws(() => parseMeta({ ...META, 'notify-hours': 30 }), /entre 0.5 y 24 horas/);
    assert.throws(() => parseMeta({ ...META, lat: 'norte', lon: 1 }), /--lat debe ser un número/);
    assert.throws(() => parseMeta({ ...META, colour: 'red' }), /opción desconocida: --colour/);
  });

  it('avisa si hay radio de aviso sin coordenadas', () => {
    assert.match(parseMeta({ ...META, 'notify-radius': 3000 }).warnings[0], /no tiene efecto/);
  });
});

describe('publicar', () => {
  it('copia el paquete sin modificar y añade la entrada al catálogo', () => {
    const root = tempRoot();
    const result = publish({ root, raw: demoRaw, meta: { ...META, venue: 'Sala' }, now: NOW });

    assert.equal(result.packagePath, 'v1/shows/show_de_demostraci_n-c32c54df3be4.json');
    assert.deepEqual(readFileSync(join(root, result.packagePath)), demoRaw);
    const catalog = JSON.parse(readFileSync(join(root, 'v1', 'events.json'), 'utf8'));
    assert.equal(catalog.updatedAt, NOW.toISOString());
    assert.deepEqual(Object.keys(catalog.events[0]).slice(0, 10), [
      'eventId',
      'showId',
      'version',
      'title',
      'venueName',
      'packageUrl',
      'packageIntegrityHash',
      'packageSizeBytes',
      'startAtUtc',
      'endAtUtc',
    ]);
    assert.equal(catalog.events[0].venueName, 'Sala');
    assert.equal(catalog.events[0].packageSizeBytes, demoRaw.length);
  });

  it('volver a publicar el mismo evento lo sustituye', () => {
    const root = tempRoot();
    publish({ root, raw: demoRaw, meta: META, now: NOW });
    const again = publish({ root, raw: demoRaw, meta: { ...META, title: 'Otro título' }, now: NOW });

    const catalog = JSON.parse(readFileSync(join(root, 'v1', 'events.json'), 'utf8'));
    assert.equal(again.replaced, true);
    assert.equal(catalog.events.length, 1);
    assert.equal(catalog.events[0].title, 'Otro título');
  });

  it('el catálogo de pruebas va aparte y no toca el real', () => {
    const root = tempRoot();
    const before = readFileSync(join(root, 'v1', 'events.json'), 'utf8');
    const result = publish({ root, raw: demoRaw, meta: META, catalog: 'test', now: NOW });

    assert.equal(result.catalogPath, 'v1/test/events.json');
    assert.equal(result.packagePath, 'v1/test/shows/show_de_demostraci_n-c32c54df3be4.json');
    assert.equal(readFileSync(join(root, 'v1', 'events.json'), 'utf8'), before);
    const test = JSON.parse(readFileSync(join(root, 'v1', 'test', 'events.json'), 'utf8'));
    assert.equal(test.format, 'lumen-events');
    assert.equal(test.events[0].eventId, 'prueba-sala');
  });

  it('un paquete o unos datos no válidos no escriben nada', () => {
    const root = tempRoot();
    const before = snapshot(root);
    assert.throws(() => publish({ root, raw: Buffer.from('{}'), meta: META }), PublishError);
    assert.throws(() => publish({ root, raw: demoRaw, meta: { ...META, end: 'x' } }), PublishError);
    assert.throws(() => publish({ root, raw: demoRaw, meta: META, catalog: 'otro' }), /catálogo desconocido/);
    assert.deepEqual(snapshot(root), before);
  });
});

describe('línea de órdenes y workflow', () => {
  const node = process.execPath;
  const script = (name) => join(REPO, 'scripts', name);

  it('publish.mjs y el paso del workflow dejan el mismo catálogo y el mismo paquete', () => {
    const viaCli = tempRoot();
    const viaWorkflow = tempRoot();
    const pkg = join(viaCli, 'show.json');
    writeFileSync(pkg, demoRaw);

    execFileSync(
      node,
      [script('publish.mjs'), pkg, '--event-id', 'prueba-sala', '--start', META.start, '--end', META.end,
        '--lat', '40.4', '--lon', '-3.7', '--notify-hours', '2', '--catalog', 'test'],
      { env: { ...process.env, LUMEN_SHOWS_ROOT: viaCli }, stdio: 'pipe' },
    );
    execFileSync(node, [script('publish-event.mjs')], {
      env: {
        ...process.env,
        LUMEN_SHOWS_ROOT: viaWorkflow,
        PACKAGE_FILE: pkg,
        EVENT_ID: 'prueba-sala',
        EVENT_META: JSON.stringify({ start: META.start, end: META.end, lat: 40.4, lon: -3.7, 'notify-hours': 2 }),
        CATALOG: 'test',
        GITHUB_OUTPUT: '',
        GITHUB_STEP_SUMMARY: '',
      },
      stdio: 'pipe',
    });

    const strip = (files) =>
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, v.replace(/"updatedAt": "[^"]+"/, '"updatedAt": "-"')]),
      );
    assert.deepEqual(strip(snapshot(viaWorkflow)), strip(snapshot(viaCli)));
    assert.ok(existsSync(join(viaWorkflow, 'v1', 'test', 'shows', 'show_de_demostraci_n-c32c54df3be4.json')));
  });

  it('el workflow devuelve los errores como anotaciones y sale con error', () => {
    const root = tempRoot();
    const pkg = join(root, 'show.json');
    writeFileSync(pkg, demoRaw);
    const run = spawnSync(node, [script('publish-event.mjs')], {
      env: {
        ...process.env,
        LUMEN_SHOWS_ROOT: root,
        PACKAGE_FILE: pkg,
        EVENT_ID: 'prueba-sala',
        EVENT_META: JSON.stringify({ start: META.start, end: '2020-01-01T00:00:00Z' }),
        CATALOG: 'test',
      },
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /::error title=Publicar evento::--end debe ser posterior a --start\./);
    assert.equal(existsSync(join(root, 'v1', 'test')), false);
  });
});
