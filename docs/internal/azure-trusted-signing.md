# Azure Trusted Signing Setup for DoneThat

> Internal maintainer release doc. This is only useful for maintainers managing Windows code-signing credentials and release infrastructure.

This document explains how to set up Azure Trusted Signing (rebranded "Artifact Signing" as of January 2026) for the DoneThat Windows builds.

## Constants

These values are non-sensitive and are hardcoded in `.github/workflows/build.yml`:

- Trusted Signing account: `DoneThat`
- Certificate profile: `Letss` (Public Trust)
- Region: West Europe (`https://weu.codesigning.azure.net`)

## One-time Azure setup

1. Create or reuse a Microsoft Entra ID app registration / service principal that will represent CI.
2. On that app registration, add a federated identity credential:
   - Issuer: `https://token.actions.githubusercontent.com`
   - Audience: `api://AzureADTokenExchange`
   - Subject: `repo:donethatai/donethat-electron:ref:refs/heads/main`
3. Assign the SP the `Artifact Signing Certificate Profile Signer` role (formerly `Trusted Signing Certificate Profile Signer`) on the `DoneThat / Letss` certificate profile.
4. Capture the tenant ID, client ID (the app registration's Application ID), and subscription ID for the next step.

The release workflow only runs on `main` (see `.github/workflows/build.yml`), so a single `ref:refs/heads/main` subject is enough. Add more subjects only if you start releasing from other branches or tags.

## GitHub repository secrets

Add the following secrets (or repository variables) in the GitHub repository settings:

| Name | Description |
|------|-------------|
| `AZURE_TENANT_ID` | Microsoft Entra ID tenant ID |
| `AZURE_CLIENT_ID` | App registration / service principal client ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID containing the Trusted Signing account |

No client secret is stored: the workflow authenticates via OIDC federated identity through `azure/login@v2`.

## How it works

1. The workflow grants `id-token: write` and runs `azure/login@v2` on Windows runners with the OIDC token.
2. A setup step downloads `nuget.exe`, installs the `Microsoft.ArtifactSigning.Client` NuGet package, locates the matching `Azure.CodeSigning.Dlib.dll` for the runner architecture, writes a `metadata.json` (Endpoint + account + profile), and adds `signtool.exe` from the Windows 10/11 SDK to `PATH`.
3. For normal Windows builds, `electron-builder` invokes `scripts/azure-sign-windows.js` once per artifact via its `signtoolOptions.sign` callback.
4. For Windows ARM64, the workflow first builds the native unpacked app on `windows-11-arm`, uploads `release/win-arm64-unpacked`, then downloads it on `windows-latest` for signing and packaging with `electron-builder --prepackaged`.
5. The script runs `signtool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <dlib> /dmdf <metadata.json> <file>` and then `signtool verify /pa /v <file>`.
6. The Trusted Signing dlib uses `DefaultAzureCredential`, which picks up the workload identity established by `azure/login@v2`.

## Local signing (optional)

Local Windows signing is skipped unless `SIGN_WINDOWS=true` is set. To exercise signing locally:

1. Install the Trusted Signing Client Tools via WinGet: `winget install -e --id Microsoft.Azure.ArtifactSigningClientTools`.
2. `az login` as a principal that has the `Artifact Signing Certificate Profile Signer` role on `DoneThat / Letss`.
3. Set `AZURE_SIGN_DLIB` to the dlib path (e.g. inside the WinGet install) and `AZURE_SIGN_METADATA` to a metadata.json you create with the constants above.
4. Run a Windows build with `SIGN_WINDOWS=true` (e.g. `set SIGN_WINDOWS=true && npm run build:win:x64`).

## Windows ARM64 flow

Azure Trusted Signing has no ARM64-native dlib yet, and the x64 dlib + signtool combination fails on the `windows-11-arm` GitHub runner under emulation (`signtool` exit code 3). The workflow avoids that by splitting the Windows ARM64 release:

1. `build_win_arm64_unpacked` runs on `windows-11-arm`, compiles the ARM64 app with `electron-builder --win dir --arm64`, and uploads `release/win-arm64-unpacked`.
2. `publish_win_arm64_signed` runs on `windows-latest`, downloads the unpacked app, signs its executables with the x64 Trusted Signing dlib, then runs `electron-builder --prepackaged release/win-arm64-unpacked --win nsis --arm64 --publish always`.

This keeps ARM64 native modules built on ARM hardware while using the x64 signing toolchain. The installer and updater metadata are generated only after the unpacked app has been signed.

References:
- [actions/partner-runner-images#156](https://github.com/actions/partner-runner-images/issues/156) — runner image / signtool issue.
- [Azure/artifact-signing-action#92](https://github.com/Azure/artifact-signing-action/issues/92) — ARM64 dlib roadmap.

Revisit when Microsoft publishes an ARM64 dlib in `Microsoft.ArtifactSigning.Client`. The workflow can then be simplified by moving signing and publishing back onto the ARM64 runner.

## Troubleshooting

- `403 Forbidden` from the signing endpoint usually means the region URI does not match where the account was created, the SP is missing the signer role, or the federated subject does not match the running ref.
- `signtool.exe not found` -> the workflow setup step could not locate the Windows SDK signtool for the matrix arch. Verify the runner image still ships the Windows 10/11 SDK.
- `Azure.CodeSigning.Dlib.dll not found for arch x64` -> the `Microsoft.ArtifactSigning.Client` package layout changed. Inspect `$RUNNER_TEMP/artsign/Microsoft.ArtifactSigning.Client/bin/`. Note: the package only ships `x64` and `x86` dlibs; we use the x64 dlib on `windows-latest`. See [Azure/artifact-signing-action#92](https://github.com/Azure/artifact-signing-action/issues/92).
- For more detail, see [Set up signing integrations to use Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/how-to-signing-integrations).
