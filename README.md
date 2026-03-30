# DoneThat Desktop

Open-source desktop client for DoneThat work capture and summaries.

## Development

- `npm install`
- `npm run dev`

## Build

- `npm run build`
- Platform builds: use `build:*` scripts in `package.json`
- Release uploads: use `upload:*` scripts in `package.json`

## Open vs Closed

This repository contains the desktop client only. Hosted backend services and APIs remain proprietary. Client behavior that depends on remote services is limited to published endpoints and API compatibility.

Primary backend dependencies:
- `https://*.cloudfunctions.net`
- `https://app.donethat.ai`
- `https://identitytoolkit.googleapis.com`
- `https://securetoken.googleapis.com`

## Local Development Notes

You can run tests, build the renderer bundle, and work on most desktop-only behavior without proprietary backend access.

You should expect limited or unavailable behavior for:

- sign-in against production-compatible services
- embedded portal flows from `app.donethat.ai`
- capture uploads and backend-produced summaries
- backend-managed local-processing config and result submission

## Contributions

This repository is public for transparency and inspection first. See [Contributing](CONTRIBUTING.md) for the current contribution posture.

## Project Docs

- [Backend Compatibility](BACKEND_COMPATIBILITY.md)
- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)
- [Changelog](CHANGELOG.md)
