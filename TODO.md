# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real Threema Gateway account (basic
      mode): "Check the account", "Send a test message", the scene action to
      an ID, a phone number and an e-mail address, a wrong secret, an account
      without credits, and the forwarding option with a "Send a message" core
      scene action.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).
- [ ] Store fields left out of the manifest on purpose (Louis' rule):
      keywords `Threema`, `Threema Gateway`, `message`, `notification`; no
      `countries` (worldwide service).

## To confirm on a real account (built without one)

- [ ] The message ID format of a 200 (16 hexadecimal characters expected; any
      other 200 is taken as sent, with an empty `message_id`).
- [ ] Whether a 404 on a phone or e-mail lookup costs a credit.
- [ ] The answer of `send_simple` for an ID set up for end-to-end mode only
      (400 expected, shown as "recipient not valid, or not a basic-mode ID").
- [ ] Rate limits of the Gateway (the documentation only says 429).

## Later

- Images and files (basic mode sends text only; end-to-end mode would be
  needed, with the private key in the integration).
- A select of the allowed recipients in the scene editor (dynamic options).

## Decisions

- **0.1.0 set by hand** in package.json, package-lock.json and the manifest
  (`docker_image` `ghcr.io/lm1lc3n7/gladys-threema:0.1.0`); the Release
  workflow takes over afterwards.
- **`gladys_version: ">=5.1.0"`**: scene actions arrived with Gladys 5.1.0
  (core commit 4d973de6); send-only communication channels
  (`messaging.receive: false`, `contact_schema`) were there before.
- **Basic mode only** (brief of lot 23): the Gateway server holds the key of
  the ID; said in the configuration and the docs without any word about
  ciphers. No library: two HTTPS requests with `fetch`, no redirect followed.
- **What may leave**: the scene action and the "Send a test message" button,
  to a recipient of the allowed list of the configuration only (a scene
  variable cannot pick a recipient outside it); the Gladys messages of users
  (`onSendMessage`, core "Send a message" action and Gladys notifications to
  administrators) only with the forwarding option, **off by default** (the
  core broadcasts some notifications to every channel, and each message costs
  credits). Nothing at start, at a reconnection, on a timer.
- **Never sent again**: no retry anywhere. A 4xx answer (or a connection
  refused before any byte) is "nothing sent" and is not counted; a 5xx, a
  timeout or a cut connection "may have left" and stays counted.
- **Hourly limit**: a sliding hour on the monotonic clock, 20 by default,
  1 to 500, counted before the request leaves, shared by every path (the free
  credit check excepted). Kept in /data as wall times; a time more than a
  minute in the future is dropped (invalid).
- **/data never blocks a send** (same decision as gladys-amazon-polly, review
  r2 of lot 22): the write is awaited 1 s at most, the first read 2 s at
  most; the status then says the counter is not saved.
- **Gladys message ack at 3.5 s** (Gladys waits 5 s): the send goes on up to
  15 s, its outcome logged and shown in the status.
- **Refused ID or secret** (401): 8 bits of an HMAC-SHA-256 under a random
  salt in `/data`, never the secret; nothing sent with them until they change
  or a button succeeds (both buttons try even when refused). A 401 is the
  only refusal: the Gateway has a single authentication.
- **Pause** after 429 or 5xx: 60 s doubled up to 1 h, `Retry-After` up to 6 h,
  on every path, buttons included, kept in /data.
- **402 (no credits)** is a status, not a pause: the next message is free to
  try (a 402 costs nothing) and the hourly limit bounds the attempts.
- **Texts cut** to 3,500 bytes of UTF-8 on a character boundary, ending with
  "…", rather than refused (an alert is better cut than lost).
- **Masks**: an ID shows its first 2 characters, a phone number its last 2
  digits, an e-mail address its first character; never more, in logs,
  statuses or errors.
