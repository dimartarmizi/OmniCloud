# Security Policy

OmniCloud aggregates access to multiple cloud storage accounts and stores
provider credentials and tokens. Security reports are taken seriously.

## Supported versions

OmniCloud is at an early `1.0.0` release and is developed on `main`. Security
fixes are applied to the latest `main` and the most recent published version
only.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue,
pull request, or discussion for an unfixed vulnerability.

Preferred channel:

- Open a private report through **GitHub Security Advisories** ("Report a
  vulnerability") on the [repository](https://github.com/NatsumeAoii/OmniClouds).
  This keeps the report confidential until a fix is ready.

If you cannot use GitHub Security Advisories, contact the maintainer:

- Repository owner: [@NatsumeAoii](https://github.com/NatsumeAoii)
- Security contact email: `[FILL IN — add a monitored security contact address]`

When reporting, please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal proof of concept if possible).
- Affected component (e.g. a specific route, adapter, or the upload pipeline).
- The commit hash or version you tested against.

## What to expect

- **Acknowledgement:** within 5 business days of receiving the report.
- **Assessment:** an initial severity assessment and triage shortly after
  acknowledgement.
- **Fix and disclosure:** coordinated disclosure once a fix is available. Please
  allow a reasonable window before any public disclosure. Credit will be given
  to reporters who wish to be named.

## Security considerations for deployers

These are grounded in how the current code behaves. Review them before
deploying OmniCloud beyond personal local use.

### Application modes

- `APP_MODE=local` (default) has **no authentication**: every request resolves
  to a single built-in local user (`authMiddleware.js`). Only run local mode on
  a trusted machine, never exposed to the public internet.
- `APP_MODE=hosted` enables session-cookie authentication, registration/login,
  CSRF origin checks, and per-IP rate limiting on auth endpoints.

### Secrets and key material

- `AUTH_SECRET` is used to derive session-token hashes. Set a strong, random
  value in hosted mode. The fallback dev value is not safe for production.
- `OMNICLOUD_ENCRYPTION_KEY` (or the legacy `OMNICLOUD_SECRET_HALF`) derives the
  AES-256-GCM key that encrypts stored provider credentials and tokens
  (`utils/crypto.js`, `config/env.js`). Changing it makes previously stored
  credentials undecryptable — affected accounts must be reconnected.
- Provider OAuth client secrets, refresh tokens, S3 access keys, and MEGA/pCloud
  passwords are stored encrypted in SQLite. Keep `backend/.env` and the database
  file private. Both are git-ignored by default.

### Transport and cookies

- In hosted mode, serve OmniCloud over HTTPS. Set `AUTH_COOKIE_SECURE=true` so
  the session cookie is only sent over HTTPS; this also enables the
  `Strict-Transport-Security` header (`middleware/securityHeaders.js`).
- `CORS_ORIGIN` / `FRONTEND_URL` must be set to the real first-party origin(s).
  The CSRF guard and the WebSocket upgrade check both validate request origin
  against these values in hosted mode.

### Network boundaries

- The S3 connect form validates the user-supplied endpoint against an SSRF
  blocklist (no `localhost`, link-local, private ranges, or the cloud metadata
  IP) before making outbound requests (`externalAccountService.js`).
- File preview responses are served with `X-Content-Type-Options: nosniff` and a
  restrictive `Content-Security-Policy` sandbox so untrusted file bytes cannot
  execute as active content on the app origin (`fileRoutes.js`).

### Operational constraints

- OmniCloud runs as a **single backend instance**. Upload progress uses an
  in-process WebSocket registry (`websocketHub.js`); running multiple replicas
  without a shared pub/sub backend will break progress delivery and is not
  supported.

## Known limitations

- Hosted mode has no role/admin model: all authenticated users are equal. There
  is no built-in administrative separation.
- OAuth provider credentials are global (operator-supplied via `.env`), not
  per-user.
