# DoneThat Desktop

Open-source desktop client for DoneThat work capture and summaries.

## Development

- `npm install`
- `npm run dev`

## Build

- `npm run build`
- Platform builds: use `build:*` scripts in `package.json`

## Open vs Closed

This repository contains the desktop client only. Hosted backend services and APIs remain proprietary. Client behavior that depends on remote services is limited to published endpoints and API compatibility.

Primary backend dependencies:
- `https://*.cloudfunctions.net`
- `https://app.donethat.ai`
- `https://identitytoolkit.googleapis.com`
- `https://securetoken.googleapis.com`

## Project Docs

- [Security](SECURITY.md)
- [Support](SUPPORT.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)
- [Changelog](CHANGELOG.md)
