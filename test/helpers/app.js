// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted Threema Gateway (no
// network) and the virtual clock: nothing fires by itself, `clock.advance(ms)`
// moves the time and runs the timers due on the way.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ThreemaApp } from '../../src/app.js';
import { ThreemaError } from '../../src/threema.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from './clock.js';

export const SELECTOR = 'threema';
// Made-up values: never a real ID or secret.
export const IDENTITY = '*GLADYS1';
export const SECRET = 'S3cr3tTestValue9';
export const SECRET_2 = 'OtherTestSecret7';
export const ALICE = 'ALICE123';
export const BOB = 'BOB45678';
export const PHONE = '+41 79 123 45 67';
export const CONFIG = {
  identity: IDENTITY,
  secret: SECRET,
  recipients: `${ALICE}, ${BOB}, ${PHONE}`,
};
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
// 2026-11-14 10:00 UTC.
export const START = Date.UTC(2026, 10, 14, 10, 0, 0);
export const MESSAGE_ID = '0a1b2c3d4e5f6789';

export function memoryLogger() {
  const lines = [];
  const log = (level) => (msg) => lines.push(`${level} ${msg}`);
  return { lines, info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') };
}

/**
 * A scripted Gateway: `answer(call)` -> `{ messageId }` or a promise of it, or
 * throws (a ThreemaError); `credits(call)` -> a number. `sends` and `checks`
 * record every request.
 */
export function fakeThreema({
  answer = () => ({ messageId: MESSAGE_ID }),
  credits = () => 1234,
} = {}) {
  const fake = { answer, credits, sends: [], checks: [] };
  fake.client = {
    send: async (cfg, recipient, text, signal) => {
      const call = { cfg, recipient, text, signal };
      fake.sends.push(call);
      return fake.answer(call);
    },
    credits: async (cfg, signal) => {
      const call = { cfg, signal };
      fake.checks.push(call);
      return fake.credits(call);
    },
  };
  return fake;
}

/** A promise that never settles unless the signal aborts it (then: timeout, may have left). */
export function hangUntilAbort(call) {
  return new Promise((_, reject) => {
    call.signal.addEventListener('abort', () =>
      reject(new ThreemaError('timeout', { code: 'timeout' })),
    );
  });
}

export async function makeApp({
  config = CONFIG,
  store = createMemoryStore(),
  threema = fakeThreema(),
  clock = testClock({ start: START }),
  gladys = createFakeGladys({ selector: SELECTOR, config }),
  connect = true,
} = {}) {
  const logger = memoryLogger();
  const app = new ThreemaApp({
    gladys,
    store,
    threema: threema.client,
    logger,
    now: clock.monotonic,
    wallNow: clock.now,
    timers: clock.timers,
  });
  if (connect) {
    await app.start();
    await settle();
  }
  return { app, gladys, store, threema, clock, logger };
}

/** The last connection status: [connected, english message]. */
export function lastStatus(gladys) {
  const s = gladys.fake.connectionStatus;
  return s ? [s.connected, s.message?.en ?? ''] : undefined;
}

export { settle };
