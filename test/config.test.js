// -----------------------------------------------------------------------------
// The configuration and the recipients: strict, never shown back, masked.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/config.js';
import { mask, parseRecipient, parseRecipientList } from '../src/recipients.js';
import { cleanText } from '../src/app.js';
import { t } from '../src/i18n.js';

const BASE = { identity: '*GLADYS1', secret: 'S3cr3tTestValue9' };

test('identity and secret: both needed, checked, the secret never shown back', () => {
  assert.deepEqual(readConfig({}), { ok: false, reason: 'not_configured' });
  assert.equal(readConfig({ secret: BASE.secret }).reason, 'identity_missing');
  assert.equal(readConfig({ identity: BASE.identity }).reason, 'secret_missing');
  assert.equal(readConfig({ ...BASE, identity: 'GLADYS12' }).reason, 'identity_invalid');
  assert.equal(readConfig({ ...BASE, identity: '*GLADYS' }).reason, 'identity_invalid');
  assert.equal(readConfig({ ...BASE, identity: '*GLA\nYS1' }).reason, 'identity_invalid');
  assert.equal(readConfig({ ...BASE, secret: 'with space inside' }).reason, 'secret_invalid');
  assert.equal(readConfig({ ...BASE, secret: 'abc\r\ndefghij' }).reason, 'secret_invalid');
  assert.equal(readConfig({ ...BASE, secret: 'short' }).reason, 'secret_invalid');
  const ok = readConfig({ ...BASE, identity: ' *gladys1 ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.identity, '*GLADYS1');
  for (const bad of ['', 'é'.repeat(10)]) {
    const r = readConfig({ ...BASE, secret: `x${bad}yyyyyyyy` });
    if (!r.ok) assert.ok(!JSON.stringify(r).includes('yyyyyyyy'));
  }
});

test('the hourly limit: a whole number from 1 to 500, strict', () => {
  for (const good of [1, 500, '20', 20]) {
    assert.ok(readConfig({ ...BASE, max_messages_per_hour: good }).ok, String(good));
  }
  for (const bad of [0, 501, 2.5, '2.5', 'abc', '1e2', -1, ' 3x', true]) {
    assert.equal(
      readConfig({ ...BASE, max_messages_per_hour: bad }).reason,
      'limit_invalid',
      String(bad),
    );
  }
  assert.equal(readConfig({ ...BASE, max_messages_per_hour: '' }).perHour, 20);
  assert.equal(readConfig({ ...BASE, max_messages_per_hour: null }).perHour, 20);
});

test('forwarding: on only with true', () => {
  assert.equal(readConfig({ ...BASE, forward_gladys_messages: true }).forward, true);
  assert.equal(readConfig({ ...BASE, forward_gladys_messages: 'true' }).forward, true);
  for (const off of [false, 'false', '', 1, 'yes', undefined, null]) {
    assert.equal(readConfig({ ...BASE, forward_gladys_messages: off }).forward, false, String(off));
  }
});

test('recipients: ID, phone, e-mail; normalized; bad ones refused', () => {
  assert.deepEqual(parseRecipient('echoecho'), {
    kind: 'to',
    value: 'ECHOECHO',
    key: 'to:ECHOECHO',
  });
  assert.deepEqual(parseRecipient('*GATEWAY'), {
    kind: 'to',
    value: '*GATEWAY',
    key: 'to:*GATEWAY',
  });
  assert.equal(parseRecipient('+41 79 123 45 67').value, '41791234567');
  assert.equal(parseRecipient('0041-79-123.45.67').value, '41791234567');
  assert.equal(parseRecipient('+33 (0)6'), null);
  assert.equal(parseRecipient(' Jo.Doe@Example.ORG ').value, 'jo.doe@example.org');
  assert.equal(parseRecipient('jo@example.org').kind, 'email');
  for (const bad of [
    '',
    '   ',
    'ABC',
    'ABCDEFGHI',
    'ABCD-123',
    '+0612345678',
    '+12',
    '+1234567890123456',
    '0612345678',
    'jo@',
    'jo@example',
    'a b@example.org',
    'jo@exa_mple.org',
    'ALICE123\n',
    'ALICE\u0000123',
    'jo@example.org\r\nBcc: x@y.z',
    'x'.repeat(300),
    42,
    null,
    undefined,
    ['ALICE123'],
  ]) {
    assert.equal(parseRecipient(bad), null, JSON.stringify(bad));
  }
});

test('masks never show a whole ID, number or address', () => {
  assert.equal(mask(parseRecipient('ALICE123')), 'AL******');
  assert.equal(mask(parseRecipient('+41 79 123 45 67')), '+…67');
  assert.equal(mask(parseRecipient('jo.doe@example.org')), 'j…@…');
  assert.equal(mask(null), '?');
});

test('the allowed list: separators, duplicates, limit, position only on error', () => {
  const r = parseRecipientList('ALICE123, bob45678;+41791234567\nalice123');
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.list.map((x) => x.key),
    ['to:ALICE123', 'to:BOB45678', 'phone:41791234567'],
  );
  assert.deepEqual(parseRecipientList(''), { ok: true, list: [] });
  assert.deepEqual(parseRecipientList(undefined), { ok: true, list: [] });
  const bad = readConfig({ ...BASE, recipients: 'ALICE123, secret-person@nowhere' });
  assert.equal(bad.reason, 'recipients_invalid');
  assert.equal(bad.vars.position, 2);
  assert.ok(!t(bad.reason, 'en', bad.vars).includes('secret-person'));
  const many = Array.from({ length: 21 }, (_, i) => `USER${String(i).padStart(4, '0')}`).join(',');
  assert.equal(readConfig({ ...BASE, recipients: many }).reason, 'recipients_too_many');
  assert.equal(readConfig({ ...BASE, recipients: 42 }).reason, 'recipients_invalid');
});

test('the text: controls removed, cut to 3,500 bytes on a character boundary', () => {
  assert.equal(cleanText('  a\u0000b\r\nc\td  '), 'a b\nc\td');
  assert.equal(cleanText(null), '');
  const short = 'é'.repeat(1750); // exactly 3,500 bytes
  assert.equal(cleanText(short), short);
  const long = cleanText('é'.repeat(1751));
  assert.ok(Buffer.byteLength(long, 'utf8') <= 3500);
  assert.ok(long.endsWith('…'));
  const emoji = cleanText('😀'.repeat(2000));
  assert.ok(Buffer.byteLength(emoji, 'utf8') <= 3500);
  assert.ok(!emoji.includes('�'));
  assert.match(emoji, /^(?:😀)+…$/u);
  // Gladys sends 4,096 characters at most: read no further.
  assert.ok(cleanText('a'.repeat(100_000)).length <= 3500);
});

test('the allowed list holds 20 recipients, not 21', () => {
  const ids = (n) =>
    Array.from({ length: n }, (_, i) => `USER${String(i).padStart(4, '0')}`).join(',');
  const twenty = readConfig({ ...BASE, recipients: ids(20) });
  assert.equal(twenty.ok, true);
  assert.equal(twenty.recipients.length, 20);
  assert.equal(readConfig({ ...BASE, recipients: ids(21) }).reason, 'recipients_too_many');
});

test('the text: C1 controls and Unicode line separators become spaces', () => {
  assert.equal(cleanText('a\u0085b c d\u009fe'), 'a b c d e');
});
