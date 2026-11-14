// -----------------------------------------------------------------------------
// The Threema Gateway in basic mode (https://gateway.threema.ch/en/developer/api):
//   POST /send_simple  from, to|phone|email, text, secret  -> 200 + message ID
//   GET  /credits      from, secret                        -> 200 + credits left
// Basic mode: the Gateway server holds the key of the identity and prepares
// the message for the recipient itself. No library: `fetch` (Node), no
// redirect followed, no retry (a send that may have left is never sent
// again), the answer read no further than 1 KB. Every failure becomes a
// ThreemaError whose `kind` drives the app; no message carries the secret,
// the text or the recipient.
// -----------------------------------------------------------------------------

import { API_BASE, MAX_ANSWER_BYTES } from './constants.js';

export class ThreemaError extends Error {
  /**
   * @param {'refused'|'no_credits'|'bad_recipient'|'not_found'|'too_long'|'throttled'|'unavailable'|'unexpected'|'timeout'|'network'|'bad_answer'} kind
   */
  constructor(kind, { status, code, retryAfterMs, sent = true } = {}) {
    super(`Threema Gateway: ${kind}${status ? ` (HTTP ${status})` : code ? ` (${code})` : ''}`);
    this.name = 'ThreemaError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    // false only when the request certainly never left, or the Gateway
    // answered that it did not take the message (4xx).
    this.sent = sent;
  }
}

// Errors raised before a single byte of the request could leave.
const NOT_SENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Seconds of a Retry-After header (numbers only); the caller bounds it. */
function retryAfterOf(headers) {
  const raw = headers?.get?.('retry-after');
  if (typeof raw !== 'string' || !/^\d{1,6}$/.test(raw.trim())) return undefined;
  return Number(raw.trim()) * 1000;
}

/** The ThreemaError of an HTTP answer that is not a 200. */
export function classifyStatus(status, headers, { sending }) {
  const retryAfterMs = retryAfterOf(headers);
  // A 4xx says the Gateway did not take the message; a 5xx may come after it did.
  const sent = !(status >= 300 && status < 500);
  const kind =
    status === 401
      ? 'refused'
      : status === 402
        ? 'no_credits'
        : status === 400 && sending
          ? 'bad_recipient'
          : status === 404 && sending
            ? 'not_found'
            : status === 413
              ? 'too_long'
              : status === 429
                ? 'throttled'
                : status >= 500
                  ? 'unavailable'
                  : 'unexpected';
  return new ThreemaError(kind, { status, retryAfterMs, sent });
}

/** The ThreemaError of a fetch that threw. */
export function classifyThrown(err, signal) {
  if (err instanceof ThreemaError) return err;
  const code = err?.cause?.code ?? err?.code;
  if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new ThreemaError('timeout', { code: 'timeout' });
  }
  return new ThreemaError('network', {
    code: typeof code === 'string' ? code.slice(0, 40) : undefined,
    sent: !NOT_SENT_CODES.has(code),
  });
}

/** The body as text, 1 KB at most (a larger answer is cut and refused). */
async function readSmall(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ThreemaError('bad_answer', { code: 'too_large' });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

/** Drops the body of an answer we do not read. */
function discard(response) {
  response.body?.cancel?.().catch(() => {});
}

/**
 * @param {{ fetch?: typeof fetch, baseUrl?: string, userAgent?: string }} options
 */
export function createThreema({ fetch: fetchImpl = fetch, baseUrl = API_BASE, userAgent } = {}) {
  const headers = { 'user-agent': userAgent ?? 'gladys-threema', accept: 'text/plain' };

  return {
    /**
     * Sends `text` to `recipient` ({ kind, value }); resolves `{ messageId }`
     * (null when the answer is not a message ID: the message left all the same).
     */
    async send({ identity, secret }, recipient, text, signal) {
      const body = new URLSearchParams();
      body.set('from', identity);
      body.set(recipient.kind, recipient.value);
      body.set('text', text);
      body.set('secret', secret);
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/send_simple`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          redirect: 'manual',
          signal,
        });
      } catch (err) {
        throw classifyThrown(err, signal);
      }
      if (response.status !== 200) {
        discard(response);
        throw classifyStatus(response.status, response.headers, { sending: true });
      }
      let answer;
      try {
        answer = await readSmall(response);
      } catch (err) {
        // Answered 200: the message left, whatever the rest of the answer.
        if (err instanceof ThreemaError) return { messageId: null };
        const thrown = classifyThrown(err, signal);
        if (thrown.kind === 'timeout' || thrown.kind === 'network') return { messageId: null };
        throw thrown;
      }
      return { messageId: /^[0-9a-f]{16}$/i.test(answer) ? answer.toLowerCase() : null };
    },

    /** The credits left on the account (free request). */
    async credits({ identity, secret }, signal) {
      const query = new URLSearchParams({ from: identity, secret });
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/credits?${query}`, {
          method: 'GET',
          headers,
          redirect: 'manual',
          signal,
        });
      } catch (err) {
        throw classifyThrown(err, signal);
      }
      if (response.status !== 200) {
        discard(response);
        throw classifyStatus(response.status, response.headers, { sending: false });
      }
      let answer;
      try {
        answer = await readSmall(response);
      } catch (err) {
        throw classifyThrown(err, signal);
      }
      if (!/^\d{1,12}$/.test(answer))
        throw new ThreemaError('bad_answer', { code: 'not_a_number' });
      return Number(answer);
    },
  };
}
