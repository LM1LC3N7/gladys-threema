// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. No version is
// pinned: only its shape and its agreement across files.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { readConfig } from '../src/config.js';
import {
  ACTIONS,
  DEFAULT_PER_HOUR,
  MAX_PER_HOUR,
  MIN_PER_HOUR,
  SCENE_ACTIONS,
} from '../src/constants.js';
import { ALL_TEXTS } from '../src/i18n.js';

const CORE = '/home/claude/code/Gladys/server';
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const field = (key) => manifest.config_schema.find((f) => f.key === key);
const BASE = { identity: '*GLADYS1', secret: 'abcdefghijklmnop' };

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the version agreeing everywhere, never pinned', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'communication');
  assert.deepEqual(manifest.messaging, { receive: false });
  // Scene actions arrived with Gladys 5.1.0.
  assert.equal(manifest.gladys_version, '>=5.1.0');
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.name, 'gladys-threema');
  assert.equal(lock.name, pkg.name);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-threema:${manifest.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-threema\//,
  );
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['notifications']);
  assert.equal(manifest.keywords, undefined);
  // An international service: no `countries`.
  assert.equal(manifest.countries, undefined);
  assert.equal(pkg.scripts.test, 'node --test --test-timeout=60000');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300);
    assert.match(
      docs,
      /never been tested with a real Threema Gateway account|jamais été testée avec un vrai compte Threema Gateway/,
    );
  }
});

test('the manifest passes the schema and the validator of the core (when the clone is here)', (t) => {
  const schemaPath = `${CORE}/lib/external-integration/manifest.schema.json`;
  if (!existsSync(schemaPath) || !existsSync(`${CORE}/node_modules/ajv`)) {
    t.skip('Gladys core clone absent');
    return;
  }
  const require = createRequire(`${CORE}/index.js`);
  const Ajv = require('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
  // The validator of the core loads its database module, which creates a file
  // in the working directory: run it in a child process inside a temporary
  // directory, removed afterwards.
  const dir = mkdtempSync(join(tmpdir(), 'threema-manifest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = `const { validateManifest } = require(${JSON.stringify(`${CORE}/lib/external-integration/externalIntegration.validateManifest.js`)});
validateManifest(JSON.parse(require('fs').readFileSync(0, 'utf8')));`;
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, ['-e', script], {
      cwd: dir,
      input: JSON.stringify(manifest),
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: 30_000,
    }),
  );
});

test('every text is in English and French; sections within their limits', () => {
  for (const [path, entry] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(entry[lang]?.trim(), `${path} needs ${lang}`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    for (const lang of ['en', 'fr'])
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('no key starts with gladys_; the secret has no default; nothing said encrypted', () => {
  const all = [
    ...manifest.config_schema,
    ...manifest.contact_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ];
  for (const f of all) assert.doesNotMatch(f.key, /^gladys_/);
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(
    secrets.map((f) => f.key),
    ['secret'],
  );
  for (const f of secrets) {
    assert.equal(f.default, undefined);
    assert.match(
      f.description.en,
      /Kept by Gladys in its database, never shown again, sent only to Threema/,
    );
    assert.match(f.description.fr, /Gardé par Gladys dans sa base, jamais réaffiché/);
  }
  assert.equal(field('identity').default, undefined);
  for (const file of [
    'gladys-assistant-integration.json',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'src/i18n.js',
  ]) {
    assert.doesNotMatch(read(file), /chiffr(é|ement)|encrypt|hachage|crypt/i, file);
  }
});

test('the config fields are the ones the code reads, with the same defaults and bounds', () => {
  assert.deepEqual(
    manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key),
    ['identity', 'secret', 'recipients', 'max_messages_per_hour', 'forward_gladys_messages'],
  );
  const config = read('src/config.js');
  for (const f of manifest.config_schema.filter((x) => x.type !== 'section')) {
    assert.ok(config.includes(`.${f.key}`), f.key);
  }
  const limit = field('max_messages_per_hour');
  assert.equal(limit.default, DEFAULT_PER_HOUR);
  assert.equal(limit.min, MIN_PER_HOUR);
  assert.equal(limit.max, MAX_PER_HOUR);
  assert.ok(readConfig({ ...BASE, max_messages_per_hour: limit.min }).ok);
  assert.ok(readConfig({ ...BASE, max_messages_per_hour: limit.max }).ok);
  assert.ok(!readConfig({ ...BASE, max_messages_per_hour: limit.max + 1 }).ok);
  assert.ok(!readConfig({ ...BASE, max_messages_per_hour: limit.min - 1 }).ok);
  // Forwarding off by default, in the manifest and in the code.
  assert.equal(field('forward_gladys_messages').default, false);
  assert.equal(readConfig(BASE).forward, false);
  assert.equal(readConfig(BASE).perHour, DEFAULT_PER_HOUR);
  // The per-user recipient is what onSendMessage reads.
  assert.deepEqual(
    manifest.contact_schema.map((f) => f.key),
    ['recipient'],
  );
  assert.ok(read('src/app.js').includes('contact?.recipient'));
});

test('every select option follows the rules of the core (none today)', () => {
  const selects = [
    ...manifest.config_schema,
    ...manifest.contact_schema,
    ...manifest.actions.flatMap((a) => a.fields ?? []),
    ...manifest.scene_actions.flatMap((a) => a.fields ?? []),
  ].filter((f) => f.type === 'select' || f.type === 'multi_select');
  for (const f of selects) {
    const seen = new Set();
    for (const o of f.options) {
      assert.deepEqual(Object.keys(o).sort(), ['label', 'value'], f.key);
      assert.ok(['string', 'number'].includes(typeof o.value));
      assert.ok(!seen.has(o.value), `${f.key}: ${o.value} twice`);
      seen.add(o.value);
      for (const lang of ['en', 'fr']) {
        const label = o.label[lang];
        assert.equal(typeof label, 'string');
        assert.ok(label.length > 0 && label.trim() === label, `${f.key}.${o.value}.${lang}`);
      }
    }
  }
  assert.equal(selects.length, 0);
});

test('the actions and the scene action are the ones the code handles; no switch, no trigger', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key),
    Object.values(SCENE_ACTIONS),
  );
  const app = read('src/app.js');
  assert.ok(app.includes('onAction(ACTIONS.CHECK'));
  assert.ok(app.includes('onAction(ACTIONS.TEST'));
  assert.ok(app.includes('onSceneAction(SCENE_ACTIONS.SEND'));
  assert.deepEqual(
    manifest.scene_actions[0].outputs.map((o) => o.key),
    ['message_id'],
  );
  for (const a of [...manifest.actions, ...manifest.scene_actions])
    assert.ok(a.timeout_seconds >= 5 && a.timeout_seconds <= 120);
  // Send only: nothing received, no scene event (no loop), no device.
  for (const key of ['widgets', 'scene_triggers', 'energy_contracts'])
    assert.equal(manifest[key], undefined);
  for (const call of ['onSetValue', 'publishSceneEvent', 'publishMessage', 'linkContact'])
    assert.ok(!app.includes(call), call);
});

test('every runtime text exists in both languages', () => {
  for (const [key, entry] of Object.entries(ALL_TEXTS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['en', 'fr'], key);
    for (const lang of ['en', 'fr']) assert.ok(entry[lang].trim(), `${key}.${lang}`);
    const names = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(names(entry.fr), names(entry.en), key);
  }
});
