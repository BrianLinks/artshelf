# ArtShelf

A creative-services marketplace: clients browse artists by category, hire them under explicit usage licenses, and pay through a local escrow-style ledger. Everything runs offline with no paid APIs.

**Status: milestone 1 of 8.** Implemented so far: project tooling, versioned SQLite migrations, accounts, sessions, role-based authorization and an audit log. The marketplace features (artists, uploads, licenses, orders, ledger, commissions, reviews, support, search, UI) are planned and not built yet. See [CHANGELOG.md](CHANGELOG.md).

## Requirements

- Node.js 20 or newer
- A C/C++ toolchain is only needed if `better-sqlite3` has no prebuilt binary for your platform

## Getting started

```bash
git clone <your-repo-url> artshelf
cd artshelf
npm install
cp .env.example .env     # optional: the defaults work as-is
npm run migrate          # creates ./data/artshelf.db
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a long passphrase' npm run create-admin
npm run dev              # http://localhost:3000
```

`.env` is not loaded automatically. Export the variables in your shell, or use `node --env-file=.env` for the built server.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the API with file watching |
| `npm test` | Run the Vitest suite once |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emitting |
| `npm run build` / `npm start` | Compile to `dist/` and run it |
| `npm run migrate` | Apply pending database migrations |
| `npm run create-admin` | Create an admin from `ADMIN_EMAIL`, `ADMIN_PASSWORD`, optional `ADMIN_NAME` |

## API (milestone 1)

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | Liveness check |
| `POST /api/auth/register` | public, rate limited | Create a `client` or `artist` account and sign in |
| `POST /api/auth/login` | public, rate limited | Sign in |
| `POST /api/auth/logout` | public | End the current session |
| `GET /api/auth/me` | signed in | Current user |
| `GET /api/admin/users` | admin | List users |
| `PATCH /api/admin/users/:id/role` | admin | Change a user's role |
| `POST /api/admin/users/:id/disable` | admin | Disable a user and end their sessions |
| `POST /api/admin/users/:id/enable` | admin | Re-enable a user |

Errors are JSON: `{ "error": { "code": "...", "message": "...", "details": [...] } }`.

## Configuration

See [.env.example](.env.example). Invalid values stop the process at startup. In production `BCRYPT_ROUNDS` must be at least 10.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Decision records](docs/adr)
- [Security policy](SECURITY.md)

## License

MIT. See [LICENSE](LICENSE).
