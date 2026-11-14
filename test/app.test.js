// -----------------------------------------------------------------------------
// The channel end to end through the SDK's fake Gladys, with a scripted
// Gateway and the virtual clock: what may leave and when, recipients, the
// hourly limit, no second try, pauses, refusals, queue, configuration and
// /data failures, status, secrets.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { fp8 } from '../src/app.js';
import { ThreemaError, classifyThrown } from '../src/threema.js';
import { createMemoryStore } from '../src/store.js';
import { testClock } from './helpers/clock.js';
import {
  ALICE,
  BOB,
  CONFIG,
  HOUR,
  IDENTITY,
  MESSAGE_ID,
  MINUTE,
  SECOND,
  SECRET,
  SECRET_2,
  SELECTOR,
  START,
  fakeThreema,
  hangUntilAbort,
  lastStatus,
  makeApp,
  settle,
} from './helpers/app.js';

const err = (kind, extra = {}) => {
  const sent = extra.sent ?? !(extra.status >= 300 && extra.status < 500);
  return () => {
    throw new ThreemaError(kind, { ...extra, sent });
  };
};
const scene = (gladys, fields) => gladys.fake.sceneAction('send_message', fields);
const ALL_TEXT = (gladys, logger, store) =>
  JSON.stringify([gladys.fake.connectionStatuses, logger.lines, store.data]);

test('nothing leaves at start, at a reconnection or when the configuration is saved', async () => {
  const { gladys, threema, clock } = await makeApp({
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  await clock.advance(2 * HOUR);
  await gladys.disconnect();
  await gladys.connect();
  await settle();
  await gladys.fake.configUpdated({ ...CONFIG, max_messages_per_hour: 5 });
  await clock.advance(HOUR);
  assert.equal(threema.sends.length, 0);
  assert.equal(threema.checks.length, 0);
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Ready. The ID and the secret are checked by Threema with the “Check the account” button (free) or at the first message.',
  ]);
});

test('scene action: the first allowed recipient by default, the message ID as output', async () => {
  const { gladys, threema } = await makeApp();
  const ack = await scene(gladys, { text: 'Garage door open' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs ?? ack.data, { message_id: MESSAGE_ID });
  assert.equal(threema.sends.length, 1);
  const call = threema.sends[0];
  assert.deepEqual(call.recipient, { kind: 'to', value: ALICE, key: `to:${ALICE}` });
  assert.equal(call.text, 'Garage door open');
  assert.equal(call.cfg.identity, IDENTITY);
  // Another allowed one, written differently (case, spaces).
  await scene(gladys, { text: 'x', recipient: ` ${BOB.toLowerCase()} ` });
  assert.equal(threema.sends[1].recipient.value, BOB);
  await scene(gladys, { text: 'x', recipient: '0041791234567' });
  assert.deepEqual(threema.sends[2].recipient.key, 'phone:41791234567');
  assert.deepEqual(lastStatus(gladys), [
    true,
    'Threema Gateway answered: the ID and the secret are accepted.',
  ]);
});

test('scene action: a recipient outside the list, invalid, or no list: refused, nothing sent', async () => {
  const { gladys, threema, logger } = await makeApp();
  const outside = await scene(gladys, { text: 'x', recipient: 'MALLORY1' });
  assert.equal(outside.success, false);
  assert.match(outside.error, /MA\*{6} is not in the list of allowed recipients/);
  assert.ok(!outside.error.includes('MALLORY1'));
  const invalid = await scene(gladys, { text: 'x', recipient: 'not a recipient' });
  assert.match(invalid.error, /recipient is not valid/);
  const empty = await scene(gladys, { text: '   ', recipient: ALICE });
  assert.match(empty.error, /text is empty/);
  await gladys.fake.configUpdated({ identity: IDENTITY, secret: SECRET });
  const none = await scene(gladys, { text: 'x' });
  assert.match(none.error, /fill the list of allowed recipients/);
  assert.equal(threema.sends.length, 0);
  assert.ok(!logger.lines.join('\n').includes('MALLORY1'));
});

test('a long text is cut to 3,500 bytes before it leaves', async () => {
  const { gladys, threema } = await makeApp();
  await scene(gladys, { text: 'ü'.repeat(4000) });
  const text = threema.sends[0].text;
  assert.ok(Buffer.byteLength(text, 'utf8') <= 3500);
  assert.ok(text.endsWith('…'));
});

test('Gladys messages: refused while the option is off (the default), nothing sent', async () => {
  const { gladys, threema } = await makeApp();
  const ack = await gladys.fake.sendMessage(
    { recipient: ALICE },
    { text: 'Low battery', file: null },
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /not forwarded to Threema/);
  assert.equal(threema.sends.length, 0);
});

test('Gladys messages with the option on: to the user’s own recipient, only if allowed', async () => {
  const { gladys, threema, logger } = await makeApp({
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  const ack = await gladys.fake.sendMessage(
    { recipient: ` ${BOB.toLowerCase()} ` },
    { text: 'Hello', file: null },
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(threema.sends[0].recipient.value, BOB);
  // Any account fills "My account": a recipient outside the list gets nothing.
  const outside = await gladys.fake.sendMessage(
    { recipient: '+33 6 00 00 00 01' },
    { text: 'Alarm', file: null },
  );
  assert.equal(outside.success, false);
  assert.match(outside.error, /\+…01 of this user .* is not in the list of allowed recipients/);
  assert.ok(logger.lines.some((l) => /^info message: \+…01 is not an allowed recipient/.test(l)));
  assert.match(lastStatus(gladys)[1], /recipient \+…01 of a user .* is not in the list/);
  assert.equal(lastStatus(gladys)[0], true);
  const carol = await gladys.fake.sendMessage({ recipient: 'CAROL789' }, { text: 'x', file: null });
  assert.equal(carol.success, false);
  const bad = await gladys.fake.sendMessage({ recipient: 'nope' }, { text: 'Hello', file: null });
  assert.match(bad.error, /recipient of this user/);
  const image = await gladys.fake.sendMessage({ recipient: ALICE }, { text: '', file: 'data:x' });
  assert.match(image.error, /text is empty/);
  assert.equal(threema.sends.length, 1);
  assert.ok(!logger.lines.join('\n').includes('33600000001'));
  // A success clears the reason from the status.
  await gladys.fake.sendMessage({ recipient: ALICE }, { text: 'x', file: null });
  assert.match(lastStatus(gladys)[1], /Threema Gateway answered/);
});

test('Gladys messages: a long text is cut to 3,500 bytes too', async () => {
  const { gladys, threema } = await makeApp({
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  await gladys.fake.sendMessage({ recipient: ALICE }, { text: '€'.repeat(2000), file: null });
  const text = threema.sends[0].text;
  assert.ok(Buffer.byteLength(text, 'utf8') <= 3500);
  assert.ok(text.endsWith('…'));
});

test('Gladys messages: answered within 3.5 s of arrival even when the configuration comes at 1.9 s', async () => {
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  const clock = testClock({ start: START });
  const real = gladys.getConfig.bind(gladys);
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) return real();
    // The app's own read, slow (Gladys busy at start).
    await new Promise((resolve) => clock.timers.setTimeout(resolve, 1900));
    return real();
  };
  const threema = fakeThreema({ answer: hangUntilAbort });
  await makeApp({ gladys, clock, threema });
  let ackedAt;
  const started = clock.monotonic();
  const pending = gladys.fake
    .sendMessage({ recipient: ALICE }, { text: 'Upgraded', file: null })
    .then((a) => ((ackedAt = clock.monotonic()), a));
  await settle();
  await clock.advance(3400);
  assert.equal(ackedAt, undefined);
  await clock.advance(101);
  const ack = await pending;
  assert.equal(ack.success, true);
  assert.ok(ackedAt - started <= 3501, `answered at ${ackedAt - started}`);
  assert.equal(threema.sends.length, 1, 'the send went on');
});

test('Gladys messages: /data hanging is waited for once only, never 2 s on every message', async () => {
  const store = createMemoryStore();
  store.hang = true;
  const threema = fakeThreema();
  const { gladys, clock } = await makeApp({
    store,
    threema,
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  const first = gladys.fake.sendMessage({ recipient: ALICE }, { text: 'a', file: null });
  await settle();
  await clock.advance(2 * SECOND + 1);
  assert.equal((await first).success, true);
  // The second one: no wait at all for /data.
  let acked;
  gladys.fake.sendMessage({ recipient: ALICE }, { text: 'b', file: null }).then((a) => (acked = a));
  await settle(10);
  assert.equal(acked?.success, true);
  assert.equal(threema.sends.length, 2);
  // A scene too.
  let sceneAck;
  scene(gladys, { text: 'c' }).then((a) => (sceneAck = a));
  await settle(10);
  assert.equal(sceneAck?.success, true);
});

test('Gladys messages answered then dropped are logged (masked), never silent', async () => {
  const threema = fakeThreema({ answer: hangUntilAbort });
  const { gladys, clock, logger } = await makeApp({
    threema,
    config: { ...CONFIG, forward_gladys_messages: true, max_messages_per_hour: 100 },
  });
  const acks = Array.from({ length: 4 }, () =>
    gladys.fake.sendMessage({ recipient: ALICE }, { text: 'x', file: null }),
  );
  await settle();
  await clock.advance(3.5 * SECOND + 1);
  for (const a of await Promise.all(acks)) assert.equal(a.success, true);
  await clock.advance(30 * SECOND);
  const later = logger.lines.filter((l) =>
    l.startsWith('warn message to AL****** after the answer'),
  );
  assert.equal(later.length, 4, logger.lines.join('\n'));
  assert.ok(later.some((l) => /waited too long/.test(l)));
  assert.ok(later.some((l) => /may have left/.test(l)));
  assert.ok(!logger.lines.join('\n').includes(ALICE));
});

test('Gladys messages: acked within 3.5 s; the send goes on, is aborted at 15 s, never repeated', async () => {
  const threema = fakeThreema({ answer: hangUntilAbort });
  const { gladys, clock, app } = await makeApp({
    threema,
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  let acked;
  const pending = gladys.fake
    .sendMessage({ recipient: ALICE }, { text: 'Hello', file: null })
    .then((a) => (acked = a));
  await settle();
  await clock.advance(3 * SECOND);
  assert.equal(acked, undefined);
  await clock.advance(0.6 * SECOND);
  await pending;
  assert.equal(acked.success, true);
  assert.equal(threema.sends[0].signal.aborted, false);
  await clock.advance(12 * SECOND);
  assert.equal(threema.sends[0].signal.aborted, true);
  await clock.advance(HOUR / 2);
  assert.equal(threema.sends.length, 1, 'never sent again');
  // It may have left: it stays counted.
  assert.equal(app.sent.length, 1);
  assert.match(lastStatus(gladys)[1], /did not answer in time: the message may have left/);
});

test('hourly limit: counted before it leaves, every path together, free again an hour later', async () => {
  const { gladys, threema, clock } = await makeApp({
    config: { ...CONFIG, max_messages_per_hour: 3, forward_gladys_messages: true },
  });
  // Five at once: exactly three leave.
  const acks = await Promise.all(
    Array.from({ length: 5 }, (_, i) => scene(gladys, { text: `n${i}` })),
  );
  assert.equal(acks.filter((a) => a.success).length, 3);
  assert.equal(threema.sends.length, 3);
  const refused = acks.find((a) => !a.success);
  assert.match(
    refused.error,
    /limit of 3 messages per hour is reached: nothing is sent before 11:00/,
  );
  assert.equal((await gladys.fake.action('send_test', {})).success, false);
  assert.equal(
    (await gladys.fake.sendMessage({ recipient: ALICE }, { text: 'x', file: null })).success,
    false,
  );
  assert.equal(lastStatus(gladys)[0], false);
  assert.match(lastStatus(gladys)[1], /limit of 3 messages per hour/);
  // The free check does not count and is not blocked.
  assert.equal((await gladys.fake.action('check_account', {})).success, true);
  await clock.advance(HOUR - MINUTE);
  assert.equal((await scene(gladys, { text: 'early' })).success, false);
  await clock.advance(MINUTE + SECOND);
  assert.equal((await scene(gladys, { text: 'later' })).success, true);
  assert.equal(threema.sends.length, 4);
});

test('a lower limit saved applies at once to the sends already counted', async () => {
  const { gladys, threema } = await makeApp();
  for (let i = 0; i < 3; i += 1) await scene(gladys, { text: 'x' });
  await gladys.fake.configUpdated({ ...CONFIG, max_messages_per_hour: 2 });
  assert.equal((await scene(gladys, { text: 'x' })).success, false);
  assert.equal(threema.sends.length, 3);
});

test('answered with a 4xx: not counted; a 5xx or a timeout: counted; never sent again', async () => {
  const threema = fakeThreema();
  const { gladys, app, clock } = await makeApp({
    threema,
    config: { ...CONFIG, max_messages_per_hour: 5 },
  });
  threema.answer = err('bad_recipient', { status: 400 });
  const a = await scene(gladys, { text: 'x' });
  assert.match(
    a.error,
    /recipient AL\*{6} is not valid, or the ID is not a basic-mode ID. Nothing was sent/,
  );
  threema.answer = err('not_found', { status: 404 });
  assert.match(
    (await scene(gladys, { text: 'x', recipient: '+41791234567' })).error,
    /No Threema user is linked to \+…67/,
  );
  threema.answer = err('no_credits', { status: 402 });
  assert.match((await scene(gladys, { text: 'x' })).error, /no credits left/);
  assert.equal(app.sent.length, 0);
  assert.equal(threema.sends.length, 3);
  // Status: credits gone is the account's problem; a wrong recipient is not.
  assert.match(lastStatus(gladys)[1], /no credits left/);
  threema.answer = err('network', { code: 'ECONNREFUSED', sent: false });
  assert.match(
    (await scene(gladys, { text: 'x' })).error,
    /could not be reached \(network\). Nothing was sent/,
  );
  assert.equal(app.sent.length, 0);
  // A connection cut after the request left, classified as the real client does.
  const cut = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
  threema.answer = () => {
    throw classifyThrown(cut);
  };
  assert.match((await scene(gladys, { text: 'x' })).error, /may have left. It is not sent again/);
  assert.equal(app.sent.length, 1);
  threema.answer = err('unavailable', { status: 500 });
  assert.match(
    (await scene(gladys, { text: 'x' })).error,
    /failed \(HTTP 500\): the message may have left. It is not sent again, and nothing is sent before/,
  );
  assert.equal(app.sent.length, 2);
  assert.equal(threema.sends.length, 6, 'one request per action, never a second try');
  await clock.advance(10 * MINUTE);
  assert.equal(threema.sends.length, 6);
});

test('429 / 5xx: a pause on every path (buttons too), doubled, Retry-After up to 6 h, kept in /data', async () => {
  const threema = fakeThreema();
  const store = createMemoryStore();
  const { gladys, clock, app } = await makeApp({ threema, store });
  threema.answer = err('throttled', { status: 429 });
  const first = await scene(gladys, { text: 'x' });
  assert.match(first.error, /asked to slow down or failed: nothing is sent before 10:01/);
  assert.equal((await scene(gladys, { text: 'y' })).success, false);
  assert.equal((await gladys.fake.action('send_test', {})).success, false);
  assert.equal((await gladys.fake.action('check_account', {})).success, false);
  assert.equal(threema.sends.length, 1);
  assert.equal(threema.checks.length, 0);
  assert.equal(lastStatus(gladys)[0], false);
  await clock.advance(MINUTE + SECOND);
  threema.answer = err('unavailable', { status: 503 });
  await scene(gladys, { text: 'x' });
  assert.equal(app.pauseStep, 2 * MINUTE);
  await clock.advance(2 * MINUTE + SECOND);
  threema.answer = err('throttled', { status: 429, retryAfterMs: 48 * HOUR });
  await scene(gladys, { text: 'x' });
  assert.ok(app.pausedFor() <= 6 * HOUR && app.pausedFor() > 6 * HOUR - MINUTE);
  await settle();
  const saved = store.data.pause;
  assert.ok(saved.until > clock.now() + 5 * HOUR);
  // A restart keeps the pause.
  const again = await makeApp({ threema, store, clock });
  assert.equal((await scene(again.gladys, { text: 'x' })).success, false);
  assert.equal(threema.sends.length, 3);
  // A success ends it.
  await clock.advance(6 * HOUR + SECOND);
  threema.answer = () => ({ messageId: MESSAGE_ID });
  assert.equal((await scene(again.gladys, { text: 'x' })).success, true);
  assert.equal(again.app.pauseStep, 0);
  await again.app.stop();
});

test('ID or secret refused: nothing more sent, kept in /data, lifted by new values or a button', async () => {
  const threema = fakeThreema({ answer: err('refused', { status: 401 }) });
  const store = createMemoryStore();
  const { gladys, clock } = await makeApp({ threema, store });
  const a = await scene(gladys, { text: 'x' });
  assert.match(a.error, /refused this Gateway ID or this secret/);
  assert.equal((await scene(gladys, { text: 'x' })).success, false);
  assert.equal(threema.sends.length, 1, 'never tried again by itself');
  assert.equal(lastStatus(gladys)[0], false);
  await clock.advance(HOUR);
  assert.equal(threema.sends.length, 1);
  // Kept in /data: 8 bits of a salted hash, never the secret.
  await settle();
  const { refused } = store.data;
  assert.match(refused.salt, /^[0-9a-f]{32}$/);
  assert.equal(refused.fp, fp8(refused.salt, { identity: IDENTITY, secret: SECRET }));
  assert.ok(!JSON.stringify(store.data).includes(SECRET));
  // A restart keeps the refusal.
  const again = await makeApp({ threema, store, clock });
  assert.equal((await scene(again.gladys, { text: 'x' })).success, false);
  assert.equal(threema.sends.length, 1);
  // The same values saved again: still refused, no false reason.
  await again.gladys.fake.configUpdated({ ...CONFIG });
  assert.match(lastStatus(again.gladys)[1], /refused this Gateway ID/);
  // A new secret is tried.
  threema.answer = () => ({ messageId: MESSAGE_ID });
  await again.gladys.fake.configUpdated({ ...CONFIG, secret: SECRET_2 });
  assert.equal((await scene(again.gladys, { text: 'x' })).success, true);
  // A success lifted the refusal: the first secret saved again is tried again.
  await again.gladys.fake.configUpdated({ ...CONFIG });
  assert.equal((await scene(again.gladys, { text: 'x' })).success, true);
  await again.app.stop();
});

test('a refusal is lifted by a successful check (free), never by a scene', async () => {
  const threema = fakeThreema({ answer: err('refused', { status: 401 }) });
  const { gladys } = await makeApp({ threema });
  await scene(gladys, { text: 'x' });
  threema.credits = () => 50;
  const check = await gladys.fake.action('check_account', {});
  assert.equal(check.success, true, check.error);
  assert.match(
    check.data.message.en,
    /accepted the ID and the secret: 50 credits left. Nothing was sent/,
  );
  threema.answer = () => ({ messageId: MESSAGE_ID });
  assert.equal((await scene(gladys, { text: 'x' })).success, true);
  assert.equal(threema.sends.length, 2);
});

test('the test button: one message to an allowed recipient, sent even when refused, counted', async () => {
  const threema = fakeThreema({ answer: err('refused', { status: 401 }) });
  const { gladys, app } = await makeApp({ threema });
  await scene(gladys, { text: 'x' });
  threema.answer = () => ({ messageId: MESSAGE_ID });
  const ack = await gladys.fake.action('send_test', { recipient: BOB });
  assert.equal(ack.success, true, ack.error);
  assert.match(ack.data.message.en, /Test message sent to BO\*{6}/);
  assert.match(ack.data.message.fr, /Message de test envoyé à BO\*{6}/);
  assert.equal(threema.sends[1].recipient.value, BOB);
  assert.match(threema.sends[1].text, /Message de test de Gladys/);
  assert.equal(app.sent.length, 1);
  const outside = await gladys.fake.action('send_test', { recipient: 'MALLORY1' });
  assert.equal(outside.success, false);
  assert.equal(threema.sends.length, 2);
});

test('the check button: free, never counted, one request', async () => {
  const { gladys, threema, app } = await makeApp({
    config: { ...CONFIG, max_messages_per_hour: 1 },
  });
  for (let i = 0; i < 3; i += 1)
    assert.equal((await gladys.fake.action('check_account', {})).success, true);
  assert.equal(threema.checks.length, 3);
  assert.equal(app.sent.length, 0);
  assert.equal(threema.sends.length, 0);
});

test('one request in flight, 10 waiting, the others refused; waiting ones re-checked', async () => {
  let release;
  const threema = fakeThreema({
    answer: () => new Promise((resolve) => (release = () => resolve({ messageId: MESSAGE_ID }))),
  });
  const { gladys, clock } = await makeApp({
    threema,
    config: { ...CONFIG, max_messages_per_hour: 100 },
  });
  const acks = Array.from({ length: 12 }, (_, i) => scene(gladys, { text: `n${i}` }));
  await settle();
  assert.equal(threema.sends.length, 1);
  const busy = await acks[11];
  assert.match(busy.error, /Too many messages at once/);
  for (let i = 0; i < 11; i += 1) {
    release();
    await settle();
  }
  const results = await Promise.all(acks.slice(0, 11));
  assert.equal(results.filter((a) => a.success).length, 11);
  assert.equal(threema.sends.length, 11);
  // The queue is not a way around the limit: 3 waiting, a limit of 2.
  await gladys.fake.configUpdated({ ...CONFIG, max_messages_per_hour: 100 });
  await clock.advance(HOUR);
  await gladys.fake.configUpdated({ ...CONFIG, max_messages_per_hour: 2 });
  const more = Array.from({ length: 3 }, () => scene(gladys, { text: 'x' }));
  await settle();
  release();
  await settle();
  release();
  await settle();
  const r = await Promise.all(more);
  assert.equal(r.filter((a) => a.success).length, 2);
  assert.equal(threema.sends.length, 13);
});

test('a waiting message past its deadline is dropped, never sent late', async () => {
  const threema = fakeThreema({ answer: hangUntilAbort });
  const { gladys, clock } = await makeApp({ threema });
  const first = scene(gladys, { text: 'a' });
  await settle();
  const second = scene(gladys, { text: 'b' });
  await clock.advance(15 * SECOND + 1);
  assert.equal((await first).success, false);
  await clock.advance(11 * SECOND);
  const b = await second;
  assert.equal(threema.sends.length, 2);
  assert.equal(b.success, false);
  // The second started late, with what was left of its 25 s.
  await clock.advance(MINUTE);
  assert.equal(threema.sends.length, 2);
});

test('configuration changed while waiting: not sent with the old values', async () => {
  let release;
  const threema = fakeThreema({
    answer: () => new Promise((resolve) => (release = () => resolve({ messageId: MESSAGE_ID }))),
  });
  const store = createMemoryStore();
  const { gladys, app } = await makeApp({ threema, store });
  const first = scene(gladys, { text: 'a' });
  await settle();
  const second = scene(gladys, { text: 'b' });
  await settle();
  await gladys.fake.configUpdated({ ...CONFIG, secret: SECRET_2 });
  // Checked before it is even counted: /data never holds two sends.
  let most = 0;
  const save = store.save;
  store.save = (data) => {
    most = Math.max(most, data.sent.length);
    return save(data);
  };
  release();
  assert.equal((await first).success, true);
  const b = await second;
  assert.match(b.error, /configuration changed while the message was waiting/);
  assert.equal(threema.sends.length, 1);
  assert.equal(app.sent.length, 1);
  assert.equal(most, 1);
});

test('getConfig failing in connected: retried 5 s, 10 s, 20 s... without end, then ready', async () => {
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const real = gladys.getConfig.bind(gladys);
  let calls = 0;
  const tries = [];
  const clock = testClock({ start: START });
  gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) return real();
    tries.push(clock.monotonic());
    if (calls <= 4) throw new Error('503');
    return real();
  };
  const { threema } = await makeApp({ gladys, clock });
  assert.equal(tries.length, 1);
  assert.match(lastStatus(gladys)[1], /could not be read from Gladys yet/);
  // A scene meanwhile waits 2 s at most, then says why; nothing sent.
  const early = scene(gladys, { text: 'x' });
  await clock.advance(2 * SECOND + 1);
  assert.match((await early).error, /configuration could not be read/);
  await clock.advance(3 * SECOND);
  assert.equal(tries.length, 2);
  await clock.advance(10 * SECOND);
  assert.equal(tries.length, 3);
  await clock.advance(20 * SECOND);
  assert.equal(tries.length, 4);
  assert.deepEqual(
    tries.slice(1).map((at, i) => Math.round((at - tries[i]) / 1000)),
    [5, 10, 20],
  );
  assert.equal(lastStatus(gladys)[0], true);
  assert.equal((await scene(gladys, { text: 'x' })).success, true);
  assert.equal(threema.sends.length, 1);
});

test('invalid configuration: status says why (never the value), nothing sent', async () => {
  const { gladys, threema } = await makeApp({
    config: { ...CONFIG, recipients: 'ALICE123, hidden-value' },
  });
  assert.deepEqual(lastStatus(gladys), [
    false,
    'Recipient number 2 of the list is not valid: a Threema ID (8 characters), a phone number starting with + or 00, or an e-mail address.',
  ]);
  assert.match((await scene(gladys, { text: 'x' })).error, /Recipient number 2/);
  await gladys.fake.configUpdated({ identity: IDENTITY });
  assert.match(lastStatus(gladys)[1], /secret is missing/);
  assert.equal(threema.sends.length, 0);
});

test('/data: the sends of the hour survive a restart; old and future dates dropped', async () => {
  const clock = testClock({ start: START });
  const store = createMemoryStore({
    sent: [START - 2 * HOUR, START - 30 * MINUTE, START - 10 * MINUTE, START + 2 * HOUR, 'x', null],
  });
  const { gladys, app, threema } = await makeApp({
    store,
    clock,
    config: { ...CONFIG, max_messages_per_hour: 3 },
  });
  assert.equal(app.sent.length, 2);
  assert.equal((await scene(gladys, { text: 'x' })).success, true);
  assert.equal((await scene(gladys, { text: 'x' })).success, false);
  await settle();
  assert.equal(store.data.sent.length, 3);
  assert.ok(store.data.sent.every((at) => at <= clock.now() && at > clock.now() - HOUR));
  await app.stop();
  // 31 minutes later, the oldest has left the hour.
  await clock.advance(31 * MINUTE);
  const again = await makeApp({
    store,
    clock,
    threema,
    config: { ...CONFIG, max_messages_per_hour: 3 },
  });
  assert.equal(again.app.sent.length, 2);
  assert.equal((await scene(again.gladys, { text: 'x' })).success, true);
  await again.app.stop();
});

test('/data written before the request leaves', async () => {
  const store = createMemoryStore();
  const threema = fakeThreema({
    answer: () => {
      assert.equal(store.data.sent.length, 1, 'saved first');
      return { messageId: MESSAGE_ID };
    },
  });
  const { gladys } = await makeApp({ store, threema });
  assert.equal((await scene(gladys, { text: 'x' })).success, true);
});

test('/data unreadable: never overwritten, read again every 10 s, merged; sends go on, status says so', async () => {
  const store = createMemoryStore({ sent: [START - 5 * MINUTE] });
  store.unreadable = true;
  const { gladys, clock, app, threema } = await makeApp({
    store,
    config: { ...CONFIG, max_messages_per_hour: 2 },
  });
  assert.equal(store.loads, 1);
  assert.equal((await scene(gladys, { text: 'x' })).success, true);
  assert.equal(store.saves, 0, 'never written over an unread file');
  assert.match(lastStatus(gladys)[1], /hourly counter is not saved/);
  await clock.advance(10 * SECOND + 1);
  assert.equal(store.loads, 2);
  store.unreadable = false;
  await clock.advance(10 * SECOND);
  assert.equal(store.loads, 3);
  // Merged: the one from /data plus the one sent since.
  assert.equal(app.sent.length, 2);
  assert.equal((await scene(gladys, { text: 'x' })).success, false);
  assert.equal(threema.sends.length, 1);
  await clock.advance(MINUTE);
  assert.equal(store.loads, 3);
});

test('/data slow or read-only: a send never waits more than 1 s for it', async () => {
  const store = createMemoryStore();
  const { gladys, clock, threema } = await makeApp({ store });
  store.save = () => new Promise(() => {});
  let ack;
  const pending = scene(gladys, { text: 'x' }).then((a) => (ack = a));
  await settle();
  await clock.advance(1 * SECOND + 1);
  await pending;
  assert.equal(ack.success, true);
  assert.equal(threema.sends.length, 1);
  assert.match(lastStatus(gladys)[1], /hourly counter is not saved/);
  const ro = await makeApp();
  ro.store.failSave = true;
  assert.equal((await scene(ro.gladys, { text: 'x' })).success, true);
  assert.match(lastStatus(ro.gladys)[1], /hourly counter is not saved/);
});

test('/data hanging at start: a send waits 2 s at most for the first read', async () => {
  const store = createMemoryStore();
  store.hang = true;
  const { gladys, clock, threema } = await makeApp({ store });
  let ack;
  const pending = scene(gladys, { text: 'x' }).then((a) => (ack = a));
  await settle();
  await clock.advance(2 * SECOND + 1);
  await pending;
  assert.equal(ack.success, true);
  assert.equal(threema.sends.length, 1);
});

test('the secret, the text and whole recipients never reach the logs, the status or /data', async () => {
  const threema = fakeThreema();
  const store = createMemoryStore();
  const { gladys, logger } = await makeApp({
    threema,
    store,
    config: {
      ...CONFIG,
      recipients: `${ALICE}, +41791234567, jo.doe@example.org`,
      forward_gladys_messages: true,
    },
  });
  const TEXT = 'private-text-content';
  await scene(gladys, { text: TEXT });
  await scene(gladys, { text: TEXT, recipient: '+41791234567' });
  await scene(gladys, { text: TEXT, recipient: 'jo.doe@example.org' });
  await gladys.fake.sendMessage({ recipient: 'CAROL789' }, { text: TEXT, file: null });
  await gladys.fake.sendMessage({ recipient: ALICE }, { text: TEXT, file: null });
  for (const kind of ['refused', 'bad_recipient', 'not_found', 'throttled']) {
    threema.answer = err(kind, {
      status: { refused: 401, bad_recipient: 400, not_found: 404, throttled: 429 }[kind],
    });
    await gladys.fake.action('send_test', { recipient: 'jo.doe@example.org' });
  }
  await settle();
  const all = ALL_TEXT(gladys, logger, store);
  for (const secret of [SECRET, TEXT, ALICE, '41791234567', 'jo.doe', 'example.org', 'CAROL789']) {
    assert.ok(!all.includes(secret), secret);
  }
  assert.ok(logger.lines.some((l) => l.includes('AL******')));
});

test('stop: nothing pending, no timer left, no send after it', async () => {
  const threema = fakeThreema({ answer: hangUntilAbort });
  const store = createMemoryStore();
  store.unreadable = true;
  const { gladys, clock, app } = await makeApp({ threema, store });
  const pending = scene(gladys, { text: 'a' });
  await settle();
  const waiting = scene(gladys, { text: 'b' });
  await settle();
  await app.stop();
  assert.equal(threema.sends[0].signal.aborted, true);
  assert.equal((await pending).success, false);
  assert.equal((await waiting).success, false);
  const loads = store.loads;
  await clock.advance(HOUR);
  assert.equal(threema.sends.length, 1);
  assert.equal(store.loads, loads);
  assert.equal(clock.pending, 0);
});

test('/data keeps exactly { salt, fp } of a refusal: 8 bits, a brute force gets 1 in 256', async () => {
  const threema = fakeThreema({ answer: err('refused', { status: 401 }) });
  const store = createMemoryStore();
  const { gladys } = await makeApp({ threema, store });
  await scene(gladys, { text: 'x' });
  await settle();
  const { refused } = store.data;
  assert.deepEqual(Object.keys(refused).sort(), ['fp', 'salt']);
  assert.ok(Number.isInteger(refused.fp) && refused.fp >= 0 && refused.fp <= 255);
  assert.ok(!JSON.stringify(store.data).includes(SECRET));
  // Trying 4,096 secrets against the stored fingerprint: about 16 match, so the
  // fingerprint never tells the secret.
  let matches = 0;
  for (let i = 0; i < 4096; i += 1) {
    const candidate = { identity: IDENTITY, secret: `Candidate${i.toString(36).padStart(7, '0')}` };
    if (fp8(refused.salt, candidate) === refused.fp) matches += 1;
  }
  assert.ok(matches >= 3 && matches <= 45, `${matches} matches`);
});

/** A store whose writes wait for `release()`. */
function slowStore() {
  const store = createMemoryStore();
  const save = store.save;
  store.held = [];
  store.save = (data) =>
    new Promise((resolve, reject) => {
      store.held.push(() => save(data).then(resolve, reject));
    });
  store.release = () => {
    for (const go of store.held.splice(0)) go();
  };
  return store;
}

test('configuration changed during a slow /data write: nothing sent with the old values', async () => {
  const store = slowStore();
  const threema = fakeThreema();
  const { gladys, clock, app } = await makeApp({ store, threema });
  store.release();
  const pending = scene(gladys, { text: 'x' });
  await settle();
  await gladys.fake.configUpdated({ ...CONFIG, secret: SECRET_2 });
  await clock.advance(500);
  store.release();
  const ack = await pending;
  assert.match(ack.error, /configuration changed while the message was waiting/);
  assert.equal(threema.sends.length, 0);
  assert.equal(app.sent.length, 0);
});

test('stop during a slow /data write: no request after it', async () => {
  const store = slowStore();
  const threema = fakeThreema();
  const { gladys, clock, app } = await makeApp({ store, threema });
  store.release();
  const pending = scene(gladys, { text: 'x' });
  await settle();
  const stopping = app.stop();
  store.release();
  await clock.advance(SECOND);
  await stopping;
  assert.equal((await pending).success, false);
  assert.equal(threema.sends.length, 0);
});

test('the check button waiting behind a send is gated again: a pause met in the queue stops it', async () => {
  let release;
  const threema = fakeThreema({
    answer: () =>
      new Promise((_, reject) => {
        release = () => reject(new ThreemaError('throttled', { status: 429, sent: false }));
      }),
  });
  const { gladys } = await makeApp({ threema });
  const send = scene(gladys, { text: 'x' });
  await settle();
  const check = gladys.fake.action('check_account', {});
  await settle();
  release();
  await send;
  const ack = await check;
  assert.equal(ack.success, false);
  assert.match(ack.error, /asked to slow down or failed: nothing is sent before/);
  assert.equal(threema.checks.length, 0);
});

test('error texts: a check that times out sends nothing; a 201 may have left', async () => {
  const threema = fakeThreema({ credits: hangUntilAbort });
  const { gladys, clock, app } = await makeApp({ threema });
  const check = gladys.fake.action('check_account', {});
  await settle();
  await clock.advance(15 * SECOND + 1);
  const ack = await check;
  assert.match(ack.error, /did not answer in time. No message is sent by this button/);
  assert.doesNotMatch(ack.error, /may have left/);
  threema.answer = err('unexpected', { status: 201, sent: true });
  const created = await scene(gladys, { text: 'x' });
  assert.match(created.error, /unexpected answer \(HTTP 201\): the message may have left/);
  assert.equal(app.sent.length, 1);
});

test('waiting for the configuration: one waiter at most, removed at its deadline', async () => {
  const gladys = createFakeGladys({ selector: SELECTOR, config: CONFIG });
  const real = gladys.getConfig.bind(gladys);
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls === 1) return real();
    throw new Error('503');
  };
  const { app, clock } = await makeApp({ gladys });
  const acks = Array.from({ length: 50 }, () => scene(gladys, { text: 'x' }));
  await settle();
  assert.ok(app.configWaiters.length <= 1, `${app.configWaiters.length} waiters`);
  await clock.advance(2 * SECOND + 1);
  for (const a of await Promise.all(acks)) assert.match(a.error, /configuration could not be read/);
  assert.equal(app.configWaiters.length, 0);
});
