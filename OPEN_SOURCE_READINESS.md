# Open-Source Readiness Checklist: DoneThat Desktop

Date: 2026-03-30
Scope: Entire repository at `/Users/christoph/repos/donethat-electron`
Goal: Publish the desktop client source while keeping hosted backend services proprietary.

## Current State Snapshot

- Desktop client source is in this repository; backend services remain proprietary.
- Legal and baseline OSS docs are now present: `LICENSE`, `README.md`, `SECURITY.md`, `SUPPORT.md`, `THIRD_PARTY_NOTICES.md`, and `CHANGELOG.md`.
- `package.json` metadata now points at `donethatai/donethat-desktop` and uses `GPL-3.0-only`.
- Firebase client config is committed, so docs/tests do not depend on CI-injected client config.
- Public backend behavior is now documented in `BACKEND_COMPATIBILITY.md`.
- A lightweight PR CI workflow now runs tests and `build:prepare`.
- Local source tags still stop at `v1.4.5` while `package.json` is `1.5.0`.
- Test coverage is still shallow; only a small number of main-process tests exist today.
- Aikido should be the required PR security check, configured in GitHub outside this repository.
- Git history still contains both org and personal author email addresses.

## P0 Before Public Launch

- [x] **Add license files and legal metadata**
  - `LICENSE` added.
  - `package.json` license updated to `GPL-3.0-only`.
- [x] **Clarify the open vs closed boundary in the public README**
  - README states that the desktop client is open source and hosted backend services remain proprietary.
- [x] **Document backend compatibility and remote behavior**
  - `BACKEND_COMPATIBILITY.md` documents the proprietary backend dependency surface.
  - Remote payload categories are documented at a public, category-based level.
- [x] **Replace the broken public dev command docs**
  - README now points to `npm run dev` and `npm run build`.
- [x] **Expand local developer bootstrap guidance**
  - README clarifies what can be developed and tested without proprietary backend access.
  - Backend-dependent limitations are documented publicly.
- [x] **Add third-party license compliance artifacts**
  - `THIRD_PARTY_NOTICES.md` exists.
- [x] **Add a basic security disclosure path**
  - `SECURITY.md` exists with a private reporting channel and response expectation.
- [x] **Add a concise public trust summary**
  - `BACKEND_COMPATIBILITY.md` includes a public summary of screenshot, activity, microphone, and system-audio handling.
- [x] **Align repository metadata to the source repo**
  - `repository`, `bugs`, and `homepage` now point to `donethatai/donethat-desktop`.
- [ ] **Align source and release topology**
  - Keep this repository as the canonical source repository.
  - Keep `donethat-releases` as the binary/update repository.
  - The release process now has a shared create-if-missing tag guard.
  - Existing shipped versions still need exact source-tag linkage.
- [x] **Audit and clean repository artifacts**
  - The unexplained `%b` root artifact is no longer present.

## P1 Strongly Recommended

- [x] **Add a minimal maintainer/support policy**
  - `SUPPORT.md` exists.
- [ ] **Add release integrity and reproducibility docs**
  - Document checksums, signing, and source-to-binary mapping.
  - Explain how users verify published binaries against source.
  - Document the new tag-guarded source tagging workflow.
- [ ] **Improve dependency and security hygiene**
  - Re-run `npm audit`, triage current findings, and remediate what is practical before launch.
  - Configure the Aikido GitHub App as a required PR security check.
- [x] **Add CI quality gates**
  - PR CI now runs tests and build smoke checks.
  - The manual release workflow is no longer the only workflow in the repository.
- [x] **Add a changelog**
  - `CHANGELOG.md` exists.

## P2 Maturity Follow-Ups

- [ ] **Increase test depth and coverage**
  - Add tests beyond work-hours logic, especially around capture flows, IPC, auth, and permissions.
- [x] **Publish contribution posture**
  - `CONTRIBUTING.md` states that the repo is public for inspection first and that outside changes are considered selectively.
- [ ] **Add trademark or brand usage guidance**
  - Protect product branding while allowing source reuse.

## Source-Available Trust Model Requirements

- [ ] Client source for every shipped binary version is published and tagged in this repository.
- [ ] Every release in `donethat-releases` links to the exact matching source tag in this repository.
- [ ] A deterministic or well-documented build path is available.
- [ ] Signed artifacts and checksums are published.
- [x] Remote dependencies and payload categories are documented.

## Minimum File Set Before Announcement

- [x] `LICENSE`
- [x] `SUPPORT.md`
- [x] `SECURITY.md`
- [x] `THIRD_PARTY_NOTICES.md`
- [x] `BACKEND_COMPATIBILITY.md`
- [x] `CONTRIBUTING.md`
- [x] `CHANGELOG.md`

## Git History Hygiene

Findings from local history inspection:

- Author email metadata still includes both `christoph@donethat.ai` and `christoph@donethat.ai`.
- No obvious private-key blocks were identified in the earlier scan that produced this checklist.

Remaining actions:

- [ ] Decide whether the personal email address should remain public in git history.
- [ ] If history is rewritten, rescan and rotate sensitive tokens as a precaution.
