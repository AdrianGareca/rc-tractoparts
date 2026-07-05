# RC Tractoparts — Sistema de Gestión de Cotizaciones

> 🇺🇸 Prefer reading this in English? → [English README](README.md)

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen?logo=node.js)
![Express](https://img.shields.io/badge/Express-4.x-blue?logo=express)
![MySQL](https://img.shields.io/badge/MySQL-8.x-orange?logo=mysql)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)
![Licencia](https://img.shields.io/badge/Licencia-UNLICENSED-red)
![Tests](https://img.shields.io/badge/Tests-Jest%20%2B%20Supertest-yellow?logo=jest)

API REST y cliente web liviano para la gestión de **cotizaciones (proformas)** de **Empresa unipersonal de Ronald Roca Cartagena** (anteriormente con la marca "RC Tractoparts") y **Roca Importaciones S.R.L.**, empresa importadora de repuestos para maquinaria pesada en Santa Cruz, Bolivia. El sistema cubre el ciclo de vida completo de una cotización: catálogos de clientes y marcas, generación atómica de correlativos, máquina de estados con aprobación basada en roles, generación de PDFs corporativos multiempresa, carga de archivos (PDF + Excel), notificaciones internas, auditoría y reportes de inteligencia de negocio.

El backend es una API REST en Node.js + Express respaldada por MySQL. El frontend es una aplicación de una sola página (SPA) en JavaScript puro (ES Modules), servida como archivos estáticos por el mismo proceso de Express — sin paso de compilación. Todo el stack está contenedorizado con Docker y orquestado con Docker Compose.

---

## Tabla de Contenidos

1. [Descripción General](#1-descripción-general)
2. [Arquitectura del Sistema y Stack Tecnológico](#2-arquitectura-del-sistema-y-stack-tecnológico)
3. [Diagramas de Arquitectura y Flujo](#3-diagramas-de-arquitectura-y-flujo)
4. [Estructura de Directorios](#4-estructura-de-directorios)
5. [Requisitos Previos](#5-requisitos-previos)
6. [Instalación Local vía Docker](#6-instalación-local-vía-docker)
7. [Instalación Manual (sin Docker)](#7-instalación-manual-sin-docker)
8. [Ejecución Local](#8-ejecución-local)
9. [Variables de Entorno](#9-variables-de-entorno)
10. [Vista Funcional](#10-vista-funcional)
11. [Arquitectura del Frontend](#11-arquitectura-del-frontend)
12. [Modelo de Seguridad](#12-modelo-de-seguridad)
13. [Pruebas](#13-pruebas)
14. [Entidad de Negocio y Nomenclatura Legal](#14-entidad-de-negocio-y-nomenclatura-legal)
15. [Refactorizaciones de PDF y Descargas](#15-refactorizaciones-de-pdf-y-descargas)
16. [Despliegue en Producción (Nginx + DigitalOcean)](#16-despliegue-en-producción-nginx--digitalocean)
17. [Licencia](#licencia)

---

## 1. Descripción General

- **Propósito:** Reemplazar las hojas de cálculo de proformas manuales con un flujo de trabajo controlado y auditado: los ejecutivos construyen cotizaciones, los jefes las aprueban, y el sistema genera un PDF corporativo consistente para el cliente.
- **Empresa:** La entidad emisora principal es **Empresa unipersonal de Ronald Roca Cartagena** (anteriormente con la marca "RC Tractoparts"), permaneciendo **Roca Importaciones S.R.L.** activa como segunda entidad emisora. Importador de repuestos para maquinaria pesada (Volvo, Komatsu, John Deere, JCB, CAT, CASE) con sede en Santa Cruz, Bolivia. Ver [§14 Entidad de Negocio y Nomenclatura Legal](#14-entidad-de-negocio-y-nomenclatura-legal) para el detalle completo del refactor de renombrado y la tolerancia a datos heredados.
- **Usuarios / roles:** `Ejecutivo`, `Administracion`, `Jefe`, `SysAdmin`, más un indicador de delegación por usuario `can_approve_quotations` (Delegación de Funciones).
- **Invariantes clave:** cada cambio de estado es validado por rol y auditado; cada cotización posee exactamente **un** PDF físico (regenerado en cada cambio relevante); todo el SQL es parametrizado; el correlativo se genera atómicamente bajo bloqueo de fila.

---

## 2. Arquitectura del Sistema y Stack Tecnológico

**Arquitectura:** Proceso único de Node.js. `src/server.js` valida la conexión a la BD y luego inicia Express; `src/app.js` construye el grafo de middlewares/rutas y se exporta por separado para que los tests puedan importarlo sin vincular un puerto. El layering es estricto: **rutas → controladores → modelos → MySQL**. Solo los modelos ejecutan SQL.

| Módulo | Tecnología (exacta) |
|---|---|
| Runtime | Node.js `>= 18` (imagen Docker: Node 20 LTS Alpine) |
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
| Contenedorización | Docker (multi-stage) + Docker Compose |

**Tablas de base de datos** (`sql/init.sql`): `roles`, `usuarios`, `marcas`, `clientes`, `productos`, `cotizaciones_correlativo`, `cotizaciones`, `cotizacion_detalles`, `auditoria`, `bitacora_auditoria`, `cotizacion_historial_estados`, `notificaciones`.

La columna `cotizaciones.entidad_emisora` (razón social emisora impresa en el encabezado de cada PDF) se almacena como **`VARCHAR(150)`**, con amplio margen para el nombre legal de 44 caracteres `Empresa unipersonal de Ronald Roca Cartagena`.

**Máquina de estados de cotizaciones** (aplicada por rol en `QuotationModel.ROLE_TRANSITIONS`):

```
Pendiente → En revision → En espera → Aprobada internamente → Enviada al cliente → Confirmada / Rechazada → Archivada
```

> **Nota histórica:** el estado de cotización confirmada fue renombrado de `Aceptada` a `Confirmada`. Una migración en `sql/init.sql` reescribe las filas heredadas `Aceptada` (y sus entradas de historial) a `Confirmada`, y el valor se conserva en listas de permitidos tolerantes para que los datos previos al renombrado nunca rompan la validación.

---

## 3. Diagramas de Arquitectura y Flujo

### 3.1 Arquitectura de Despliegue e Infraestructura

Flujo de la petición desde el cliente, sobre HTTPS, a través del proxy inverso Nginx del host (terminación SSL con Let's Encrypt), hacia los contenedores Docker aislados.

```mermaid
flowchart LR
    Cliente["🌐 Navegador Cliente<br/>(HTTPS)"]

    subgraph Droplet["Droplet de DigitalOcean (Host Ubuntu)"]
        direction TB
        Nginx["Proxy Inverso Nginx<br/>:443 terminación TLS<br/>Let's Encrypt / Certbot"]

        subgraph Docker["Docker Compose — red: rc_internal"]
            direction TB
            App["contenedor app<br/>Node.js + Express<br/>127.0.0.1:3000"]
            DB[("contenedor db<br/>MySQL 8")]
            VolDB[["volumen: db_data"]]
            VolUp[["volumen: app_uploads"]]
            VolSt[["volumen: app_storage"]]
        end
    end

    Cliente -- "HTTPS :443" --> Nginx
    Nginx -- "proxy_pass HTTP<br/>127.0.0.1:3000" --> App
    App -- "SQL :3306<br/>(solo interno)" --> DB
    DB --- VolDB
    App --- VolUp
    App --- VolSt
```

### 3.2 Lógica Dinámica Multiempresa

Cómo el sistema resuelve dinámicamente encabezados, marca (branding) e información tributaria separados según la entidad comercial seleccionada.

```mermaid
flowchart TD
    Start(["Cotización creada / editada"]) --> Sel{"¿entidad_emisora<br/>seleccionada?"}
    Sel -- "vacío / null" --> Legacy
    Sel -- "'RC Tractoparts'<br/>(valor heredado)" --> Legacy["normalizeEntidad()<br/>mapeo tolerante en runtime"]
    Legacy --> Primary
    Sel -- "Empresa unipersonal de<br/>Ronald Roca Cartagena" --> Primary["Entidad A — Unipersonal"]
    Sel -- "Roca Importaciones S.R.L." --> SRL["Entidad B — S.R.L."]

    Primary --> RA["Renderiza encabezado A<br/>+ branding A + datos tributarios A"]
    SRL --> RB["Renderiza encabezado B<br/>+ branding B + datos tributarios B"]

    RA --> PDF["Encabezado de proforma PDF<br/>(pdfService.drawHeader)"]
    RB --> PDF
    PDF --> Done(["Documento con marca emitido"])
```

### 3.3 Máquina de Estados del Ciclo de Vida del Documento

Flujo completo de la cotización, enfatizando las reglas de negocio del estado **`Confirmada`** — su inmutabilidad absoluta y el disparador automático de registro de auditoría.

```mermaid
stateDiagram-v2
    [*] --> Pendiente
    Pendiente --> EnRevision: enviar
    EnRevision --> EnEspera: poner en espera
    EnEspera --> AprobadaInternamente: jefe aprueba
    EnRevision --> AprobadaInternamente: jefe aprueba
    AprobadaInternamente --> EnviadaAlCliente: enviar al cliente
    EnviadaAlCliente --> Confirmada: cliente confirma
    EnviadaAlCliente --> Rechazada: cliente rechaza
    Confirmada --> Archivada: archivar
    Rechazada --> Archivada: archivar
    Archivada --> [*]

    note right of Confirmada
        REGLA DE NEGOCIO — INMUTABLE
        • No se permiten más ediciones / cambios de estado
        • La transición se registra en cotizacion_historial_estados
        • Se escribe una entrada de auditoría JSON automática
          en bitacora_auditoria (quién / cuándo / payload)
    end note

    state "En revision" as EnRevision
    state "En espera" as EnEspera
    state "Aprobada internamente" as AprobadaInternamente
    state "Enviada al cliente" as EnviadaAlCliente
```

### 3.4 Rendimiento del Sistema y Flujo de UI

Transiciones de diseño responsivo mobile-first y la descarga asíncrona y eficiente en memoria del PDF (respuestas por streaming en fragmentos que evitan la saturación de RAM).

```mermaid
sequenceDiagram
    participant U as Usuario (UI mobile-first)
    participant FE as SPA (timelineView.js)
    participant API as Ruta Express
    participant FS as Disco / Stream

    Note over U,FE: El diseño responsivo se adapta:<br/>≤768px una columna apilada ·<br/>>768px dashboard multicolumna
    U->>FE: Toca "Descargar PDF"
    FE->>API: GET /:id/pdf (Bearer JWT)
    API->>FS: fs.createReadStream(pdf)
    FS-->>API: fragmento 1..n (streaming)
    API-->>FE: Respuesta Blob (por fragmentos, baja RAM)
    FE->>FE: createElement('a') + download=<br/>"COT-2026-0001.pdf"
    FE-->>U: Archivo con nombre limpio guardado
    Note over API,FS: El streaming evita almacenar el archivo<br/>completo en memoria — previene saturación de RAM
```

---

## 4. Estructura de Directorios

```
rc-tractoparts/
├── Dockerfile                     # Build multi-stage (deps → runner, sin root)
├── docker-compose.yml             # app + MySQL + volúmenes + red interna
├── .dockerignore                  # Mantiene secretos/tests/artefactos fuera de la imagen
├── src/
│   ├── server.js                  # Punto de entrada: verificación de BD + HTTP listen + shutdown
│   ├── app.js                     # App Express: middlewares, Swagger, rutas, manejador de errores
│   ├── config/
│   │   └── db.js                  # Pool de conexiones MySQL (singleton) + ping de arranque
│   ├── routes/                    # /api/auth, /api/cotizaciones, /api/usuarios, …
│   ├── controllers/               # Manejadores de peticiones (incl. subcarpeta quotation/)
│   ├── models/                    # ÚNICA capa que ejecuta SQL (todo parametrizado)
│   ├── middlewares/               # authMiddleware, roleMiddleware, auditMiddleware
│   ├── validators/                # Esquemas Zod + factory validate()
│   ├── services/
│   │   └── pdfService.js          # Motor de diseño de proformas con PDFKit
│   ├── utils/
│   │   └── auditLog.js
│   └── assets/images/             # rc_logo.png + marcas/*.png (para el motor PDF)
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
├── uploads/                       # PDFs generados/subidos (gitignored, volumen runtime)
├── storage/excels/                # Hojas Excel subidas (gitignored, volumen runtime)
├── .env.example                   # Referencia de variables de entorno
├── eslint.config.js
└── package.json
```

---

## 5. Requisitos Previos

**Para el flujo con Docker (recomendado):**

- **Docker Engine 24+** y el plugin **Docker Compose v2**.
- No se requiere instalación local de Node.js ni MySQL — ambos corren en contenedores.

**Para el flujo manual:**

- **Node.js `>= 18`** y npm (el lockfile es de npm).
- **MySQL Server 8.x** en ejecución y accesible, con una cuenta que pueda crear bases de datos (para `npm run db:init`).

---

## 6. Instalación Local vía Docker

El repositorio incluye un `Dockerfile` multi-stage orientado a producción y un `docker-compose.yml` que orquesta la aplicación y una base de datos MySQL persistente en una red interna aislada.

```bash
# 1. Clonar y entrar al proyecto
git clone <repo-url> rc-tractoparts && cd rc-tractoparts

# 2. Crear el archivo de entorno desde la plantilla y llenar los secretos reales
cp .env.example .env          # PowerShell: Copy-Item .env.example .env

# 3. Construir las imágenes y levantar el stack (en segundo plano)
docker compose up -d --build

# 4. Seguir los logs de la aplicación
docker compose logs -f app
```

**Qué ocurre en el primer `up`:**

- El servicio `db` inicializa MySQL y **ejecuta automáticamente `sql/init.sql`** (montado en `/docker-entrypoint-initdb.d/`), que elimina/recrea el esquema y siembra roles, marcas, clientes de ejemplo, el contador anual y las cuentas privilegiadas iniciales.
- El servicio `app` espera a que la base de datos reporte estado **saludable** (`depends_on: condition: service_healthy`) y luego inicia Express.
- Los PDFs generados y los archivos Excel subidos persisten en los volúmenes nombrados `app_uploads` y `app_storage`; los datos de la base persisten en `db_data`.

**Endpoints (publicados en el host solo en `127.0.0.1`):**

- Frontend / Login: `http://localhost:3000/`
- Health check: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/api-docs`

**Comandos comunes:**

```bash
docker compose ps                 # Estado de los contenedores
docker compose logs -f app        # Ver logs de la app
docker compose exec app sh        # Abrir shell en el contenedor de la app
docker compose exec db mysql -u root -p   # Cliente MySQL dentro del contenedor db
docker compose down               # Detener y eliminar contenedores (se conservan volúmenes)
docker compose down -v            # Detener y ADEMÁS eliminar volúmenes (destruye los datos)
```

> ⚠️ `sql/init.sql` es **destructivo** — en la primera inicialización elimina cualquier base de datos `rc_tractoparts` existente. Solo se ejecuta automáticamente cuando el volumen `db_data` está vacío (primer arranque).

**Cuentas iniciales sembradas por `init.sql`** (cámbialas en producción):

| Usuario | Rol | Contraseña |
|---|---|---|
| `SysAdmin` | SysAdmin (4) | `Admin#RC2026` |
| `ronald` | Jefe (3) | `Ronald#RC2026` |
| `angelica` | Administracion (2) | `Angelica#RC2026` |

Las cuentas `Ejecutivo` **no** se siembran; se crean desde la plataforma mediante `POST /api/usuarios`.

---

## 7. Instalación Manual (sin Docker)

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de entorno desde la plantilla
cp .env.example .env          # PowerShell: Copy-Item .env.example .env

# 3. Edita .env con tus valores reales (mantén DB_HOST=localhost para MySQL local)

# 4. Inicializar la base de datos (destructivo — elimina rc_tractoparts primero)
npm run db:init

# 5. (Opcional) Sembrar usuarios de desarrollo/test con hashes bcrypt frescos
npm run seed            # SOLO PREVISUALIZACIÓN — imprime el SQL, no escribe nada
npm run seed:execute    # Conecta e inserta/actualiza los usuarios de dev en la BD
```

> `db:init` abre una conexión admin de un solo uso (sin BD preseleccionada, `multipleStatements` activado) y ejecuta el script completo `sql/init.sql`.

---

## 8. Ejecución Local

```bash
# Desarrollo (recarga automática con nodemon)
npm run dev

# Inicio en modo producción
npm start
```

Al iniciar con éxito, el servidor valida la conexión a la BD y luego escucha en `PORT` (por defecto **3000**). Si MySQL no es accesible, el arranque se interrumpe con código de salida no cero.

**Calidad / pruebas:**

```bash
npm run lint              # ESLint sobre src/
npm run test:unit         # Tests unitarios — SIN base de datos requerida
npm run test:integration  # Tests de integración — REQUIERE BD rc_tractoparts_test
npm test                  # Jest completo (integración requiere la BD de test)
```

---

## 9. Variables de Entorno

Todos los secretos y la configuración están externalizados en `.env` (nunca versionado). Referencia (`.env.example`):

| Variable | Grupo | Descripción |
|---|---|---|
| `NODE_ENV` | App | `development` \| `production` \| `test` |
| `PORT` | App | Puerto HTTP en el que escucha Express (por defecto `3000`) |
| `APP_NAME` | App | Nombre mostrado en logs / Swagger |
| `DB_HOST` | Base de datos | Host de MySQL. En Docker Compose se sobrescribe al nombre del servicio `db` |
| `DB_PORT` | Base de datos | Puerto de MySQL (por defecto `3306`) |
| `DB_USER` | Base de datos | Usuario de BD de la aplicación |
| `DB_PASSWORD` | Base de datos | Contraseña del usuario de BD (**secreto**) |
| `DB_NAME` | Base de datos | Nombre de la base principal (`rc_tractoparts`) |
| `DB_NAME_TEST` | Base de datos | Base usada solo cuando `NODE_ENV=test` |
| `DB_ROOT_PASSWORD` | Base de datos | Contraseña **root** de MySQL para el servicio `db` de Compose (**secreto**) |
| `DB_CONNECTION_LIMIT` | Base de datos | Máximo de conexiones simultáneas del pool |
| `DB_QUEUE_LIMIT` | Base de datos | Límite de cola; `0` = ilimitado |
| `JWT_SECRET` | Auth | Secreto de firma HS256, ≥ 64 caracteres aleatorios (**secreto**) |
| `JWT_EXPIRES_IN` | Auth | Duración del token (ej. `8h`) |
| `BCRYPT_ROUNDS` | Auth | Factor de costo de bcrypt |
| `MAX_LOGIN_ATTEMPTS` | Seguridad | Fallos antes del bloqueo de cuenta |
| `LOCK_DURATION_MINUTES` | Seguridad | Duración del bloqueo de cuenta |
| `UPLOAD_DIR` | Cargas | Directorio de subida de PDFs (por defecto `uploads/cotizaciones`) |
| `MAX_PDF_SIZE_MB` | Cargas | Tamaño máximo de PDF en MB |
| `CORS_ORIGIN` | CORS | Orígenes permitidos separados por coma (tu dominio HTTPS público en producción) |

> **Generación de secretos:** crea un JWT secret fuerte con `openssl rand -hex 64`. Nunca escribas secretos en el código fuente, el Dockerfile ni el `docker-compose.yml` — Compose los lee de `.env` en tiempo de ejecución.

---

## 10. Vista Funcional

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

## 11. Arquitectura del Frontend

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

La UI es **responsiva mobile-first**: en anchos reducidos el dashboard colapsa a una sola columna apilada, y se expande a un diseño multicolumna en pantallas más grandes (ver [§3.4](#34-rendimiento-del-sistema-y-flujo-de-ui)).

---

## 12. Modelo de Seguridad

| Capa | Mecanismo |
|---|---|
| Transporte | HTTPS terminado en el proxy inverso Nginx (Let's Encrypt) |
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
| Secretos | Externalizados en `.env`; nunca hardcodeados en código ni imágenes |
| Contenedor | Corre como usuario `node` no-root; MySQL nunca expuesto a la red pública |

---

## 13. Pruebas

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

> Los tests de integración se conectan a la base de datos nombrada por `DB_NAME_TEST` cuando `NODE_ENV=test`. Crea e inicializa esa base de datos antes de ejecutarlos.

---

## 14. Entidad de Negocio y Nomenclatura Legal

El nombre de la entidad de negocio principal fue cambiado oficialmente de **"RC Tractoparts"** a **"Empresa unipersonal de Ronald Roca Cartagena"**. Este refactor se aplicó de forma consistente en **todas las capas** del stack:

| Capa | Ubicación | Cambio |
|---|---|---|
| Base de datos | `sql/init.sql` | El valor por defecto de `cotizaciones.entidad_emisora` es `'Empresa unipersonal de Ronald Roca Cartagena'`, almacenado como `VARCHAR(150)` |
| Validación backend | `src/validators/quotationValidator.js` | La lista de permitidos `VALID_ENTITIES` usa el nuevo nombre legal como valor principal |
| Selector frontend | `public/js/views/quotationForm.js` | El desplegable/hidratación de entidad emisora usa por defecto el nuevo nombre legal |
| Encabezados PDF / Excel | `src/services/pdfService.js` | El texto del encabezado de la proforma PDF renderiza el nuevo nombre legal |

- **Segunda entidad sin cambios:** `Roca Importaciones S.R.L.` permanece activa y sin cambios como segunda entidad emisora seleccionable.
- **Mapeo tolerante de datos heredados:** el sistema implementa un patrón de mapeo en tiempo de ejecución para que los registros heredados que aún contienen la cadena `'RC Tractoparts'` sean tolerados sin romper la validación ni la hidratación de la UI:
  - `quotationValidator.js` mantiene `'RC Tractoparts'` en la lista de permitidos `VALID_ENTITIES`, de modo que las filas previas al renombrado siguen validando al editar/re-guardar.
  - `pdfService.js` expone `normalizeEntidad()`, que mapea cualquier valor almacenado `'RC Tractoparts'` (o vacío) a `Empresa unipersonal de Ronald Roca Cartagena` al momento de imprimir — las cotizaciones antiguas renderizan el encabezado correcto **sin ninguna migración de datos**.

> Esto refleja el mismo enfoque de tolerancia a datos heredados usado para el renombrado de estado `Aceptada` → `Confirmada` (ver [§2](#2-arquitectura-del-sistema-y-stack-tecnológico)). La resolución dinámica de encabezado/branding/datos tributarios por entidad se ilustra en [§3.2](#32-lógica-dinámica-multiempresa).

---

## 15. Refactorizaciones de PDF y Descargas

### Corrección de alineación del logo (`src/services/pdfService.js`)

La alineación del logo de marca principal en `drawHeader()` se cambió de `align: 'center'` a `align: 'left'`. El logo es una imagen apaisada ancha que, al ajustarse por altura dentro de su caja, queda más angosta que el ancho de la caja; con `align: 'center'` PDFKit rellenaba el espacio horizontal sobrante a ambos lados, empujando el logo visible **~12 pt hacia la derecha**. Cambiar a `align: 'left'` fija el borde izquierdo del logo exactamente en `x = MARGIN = 36`, alineándolo limpiamente con el bloque de texto de dirección y datos de contacto que se renderiza justo debajo.

### Refactor del manejador de descargas con nombre limpio (`public/js/views/dashboard/modules/timelineView.js`)

El enfoque de descarga heredado usaba `window.open(blobUrl)` sobre una URL `blob:` cruda, lo que hacía que los navegadores guardaran los PDFs con un nombre de archivo UUID aleatorio ilegible (ej. `32cb1a0d-…`), rompiendo el flujo de los ejecutivos de "descargar y enviar al cliente por WhatsApp".

Esto fue reemplazado completamente por una técnica de **inyección dinámica de etiqueta ancla** (`document.createElement('a')` con el atributo `download` establecido). Ahora tanto los **PDFs como los archivos Excel** se descargan forzando el identificador alfanumérico real y limpio de la cotización como nombre de archivo (ej. `COT-2026-0001.pdf`). El correlativo se sanitiza antes de usarse para bloquear cualquier carácter de inyección de rutas/cabeceras. La descarga se sirve mediante **streaming por fragmentos** para mantener plana la memoria del servidor (ver [§3.4](#34-rendimiento-del-sistema-y-flujo-de-ui)).

---

## 16. Despliegue en Producción (Nginx + DigitalOcean)

La topología de producción recomendada ejecuta el stack de Docker Compose en un **Droplet de DigitalOcean**, con **Nginx en el host** actuando como proxy inverso con terminación TLS delante de la app contenedorizada. Ver el diagrama en [§3.1](#31-arquitectura-de-despliegue-e-infraestructura).

### 16.1 Aprovisionar el Droplet

1. Crea un Droplet Ubuntu 22.04 LTS y apunta el registro `A` de tu dominio a su IP pública.
2. Endurece SSH, crea un usuario sudo no-root y habilita el firewall:
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'   # abre 80 y 443
   sudo ufw enable
   ```
3. Instala Docker Engine + plugin de Compose y Nginx + Certbot:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo apt-get install -y nginx certbot python3-certbot-nginx
   ```

### 16.2 Desplegar el stack de la aplicación

```bash
git clone <repo-url> /opt/rc-tractoparts && cd /opt/rc-tractoparts
cp .env.example .env          # llena los secretos de producción (contraseñas fuertes + JWT)
# Configura CORS_ORIGIN=https://cotizaciones.tudominio.com en .env
docker compose up -d --build
```

El contenedor `app` se vincula solo a **`127.0.0.1:3000`** — nunca se expone públicamente. Únicamente Nginx queda de cara a internet.

### 16.3 Configurar Nginx como proxy inverso

Crea `/etc/nginx/sites-available/rc-tractoparts`:

```nginx
server {
    listen 80;
    server_name cotizaciones.tudominio.com;

    # Permite subidas grandes de PDF/Excel (coincide con MAX_PDF_SIZE_MB)
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Actívalo y recarga:

```bash
sudo ln -s /etc/nginx/sites-available/rc-tractoparts /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> La app ya invoca `app.set('trust proxy', 1)`, por lo que las cabeceras `X-Forwarded-*` se respetan para obtener las IPs de cliente correctas y el rate limiting.

### 16.4 Habilitar HTTPS con Let's Encrypt

```bash
sudo certbot --nginx -d cotizaciones.tudominio.com
```

Certbot obtiene el certificado, reescribe la configuración de Nginx para escuchar en `:443` con TLS, e instala un temporizador de renovación automática. Todo el tráfico del cliente ahora es HTTPS; el TLS se termina en Nginx y se reenvía como HTTP plano al contenedor por la interfaz de loopback.

### 16.5 Advertencia de persistencia y almacenamiento

Los PDFs generados (`uploads/cotizaciones/`) y los archivos Excel subidos (`storage/excels/`) se escriben en disco y persisten mediante los volúmenes nombrados de Docker `app_uploads` y `app_storage`; la base de datos persiste vía `db_data`.

> ⚠️ En plataformas **efímeras/serverless** (ej. Render, Heroku) los archivos locales se borran en cada reinicio/redespliegue. Un Droplet con disco persistente y volúmenes nombrados (como arriba) evita esto. Para escalado horizontal, migra el almacenamiento de archivos a **almacenamiento de objetos** (DigitalOcean Spaces / S3) o transmite los documentos generados en memoria en lugar de escribir en disco local.

### 16.6 Operaciones

```bash
docker compose pull && docker compose up -d --build   # desplegar una actualización
docker compose logs -f app                            # ver logs
docker compose exec db mysqldump -u root -p rc_tractoparts > backup.sql   # respaldo de BD
```

---

## Licencia

UNLICENSED — © Empresa unipersonal de Ronald Roca Cartagena (anteriormente RC Tractoparts), Departamento de Sistemas.
