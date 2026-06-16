# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `SECURITY.md`, `CODE_OF_CONDUCT.md`, and this `CHANGELOG.md`.

### Changed

- Disabled all upload entry points in My Drive (empty-state CTA, drag-and-drop,
  file/folder pickers, new-folder) when no storage account is connected; the
  empty state now shows a "Connect an account" call to action instead.

### Removed

- Dead code cleanup: unused imports (`HeadBucketCommand` in `S3Adapter`, `env`
  in `externalAccountService`, unused icon imports in `DriveShell`) and an
  unused `props` binding in `FileListSelectionBar`.

## [1.0.0]

Initial documented release. Entries below are derived from the project's commit
history (no version tags exist yet, so the boundary of this release is the
current `main`).

### Added

- Multi-provider cloud aggregation through a normalized adapter layer for Google
  Drive, OneDrive, Dropbox, Yandex Disk, MEGA, pCloud, and S3-compatible storage.
- Redirect-based OAuth account linking for Google Drive, OneDrive, Dropbox, and
  Yandex Disk; in-app email/password connect for MEGA and pCloud; access-key
  connect form for S3-compatible storage.
- Unified file workspace with Home, My Drive, Recent, Starred, Shared with Me,
  and Quota views over a virtual-path file tree.
- File management: browse, create folder, rename, move (within an account),
  delete (including bulk delete), download (with HTTP range support), preview,
  and star/unstar on providers that support it.
- Upload system: browser file and folder uploads, drag-and-drop, server-side
  upload session initiation with single-use tokens, and real-time progress over
  WebSocket.
- Automatic upload account allocation with selectable strategies: `round_robin`,
  `weighted_round_robin`, `least_used`, `most_free`, and `manual` ordering.
- Metadata mirror in SQLite with scheduled synchronization via `node-cron`,
  including incremental delta sync for providers that expose change tokens
  (e.g. Google Drive) and diff-and-upsert full walks for the rest.
- Global file search across the mirrored metadata.
- `local` and `hosted` application modes; hosted mode adds session-cookie
  register/login/logout, password change, and account deletion.
- User settings (language, theme) persisted per user; English and Indonesian UI
  locales.
- Docker support: backend and frontend Dockerfiles plus a `docker-compose.yml`
  running the API and an Nginx-served production frontend.
- Versioned SQLite schema migrations recorded in a `schema_migrations` table.

### Security

- AES-256-GCM encryption of stored provider credentials and tokens.
- Hosted-mode CSRF origin validation, per-IP rate limiting on auth endpoints,
  and baseline security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `Referrer-Policy`, conditional HSTS).
- WebSocket upgrade origin validation and per-session upload-token checks.
- SSRF guard on user-supplied S3 endpoints.
- `nosniff` + sandboxed CSP on inline file preview responses.

[Unreleased]: https://github.com/NatsumeAoii/OmniClouds/compare/main...HEAD
[1.0.0]: https://github.com/NatsumeAoii/OmniClouds/releases/tag/v1.0.0
