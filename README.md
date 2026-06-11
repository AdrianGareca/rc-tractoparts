<div align="center">

# 🚜 RC Tractoparts
### Sistema de Gestión de Cotizaciones y Proformas

**Plataforma full-stack empresarial para la gestión integral del ciclo de vida de cotizaciones comerciales**

---

![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-Tests_12%2F12_✓-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-UI_/api--docs-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)
![Sprint](https://img.shields.io/badge/Sprint-2_Completado-1B2B4B?style=for-the-badge)
![License](https://img.shields.io/badge/Licencia-UNLICENSED-red?style=for-the-badge)

</div>

---

## 📋 Tabla de Contenidos

1. [Descripción General](#-descripción-general)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Matriz Jerárquica de Roles](#-matriz-jerárquica-de-roles)
4. [Máquina de Estados — Ciclo de Vida de Cotizaciones](#-máquina-de-estados)
5. [Capa de Seguridad y Validación](#-capa-de-seguridad-y-validación)
6. [Stack Tecnológico](#-stack-tecnológico)
7. [Estructura de Archivos](#-estructura-de-archivos)
8. [Instalación y Configuración](#-instalación-y-configuración)
9. [Variables de Entorno](#-variables-de-entorno)
10. [Base de Datos](#-base-de-datos)
11. [Ejecución del Proyecto](#-ejecución-del-proyecto)
12. [Documentación Interactiva (Swagger)](#-documentación-interactiva-swagger)
13. [Mapa Completo de Endpoints](#-mapa-completo-de-endpoints)
14. [Pruebas Automatizadas](#-pruebas-automatizadas)
15. [Solución de Problemas](#-solución-de-problemas)

---

## 📖 Descripción General

RC Tractoparts es una empresa boliviana de importación de maquinaria pesada y repuestos con sede en **Santa Cruz de la Sierra, Bolivia**. Este repositorio contiene la **plataforma full-stack** del Sistema de Gestión de Cotizaciones y Proformas, desarrollado bajo metodología **XP/SCRUM** en dos sprints productivos.

El sistema automatiza el ciclo completo de una cotización comercial: desde su creación por el Ejecutivo de ventas, pasando por la revisión técnica del Administrador (con comentarios de supervisión), la aprobación definitiva del Jefe, el envío formal al cliente y el cierre de venta como `Aceptada`.

### Funcionalidades clave implementadas

| Característica | Descripción |
|---|---|
| 🔐 **Autenticación JWT** | Tokens firmados con expiración configurable y revocación en memoria al cerrar sesión |
| 🔒 **RBAC jerárquico** | SysAdmin › Jefe › Administrador › Ejecutivo — cada endpoint valida el rol antes de ejecutar |
| 🔢 **Correlativo atómico** | `SELECT … FOR UPDATE` garantiza seriales únicos bajo concurrencia máxima (RNF10) |
| 📄 **PDF automático** | Generación de proformas con marca corporativa en el momento de creación y aprobación |
| ⚙️ **Máquina de estados** | Flujo formal `Pendiente → En revision → Aprobada internamente → Aceptada` con cierre de venta |
| 💬 **Comentarios del Administrador** | Campo `comentarios_admin` para observaciones de supervisión visibles solo por el Jefe |
| ⏸ **Estado En Espera** | El Administrador puede suspender la revisión mientras verifica stock con proveedores |
| 🛡️ **Flujo de aprobación HU08** | Solo Jefe/SysAdmin pueden aprobar, rechazar o cerrar una venta |
| 📊 **Consultas avanzadas** | Listado paginado con 10 filtros combinables, ordenamiento dinámico y conteo paralelo |
| 📝 **Auditoría completa** | Cada acción se registra en `bitacora_auditoria` con IP, usuario, rol y metadatos |
| 🌐 **Dashboard SPA** | Interfaz web con patrones Strategy, Command, Observer y Mediator — sin frameworks externos |

---

## 🏗 Arquitectura del Sistema

El sistema implementa una **arquitectura de capas MVC estricta** con separación total de responsabilidades:

```
┌─────────────────────────────────────────────────────────────────┐
│               CLIENTE — SPA / Swagger UI                        │
│          public/  (HTML + Vanilla JS + CSS)                     │
│                HTTP + Bearer JWT Token                          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                    CAPA DE ENRUTAMIENTO                          │
│          src/routes/*.js  —  Express Router                     │
│   authRoutes · quotationRoutes · clientRoutes · userRoutes      │
└──────────┬──────────────────────────┬───────────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌───────────▼───────────────────────────┐
│  MIDDLEWARES        │   │         CONTROLADORES                  │
│  authMiddleware.js  │   │  authController.js                     │
│  roleMiddleware.js  │   │  quotationController.js                │
│  auditMiddleware.js │   │  clientController.js                   │
│  JWT verify + RBAC  │   │  userController.js                     │
└─────────────────────┘   └───────────┬───────────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────────┐
                    │            SERVICIOS                        │
                    │        pdfService.js (PDFKit)              │
                    └─────────────────┬─────────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────────┐
                    │              MODELOS (DAL)                  │
                    │   QuotationModel.js · UserModel.js         │
                    │   ClientModel.js · AuditModel.js           │
                    │   Pool MySQL · Transacciones · RBAC        │
                    └─────────────────┬─────────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────────┐
                    │          BASE DE DATOS MySQL 8.0+          │
                    │  9 tablas · Pool de 10 conexiones          │
                    │  Charset utf8mb4 · Timezone UTC            │
                    └───────────────────────────────────────────┘
```

### Patrones de diseño del frontend (SPA)

| Patrón | Ubicación | Propósito |
|---|---|---|
| **Strategy** | `dashboardView.js` | `ExecutiveStrategy` vs `ManagerStrategy` — renderizado por rol |
| **Command** | `dashboardView.js` | `ApproveQuotationCommand`, `ChangeStatusCommand`, etc. |
| **Observer** | `quotationForm.js` | `LineItemsSubject` notifica a `RowSubtotalObserver`, `IvaObserver`, `GrandTotalObserver` |
| **Mediator** | `quotationForm.js` | `FormMediator` coordina `LineItemsComponent`, `TotalsComponent` y `FileUploadComponent` |

---

## 👥 Matriz Jerárquica de Roles

El sistema implementa una jerarquía de autoridad descendente. Cada nivel hereda todas las capacidades de los niveles inferiores y agrega las propias.

```
┌───────────────────────────────────────────────────────────────┐
│  NIVEL 4 — SysAdmin  (Control absoluto del sistema)           │
│  • Todas las transiciones de cualquier estado                 │
│  • Puede revertir incluso estados avanzados a Pendiente       │
│  • Gestión de usuarios (igual que Jefe)                       │
├───────────────────────────────────────────────────────────────┤
│  NIVEL 3 — Jefe  (Aprobador comercial final)                  │
│  • Aprueba y rechaza desde cualquier estado activo            │
│  • Marca cotizaciones como "Aceptada" (cierre de venta)       │
│  • Gestión completa de usuarios (CRUD)                        │
│  • Ve la Cola de Aprobación con todos los estados activos     │
├───────────────────────────────────────────────────────────────┤
│  NIVEL 2 — Administrador  (Revisor técnico y comentarista)    │
│  • Deja comentarios de supervisión (comentarios_admin)        │
│  • Puede poner una cotización "En Espera" con justificación   │
│  • Puede retirar una cotización de revisión → Pendiente       │
│  • NO puede aprobar ni rechazar (autoridad exclusiva del Jefe)│
├───────────────────────────────────────────────────────────────┤
│  NIVEL 1 — Ejecutivo  (Ventas y proformas)                    │
│  • Crea cotizaciones y agrega ítems de línea                  │
│  • Envía a revisión una vez que el borrador está completo     │
│  • Marca como "Enviada al cliente" tras aprobación interna    │
│  • Ve únicamente sus propias cotizaciones en el dashboard     │
└───────────────────────────────────────────────────────────────┘
```

### Tabla detallada de permisos por acción

| Acción | Ejecutivo | Administrador | Jefe | SysAdmin |
|---|:---:|:---:|:---:|:---:|
| Login / Logout | ✅ | ✅ | ✅ | ✅ |
| Ver cotizaciones (propias) | ✅ | ✅ | ✅ | ✅ |
| Crear cotización | ✅ | ✅ | ✅ | ✅ |
| Enviar a revisión (`Pendiente → En revision`) | ✅ | ✅ | ✅ | ✅ |
| Dejar comentario de supervisión | ❌ | ✅ | ❌ | ✅ |
| Poner en espera con comentario (`→ En espera`) | ❌ | ✅ | ✅ | ✅ |
| Retirar de revisión (`En revision → Pendiente`) | ❌ | ✅ | ✅ | ✅ |
| **Aprobar** (`→ Aprobada internamente`) | ❌ | ❌ | ✅ | ✅ |
| **Rechazar** (`→ Rechazada`) | ❌ | ❌ | ✅ | ✅ |
| Enviar al cliente (`→ Enviada al cliente`) | ✅ | ❌ | ✅ | ✅ |
| **Aceptar — Cierre de Venta** (`→ Aceptada`) | ✅* | ❌ | ✅ | ✅ |
| Ver cola de aprobación completa | ❌ | ❌ | ✅ | ✅ |
| Subir/descargar PDF | ✅ | ✅ | ✅ | ✅ |
| Ver historial de estados | ✅ | ✅ | ✅ | ✅ |
| Gestión de usuarios (CRUD) | ❌ | ❌ | ✅ | ✅ |

> \* El Ejecutivo puede registrar `Aceptada` únicamente desde `Enviada al cliente` (respuesta del cliente). El Jefe y SysAdmin pueden marcarla desde `Aprobada internamente` o `Enviada al cliente` como cierre de venta directo.

---

## ⚙️ Máquina de Estados

Cada cotización sigue un ciclo de vida formal con transiciones validadas por rol en `ROLE_TRANSITIONS` (fuente de verdad única en `QuotationModel.js`). Ninguna transición puede ejecutarse sin el rol correcto.

```
                    ┌─────────────────┐
                    │    PENDIENTE    │  ← Estado inicial al crear
                    └────────┬────────┘
            Ejecutivo/Admin  │  envía a revisión
            (valida: ítems,  │  monto_total, fecha_validez)
                    ┌────────▼────────┐
          ┌────────▶│   EN REVISION   │◀───────────────────────────┐
          │         └────────┬────────┘                            │
          │    Admin retira  │  Jefe/SysAdmin deciden              │
          │                  │                                      │
          │    ┌─────────────┼──────────────────┐                  │
          │    │             │                  │                  │
          │  ┌─▼──────────┐  │            ┌─────▼──────┐          │
          │  │  EN ESPERA  │  │            │  RECHAZADA │          │
          │  └─────────────┘  │            └─────┬──────┘          │
          │  Admin/Jefe        │                  │ Ejecutivo        │
          │  retoma           │                  └──────────────────┘
          │                  ▼                         (rework)
          │     ┌────────────────────────┐
          │     │  APROBADA INTERNAMENTE │  ← Jefe/SysAdmin aprueban
          │     └────────────┬───────────┘
          │           ┌──────┴──────────────────────────────┐
          │           │  Ejecutivo envía          Jefe/Sys  │
          │           │  al cliente               cierran   │
          │    ┌──────▼──────────────┐       ┌──────────────▼──┐
          │    │  ENVIADA AL CLIENTE │       │    ACEPTADA      │
          │    └──────┬──────────────┘       │ (Cierre de Venta)│
          │           │                      └──────────────────┘
          │     ┌─────┴─────┐
          │     │           │
          │  ┌──▼───────┐ ┌─▼────────┐
          │  │ ACEPTADA │ │RECHAZADA │
          │  └──────────┘ └──────────┘
          │
          └── Todos los estados activos → ARCHIVADA (terminal)
```

### Transiciones por rol (resumen)

| Estado Actual | Ejecutivo | Administrador | Jefe / SysAdmin |
|---|---|---|---|
| `Pendiente` | → En revision, Archivada | → En revision, En espera, Archivada | → Cualquiera |
| `En revision` | *(solo lectura)* | → En espera, Pendiente, Archivada | → Cualquiera |
| `En espera` | *(solo lectura)* | → En revision, Pendiente, Archivada | → Cualquiera |
| `Aprobada internamente` | → Enviada al cliente | → Archivada | → **Aceptada**, Enviada, Rechazada, Archivada |
| `Enviada al cliente` | → Aceptada, Rechazada, Archivada | → Archivada | → **Aceptada**, Rechazada, Archivada |
| `Rechazada` | → Pendiente, Archivada | → Pendiente, Archivada | → Pendiente, Aprobada int., Archivada |
| `Aceptada` | → Archivada | → Archivada | → Archivada |
| `Archivada` | *(terminal)* | *(terminal)* | *(terminal)* |

---

## 🛡 Capa de Seguridad y Validación

### Validación cruzada con Zod

El esquema de validación en `src/validators/quotationValidator.js` aplica reglas cruzadas que no pueden verificarse campo a campo:

```js
// fecha_validez debe ser igual o posterior a fecha_emision
.refine(
  (data) => !data.fecha_emision || !data.fecha_validez ||
            data.fecha_validez >= data.fecha_emision,
  {
    message: 'La fecha de validez no puede ser anterior a la fecha de emisión.',
    path: ['fecha_validez'],
  }
)
```

**Reglas de validación implementadas:**

| Regla | Campo | Tipo |
|---|---|---|
| `fecha_validez >= fecha_emision` | Fechas | Cross-field (Zod `.refine`) |
| Mínimo 1 ítem de línea | `detalles` | Array mínimo (`.min(1)`) |
| `monto_total` obligatorio para envío a revisión | Header | Pre-flight check |
| `cantidad > 0` por ítem | `detalles[].cantidad` | Numérico positivo |
| `precio_unitario >= 0` por ítem | `detalles[].precio_unitario` | Numérico no negativo |
| `observaciones` obligatorio al rechazar | Aprobación | Condicional (`aprobado = false`) |

### Mitigación de XSS almacenado (OWASP A03)

Todos los campos controlados por el usuario que se renderizan en el DOM pasan por `escHtml()` antes de ser interpolados en `innerHTML`:

```js
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Esta función protege los campos: `descripcion`, `cliente_nombre`, `ejecutivo_nombre`, `observaciones`, `obs_aprobacion`, `comentarios_admin` y todos los ítems de línea.

### Otras medidas de seguridad activas

| Medida | Implementación |
|---|---|
| **Hashing bcrypt** | Factor de costo configurable (12 rondas por defecto en producción) |
| **Brute-force protection** | Bloqueo automático tras 3 intentos fallidos, 15 minutos de espera |
| **Cabeceras HTTP seguras** | `helmet` (CSP, X-Frame-Options, HSTS, X-Content-Type-Options) |
| **CORS restrictivo** | Origen configurado por variable de entorno `CORS_ORIGIN` |
| **Consultas parametrizadas** | Cero concatenación de strings en SQL — solo prepared statements |
| **Inyección de sort column** | Whitelist explícita `SORTABLE_COLUMNS` — ningún valor externo llega al `ORDER BY` |
| **Concurrencia atómica** | Transacciones con `SELECT … FOR UPDATE` para el correlativo |
| **Defense-in-depth** | El controller re-verifica el rol después del middleware (doble barrera) |
| **Token revocation** | Tokens invalidados en memoria al hacer logout (antes de su expiración JWT) |

---

## 🛠 Stack Tecnológico

| Capa | Tecnología | Versión | Propósito |
|---|---|---|---|
| Runtime | Node.js | ≥ 18.0.0 | Entorno de ejecución JavaScript |
| Framework | Express.js | 4.x | Servidor HTTP y enrutamiento |
| Base de datos | MySQL | 8.0+ | Persistencia relacional |
| Driver DB | mysql2 | 3.9.x | Pool de conexiones con soporte Promise |
| Autenticación | jsonwebtoken | 9.x | Firma y verificación de tokens JWT |
| Hashing | bcryptjs | 2.4.x | Encriptación segura de contraseñas |
| Validación | zod | 3.x | Validación de esquemas con cross-field rules |
| PDF | PDFKit | 0.x | Generación de proformas en formato A4 |
| Upload | Multer | 1.4.x | Validación y almacenamiento de PDFs |
| Seguridad | Helmet | 7.x | Cabeceras HTTP de seguridad |
| Logging | Morgan | 1.10.x | Registro de peticiones HTTP |
| API Docs | Swagger UI Express | 5.x | Documentación interactiva en `/api-docs/` |
| Variables | dotenv | 16.x | Gestión de entorno |
| Testing | Jest + Supertest | 29.x | Pruebas unitarias e integración |
| Dev server | Nodemon | 3.x | Recarga automática en desarrollo |

---

## 📁 Estructura de Archivos

```
rc-tractoparts/
│
├── 📂 public/                         # Frontend SPA (servida como archivos estáticos)
│   ├── index.html                     # Página de login
│   ├── dashboard.html                 # Dashboard principal (SPA)
│   ├── 📂 css/
│   │   └── styles.css                 # Sistema de diseño: variables CSS, badges, grid
│   └── 📂 js/
│       ├── 📂 services/
│       │   ├── apiClient.js           # Wrapper Fetch con auto-adjuntar token JWT
│       │   └── authSession.js         # Sesión en memoria (user, token, logout)
│       └── 📂 views/
│           ├── authView.js            # Formulario de login
│           ├── dashboardView.js       # Strategy (Ejecutivo/Jefe) + Commands + UI
│           └── quotationForm.js       # Formulario reactivo: Observer + Mediator
│
├── 📂 scripts/
│   ├── seed-users.js                  # Sembrado seguro de usuarios con hashes bcrypt
│   ├── migrate-en-espera.js           # Migración: agrega estado 'En espera'
│   └── run-migration-comentarios-admin.js  # Migración: columna comentarios_admin
│
├── 📂 sql/
│   ├── init.sql                       # Esquema base: 9 tablas + ENUM + roles iniciales
│   ├── migration_add_en_espera.sql    # ENUM 'En espera'
│   ├── migration_add_comentarios_admin.sql  # Columna comentarios_admin
│   └── migration_add_sysadmin_role.sql     # Rol SysAdmin
│
├── 📂 src/
│   ├── 📂 config/
│   │   └── db.js                      # Pool MySQL (Singleton) + testConnection()
│   │
│   ├── 📂 controllers/
│   │   ├── authController.js          # Login / Logout (HU01)
│   │   ├── quotationController.js     # CRUD cotizaciones + HU08 aprobación + historial
│   │   ├── clientController.js        # CRUD clientes
│   │   └── userController.js          # CRUD usuarios (Jefe/SysAdmin — HU02)
│   │
│   ├── 📂 middlewares/
│   │   ├── authMiddleware.js          # Verificación JWT + revocación en memoria
│   │   ├── roleMiddleware.js          # RBAC: authorize(['Jefe', 'SysAdmin', ...])
│   │   └── auditMiddleware.js         # Registro automático de accesos
│   │
│   ├── 📂 models/
│   │   ├── QuotationModel.js          # DAL completo: state machine, transacciones, historial
│   │   ├── UserModel.js               # DAL usuarios: CRUD + brute-force counters
│   │   ├── ClientModel.js             # DAL clientes
│   │   └── AuditModel.js              # DAL bitácora de auditoría
│   │
│   ├── 📂 routes/
│   │   ├── authRoutes.js              # POST /api/auth/login|logout
│   │   ├── quotationRoutes.js         # 10 rutas — orden fijo-antes-paramétrico crítico
│   │   ├── clientRoutes.js            # /api/clientes
│   │   └── userRoutes.js              # /api/usuarios
│   │
│   ├── 📂 services/
│   │   └── pdfService.js              # Generación PDF corporativo (PDFKit, A4, auto-triggered)
│   │
│   ├── 📂 utils/
│   │   └── auditLog.js                # logEvent() — escritura asíncrona a bitacora_auditoria
│   │
│   ├── 📂 validators/
│   │   ├── authValidator.js           # Zod schemas para login
│   │   ├── quotationValidator.js      # Zod schemas con cross-field fecha_validez >= fecha_emision
│   │   └── validate.js                # Middleware wrapper para schemas Zod
│   │
│   ├── app.js                         # Express: CORS, helmet, morgan, Swagger, rutas, error handler
│   └── server.js                      # Inicio servidor + testConnection() + graceful shutdown
│
├── 📂 tests/
│   ├── 📂 unit/
│   │   ├── calcularTotales.test.js    # 12 pruebas UT-01→UT-08 + EDGE cases
│   │   └── validationEdgeCases.test.js  # Edge cases de validación Zod
│   └── 📂 integration/
│       └── correlativo.concurrencia.test.js  # CC-01: 20 peticiones simultáneas
│
├── 📂 uploads/cotizaciones/           # PDFs generados y subidos
├── .env.example                       # Plantilla de variables de entorno
├── package.json
└── README.md
```

---

## ⚙️ Instalación y Configuración

### Requisitos previos

- **[Node.js](https://nodejs.org/) v18.0.0 o superior** — verificar con `node -v`
- **[MySQL 8.0+](https://dev.mysql.com/downloads/)** — servidor local o remoto accesible
- **[Git](https://git-scm.com/)** — para clonar el repositorio

### Paso 1 — Clonar e instalar dependencias

```bash
git clone https://github.com/AdrianGareca/rc-tractoparts.git
cd rc-tractoparts
npm install
```

### Paso 2 — Crear el archivo de variables de entorno

```bash
cp .env.example .env
# Editar .env con los valores reales
```

### Paso 3 — Inicializar la base de datos

Ejecutar los scripts SQL en **MySQL Workbench** o desde la terminal en el orden indicado:

```sql
SOURCE sql/init.sql;
SOURCE sql/migration_add_en_espera.sql;
SOURCE sql/migration_add_comentarios_admin.sql;
SOURCE sql/migration_add_sysadmin_role.sql;
```

> **Nota:** Seleccionar el esquema `rc_tractoparts` (doble clic para que aparezca en negrita) antes de ejecutar los scripts en MySQL Workbench.

### Paso 4 — Sembrar usuarios de prueba

```bash
npm run seed:execute
```

Los usuarios sembrados son:

| Usuario | Contraseña | Rol |
|---|---|---|
| `sysadmin` | `sysadmin123` | SysAdmin |
| `jefe` | `jefe123` | Jefe |
| `adrian_admin` | `admin123` | Jefe |
| `carlos_admin` | `admin123` | Administracion |
| `elena_ejec` | `ejecutivo123` | Ejecutivo |

---

## 🔑 Variables de Entorno

```env
# ── Aplicación ─────────────────────────────────────────────
NODE_ENV=development
PORT=3000
APP_NAME=RC-Tractoparts-API

# ── Base de Datos (MySQL) ───────────────────────────────────
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña
DB_NAME=rc_tractoparts
DB_NAME_TEST=rc_tractoparts_test
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0

# ── Autenticación y Seguridad ───────────────────────────────
JWT_SECRET=cambia_esto_por_clave_larga_y_aleatoria_de_64_caracteres
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=12

# ── Protección Brute-Force ──────────────────────────────────
MAX_LOGIN_ATTEMPTS=3
LOCK_DURATION_MINUTES=15

# ── Archivos PDF ────────────────────────────────────────────
UPLOAD_DIR=uploads/cotizaciones
MAX_PDF_SIZE_MB=10

# ── CORS ────────────────────────────────────────────────────
CORS_ORIGIN=http://localhost:5500
```

> ⚠️ Generar un `JWT_SECRET` seguro: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

## 🗄 Base de Datos

### Esquema de tablas

| Tabla | Descripción |
|---|---|
| `roles` | Catálogo de perfiles: SysAdmin, Ejecutivo, Administracion, Jefe |
| `usuarios` | Cuentas con hash bcrypt y control brute-force |
| `clientes` | Contrapartes comerciales (razón social, NIT) |
| `productos` | Catálogo interno de piezas y repuestos |
| `cotizaciones_correlativo` | Contador atómico de seriales por año calendario |
| `cotizaciones` | Registro principal de cada cotización (header + estado + `comentarios_admin`) |
| `cotizacion_detalles` | Ítems de línea de cada cotización |
| `cotizacion_historial_estados` | Historial cronológico de transiciones de estado |
| `bitacora_auditoria` | Log de auditoría inmutable (INSERT-only) |

### Formato del correlativo generado

```
COT-YYYY-NNNN
│    │     └── Número secuencial del año, 0-rellenado a 4 dígitos
│    └──────── Año calendario de 4 dígitos
└───────────── Prefijo fijo de la empresa
```

---

## 🚀 Ejecución del Proyecto

```bash
# Desarrollo (recarga automática)
npm run dev

# Producción
npm start

# Sembrar usuarios
npm run seed:execute

# Pruebas unitarias
npm run test:unit

# Todas las pruebas
npm test
```

Al iniciar correctamente verás:

```
============================================================
[Server] RC-Tractoparts-API running
[Server] Environment : development
[Server] Listening on: http://localhost:3000
[Server] Health check: http://localhost:3000/health
[Server] API Docs   : http://localhost:3000/api-docs/
============================================================
[DB] Connected to MySQL — host: localhost:3306 | database: rc_tractoparts
```

---

## 📚 Documentación Interactiva (Swagger)

Con el servidor corriendo, la documentación completa e interactiva de la API está disponible en:

```
http://localhost:3000/api-docs/
```

Swagger UI está **completamente configurado y operacional**. Permite:

- **Explorar** todos los endpoints con sus esquemas de request/response
- **Autenticarse** con el token JWT del login (botón **Authorize 🔒**)
- **Probar** cada endpoint directamente desde el navegador

> **Flujo recomendado:**
> 1. `POST /api/auth/login` → copiar el `token` del response
> 2. Clic en **Authorize 🔒** → pegar `Bearer <token>`
> 3. Explorar todos los endpoints protegidos

---

## 🗺 Mapa Completo de Endpoints

### 🔐 Autenticación — `/api/auth`

| Método | Endpoint | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/auth/login` | ❌ Pública | Devuelve JWT firmado |
| `POST` | `/api/auth/logout` | ✅ JWT | Revoca el token activo |

### 👥 Usuarios — `/api/usuarios` (Jefe / SysAdmin)

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/usuarios` | Listar usuarios |
| `POST` | `/api/usuarios` | Crear usuario |
| `GET` | `/api/usuarios/:id` | Detalle de usuario |
| `PUT` | `/api/usuarios/:id` | Actualizar usuario |
| `DELETE` | `/api/usuarios/:id` | Desactivar usuario (soft delete) |

### 🏢 Clientes — `/api/clientes`

| Método | Endpoint | Auth | Descripción |
|---|---|---|---|
| `GET` | `/api/clientes` | ✅ JWT | Listar clientes |
| `POST` | `/api/clientes` | ✅ JWT | Crear cliente |
| `GET` | `/api/clientes/:id` | ✅ JWT | Detalle de cliente |
| `PUT` | `/api/clientes/:id` | ✅ JWT | Actualizar cliente |

### 📋 Cotizaciones — `/api/cotizaciones`

| Método | Endpoint | Roles | Descripción |
|---|---|---|---|
| `GET` | `/api/cotizaciones/resumen` | Todos | Conteo por estado |
| `GET` | `/api/cotizaciones/pendientes-aprobacion` | Jefe, SysAdmin | Cola de aprobación: `Pendiente` + `En revision` + `En espera` |
| `GET` | `/api/cotizaciones` | Todos | Listado paginado con 10 filtros |
| `POST` | `/api/cotizaciones` | Todos | Crear cotización + PDF automático |
| `GET` | `/api/cotizaciones/:id` | Todos | Detalle: header + ítems + historial |
| `GET` | `/api/cotizaciones/:id/historial` | Todos | Historial cronológico de estados |
| `PUT` | `/api/cotizaciones/:id/estado` | Según rol | Transición de estado (state machine) |
| `POST` | `/api/cotizaciones/:id/aprobar` | Jefe, SysAdmin | Aprobar o rechazar (HU08) |
| `PATCH` | `/api/cotizaciones/:id/comentario-admin` | Administracion | Guardar comentario de supervisión |
| `POST` | `/api/cotizaciones/:id/pdf` | Ejecutivo | Subir PDF manualmente |
| `GET` | `/api/cotizaciones/:id/pdf` | Todos | Descargar PDF adjunto |

#### Parámetros de filtrado en `GET /api/cotizaciones`

| Parámetro | Tipo | Descripción |
|---|---|---|
| `q` | string | Búsqueda libre en correlativo, razón social y NIT |
| `razon_social` | string | Coincidencia parcial en nombre del cliente |
| `nit` | string | Coincidencia parcial en NIT |
| `estado` | string | Filtro exacto por estado del ciclo de vida |
| `id_cliente` | number | Filtro por ID de cliente |
| `id_ejecutivo` | number | Filtro por ID de ejecutivo |
| `fecha_desde` | YYYY-MM-DD | Límite inferior de fecha de emisión |
| `fecha_hasta` | YYYY-MM-DD | Límite superior de fecha de emisión |
| `moneda` | `USD` \| `BOB` | Filtra por moneda |
| `tiene_pdf` | `true` \| `false` | Solo con o sin PDF adjunto |
| `page` | number | Página (base 1, por defecto 1) |
| `limit` | number | Registros por página (máximo 100, por defecto 20) |
| `sort_by` | string | Columna de ordenamiento |
| `sort_order` | `ASC` \| `DESC` | Dirección del ordenamiento |

---

## 🧪 Pruebas Automatizadas

### Pruebas unitarias

```bash
npm run test:unit
```

Ejecuta **12 pruebas** que validan la lógica de cálculo de subtotales y la validación Zod:

| ID | Descripción | Estado |
|---|---|---|
| UT-01 | Subtotal exacto para ítem simple | ✅ |
| UT-02 | Redondeo a 2 decimales en decimales periódicos | ✅ |
| UT-03 | Suma correcta de múltiples ítems | ✅ |
| UT-04 | Array vacío devuelve `0.00` | ✅ |
| UT-05 | Cantidad fraccional produce subtotal correcto | ✅ |
| UT-06 | Precio unitario máximo no lanza excepción | ✅ |
| UT-07 | Cantidad negativa lanza error de validación | ✅ |
| UT-08 | Precio negativo lanza error de validación | ✅ |
| EDGE-01 | Cantidad cero lanza error de validación | ✅ |
| EDGE-02 | Precio cero es válido (`0.00`) | ✅ |
| EDGE-03 | Un solo ítem: total = subtotal | ✅ |
| EDGE-04 | Suma con decimales periódicos redondeada correctamente | ✅ |

### Prueba de concurrencia

`CC-01` — dispara **20 peticiones simultáneas** y verifica que todos los correlativos sean únicos. Valida el `SELECT … FOR UPDATE` bajo carga real.

---

## 🔧 Solución de Problemas

### `UnauthorizedAccess` en PowerShell (Windows)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### `Error Code: 1046 — No database selected` en MySQL Workbench

Doble clic sobre `rc_tractoparts` en el panel izquierdo (debe aparecer en **negrita**) antes de ejecutar el script.

### `401 Invalid credentials` con credenciales correctas

El hash almacenado no corresponde. Resembrar:

```bash
npm run seed:execute
```

### `FORBIDDEN_TRANSITION` al cambiar estado

El rol del usuario no tiene permiso para esa transición. Consultar la sección [Máquina de Estados](#-máquina-de-estados).

### La Cola de Aprobación aparece vacía para el Jefe

Verificar que existan cotizaciones en estado `Pendiente`, `En revision` o `En espera`. El endpoint `/api/cotizaciones/pendientes-aprobacion` incluye los tres estados activos.

---

## 👨‍💻 Autores y Contexto Académico

| | |
|---|---|
| **Institución** | UTEPSA — Universidad Tecnológica Privada de Santa Cruz |
| **Carrera** | Ingeniería de Sistemas |
| **Empresa** | RC Tractoparts — Importaciones de Maquinaria Pesada |
| **Metodología** | XP / SCRUM con sprints de dos semanas |
| **Sprint actual** | Sprint 2 — Ciclo de vida completo y gestión documental |

---

<div align="center">

**RC Tractoparts — Departamento de Sistemas**
Santa Cruz de la Sierra, Bolivia · 2026

</div>
