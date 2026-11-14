# Threema for Gladys

Unofficial connector, not affiliated with Threema. It sends Threema messages from your Gladys scenes, with your
own **Threema Gateway** account. Send only: Gladys does not read the answers.

> This integration has never been tested with a real Threema Gateway account: it follows the official API
> documentation. Feedback is welcome.

## What you need

- A **Threema Gateway ID in basic mode**, created on [gateway.threema.ch](https://gateway.threema.ch/en/):
  8 characters starting with `*`, with its **API secret**.
- Threema Gateway **credits**: every message sent uses some; they are bought from Threema.

**Basic mode**: the Threema Gateway server holds the private key of your ID and prepares each message for the
recipient itself. It is the simplest mode to set up; if you want the key to stay with you, this connector does
not fit (end-to-end mode not supported).

## Configuration

| Field                                  | Role                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway ID                             | `*XXXXXXX`, 8 characters.                                                                                                                                                                                                                                                        |
| API secret                             | Kept by Gladys in its database, never shown again, sent only to Threema.                                                                                                                                                                                                         |
| Allowed recipients                     | Up to 20, separated by commas: Threema IDs (8 characters), phone numbers in international format (`+41…` or `0041…`) or e-mail addresses linked to a Threema account. **The only** possible recipients of the scene action and of the test button; the first one is the default. |
| Messages per hour, at most             | 20 by default, from 1 to 500.                                                                                                                                                                                                                                                    |
| Also send the Gladys messages of users | Off by default (see below).                                                                                                                                                                                                                                                      |

Buttons:

- **Check the account**: asks Threema for the credits left. Free, nothing sent, not counted in the limit.
- **Send a test message**: a short message to an allowed recipient (the first one when empty). Costs credits and
  counts in the limit.

## Scene action "Send a Threema message"

- **Text**: may hold scene variables. Beyond 3,500 bytes (the Threema limit), it is cut and ends with "…".
- **Recipient** (optional): one of the allowed recipients, written as you like (`alice123`,
  `+41 79 123 45 67`); empty, the first one of the list. A recipient outside the list is refused, even when it
  comes from a scene variable: nothing is sent.
- **Output**: `message_id`, the message ID given by Threema (empty when it could not be read).

## Gladys messages to users (option)

This connector is also a Gladys message channel. When the administrator turns on **"Also send the Gladys
messages of users"**, every user who enters their Threema recipient in "My account" receives through Threema
the messages Gladys sends them: the core "Send a message" scene action, and also the Gladys notifications to
administrators (low batteries, upgrades, weekly digest…). Each one costs credits, hence the option off by
default. These messages count in the same hourly limit.

Gladys waits 5 s for a channel to answer: the connector answers after 3.5 s at most and the send goes on (15 s
at most); its outcome goes to the logs and the status.

## What protects your account

- **Nothing leaves by itself**: not at start, not at a reconnection, not on a timer; only a scene action, a
  click on "Send a test message", or a Gladys message when the option is on.
- **No duplicate**: a message is never sent again. When Threema does not answer in time or the connection is
  cut, the message may have left: the error says so, and it is not sent again.
- **Hourly limit**: counted before the send, over a sliding hour, kept in `/data` (a restart does not reset
  it). A message refused by Threema (400, 401, 402, 404, 413, 429) does not count; a server error (5xx), a
  timeout or a cut connection does. When `/data` is unreadable, read-only or slow, the send does not wait
  (1 s at most) and the status warns that the limit only holds until the next restart.
- **One message at a time**, 10 waiting at most, the others refused.
- **Refused ID or secret** (401): nothing more sent with them (an 8-bit fingerprint, never the secret, kept in
  `/data`) until they change or a button succeeds.
- **Pause** after a 429 or a server error: 60 s, doubled each time up to 1 h, or the delay Threema asks up to
  6 h; buttons included, kept across a restart.
- **No credits left** (402): the status says so; nothing was sent.
- The secret, the text of the messages and whole recipients never appear in the logs, the status or `/data`:
  an ID becomes `AL******`, a number `+…67`, an address `j…@…`.

## Statuses

"Ready" as long as nothing was sent (the ID and the secret are only checked at the first message or with the
"Check the account" button); "Threema Gateway answered" after a success; otherwise the reason: refusal, pause,
limit reached, no credits, network.

## Privacy

The messages go through the Threema servers (Switzerland). What Threema does with them falls under the terms of
its Gateway service.
