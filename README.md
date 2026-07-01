# RC Tractoparts — Quotation Management System

> 🇪🇸 ¿Prefieres leer esto en español? → [README en Español](README.es.md)

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-blue?logo=express)
![MySQL](https://img.shields.io/badge/MySQL-8.x-orange?logo=mysql)
![License](https://img.shields.io/badge/License-UNLICENSED-red)
![Tests](https://img.shields.io/badge/Tests-Jest%20%2B%20Supertest-yellow?logo=jest)

REST API and lightweight web client for managing **quotations (proformas)** at RC Tractoparts, a heavy-machinery spare-parts importer in Santa Cruz, Bolivia. The system covers the full quotation lifecycle: client/brand catalogs, atomic correlativo generation, a role-based approval state machine, corporate-branded PDF generation, file uploads (PDF + Excel), in-app notifications, auditing, and business-intelligence reports.

The backend is a Node.js + Express REST API backed by MySQL. The frontend is a vanilla-JavaScript (ES Modules) single-page application (SPA) served as static files by the same Express process — no build step required.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture & Tech Stack](#2-system-architecture--tech-stack)
3. [Project Directory Tree](#3-project-directory-tree)
4. [Prerequisites](#4-prerequisites)
5. [Installation & Local Setup](#5-installation--local-setup)
6. [Local Execution](#6-local-execution)
7. [Functional Overview](#7-functional-overview)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Security Model](#9-security-model)
10. [Tests](#10-tests)
11. [License](#license)

---

## 1. Project Overview

- **Purpose:** Replace manual proforma spreadsheets with a controlled, audited workflow — executives build quotations, managers approve them, and the system emits a consistent branded PDF for the client.
- **Company:** RC Tractoparts — importer of heavy-machinery spare parts (Volvo, Komatsu, John Deere, JCB, CAT, CASE) based in Santa Cruz, Bolivia.
- **Users / roles:** `Ejecutivo`, `Administracion`, `Jefe`, `SysAdmin`, plus a per-user `can_approve_quotations` delegation flag (Delegación de Funciones).
- **Key invariants:** every state change is role-validated and audited; each quotation owns exactly **one** physical PDF (regenerated on every meaningful change); all SQL is parameterized; the correlativo serial is generated atomically under a row lock.

---

## 2. System Architecture & Tech Stack

**Architecture:** Single Node.js process. `src/server.js` validates the DB connection then starts Express; `src/app.js` builds the middleware/route graph and is exported separately so tests can import it without binding a port. Layering is strict: **routes → controllers → models → MySQL**. Only models execute SQL.

| Concern | Technology (exact) |
|---|---|
| Runtime | Node.js `>= 18` |
| Web framework | Express `^4.19.2` |
| Database | MySQL 8 via `mysql2 ^3.9.7` (promise pool) |
| Authentication | `jsonwebtoken ^9.0.2` (HS256) + `bcryptjs ^2.4.3` |
| Input validation | `zod ^4.4.3` |
| PDF generation | `pdfkit ^0.18.0` |
| File uploads | `multer ^1.4.5-lts.1` |
| Security headers / CORS / rate-limit | `helmet ^7.1.0`, `cors ^2.8.5`, `express-rate-limit ^8.5.2` |
| HTTP logging | `morgan ^1.10.0` |
| API documentation | `swagger-jsdoc ^6.3.0` + `swagger-ui-express ^5.0.1` |
| Config | `dotenv ^16.4.5` |
| Tests | `jest ^29.7.0` + `supertest ^7.0.0` |
| Linting | `eslint ^10.5.0` (flat config) |
| Dev reload | `nodemon ^3.1.0` |
| Frontend | Vanilla JS (ES Modules), no build step |

> **Infrastructure note:** This repository contains **no** Docker, Nginx, Redis, PM2, or CI/CD configuration. The application runs directly with Node.js against a MySQL server. (Some source comments reference reverse proxies / process managers, but none are required to run the project.)

**Database tables** (`sql/init.sql`): `roles`, `usuarios`, `marcas`, `clientes`, `productos`, `cotizaciones_correlativo`, `cotizaciones`, `cotizacion_detalles`, `auditoria`, `bitacora_auditoria`, `cotizacion_historial_estados`, `notificaciones`.

**Quotation state machine** (enforced per role in `QuotationModel.ROLE_TRANSITIONS`):
`Pendiente → En revision → En espera → Aprobada internamente → Enviada al cliente → Aceptada / Rechazada → Archivada`.

---

## 3. Project Directory Tree

```
rc-tractoparts/
├── src/
│   ├── server.js                  # Entry point: DB check + HTTP listen + graceful shutdown
│   ├── app.js                     # Express app: middleware, Swagger, routes, error handler
│   ├── config/
│   │   └── db.js                  # MySQL connection pool (singleton) + startup ping
│   ├── routes/
│   │   ├── authRoutes.js          # /api/auth
│   │   ├── quotationRoutes.js     # /api/cotizaciones (load-bearing route order)
│   │   ├── userRoutes.js          # /api/usuarios
│   │   ├── clientRoutes.js        # /api/clientes
│   │   ├── brandRoutes.js         # /api/marcas
│   │   └── reportesRoutes.js      # /api/reportes
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── quotationController.js
│   │   ├── quotation/
│   │   │   ├── quotationStateController.js   # state machine + approval
│   │   │   └── quotationPdfController.js      # PDF/Excel upload & download
│   │   ├── userController.js
│   │   ├── clientController.js
│   │   ├── brandController.js
│   │   └── reportesController.js
│   ├── models/                    # ONLY layer that runs SQL (all parameterized)
│   │   ├── UserModel.js
│   │   ├── QuotationModel.js       # state matrix, correlativo, reports
│   │   ├── ClientModel.js
│   │   ├── BrandModel.js
│   │   └── AuditModel.js
│   ├── middlewares/
│   │   ├── authMiddleware.js       # JWT verify + token_version revocation
│   │   ├── roleMiddleware.js       # RBAC authorize([...])
│   │   └── auditMiddleware.js
│   ├── validators/                # Zod schemas + validate() factory
│   │   ├── validate.js
│   │   ├── authValidator.js
│   │   └── quotationValidator.js
│   ├── services/
│   │   └── pdfService.js           # PDFKit proforma layout engine
│   ├── utils/
│   │   └── auditLog.js
│   └── assets/images/              # rc_logo.png + brands/*.png (used by the PDF engine)
├── public/                        # Static frontend (served by Express)
│   ├── index.html                 # Login
│   ├── dashboard.html
│   ├── css/styles.css
│   └── js/{services,views}/        # apiClient, authSession, dashboard views
├── sql/
│   ├── init.sql                   # Single source of truth: full schema + seed data
│   └── init.js                    # Runs init.sql (admin connection, multipleStatements)
├── scripts/
│   └── seed-users.js              # Generates bcrypt hashes; seeds dev/test users
├── tests/
│   ├── unit/                      # No DB required
│   └── integration/               # Requires the test database
├── uploads/                       # Generated/uploaded PDFs (gitignored, runtime)
├── storage/excels/                # Uploaded Excel spreadsheets (gitignored, runtime)
├── .env.example                   # Environment variable reference
├── eslint.config.js
└── package.json
```

---

## 4. Prerequisites

- **Node.js `>= 18`** and npm (the lockfile is npm-based).
- **MySQL Server 8.x** running and reachable, with an account that can create databases (for `npm run db:init`).
- A POSIX-ish shell is fine; all commands below are cross-platform npm scripts.

---

## 5. Installation & Local Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file from the template
cp .env.example .env          # Windows (PowerShell): Copy-Item .env.example .env
```

**3. Edit `.env`** with your real values. Reference (`.env.example`):

```ini
# Application
NODE_ENV=development
PORT=3000
APP_NAME=RC-Tractoparts-API

# Database (MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=rc_tractoparts
DB_NAME_TEST=rc_tractoparts_test   # used only when NODE_ENV=test

DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0

# Auth & security
JWT_SECRET=replace_with_a_long_random_secret_at_least_64_chars
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=12

# Brute-force protection
MAX_LOGIN_ATTEMPTS=3
LOCK_DURATION_MINUTES=15

# File uploads
UPLOAD_DIR=uploads/cotizaciones
MAX_PDF_SIZE_MB=10

# CORS (comma-separated origins)
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

**4. Initialize the database.** `sql/init.sql` is self-contained — it **drops and recreates** the `rc_tractoparts` database, builds every table, and seeds roles, default brands, sample clients, the year counter, and the three initial privileged accounts:

```bash
npm run db:init
```

> `db:init` opens a one-shot admin connection (no pre-selected DB, `multipleStatements` enabled) and runs the whole script. ⚠️ It is destructive — it drops any existing `rc_tractoparts` database first.

**Initial accounts seeded by `init.sql`** (rotate these in production):

| Username | Role | Raw password |
|---|---|---|
| `SysAdmin` | SysAdmin (4) | `Admin#RC2026` |
| `ronald` | Jefe (3) | `Ronald#RC2026` |
| `angelica` | Administracion (2) | `Angelica#RC2026` |

`Ejecutivo` accounts are **not** seeded; they are created from inside the platform via `POST /api/usuarios`.

**5. (Optional) Seed development/test users** with freshly generated bcrypt hashes:

```bash
npm run seed            # PREVIEW only — prints SQL, writes nothing
npm run seed:execute    # Connects and upserts the dev users into the DB
```

---

## 6. Local Execution

```bash
# Development (auto-reload via nodemon)
npm run dev

# Production-style start
npm start
```

On a successful start the server validates the DB connection, then listens on `PORT` (default **3000**):

- **Frontend / login:** `http://localhost:3000/`
- **Health check:** `http://localhost:3000/health`
- **Interactive API docs (Swagger UI):** `http://localhost:3000/api-docs`

If MySQL is unreachable, startup aborts with a non-zero exit code (it will not serve requests it cannot fulfill).

**Quality / tests:**

```bash
npm run lint              # ESLint over src/
npm run test:unit         # Unit tests — NO database required
npm run test:integration  # Integration tests — REQUIRES rc_tractoparts_test DB
npm test                  # Full Jest run (integration parts need the test DB)
```

> Integration tests connect to the database named by `DB_NAME_TEST` when `NODE_ENV=test`. Create and initialize that database before running them.

---

## 7. Functional Overview

### Web client (served from `public/`)

- **Login** (`index.html`) — username/password, JWT stored client-side via `authSession`.
- **Dashboard** (`dashboard.html`) — role-aware views: quotation list/filters, quotation form, approval queue, notifications, timeline/history, and BI reports.

### REST API surface

| Area | Endpoints | Access |
|---|---|---|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/logout` | Public / authenticated |
| **Quotations** | `GET /` (paginated+filtered), `POST /`, `GET /:id`, `PUT /:id` (owner, Pendiente only), `GET /resumen`, `GET /pendientes-aprobacion`, `GET /:id/historial` | All authenticated roles (writes role-scoped) |
| **Quotation state** | `PUT /:id/estado` (role state machine), `POST /:id/aprobar` (Jefe/SysAdmin), `PATCH /:id/comentario-admin` (Administracion) | Role-restricted |
| **Quotation files** | `POST /:id/pdf`, `POST /:id/upload` (PDF+Excel), `GET /:id/pdf`, `GET /:id/excel` | Ejecutivo upload / all download |
| **Notifications** | `GET /api/cotizaciones/notificaciones`, `POST /…/notificaciones/leer` | Ejecutivo |
| **Users** | `GET /`, `POST /`, `GET /:id`, `PUT /:id` (Jefe/Administracion/SysAdmin), `DELETE /:id` soft-delete (Jefe/SysAdmin) | Management roles |
| **Clients** | `GET /api/clientes` (autocomplete), `POST /api/clientes` | All roles |
| **Brands** | `GET /api/marcas`, `POST /api/marcas` | Quote-creating roles |
| **Reports** | `GET /api/reportes/progreso` (Jefe/SysAdmin), `GET /api/reportes/advanced` (row-level security for Ejecutivo) | Restricted |
| **System** | `GET /health` | Public |

## 7. Functional Overview

### Web client (served from `public/`)

- **Login** (`index.html`) — username/password, JWT stored client-side via `authSession`.
- **Dashboard** (`dashboard.html`) — role-aware views: quotation list/filters, quotation form, approval queue, notifications, timeline/history, and BI reports.

### REST API surface

| Area | Endpoints | Access |
|---|---|---|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/logout` | Public / authenticated |
| **Quotations** | `GET /` (paginated+filtered), `POST /`, `GET /:id`, `PUT /:id` (owner, Pendiente only), `GET /resumen`, `GET /pendientes-aprobacion`, `GET /:id/historial` | All authenticated roles (writes role-scoped) |
| **Quotation state** | `PUT /:id/estado` (role state machine), `POST /:id/aprobar` (Jefe/SysAdmin), `PATCH /:id/comentario-admin` (Administracion) | Role-restricted |
| **Quotation files** | `POST /:id/pdf`, `POST /:id/upload` (PDF+Excel), `GET /:id/pdf`, `GET /:id/excel` | Ejecutivo upload / all download |
| **Notifications** | `GET /api/cotizaciones/notificaciones`, `POST /…/notificaciones/leer` | Ejecutivo |
| **Users** | `GET /`, `POST /`, `GET /:id`, `PUT /:id` (Jefe/Administracion/SysAdmin), `DELETE /:id` soft-delete (Jefe/SysAdmin) | Management roles |
| **Clients** | `GET /api/clientes` (autocomplete), `POST /api/clientes` | All roles |
| **Brands** | `GET /api/marcas`, `POST /api/marcas` | Quote-creating roles |
| **Reports** | `GET /api/reportes/progreso` (Jefe/SysAdmin), `GET /api/reportes/advanced` (row-level security for Ejecutivo) | Restricted |
| **System** | `GET /health` | Public |
| **API Docs** | `GET /api-docs` | Public (Swagger UI) |

### Cross-cutting behavior

- **Security:** Helmet headers, configurable CORS allowlist, global rate limiting (with stricter limits on login and uploads), 5 MB JSON body cap, and a hardened global error handler that never leaks stack traces or internals on 5xx.
- **Auth & sessions:** JWT (HS256, 8 h default) carrying the role name and a `token_version`; logout bumps the persistent counter so revocation survives restarts. Brute-force lockout after repeated failures.
- **Validation:** Zod schemas sanitize and type-coerce every write at the boundary; unknown keys are stripped.
- **Auditing:** significant actions are written to `bitacora_auditoria` / `auditoria`; per-quotation state transitions are recorded in `cotizacion_historial_estados`.
- **PDF engine:** generates an A4 corporate proforma (logo, partner-brand strip, client/requester/equipment grid, line-item table with es-BO number formatting, amount-in-words, bank data, and an `APROBADO` stamp on approved quotations). Uploaded files are validated by magic number, not just declared MIME type.
- **Notifications:** Ejecutivo users receive persistent in-app notifications on quotation state changes; unread items remain visible until explicitly acknowledged via `POST /…/notificaciones/leer`.

---

## 8. Frontend Architecture

The frontend is a vanilla JavaScript SPA using ES Modules — no transpiler or bundler required. Design patterns applied:

**Strategy Pattern** — role-based rendering is delegated to concrete strategy objects chosen at login time:
- `ExecutiveStrategy` — Ejecutivo / Administracion: summary stats, own quotation table, "Nueva Cotización" action.
- `ManagerStrategy` — Jefe: global overview, pending-approval queue, User CRUD panel, Audit Logs workspace.

**Command Pattern** — critical mutations are encapsulated as Command objects with a single `execute()` method:
- `ApproveQuotationCommand` — `POST /:id/aprobar`
- `ChangeStatusCommand` — `PUT /:id/estado`
- `DeactivateUserCommand` — `DELETE /api/usuarios/:id`
- `CreateUserCommand` — `POST /api/usuarios`

**Module breakdown:**

| Module | Responsibility |
|---|---|
| `apiClient.js` | Axios-style fetch wrapper, automatic JWT injection, toast feedback |
| `authSession.js` | JWT storage and role-decoding utilities |
| `dashboardView.js` | Main controller, strategy selection, Command invoker |
| `quotationForm.js` | Multi-step quotation creation / editing form |
| `dashboard/helpers.js` | Shared formatters, badge builders, escape utils |
| `dashboard/modules/timelineView.js` | State history timeline, PDF/Excel download buttons |
| `dashboard/modules/reportesView.js` | BI charts and leaderboard tables |
| `dashboard/modules/notificationsView.js` | Notification badge polling and read marking |

---

## 9. Security Model

| Layer | Mechanism |
|---|---|
| Transport | HTTPS recommended behind a reverse proxy (Nginx) |
| Headers | `helmet` — CSP, X-Frame-Options, HSTS, etc. |
| CORS | Allowlist-based; origins configured via `CORS_ORIGIN` env var |
| Rate limiting | Global + stricter on `/api/auth/login` and file uploads |
| Authentication | HS256 JWT, 8h expiry, `token_version` revocation |
| Authorization | Role-based (`ROLE_TRANSITIONS` matrix) + per-user delegation flag |
| Input validation | Zod schemas at every write boundary; unknown keys stripped |
| SQL injection | 100% parameterized queries via `mysql2` promise pool |
| File uploads | Magic-number validation (not MIME type); size-capped by multer |
| Brute force | Lockout after `MAX_LOGIN_ATTEMPTS` failures for `LOCK_DURATION_MINUTES` |
| Error handling | Global handler; stack traces / internals never exposed on 5xx |
| Auditing | All significant actions logged to `bitacora_auditoria` |

---

## 10. Tests

```bash
npm run test:unit         # Unit tests — NO database required
npm run test:integration  # Integration tests — REQUIRES rc_tractoparts_test DB
npm test                  # Full Jest run (integration parts need the test DB)
```

**Test suites:**

| File | Type | What it covers |
|---|---|---|
| `tests/unit/calcularTotales.test.js` | Unit | Line-item total and grand-total calculation logic |
| `tests/unit/validationEdgeCases.test.js` | Unit | Zod schema edge cases and boundary validation |
| `tests/integration/correlativo.concurrencia.test.js` | Integration | Atomic correlativo generation under concurrent requests |
| `tests/integration/newFeatures.test.js` | Integration | Admin notes visibility (NF-03) + persistent notifications (NF-04) |

> Integration tests connect to the database named by `DB_NAME_TEST` in `.env` when `NODE_ENV=test`. Initialize that database before running them:
> ```bash
> # In .env: DB_NAME_TEST=rc_tractoparts_test
> # Then run db:init once for the test DB (update DB_NAME temporarily, or connect manually)
> ```

---

## License

UNLICENSED — © RC Tractoparts, Departamento de Sistemas.
