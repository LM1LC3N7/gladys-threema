# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `communication`, send only
(`messaging.receive: false`, Gladys 5.1.0+): a Node.js service (Node 22+, ESM,
no build step) in its own sandboxed Docker container, talking to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the **Threema Gateway** in basic mode (`https://msgapi.threema.ch`,
`send_simple` and `credits`) with `fetch`, using the user's own Gateway ID and
API secret. In basic mode the Gateway server holds the key of the ID.
Unofficial: not affiliated with Threema.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "limit"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run mutants                           # mutation check (scripts/mutants.json), use memcap
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: ThreemaApp, FileStore, createThreema
src/app.js                        ThreemaApp: handlers (scene action, buttons, Gladys messages),
                                  configuration, hourly limit, queue, pause, refusal, status
src/threema.js                    the only network access: send_simple, credits, error classes,
                                  bounded read of the answer
src/recipients.js                 Threema ID / phone / e-mail parsing, the allowed list, masks
src/config.js                     the form, checked (never throws, never shows a bad value)
src/store.js                      /data/threema.json (sends of the hour, pause, refusal)
src/constants.js                  endpoints, bounds, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: type communication, config, contact_schema,
                                  actions, scene action
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test: fake Gladys, scripted Gateway, virtual clock;
                                  test/threema.test.js: the client on a local HTTP server
scripts/                          cover.png generator, mutation runner and list
```

## Rules

- **Every message costs the user credits.** Nothing leaves at start, at a
  reconnection or on a timer: only the scene action, the "Send a test
  message" button, or a Gladys message when `forward_gladys_messages` is on
  (off by default). Never a retry: a request that may have left is never
  sent again. The hourly limit is counted BEFORE a request leaves (refunded
  only on a 4xx answer or a connection refused before any byte).
- **Recipients are fixed by people, never by a text**: the scene action and
  the test button only reach the allowed list of the configuration; a Gladys
  message only reaches the recipient its user entered in "My account".
- **Never the secret** in a log, the status, an error, `/data` or a URL that
  is logged; never the text of a message; a recipient only masked
  (`mask()`: `AL******`, `+…67`, `j…@…`).
- **Only a 401 is a refusal** of the ID and secret; a refused pair is never
  used again by itself, new values are always tried, a button success lifts it.
- **429 or 5xx**: a pause on the monotonic clock (60 s doubled up to 1 h,
  Retry-After up to 6 h), its wall end in `/data`; the wall clock serves only
  `/data` and the times shown.
- **/data unreadable is not empty**: read again every 10 s, one read at a time,
  never written before it was read; a send waits 2 s for the first read and
  1 s for a write at most.
- **Never write a word about ciphers** for the secret or the basic mode: say
  "kept by Gladys in its database, never shown again, sent only to Threema"
  and "the Gateway server holds the key of the ID".
- **Config keys, the contact key, the action and scene action keys are
  forever** (`identity`, `secret`, `recipients`, `max_messages_per_hour`,
  `forward_gladys_messages`, `recipient`, `check_account`, `send_test`,
  `send_message`, output `message_id`): users store their values and scenes.
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (test/threema.test.js talks to a
  local server on 127.0.0.1).
