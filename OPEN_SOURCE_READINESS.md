# Open-Source Readiness Checklist: DoneThat Desktop

Date: 2026-03-30
Scope: Entire repository at `/Users/christoph/repos/donethat-electron`
Goal: Publish the desktop client source while keeping hosted backend services proprietary.

## Current State Snapshot

- Desktop client source is in this repository; backend services remain proprietary.
- Legal and baseline OSS docs are now present: `LICENSE`, `README.md`, `SECURITY.md`, `SUPPORT.md`, `THIRD_PARTY_NOTICES.md`, and `CHANGELOG.md`.
- `package.json` metadata now points at `donethatai/donethat-desktop` and uses `GPL-3.0-only`.
- Firebase client config is committed, so docs/tests do not depend on CI-injected client config.
- Capture diagnostics telemetry is still sent to backend requests unless the new client telemetry setting is turned off.
- Local source tags still stop at `v1.4.5` while `package.json` is `1.5.0`.
- Test coverage is still shallow; only a small number of main-process tests exist today.
- CI is still release-oriented. There is no visible PR safety workflow, CodeQL, or Dependabot config.
- Git history still contains both org and personal author email addresses.

## P0 Before Public Launch

- [x] **Add license files and legal metadata**
  - `LICENSE` added.
  - `package.json` license updated to `GPL-3.0-only`.
- [x] **Clarify the open vs closed boundary in the public README**
  - README states that the desktop client is open source and hosted backend services remain proprietary.
- [ ] **Document backend compatibility and remote behavior**
  - Add a public API or compatibility note for the proprietary backend dependency surface.
  - Document what data each remote endpoint receives.
- [x] **Replace the broken public dev command docs**
  - README now points to `npm run dev` and `npm run build`.
- [ ] **Expand local developer bootstrap guidance**
  - Clarify what can be developed or tested without proprietary backend access.
  - Document any expected limitations for local-only workflows.
- [x] **Add third-party license compliance artifacts**
  - `THIRD_PARTY_NOTICES.md` exists.
- [x] **Add a basic security disclosure path**
  - `SECURITY.md` exists with a private reporting channel and response expectation.
- [ ] **Add privacy and trust docs for capture behavior**
  - Add `PRIVACY_CLIENT.md` describing screenshot, window, microphone, and system-audio capture behavior.
  - Add a concise public threat-model or trust summary for the desktop client.
- [x] **Expose client telemetry control in settings**
  - Add a user-facing setting to disable remote `clientTelemetry` uploads from the desktop app.
- [ ] **Document telemetry behavior precisely**
  - Explain what the client telemetry toggle disables and what capture data is still uploaded when it is off.
- [x] **Align repository metadata to the source repo**
  - `repository`, `bugs`, and `homepage` now point to `donethatai/donethat-desktop`.
- [ ] **Align source and release topology**
  - Keep this repository as the canonical source repository.
  - Keep `donethat-releases` as the binary/update repository.
  - For every shipped version, publish from an exact source tag in this repository and link that tag from the matching release.
- [x] **Audit and clean repository artifacts**
  - The unexplained `%b` root artifact is no longer present.

## P1 Strongly Recommended

- [x] **Add a minimal maintainer/support policy**
  - `SUPPORT.md` exists.
- [ ] **Add release integrity and reproducibility docs**
  - Document checksums, signing, and source-to-binary mapping.
  - Explain how users verify published binaries against source.
  - Standardize source tagging so every shipped binary version has a matching source tag.
- [ ] **Improve dependency and security hygiene**
  - Re-run `npm audit`, triage current findings, and remediate what is practical before launch.
  - Add automated dependency or security scanning.
- [ ] **Add CI quality gates**
  - Add PR CI for tests and build smoke checks.
  - Keep the manual release workflow, but do not rely on it as the only workflow.
- [x] **Add a changelog**
  - `CHANGELOG.md` exists.

## P2 Maturity Follow-Ups

- [ ] **Increase test depth and coverage**
  - Add tests beyond work-hours logic, especially around capture flows, IPC, auth, and permissions.
- [ ] **Add developer standards**
  - Add linting or contribution guidance if the repo is expected to accept outside changes.
- [ ] **Add public architecture documentation**
  - Add `ARCHITECTURE.md` covering main/renderer boundaries, capture flow, and local-vs-cloud processing.
- [ ] **Add trademark or brand usage guidance**
  - Protect product branding while allowing source reuse.

## Source-Available Trust Model Requirements

- [ ] Client source for every shipped binary version is published and tagged in this repository.
- [ ] Every release in `donethat-releases` links to the exact matching source tag in this repository.
- [ ] A deterministic or well-documented build path is available.
- [ ] Signed artifacts and checksums are published.
- [ ] Remote dependencies and payload categories are documented.
- [ ] Telemetry defaults and opt-out behavior are documented precisely.

## Minimum File Set Before Announcement

- [x] `LICENSE`
- [x] `SUPPORT.md`
- [x] `SECURITY.md`
- [x] `THIRD_PARTY_NOTICES.md`
- [ ] `PRIVACY_CLIENT.md`
- [ ] `ARCHITECTURE.md`
- [x] `CHANGELOG.md`

## Git History Hygiene

Findings from local history inspection:

- Author email metadata still includes both `christoph@donethat.ai` and `christoph@donethat.ai`.
- No obvious private-key blocks were identified in the earlier scan that produced this checklist.

Remaining actions:

- [ ] Decide whether the personal email address should remain public in git history.
- [ ] If history is rewritten, rescan and rotate sensitive tokens as a precaution.
