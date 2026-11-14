# Threema for Gladys Assistant

Unofficial [Gladys Assistant](https://gladysassistant.com) integration, not
affiliated with Threema: **Threema messages from your Gladys scenes**, sent
through your own **Threema Gateway** account in basic mode (send only).

- a "Send a Threema message" scene action, to a recipient of the allowed list
  (Threema ID, phone number or e-mail address);
- "Check the account" (free) and "Send a test message" buttons;
- optionally, the messages Gladys sends to its users (off by default);
- an hourly limit kept in `/data`, no message ever sent twice, a pause after a
  rate limit or a server error.

Needs Gladys 5.1.0 or later. Never tested with a real Threema Gateway account
yet.

Documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Development

```bash
npm install
npm test            # node --test
npm run lint
npm run format:check
npm run mutants     # mutation check of the guards (scripts/mutants.json), with memcap
npm run cover       # regenerates cover.png
```

Rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md).
Open points and decisions: [TODO.md](TODO.md).

## Credits and license

Apache-2.0 ([LICENSE](LICENSE)). The Threema Gateway API is called as
documented; no third-party code: see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Threema is a trademark of
Threema GmbH.
