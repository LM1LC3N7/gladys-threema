// -----------------------------------------------------------------------------
// Configuration: the values of the `config_schema`, checked. `readConfig`
// never throws: it returns `{ ok: true, ... }` or `{ ok: false, reason }`, the
// reason being an i18n key (an invalid value is never shown back).
// -----------------------------------------------------------------------------

import { DEFAULT_PER_HOUR, MAX_PER_HOUR, MIN_PER_HOUR } from './constants.js';
import { parseRecipientList } from './recipients.js';

// A Gateway ID: 8 characters, starting with * (the IDs Threema gives to the Gateway).
const IDENTITY = /^\*[A-Z0-9]{7}$/;
// The API secret: printable ASCII, no space (16 letters and digits today).
const SECRET = /^[\x21-\x7e]{8,128}$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the values from Gladys
 */
export function readConfig(raw = {}) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const identity = text(config.identity).toUpperCase();
  const secret = text(config.secret);
  if (!identity && !secret) return { ok: false, reason: 'not_configured' };
  if (!identity) return { ok: false, reason: 'identity_missing' };
  if (!secret) return { ok: false, reason: 'secret_missing' };
  if (!IDENTITY.test(identity)) return { ok: false, reason: 'identity_invalid' };
  if (!SECRET.test(secret)) return { ok: false, reason: 'secret_invalid' };

  const recipients = parseRecipientList(config.recipients);
  if (!recipients.ok) {
    return { ok: false, reason: recipients.reason, vars: { position: recipients.position ?? '' } };
  }

  let perHour = DEFAULT_PER_HOUR;
  const rawLimit = config.max_messages_per_hour;
  if (rawLimit !== undefined && rawLimit !== null && rawLimit !== '') {
    // Strict: a decimal or a text is not a number of messages.
    const n = typeof rawLimit === 'number' ? rawLimit : Number(text(rawLimit));
    if (
      !Number.isInteger(n) ||
      (typeof rawLimit === 'string' && !/^\d+$/.test(text(rawLimit))) ||
      n < MIN_PER_HOUR ||
      n > MAX_PER_HOUR
    ) {
      return { ok: false, reason: 'limit_invalid' };
    }
    perHour = n;
  }

  // Only `true` turns it on: absent, empty or anything else is off.
  const forward =
    config.forward_gladys_messages === true || config.forward_gladys_messages === 'true';

  return { ok: true, identity, secret, recipients: recipients.list, perHour, forward };
}
