// -----------------------------------------------------------------------------
// The app on a REAL moving clock (sped up 5 times): an unreadable /data read
// again every 10 s (never early, a little late under load at most), a Gladys
// message acked at 3.5 s while its request goes on, the request aborted at
// 15 s and never repeated, nothing left running after stop.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ThreemaApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { realClock, waitFor } from './helpers/clock.js';
import {
  ALICE,
  CONFIG,
  SELECTOR,
  fakeThreema,
  hangUntilAbort,
  memoryLogger,
} from './helpers/app.js';

// Slow enough for a 200 ms margin (40 ms real) on the 3.5 s answer.
const SPEED = 5;

test('real clock: /data read every 10 s; ack at 3.5 s; request aborted at 15 s; nothing after stop', async (t) => {
  const clock = realClock({ speed: SPEED });
  const store = createMemoryStore();
  store.unreadable = true;
  const reads = [];
  const load = store.load;
  store.load = () => {
    reads.push(clock.monotonic());
    return load();
  };
  const threema = fakeThreema({ answer: hangUntilAbort });
  let abortedAt;
  const answer = threema.answer;
  threema.answer = (call) => {
    call.signal.addEventListener('abort', () => (abortedAt = clock.monotonic()));
    return answer(call);
  };
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...CONFIG, forward_gladys_messages: true },
  });
  const app = new ThreemaApp({
    gladys,
    store,
    threema: threema.client,
    logger: memoryLogger(),
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
  });
  t.after(async () => {
    await Promise.race([app.stop(), new Promise((resolve) => setTimeout(resolve, 500))]);
    clock.close();
  });
  await app.start();
  // Past the first read budget (2 s): the message is not delayed by /data.
  await waitFor(() => reads.length >= 1, 'first read', 5_000);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const started = clock.monotonic();
  const ack = await gladys.fake.sendMessage({ recipient: ALICE }, { text: 'Hello', file: null });
  const ackedIn = clock.monotonic() - started;
  assert.equal(ack.success, true);
  assert.ok(ackedIn >= 3_400 && ackedIn <= 3_700, `acked in ${ackedIn}`);
  await waitFor(() => abortedAt !== undefined, 'the abort', 10_000);
  const abortIn = abortedAt - started;
  assert.ok(abortIn >= 14_900 && abortIn <= 19_000, `aborted at ${abortIn}`);
  await waitFor(() => reads.length >= 4, '4 reads of /data', 10_000);
  const gaps = reads.slice(1).map((at, i) => at - reads[i]);
  for (const gap of gaps) assert.ok(gap >= 9_900 && gap <= 15_000, `gap ${gap}`);
  assert.equal(threema.sends.length, 1, 'never repeated');

  await app.stop();
  const count = reads.length;
  await new Promise((resolve) => setTimeout(resolve, 1500)); // 7.5 s simulated
  assert.equal(reads.length, count, 'no read after stop');
  assert.equal(threema.sends.length, 1);
  assert.equal(clock.live, 0, 'no timer left');
});
