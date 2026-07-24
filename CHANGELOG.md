# Changelog

All notable changes to AssppWeb are documented in this file.

## 2026-07-24

### Fixed

- Request Apple Bag configuration with `ix=6` so current authentication and redownload endpoints are returned.
- Parse `authenticateAccount` and `redownloadProduct` dynamically, with safe defaults when Bag data is unavailable.
- Fall back once to Apple's legacy authentication endpoint when the native endpoint returns a malformed redirect, an empty body, HTML, or HTTP 404.
- Handle HTTP 301, 302, 303, 307, and 308 consistently across authentication, download, and version requests.
- Treat HTTP 429 as rate limiting without automatic retry or legacy fallback.
- Allow the exact `downloaddispatch.itunes.apple.com` host through the Wisp target whitelist.
- Validate dynamic redownload endpoints before using them.

### Diagnostics

- Add bounded response diagnostics for malformed Apple responses.
- Avoid logging Plist bodies, credentials, cookies, password tokens, or other sensitive authentication data.
- Forward allowlisted browser-side Apple protocol failures to structured backend logs with correlation IDs.
- Add structured download, SINF injection, and unexpected API error logs.
- Include the backend `eventId` in asynchronous task failures for direct log correlation.

### Tests

- Cover Bag `ix=6` requests and endpoint parsing.
- Cover native-to-legacy authentication fallback and rate-limit handling.
- Cover dynamic redownload endpoint validation.
- Cover the Wisp hostname allowlist update.

### Documentation

- Add a Simplified Chinese README.
- Document local source builds, Apple endpoint compatibility, rate limiting, and common Wisp troubleshooting.

### Deployment

- Build the Docker image from the current checkout instead of pulling the upstream GHCR image.
- Set the Compose pull policy to `build` so `docker compose up -d` rebuilds after source updates while retaining Docker layer caching.
