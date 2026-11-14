// -----------------------------------------------------------------------------
// Recipients: a Threema ID (8 characters), a phone number in international
// format (+41 79 123 45 67 or 0041..., sent without the +) or an e-mail
// address. `parseRecipient` never throws: a recipient or null. `mask` is what
// the logs and the messages may show: never a whole ID, number or address.
// -----------------------------------------------------------------------------

import { MAX_RECIPIENTS } from './constants.js';

// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ID = /^[A-Z0-9*][A-Z0-9]{7}$/;
const EMAIL =
  /^[^\s@"<>(),;:\\[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * @param {unknown} raw
 * @returns {{ kind: 'to'|'phone'|'email', value: string, key: string } | null}
 */
export function parseRecipient(raw) {
  if (typeof raw !== 'string' || raw.length > 254 || CONTROL.test(raw)) return null;
  const text = raw.trim();
  if (!text) return null;
  if (text.includes('@')) {
    const email = text.toLowerCase();
    if (email.length > 254 || !EMAIL.test(email)) return null;
    return { kind: 'email', value: email, key: `email:${email}` };
  }
  if (text.startsWith('+') || text.startsWith('00')) {
    const compact = text.replace(/[\s.\-/()]/g, '');
    const digits = compact.startsWith('+') ? compact.slice(1) : compact.slice(2);
    // E.164: a country code that never starts with 0, 15 digits at most.
    if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
    return { kind: 'phone', value: digits, key: `phone:${digits}` };
  }
  const id = text.toUpperCase();
  if (!ID.test(id)) return null;
  return { kind: 'to', value: id, key: `to:${id}` };
}

/** What a log or a message may show of a recipient. */
export function mask(recipient) {
  if (!recipient) return '?';
  if (recipient.kind === 'to') return `${recipient.value.slice(0, 2)}******`;
  if (recipient.kind === 'phone') return `+…${recipient.value.slice(-2)}`;
  return `${recipient.value[0]}…@…`;
}

/**
 * The allowed recipients of the configuration: separated by commas, semicolons
 * or new lines; duplicates removed.
 * @returns {{ ok: true, list: object[] } | { ok: false, reason: string, position?: number }}
 */
export function parseRecipientList(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, list: [] };
  if (typeof raw !== 'string') return { ok: false, reason: 'recipients_invalid', position: 1 };
  const parts = raw
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const list = [];
  const seen = new Set();
  for (const [i, part] of parts.entries()) {
    const r = parseRecipient(part);
    // The position only: the value itself is never shown back.
    if (!r) return { ok: false, reason: 'recipients_invalid', position: i + 1 };
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    list.push(r);
  }
  if (list.length > MAX_RECIPIENTS) return { ok: false, reason: 'recipients_too_many' };
  return { ok: true, list };
}
