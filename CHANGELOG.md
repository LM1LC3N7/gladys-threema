# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-11-14

### Added

- First version: Threema messages from Gladys through the user's own Threema
  Gateway account in basic mode (type `communication`, send only, Gladys
  5.1.0+).
- "Send a Threema message" scene action, to a recipient of the allowed list
  of the configuration (Threema ID, phone number or e-mail address), with the
  message ID as output; texts cut to 3,500 bytes.
- "Check the account" (credits left, free) and "Send a test message" buttons.
- Optional forwarding of the Gladys messages of users to their own Threema
  recipient ("My account"), off by default, only when that recipient is also
  in the allowed list; answered to Gladys within 3.5 s.
- Cost guards: hourly limit (20 by default) kept in `/data`, never a second
  try, one request at a time, a pause after a rate limit or a server error,
  a refused ID or secret never used again by itself.

[Unreleased]: https://github.com/LM1LC3N7/gladys-threema/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-threema/releases/tag/v0.1.1
