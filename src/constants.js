// -----------------------------------------------------------------------------
// Fixed values: the Threema Gateway endpoints (basic mode) and the limits the
// integration holds itself to. Source: the official API documentation,
// https://gateway.threema.ch/en/developer/api (read in November 2026).
// -----------------------------------------------------------------------------

export const API_BASE = 'https://msgapi.threema.ch';

export const ACTIONS = { CHECK: 'check_account', TEST: 'send_test' };
export const SCENE_ACTIONS = { SEND: 'send_message' };

/** The Gateway refuses a text over 3,500 bytes (UTF-8); longer texts are cut here first. */
export const MAX_TEXT_BYTES = 3500;
/** Gladys texts are 4,096 characters at most; read no further. */
export const MAX_INPUT_CHARS = 4096;
/** An answer of the Gateway is a message ID or a number: read 1 KB at most. */
export const MAX_ANSWER_BYTES = 1024;

/** A send or a credit check: the answer within 15 s, or it is abandoned (never sent again). */
export const REQUEST_TIMEOUT_MS = 15_000;
/** Gladys waits 5 s for a message ack: the ack leaves after 3.5 s at most, the send goes on. */
export const MESSAGE_ACK_MS = 3_500;
/** A scene action or a button: 25 s at most (Gladys waits 30 s), queue included. */
export const ACTION_DEADLINE_MS = 25_000;
/** One request in flight; the others wait in a bounded queue. */
export const MAX_WAITING = 10;

/** The hourly limit: a sliding hour; 20 by default, from 1 to 500. */
export const HOUR_MS = 3_600_000;
export const DEFAULT_PER_HOUR = 20;
export const MIN_PER_HOUR = 1;
export const MAX_PER_HOUR = 500;
/** The allowed recipients: 20 at most. */
export const MAX_RECIPIENTS = 20;

/** Pause after a rate limit (429) or a server error (5xx): 60 s doubled up to 1 h; a Retry-After up to 6 h. */
export const PAUSE_MIN_MS = 60_000;
export const PAUSE_MAX_MS = 3_600_000;
export const RETRY_AFTER_MAX_MS = 6 * 3_600_000;

/** /data read again on this timer while it cannot be read; the first read waits this long. */
export const STORE_RETRY_MS = 10_000;
export const STORE_LOAD_BUDGET_MS = 2_000;
/** The send is written to /data before the request leaves, waited for this long at most. */
export const SAVE_BUDGET_MS = 1_000;
/** getConfig() retried without end: 5 s, doubled up to 60 s. */
export const CONFIG_RETRY_MIN_MS = 5_000;
export const CONFIG_RETRY_MAX_MS = 60_000;
/** A send arriving before the configuration was read waits for it this long at most. */
export const CONFIG_WAIT_MS = 2_000;
