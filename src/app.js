// -----------------------------------------------------------------------------
// Threema messages from Gladys, send only (Threema Gateway, basic mode).
//
// What leaves, and only then:
//   - the "Send a Threema message" scene action, to a recipient of the list of
//     allowed recipients of the configuration (never one taken from a text);
//   - the "Send a test message" button (one credit) and the "Check the
//     account" button (free: the credits left, nothing sent);
//   - the messages Gladys sends to a user (core "Send a message" scene action,
//     Gladys notifications), to the recipient this user entered in "My
//     account", ONLY when the "forward Gladys messages" option is on (off by
//     default).
// Nothing is ever sent at start, at a (re)connection, on a timer or again
// after a failure: a request that may have left is never repeated.
//
// What protects the bill and the account:
//   - the hourly limit (a sliding hour), counted before a request leaves and
//     kept in /data (a send that may have left stays counted);
//   - one request in flight, 10 waiting, the others refused;
//   - after a rate limit or a server error: a pause (60 s doubled up to 1 h,
//     a Retry-After up to 6 h), kept in /data, on every path, buttons included;
//   - an ID and secret refused by Threema (401): nothing more sent with them
//     (8 bits of a salted hash in /data) until they change or a button succeeds.
// Time: every pause and the hourly window on the monotonic clock; the wall
// clock only for /data (across a restart) and the times shown.
// -----------------------------------------------------------------------------

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readConfig } from './config.js';
import {
  ACTION_DEADLINE_MS,
  ACTIONS,
  CONFIG_RETRY_MAX_MS,
  CONFIG_RETRY_MIN_MS,
  CONFIG_WAIT_MS,
  HOUR_MS,
  MAX_INPUT_CHARS,
  MAX_PER_HOUR,
  MAX_TEXT_BYTES,
  MAX_WAITING,
  MESSAGE_ACK_MS,
  PAUSE_MAX_MS,
  PAUSE_MIN_MS,
  REQUEST_TIMEOUT_MS,
  RETRY_AFTER_MAX_MS,
  SAVE_BUDGET_MS,
  SCENE_ACTIONS,
  STORE_LOAD_BUDGET_MS,
  STORE_RETRY_MS,
} from './constants.js';
import { both, t } from './i18n.js';
import { mask, parseRecipient } from './recipients.js';
import { ThreemaError } from './threema.js';

const credsOf = (cfg) => `${cfg.identity}\n${cfg.secret}`;
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
export const fp8 = (salt, cfg) => createHmac('sha256', salt).update(credsOf(cfg)).digest()[0];
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
/** The sends of the last hour kept in /data: never more than this. */
const MAX_KEPT = MAX_PER_HOUR * 2;

/** Bounded wait: resolves `fallback` after `ms` if `promise` is slower. */
function within(promise, ms, timers, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = timers.setTimeout(() => resolve(fallback), Math.max(0, ms));
    }),
  ]).finally(() => timers.clearTimeout(timer));
}

/**
 * The text cleaned (control characters but tab and line feed become spaces)
 * and cut to 3,500 bytes of UTF-8, ending with "…" when cut.
 */
export function cleanText(raw) {
  const text = String(raw ?? '')
    .slice(0, MAX_INPUT_CHARS)
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- control characters are what it removes
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim();
  if (Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES) return text;
  let out = '';
  let bytes = 0;
  const room = MAX_TEXT_BYTES - 3; // "…" is 3 bytes
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > room) break;
    out += ch;
    bytes += size;
  }
  return `${out}…`;
}

export class ThreemaApp {
  constructor({
    gladys,
    store,
    threema,
    logger = console,
    now = () => performance.now(),
    wallNow = () => Date.now(),
    timers = { setTimeout, clearTimeout },
  }) {
    Object.assign(this, { gladys, store, threema, logger, now, wallNow, timers });
    this.stopped = false;
    // Configuration.
    this.config = null;
    this.configRead = false;
    this.configLoop = null;
    this.configTimer = null;
    this.configWaiters = [];
    // /data.
    this.storeReady = false;
    this.loading = null;
    this.storeTimer = null;
    this.firstLoad = null;
    this.sent = []; // monotonic times of the sends of the last hour, oldest first
    this.pauseUntil = 0; // monotonic
    this.pauseStep = 0;
    this.refused = null; // { salt, fp } (persisted)
    this.refusedFull = null; // sha256 of the refused ID and secret, this process only
    this.succeeded = null; // the ID and secret of the last success, to drop a stale refusal
    // Requests.
    this.busy = false;
    this.waiting = [];
    this.controllers = new Set();
    // Status.
    this.outcome = 'ready';
    this.outcomeVars = {};
    this.lastStatus = null;
    this.persisted = undefined;
  }

  /** Handlers first, then /data, then the connection. */
  async start() {
    const { gladys } = this;
    gladys.onSendMessage((contact, message) => this.onMessage(contact, message));
    gladys.onSceneAction(SCENE_ACTIONS.SEND, (fields) => this.sceneSend(fields));
    gladys.onAction(ACTIONS.CHECK, () => this.check());
    gladys.onAction(ACTIONS.TEST, (fields) => this.test(fields));
    gladys.onConfigUpdated(async (raw) => this.applyConfig(raw));
    gladys.on('connected', () => this.onConnected());
    this.firstLoad = this.loadStore();
    await gladys.connect();
  }

  async stop() {
    this.stopped = true;
    for (const timer of [this.configTimer, this.storeTimer]) this.timers.clearTimeout(timer);
    this.configTimer = null;
    this.storeTimer = null;
    for (const w of this.waiting.splice(0)) {
      this.timers.clearTimeout(w.timer);
      w.reject(new Error(t('stopped')));
    }
    for (const c of this.controllers) c.abort();
    for (const w of this.configWaiters.splice(0)) w();
    await this.store.flush?.();
  }

  // --- Configuration -----------------------------------------------------------

  /** Every (re)connection: the configuration read again, the status published again. Nothing sent. */
  onConnected() {
    this.lastStatus = null;
    this.refreshConfig(CONFIG_RETRY_MIN_MS);
    this.publishStatus();
  }

  /** getConfig() until it answers, 5 s doubled up to 60 s between tries, without end. */
  refreshConfig(delay) {
    if (this.configLoop || this.stopped) return;
    this.timers.clearTimeout(this.configTimer);
    this.configTimer = null;
    this.configLoop = (async () => {
      try {
        const raw = await this.gladys.getConfig();
        if (this.stopped) return;
        this.applyConfig(raw);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`getConfig failed (${err?.name ?? 'error'}); retry in ${delay / 1000} s`);
        this.publishStatus();
        this.configTimer = this.timers.setTimeout(() => {
          this.configTimer = null;
          this.refreshConfig(Math.min(delay * 2, CONFIG_RETRY_MAX_MS));
        }, delay);
      } finally {
        this.configLoop = null;
      }
    })();
  }

  applyConfig(raw) {
    const cfg = readConfig(raw);
    const before = this.config;
    const sameCreds = before?.ok && cfg.ok && credsOf(before) === credsOf(cfg);
    this.config = cfg;
    this.configRead = true;
    // New ID or secret: the last outcome no longer says anything. The same
    // ones saved again keep it (no false reason, no temporary refusal).
    if (!sameCreds) {
      this.outcome = 'ready';
      this.outcomeVars = {};
    }
    for (const w of this.configWaiters.splice(0)) w();
    this.publishStatus();
  }

  /** Waits (bounded) for the configuration and the first read of /data. */
  async ready(budget = CONFIG_WAIT_MS) {
    const waits = [];
    if (!this.configRead) {
      if (!this.configLoop && !this.configTimer) this.refreshConfig(CONFIG_RETRY_MIN_MS);
      waits.push(
        within(new Promise((resolve) => this.configWaiters.push(resolve)), budget, this.timers),
      );
    }
    if (!this.storeReady && this.firstLoad) {
      waits.push(within(this.firstLoad, Math.min(budget, STORE_LOAD_BUDGET_MS), this.timers));
    }
    await Promise.all(waits);
    if (this.stopped) throw new Error(t('stopped'));
  }

  /** The configuration, usable, or throws why not. */
  usableConfig() {
    const cfg = this.config;
    if (!cfg) throw new Error(t('config_unread'));
    if (!cfg.ok) throw new Error(t(cfg.reason, 'en', cfg.vars));
    return cfg;
  }

  // --- /data ------------------------------------------------------------------------

  /** One read at a time; an unreadable /data is read again every 10 s, never overwritten. */
  loadStore() {
    if (this.loading || this.storeReady || this.stopped) return this.loading;
    this.loading = (async () => {
      try {
        const data = await this.store.load();
        if (this.stopped) return;
        this.merge(data);
      } catch (err) {
        if (this.stopped) return;
        this.logger.warn(`/data unreadable (${err?.message ?? 'error'}); read again in 10 s`);
        this.storeTimer = this.timers.setTimeout(() => {
          this.storeTimer = null;
          this.loadStore();
        }, STORE_RETRY_MS);
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  /** What /data says, merged with what happened since the start (never lost). */
  merge(data) {
    const now = this.now();
    const wall = this.wallNow();
    if (Array.isArray(data?.sent)) {
      const kept = [];
      for (const at of data.sent.slice(-MAX_KEPT)) {
        if (!Number.isFinite(at)) continue;
        const age = wall - at;
        // A date in the future (beyond a minute of drift) is invalid; older than an hour, done.
        if (age < -60_000 || age >= HOUR_MS) continue;
        kept.push(now - Math.max(0, age));
      }
      this.sent = [...kept, ...this.sent].sort((a, b) => a - b).slice(-MAX_KEPT);
    }
    const pause = data?.pause;
    if (pause && Number.isFinite(pause.until)) {
      const left = pause.until - wall;
      // A date further than the longest pause is invalid (clock jumped, foreign file).
      if (left > 0 && left <= RETRY_AFTER_MAX_MS) {
        this.pauseUntil = Math.max(this.pauseUntil, now + left);
      }
      if (isInt(pause.step, PAUSE_MIN_MS, PAUSE_MAX_MS)) {
        this.pauseStep = Math.max(this.pauseStep, pause.step);
      }
    }
    const refused = data?.refused;
    if (
      !this.refused &&
      refused &&
      typeof refused.salt === 'string' &&
      /^[0-9a-f]{32}$/.test(refused.salt) &&
      isInt(refused.fp, 0, 255)
    ) {
      // An ID and secret that succeeded since the start lift a refusal read late.
      const lifted = this.succeeded && fp8(refused.salt, this.succeeded) === refused.fp;
      if (!lifted) this.refused = { salt: refused.salt, fp: refused.fp };
    }
    this.storeReady = true;
    this.save();
    this.publishStatus();
  }

  snapshot() {
    const now = this.now();
    const wall = this.wallNow();
    const left = this.pauseUntil - now;
    return {
      sent: this.window(now).map((at) => Math.round(wall - (now - at))),
      pause:
        left > 0 || this.pauseStep
          ? { until: wall + Math.max(0, left), step: this.pauseStep }
          : null,
      refused: this.refused ? { ...this.refused } : null,
    };
  }

  /** Resolves true once written, false when /data is not read or the write failed. */
  save() {
    if (!this.storeReady) return Promise.resolve(false);
    return this.store.save(this.snapshot()).then(
      () => {
        this.setPersisted(true);
        return true;
      },
      (err) => {
        this.logger.warn(`/data not saved (${err?.message ?? 'error'})`);
        this.setPersisted(false);
        return false;
      },
    );
  }

  setPersisted(value) {
    if (this.persisted === value) return;
    this.persisted = value;
    this.publishStatus();
  }

  // --- Guards -------------------------------------------------------------------------

  isRefused(cfg) {
    if (this.refusedFull) return this.refusedFull === sha256(credsOf(cfg));
    return Boolean(this.refused) && fp8(this.refused.salt, cfg) === this.refused.fp;
  }

  pausedFor(now = this.now()) {
    return Math.max(0, this.pauseUntil - now);
  }

  /** The sends of the last hour (monotonic times); the older ones dropped. */
  window(now) {
    while (this.sent.length && now - this.sent[0] >= HOUR_MS) this.sent.shift();
    return this.sent;
  }

  /** Throws the reason nothing can be sent now (the order is the status order). */
  gate(cfg, { allowRefused = false } = {}) {
    const now = this.now();
    if (!allowRefused && this.isRefused(cfg)) throw new Error(t('refused'));
    const left = this.pausedFor(now);
    if (left > 0) throw new Error(t('paused', 'en', { time: this.timeIn(left) }));
    const sent = this.window(now);
    if (sent.length >= cfg.perHour) {
      // Free again when the oldest send that keeps the count at the limit leaves the hour.
      const freeAt = sent[sent.length - cfg.perHour] + HOUR_MS;
      throw new Error(
        t('limit_reached', 'en', { limit: cfg.perHour, time: this.timeIn(freeAt - now) }),
      );
    }
    return now;
  }

  timeIn(ms) {
    return new Date(this.wallNow() + Math.max(0, ms)).toISOString().slice(11, 16);
  }

  // --- Queue: one request in flight ----------------------------------------------------

  acquire(deadline) {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve();
    }
    if (this.waiting.length >= MAX_WAITING) return Promise.reject(new Error(t('busy')));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = this.timers.setTimeout(
        () => {
          this.waiting = this.waiting.filter((w) => w !== waiter);
          reject(new Error(t('deadline')));
        },
        Math.max(0, deadline - this.now()),
      );
      this.waiting.push(waiter);
    });
  }

  release() {
    const next = this.waiting.shift();
    if (next) {
      this.timers.clearTimeout(next.timer);
      next.resolve(); // the slot passes on
    } else {
      this.busy = false;
    }
  }

  /** Runs `fn(signal)` with an abort at `ms`. */
  async withTimeout(ms, fn) {
    const controller = new AbortController();
    const timer = this.timers.setTimeout(() => controller.abort(), Math.max(0, ms));
    this.controllers.add(controller);
    try {
      return await fn(controller.signal);
    } finally {
      this.timers.clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  // --- Entry points ------------------------------------------------------------------

  /** onSendMessage: a Gladys message to a user, only when the option is on. */
  async onMessage(contact, message) {
    const deadline = this.now() + ACTION_DEADLINE_MS;
    await this.ready();
    const cfg = this.usableConfig();
    if (!cfg.forward) throw new Error(t('forward_off'));
    const recipient = parseRecipient(contact?.recipient);
    if (!recipient) throw new Error(t('contact_invalid'));
    const text = cleanText(message?.text);
    if (!text) throw new Error(t('empty_text'));
    // Gladys waits 5 s for the ack: answered at 3.5 s at most; the send goes
    // on and its outcome is logged and shown in the status.
    const job = this.deliver({ recipient, text, deadline, origin: 'message' });
    const result = await within(
      job.then(
        () => 'sent',
        (err) => err,
      ),
      MESSAGE_ACK_MS,
      this.timers,
      'pending',
    );
    if (result instanceof Error) throw result;
    return undefined;
  }

  /** The scene action: to a recipient of the allowed list (empty: the first one). */
  async sceneSend(fields = {}) {
    const deadline = this.now() + ACTION_DEADLINE_MS;
    await this.ready();
    const cfg = this.usableConfig();
    const recipient = this.allowedRecipient(cfg, fields?.recipient);
    const text = cleanText(fields?.text);
    if (!text) throw new Error(t('empty_text'));
    const { messageId } = await this.deliver({ recipient, text, deadline, origin: 'scene' });
    return { message_id: messageId ?? '' };
  }

  /** The "Send a test message" button: one message, even with a refused ID (never during a pause). */
  async test(fields = {}) {
    const deadline = this.now() + ACTION_DEADLINE_MS;
    await this.ready();
    const cfg = this.usableConfig();
    const recipient = this.allowedRecipient(cfg, fields?.recipient);
    const started = this.now();
    const text = `${t('test_text', 'fr')}\n${t('test_text', 'en')}`;
    await this.deliver({ recipient, text, deadline, origin: 'test', allowRefused: true });
    return both('test_ok', { to: mask(recipient), ms: Math.round(this.now() - started) });
  }

  /** The "Check the account" button: the credits left; nothing sent, nothing counted. */
  async check() {
    const deadline = this.now() + ACTION_DEADLINE_MS;
    await this.ready();
    const cfg = this.usableConfig();
    this.gate({ ...cfg, perHour: Infinity }, { allowRefused: true });
    await this.acquire(deadline);
    try {
      if (this.stopped) throw new Error(t('stopped'));
      const current = this.config;
      if (!current?.ok || credsOf(current) !== credsOf(cfg)) throw new Error(t('config_changed'));
      this.gate({ ...cfg, perHour: Infinity }, { allowRefused: true });
      const left = Math.min(REQUEST_TIMEOUT_MS, deadline - this.now());
      if (left <= 0) throw new Error(t('deadline'));
      let credits;
      try {
        credits = await this.withTimeout(left, (signal) => this.threema.credits(cfg, signal));
      } catch (err) {
        this.failed(err, cfg, null);
        throw new Error(this.message(err, null), { cause: err });
      }
      this.succeededWith(cfg);
      this.logger.info(`account checked: ${credits} credits left`);
      return both('check_ok', { credits });
    } finally {
      this.release();
    }
  }

  /** The recipient asked by a scene or the button: in the allowed list, or the first of it. */
  allowedRecipient(cfg, raw) {
    const wanted = typeof raw === 'string' ? raw.trim() : '';
    if (!wanted) {
      if (!cfg.recipients.length) throw new Error(t('no_recipient'));
      return cfg.recipients[0];
    }
    const recipient = parseRecipient(wanted);
    if (!recipient) throw new Error(t('recipient_invalid'));
    const allowed = cfg.recipients.find((r) => r.key === recipient.key);
    if (!allowed) throw new Error(t('recipient_not_allowed', 'en', { to: mask(recipient) }));
    return allowed;
  }

  // --- Sending --------------------------------------------------------------------------

  /** Gate, queue, gate again, count, save, send once. */
  async deliver({ recipient, text, deadline, origin, allowRefused = false }) {
    const cfg = this.usableConfig();
    this.gate(cfg, { allowRefused });
    await this.acquire(deadline);
    let at = null;
    try {
      if (this.stopped) throw new Error(t('stopped'));
      // Things may have changed while waiting: the configuration, a refusal, a pause, the count.
      const current = this.config;
      if (!current?.ok || credsOf(current) !== credsOf(cfg)) throw new Error(t('config_changed'));
      at = this.gate(current, { allowRefused });
      if (deadline - this.now() <= 0) throw new Error(t('deadline'));
      // Counted in memory before it leaves (the limit always holds while the
      // process runs), and written to /data first, 1 s at most: a slow or
      // read-only /data never blocks a message; the status then says the
      // count is not saved.
      this.sent.push(at);
      const saved = await within(this.save(), SAVE_BUDGET_MS, this.timers, false);
      if (!saved) this.setPersisted(false);
      if (this.stopped) throw new Error(t('stopped'));
      const after = this.config;
      if (!after?.ok || credsOf(after) !== credsOf(cfg)) throw new Error(t('config_changed'));
      const left = Math.min(REQUEST_TIMEOUT_MS, deadline - this.now());
      if (left <= 0) throw new Error(t('deadline'));
      const started = this.now();
      let result;
      try {
        result = await this.withTimeout(left, (signal) =>
          this.threema.send(cfg, recipient, text, signal),
        );
      } catch (err) {
        if (!(err instanceof ThreemaError) || err.sent === false) this.unsend(at);
        at = null;
        this.failed(err, cfg, recipient, origin);
        throw new Error(this.message(err, recipient), { cause: err });
      }
      at = null;
      this.succeededWith(cfg);
      this.logger.info(
        `${origin}: message sent to ${mask(recipient)} (${Buffer.byteLength(text, 'utf8')} bytes, ${Math.round(this.now() - started)} ms)`,
      );
      return result;
    } catch (err) {
      // Never left (stopped, configuration changed, deadline): not counted.
      if (at !== null) this.unsend(at);
      throw err;
    } finally {
      this.release();
    }
  }

  unsend(at) {
    const i = this.sent.lastIndexOf(at);
    if (i >= 0) {
      this.sent.splice(i, 1);
      this.save();
    }
  }

  succeededWith(cfg) {
    this.pauseStep = 0;
    this.pauseUntil = 0;
    this.refused = null;
    this.refusedFull = null;
    this.succeeded = { identity: cfg.identity, secret: cfg.secret };
    this.outcome = 'working';
    this.outcomeVars = {};
    this.save();
    this.publishStatus();
  }

  failed(err, cfg, recipient, origin = 'check') {
    const kind = err instanceof ThreemaError ? err.kind : 'network';
    if (kind === 'refused') {
      const salt = randomBytes(16).toString('hex');
      this.refused = { salt, fp: fp8(salt, cfg) };
      this.refusedFull = sha256(credsOf(cfg));
      this.succeeded = null;
      this.outcome = 'refused';
    } else if (kind === 'throttled' || kind === 'unavailable') {
      this.pauseStep = this.pauseStep ? Math.min(this.pauseStep * 2, PAUSE_MAX_MS) : PAUSE_MIN_MS;
      const asked = Number.isFinite(err.retryAfterMs)
        ? Math.min(err.retryAfterMs, RETRY_AFTER_MAX_MS)
        : 0;
      this.pauseUntil = this.now() + Math.max(this.pauseStep, asked);
    } else if (kind !== 'bad_recipient' && kind !== 'not_found' && kind !== 'too_long') {
      // A wrong recipient is the scene's problem, not the account's.
      this.outcome = kind;
      this.outcomeVars = { status: err?.status ?? '' };
    }
    this.logger.warn(
      `${origin} failed: ${kind}${err?.status ? ` HTTP ${err.status}` : err?.code ? ` (${err.code})` : ''}${recipient ? ` (recipient ${mask(recipient)})` : ''}${err?.sent === false ? ', nothing sent' : ''}`,
    );
    this.save();
    this.publishStatus();
  }

  message(err, recipient) {
    const kind = err instanceof ThreemaError ? err.kind : 'network';
    if (kind === 'throttled' || kind === 'unavailable') {
      return t('paused', 'en', { time: this.timeIn(this.pausedFor()) });
    }
    if (kind === 'network' && err?.sent === false) return t('network_not_sent');
    return t(kind, 'en', { to: mask(recipient), status: err?.status ?? '' });
  }

  // --- Status -------------------------------------------------------------------------

  status() {
    if (!this.configRead) return { ok: false, key: 'config_unread' };
    const cfg = this.config;
    if (!cfg.ok) return { ok: false, key: cfg.reason, vars: cfg.vars };
    if (this.isRefused(cfg)) return { ok: false, key: 'refused' };
    const now = this.now();
    const left = this.pausedFor(now);
    if (left > 0) return { ok: false, key: 'paused', vars: { time: this.timeIn(left) } };
    const sent = this.window(now);
    if (sent.length >= cfg.perHour) {
      const freeAt = sent[sent.length - cfg.perHour] + HOUR_MS;
      return {
        ok: false,
        key: 'limit_reached',
        vars: { limit: cfg.perHour, time: this.timeIn(freeAt - now) },
      };
    }
    if (
      (!this.storeReady || this.persisted === false) &&
      (this.outcome === 'working' || this.outcome === 'ready')
    ) {
      return { ok: true, key: 'not_persisted' };
    }
    if (this.outcome === 'working') return { ok: true, key: 'working' };
    if (this.outcome !== 'ready' && this.outcome !== 'refused') {
      return { ok: false, key: this.outcome, vars: this.outcomeVars };
    }
    return { ok: true, key: 'ready' };
  }

  /** One setConnectionStatus per change of state. */
  publishStatus() {
    if (this.stopped) return;
    const { ok, key, vars = {} } = this.status();
    const message = both(key, vars);
    const id = JSON.stringify([ok, message]);
    if (id === this.lastStatus) return;
    this.lastStatus = id;
    Promise.resolve()
      .then(() => this.gladys.setConnectionStatus(ok, message))
      .catch((err) => {
        if (this.lastStatus === id) this.lastStatus = null;
        this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'error'})`);
      });
  }
}
