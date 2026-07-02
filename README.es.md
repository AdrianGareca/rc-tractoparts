# RC Tractoparts — Sistema de Gestión de Cotizaciones

> 🇺🇸 Prefer reading this in English? → [English README](README.md)

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-blue?logo=express)
![MySQL](https://img.shields.io/badge/MySQL-8.x-orange?logo=mysql)
![Licencia](https://img.shields.io/badge/Licencia-UNLICENSED-red)
![Tests](https://img.shields.io/badge/Tests-Jest%20%2B%20Supertest-yellow?logo=jest)

API REST y cliente web liviano para la gestión de **cotizaciones (proformas)** en RC Tractoparts, empresa importadora de repuestos para maquinaria pesada en Santa Cruz, Bolivia. El sistema cubre el ciclo de vida completo de una cotización: catálogos de clientes y marcas, generación atómica de correlativos, máquina de estados con aprobación basada en roles, generación de PDFs corporativos, carga de archivos (PDF + Excel), notificaciones internas, auditoría y reportes de inteligencia de negocio.

El backend es una API REST en Node.js + Express respaldada por MySQL. El frontend es una aplicación de una sola página (SPA) en JavaScript puro (ES Modules), servida como archivos estáticos por el mismo proceso de Express — sin paso de compilación.

---

## Tabla de Contenidos

1. [Descripción General](#1-descripción-general)
2. [Arquitectura del Sistema y Stack Tecnológico](#2-arquitectura-del-sistema-y-stack-tecnológico)
3. [Estructura de Directorios](#3-estructura-de-directorios)
4. [Requisitos Previos](#4-requisitos-previos)
5. [Instalación y Configuración Local](#5-instalación-y-configuración-local)
6. [Ejecución Local](#6-ejecución-local)
7. [Vista Funcional](#7-vista-funcional)
8. [Arquitectura del Frontend](#8-arquitectura-del-frontend)
9. [Modelo de Seguridad](#9-modelo-de-seguridad)
10. [Pruebas](#10-pruebas)
11. [Licencia](#licencia)

---

## 1. Descripción General

- **Propósito:** Reemplazar las hojas de cálculo de proformas manuales con un flujo de trabajo controlado y auditado: los ejecutivos construyen cotizaciones, los jefes las aprueban, y el sistema genera un PDF corporativo consistente para el cliente.
- **Empresa:** RC Tractoparts — importador de repuestos para maquinaria pesada (Volvo, Komatsu, John Deere, JCB, CAT, CASE) con sede en Santa Cruz, Bolivia.
- **Usuarios / roles:** `Ejecutivo`, `Administracion`, `Jefe`, `SysAdmin`, más un indicador de delegación por usuario `can_approve_quotations` (Delegación de Funciones).
- **Invariantes clave:** cada cambio de estado es validado por rol y auditado; cada cotización posee exactamente **un** PDF físico (regenerado en cada cambio relevante); todo el SQL es parametrizado; el correlativo se genera atómicamente bajo bloqueo de fila.

---

## 2. Arquitectura del Sistema y Stack Tecnológico

**Arquitectura:** Proceso único de Node.js. `src/server.js` valida la conexión a la BD y luego inicia Express; `src/app.js` construye el grafo de middlewares/rutas y se exporta por separado para que los tests puedan importarlo sin vincular un puerto. El layering es estricto: **rutas → controladores → modelos → MySQL**. Solo los modelos ejecutan SQL.

| Módulo | Tecnología (exacta) |
|---|---|
| Runtime | Node.js `>= 18` |
| Framework web | Express `^4.19.2` |
| Base de datos | MySQL 8 vía `mysql2 ^3.9.7` (promise pool) |
| Autenticación | `jsonwebtoken ^9.0.2` (HS256) + `bcryptjs ^2.4.3` |
| Validación de entrada | `zod ^4.4.3` |
| Generación de PDF | `pdfkit ^0.18.0` |
| Carga de archivos | `multer ^1.4.5-lts.1` |
| Seguridad / CORS / rate-limit | `helmet ^7.1.0`, `cors ^2.8.5`, `express-rate-limit ^8.5.2` |
| Logging HTTP | `morgan ^1.10.0` |
| Documentación de API | `swagger-jsdoc ^6.3.0` + `swagger-ui-express ^5.0.1` |
| Configuración | `dotenv ^16.4.5` |
| Pruebas | `jest ^29.7.0` + `supertest ^7.0.0` |
| Linting | `eslint ^10.5.0` (flat config) |
| Recarga en desarrollo | `nodemon ^3.1.0` |
| Frontend | Vanilla JS (ES Modules), sin build |

> **Nota de infraestructura:** Este repositorio **no** incluye Docker, Nginx, Redis, PM2 ni configuración de CI/CD. La aplicación corre directamente con Node.js contra un servidor MySQL.

**Tablas de base de datos** (`sql/init.sql`): `roles`, `usuarios`, `marcas`, `clientes`, `productos`, `cotizaciones_correlativo`, `cotizaciones`, `cotizacion_detalles`, `auditoria`, `bitacora_auditoria`, `cotizacion_historial_estados`, `notificaciones`.

**Máquina de estados de cotizaciones** (aplicada por rol en `QuotationModel.ROLE_TRANSITIONS`):

```
Pendiente → En revision → En espera → Aprobada internamente → Enviada al cliente → Confirmada / Rechazada → Archivada
```

---

## 3. Estructura de Directorios

```
rc-tractoparts/
├── src/
│   ├── server.js                  # Punto de entrada: verificación de BD + HTTP listen + shutdown
│   ├── app.js                     # App Express: middlewares, Swagger, rutas, manejador de errores
│   ├── config/
│   │   └── db.js                  # Pool de conexiones MySQL (singleton) + ping de arranque
│   ├── routes/
│   │   ├── authRoutes.js          # /api/auth
│   │   ├── quotationRoutes.js     # /api/cotizaciones (orden de rutas crítico)
│   │   ├── userRoutes.js          # /api/usuarios
│   │   ├── clientRoutes.js        # /api/clientes
│   │   ├── brandRoutes.js         # /api/marcas
│   │   └── reportesRoutes.js      # /api/reportes
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── quotationController.js
│   │   ├── quotation/
│   │   │   ├── quotationStateController.js   # máquina de estados + aprobación
│   │   │   └── quotationPdfController.js      # carga/descarga de PDF y Excel
│   │   ├── userController.js
│   │   ├── clientController.js
│   │   ├── brandController.js
│   │   └── reportesController.js
│   ├── models/                    # ÚNICA capa que ejecuta SQL (todo parametrizado)
│   │   ├── UserModel.js
│   │   ├── QuotationModel.js       # matriz de estados, correlativo, reportes
│   │   ├── ClientModel.js
│   │   ├── BrandModel.js
│   │   └── AuditModel.js
│   ├── middlewares/
│   │   ├── authMiddleware.js       # Verificación JWT + revocación por token_version
│   │   ├── roleMiddleware.js       # RBAC authorize([...])
│   │   └── auditMiddleware.js
│   ├── validators/                # Esquemas Zod + factory validate()
│   │   ├── validate.js
│   │   ├── authValidator.js
│   │   └── quotationValidator.js
│   ├── services/
│   │   └── pdfService.js           # Motor de diseño de proformas con PDFKit
│   ├── utils/
│   │   └── auditLog.js
│   └── assets/images/              # rc_logo.png + marcas/*.png (para el motor PDF)
├── public/                        # Frontend estático (servido por Express)
│   ├── index.html                 # Login
│   ├── dashboard.html
│   ├── css/styles.css
│   └── js/{services,views}/        # apiClient, authSession, vistas del dashboard
├── sql/
│   ├── init.sql                   # Fuente única de verdad: esquema completo + datos iniciales
│   └── init.js                    # Ejecuta init.sql (conexión admin, multipleStatements)
├── scripts/
│   └── seed-users.js              # Genera hashes bcrypt; siembra usuarios de dev/test
├── tests/
│   ├── unit/                      # Sin BD requerida
│   └── integration/               # Requiere la base de datos de prueba
├── uploads/                       # PDFs generados/subidos (gitignored, runtime)
├── storage/excels/                # Hojas Excel subidas (gitignored, runtime)
├── .env.example                   # Referencia de variables de entorno
├── eslint.config.js
└── package.json
```

---

## 4. Requisitos Previos

- **Node.js `>= 18`** y npm (el lockfile es de npm).
- **MySQL Server 8.x** en ejecución y accesible, con una cuenta que pueda crear bases de datos (para `npm run db:init`).
- Un shell compatible (PowerShell o bash); todos los comandos son scripts npm multiplataforma.

---

## 5. Instalación y Configuración Local

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de entorno a partir de la plantilla
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

**3. Edita `.env`** con tus valores reales. Referencia (`.env.example`):

```ini
# Aplicación
NODE_ENV=development
PORT=3000
APP_NAME=RC-Tractoparts-API

# Base de datos (MySQL)
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseña_aqui
DB_NAME=rc_tractoparts
DB_NAME_TEST=rc_tractoparts_test   # solo usado cuando NODE_ENV=test

DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0

# Autenticación y seguridad
JWT_SECRET=reemplazar_con_un_secreto_largo_aleatorio_minimo_64_chars
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=12

# Protección contra fuerza bruta
MAX_LOGIN_ATTEMPTS=3
LOCK_DURATION_MINUTES=15

# Carga de archivos
UPLOAD_DIR=uploads/cotizaciones
MAX_PDF_SIZE_MB=10

# CORS (orígenes separados por coma)
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

**4. Inicializar la base de datos.** `sql/init.sql` es auto-contenido — **elimina y recrea** la base de datos `rc_tractoparts`, construye todas las tablas y siembra roles, marcas predeterminadas, clientes de ejemplo, el contador anual, y las tres cuentas iniciales privilegiadas:

```bash
npm run db:init
```

> `db:init` abre una conexión admin de un solo uso (sin BD preseleccionada, `multipleStatements` activado) y ejecuta el script completo. ⚠️ Es destructivo — elimina cualquier base de datos `rc_tractoparts` existente primero.

**Cuentas iniciales sembradas por `init.sql`** (cámbialas en producción):

| Usuario | Rol | Contraseña |
|---|---|---|
| `SysAdmin` | SysAdmin (4) | `Admin#RC2026` |
| `ronald` | Jefe (3) | `Ronald#RC2026` |
| `angelica` | Administracion (2) | `Angelica#RC2026` |

Las cuentas `Ejecutivo` **no** se siembran; se crean desde la plataforma mediante `POST /api/usuarios`.

**5. (Opcional) Sembrar usuarios de desarrollo/test** con hashes bcrypt recién generados:

```bash
npm run seed            # SOLO PREVISUALIZACIÓN — imprime el SQL, no escribe nada
npm run seed:execute    # Conecta e inserta/actualiza los usuarios de dev en la BD
```

---

## 6. Ejecución Local

```bash
# Desarrollo (recarga automática con nodemon)
npm run dev

# Inicio en modo producción
npm start
```

Al iniciar con éxito, el servidor valida la conexión a la BD y luego escucha en `PORT` (por defecto **3000**):

- **Frontend / Login:** `http://localhost:3000/`
- **Health check:** `http://localhost:3000/health`
- **Documentación interactiva de API (Swagger UI):** `http://localhost:3000/api-docs`

Si MySQL no es accesible, el arranque se interrumpe con código de salida no cero.

**Calidad / pruebas:**

```bash
npm run lint              # ESLint sobre src/
npm run test:unit         # Tests unitarios — SIN base de datos requerida
npm run test:integration  # Tests de integración — REQUIERE BD rc_tractoparts_test
npm test                  # Jest completo (integración requiere la BD de test)
```

> Los tests de integración se conectan a la base de datos nombrada por `DB_NAME_TEST` cuando `NODE_ENV=test`. Crea e inicializa esa base de datos antes de ejecutarlos.

---

## 7. Vista Funcional

### Cliente web (servido desde `public/`)

- **Login** (`index.html`) — usuario/contraseña, JWT almacenado en cliente mediante `authSession`.
- **Dashboard** (`dashboard.html`) — vistas ajustadas al rol: lista/filtros de cotizaciones, formulario de cotización, cola de aprobaciones, notificaciones, timeline/historial y reportes BI.

### Superficie de la API REST

| Área | Endpoints | Acceso |
|---|---|---|
| **Auth** | `POST /api/auth/login`, `POST /api/auth/logout` | Público / autenticado |
| **Cotizaciones** | `GET /` (paginado+filtrado), `POST /`, `GET /:id`, `PUT /:id` (propietario, solo Pendiente), `GET /resumen`, `GET /pendientes-aprobacion`, `GET /:id/historial` | Todos los roles autenticados (escritura con restricción de rol) |
| **Estado de cotización** | `PUT /:id/estado` (máquina de estados por rol), `POST /:id/aprobar` (Jefe/SysAdmin), `PATCH /:id/comentario-admin` (Administracion) | Restringido por rol |
| **Archivos de cotización** | `POST /:id/pdf`, `POST /:id/upload` (PDF+Excel), `GET /:id/pdf`, `GET /:id/excel` | Ejecutivo sube / todos descargan |
| **Notificaciones** | `GET /api/cotizaciones/notificaciones`, `POST /…/notificaciones/leer` | Ejecutivo |
| **Usuarios** | `GET /`, `POST /`, `GET /:id`, `PUT /:id` (Jefe/Administracion/SysAdmin), `DELETE /:id` soft-delete (Jefe/SysAdmin) | Roles de gestión |
| **Clientes** | `GET /api/clientes` (autocompletado), `POST /api/clientes` | Todos los roles |
| **Marcas** | `GET /api/marcas`, `POST /api/marcas` | Roles que crean cotizaciones |
| **Reportes** | `GET /api/reportes/progreso` (Jefe/SysAdmin), `GET /api/reportes/advanced` (seguridad a nivel de fila para Ejecutivo) | Restringido |
| **Sistema** | `GET /health` | Público |
| **Documentación** | `GET /api-docs` | Público (Swagger UI) |

### Comportamiento transversal

- **Seguridad:** Cabeceras Helmet, lista de CORS configurable, rate limiting global (más estricto en login y subidas), límite de cuerpo JSON de 5 MB, y un manejador de errores global que nunca expone stack traces o internos en respuestas 5xx.
- **Auth y sesiones:** JWT (HS256, 8h por defecto) con nombre de rol y `token_version`; el logout incrementa el contador persistente para que la revocación sobreviva reinicios. Bloqueo por fuerza bruta tras fallos repetidos.
- **Validación:** Esquemas Zod sanitizan y coercionan tipos en cada escritura; las claves desconocidas son eliminadas.
- **Auditoría:** Las acciones significativas se escriben en `bitacora_auditoria` / `auditoria`; las transiciones de estado por cotización se registran en `cotizacion_historial_estados`.
- **Motor PDF:** Genera una proforma corporativa A4 (logo, franja de marcas asociadas, grilla de cliente/solicitante/equipo, tabla de líneas con formato numérico es-BO, monto en palabras, datos bancarios y sello `APROBADO` en cotizaciones aprobadas). Los archivos subidos se validan por número mágico, no solo por tipo MIME declarado.
- **Notificaciones:** Los usuarios `Ejecutivo` reciben notificaciones internas persistentes al cambiar el estado de una cotización; los elementos no leídos permanecen visibles hasta ser explícitamente marcados vía `POST /…/notificaciones/leer`.

---

## 8. Arquitectura del Frontend

El frontend es una SPA en JavaScript puro usando ES Modules — sin transpilador ni bundler. Patrones de diseño aplicados:

**Patrón Strategy** — el renderizado basado en rol se delega a objetos estrategia concretos elegidos al iniciar sesión:
- `ExecutiveStrategy` — Ejecutivo / Administracion: estadísticas resumen, tabla de cotizaciones propias, acción "Nueva Cotización".
- `ManagerStrategy` — Jefe: vista global, cola de aprobaciones pendientes, panel CRUD de usuarios, espacio de trabajo de Logs de Auditoría.

**Patrón Command** — las mutaciones críticas están encapsuladas como objetos Command con un único método `execute()`:
- `ApproveQuotationCommand` — `POST /:id/aprobar`
- `ChangeStatusCommand` — `PUT /:id/estado`
- `DeactivateUserCommand` — `DELETE /api/usuarios/:id`
- `CreateUserCommand` — `POST /api/usuarios`

**Desglose de módulos:**

| Módulo | Responsabilidad |
|---|---|
| `apiClient.js` | Wrapper de fetch estilo Axios, inyección automática de JWT, feedback con toasts |
| `authSession.js` | Almacenamiento de JWT y utilidades de decodificación de rol |
| `dashboardView.js` | Controlador principal, selección de estrategia, invocador de Commands |
| `quotationForm.js` | Formulario multi-paso de creación/edición de cotizaciones |
| `dashboard/helpers.js` | Formateadores compartidos, constructores de badges, utilidades de escape |
| `dashboard/modules/timelineView.js` | Timeline de historial de estados, botones de descarga PDF/Excel |
| `dashboard/modules/reportesView.js` | Gráficos BI y tablas de leaderboard |
| `dashboard/modules/notificationsView.js` | Polling del badge de notificaciones y marcado como leído |

---

## 9. Modelo de Seguridad

| Capa | Mecanismo |
|---|---|
| Transporte | HTTPS recomendado detrás de un proxy inverso (Nginx) |
| Cabeceras HTTP | `helmet` — CSP, X-Frame-Options, HSTS, etc. |
| CORS | Basado en lista blanca; orígenes configurados vía variable `CORS_ORIGIN` |
| Rate limiting | Global + más estricto en `/api/auth/login` y subida de archivos |
| Autenticación | JWT HS256, expiración 8h, revocación por `token_version` |
| Autorización | Basada en rol (matriz `ROLE_TRANSITIONS`) + indicador de delegación por usuario |
| Validación de entrada | Esquemas Zod en cada escritura; claves desconocidas eliminadas |
| Inyección SQL | 100% consultas parametrizadas vía pool de promesas `mysql2` |
| Carga de archivos | Validación por número mágico (no tipo MIME); tamaño limitado por multer |
| Fuerza bruta | Bloqueo tras `MAX_LOGIN_ATTEMPTS` fallos por `LOCK_DURATION_MINUTES` |
| Manejo de errores | Handler global; stack traces / internos nunca expuestos en 5xx |
| Auditoría | Todas las acciones significativas registradas en `bitacora_auditoria` |

---

## 10. Pruebas

```bash
npm run test:unit         # Tests unitarios — SIN base de datos requerida
npm run test:integration  # Tests de integración — REQUIERE BD rc_tractoparts_test
npm test                  # Jest completo (integración requiere la BD de test)
```

**Suites de prueba:**

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `tests/unit/calcularTotales.test.js` | Unitario | Lógica de cálculo de totales por línea y total general |
| `tests/unit/validationEdgeCases.test.js` | Unitario | Casos borde del esquema Zod y validación de límites |
| `tests/integration/correlativo.concurrencia.test.js` | Integración | Generación atómica de correlativo bajo peticiones concurrentes |
| `tests/integration/newFeatures.test.js` | Integración | Visibilidad de notas de administrador (NF-03) + notificaciones persistentes (NF-04) |

> Los tests de integración se conectan a la base de datos nombrada por `DB_NAME_TEST` en `.env` cuando `NODE_ENV=test`. Inicializa esa base de datos antes de ejecutarlos.

---

## Licencia

UNLICENSED — © RC Tractoparts, Departamento de Sistemas.
