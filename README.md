<div align="center">

# 🚜 RC Tractoparts
### Sistema de Gestión de Cotizaciones y Proformas

**API REST empresarial para la gestión integral del ciclo de vida de cotizaciones comerciales**

---

![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-Tests_12%2F12_✓-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Sprint](https://img.shields.io/badge/Sprint-2_Completado-1B2B4B?style=for-the-badge)
![License](https://img.shields.io/badge/Licencia-UNLICENSED-red?style=for-the-badge)

</div>

---

## 📋 Tabla de Contenidos

1. [Descripción General](#-descripción-general)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Stack Tecnológico](#-stack-tecnológico)
4. [Estructura de Archivos](#-estructura-de-archivos)
5. [Instalación y Configuración](#-instalación-y-configuración)
6. [Variables de Entorno](#-variables-de-entorno)
7. [Base de Datos](#-base-de-datos)
8. [Ejecución del Proyecto](#-ejecución-del-proyecto)
9. [Documentación Interactiva (Swagger)](#-documentación-interactiva-swagger)
10. [Mapa Completo de Endpoints](#-mapa-completo-de-endpoints)
11. [Máquina de Estados — Ciclo de Vida de Cotizaciones](#-máquina-de-estados)
12. [Matriz de Roles y Permisos](#-matriz-de-roles-y-permisos)
13. [Pruebas Automatizadas](#-pruebas-automatizadas)
14. [Solución de Problemas](#-solución-de-problemas)

---

## 📖 Descripción General

RC Tractoparts es una empresa boliviana de importación de maquinaria pesada y repuestos con sede en **Santa Cruz de la Sierra, Bolivia**. Este repositorio contiene la **API REST backend** del Sistema de Gestión de Cotizaciones y Proformas, desarrollado bajo metodología **XP/SCRUM** en dos sprints productivos.

El sistema automatiza el ciclo completo de una cotización comercial: desde su creación como borrador, pasando por la revisión y aprobación interna del Jefe, hasta el envío formal al cliente y el registro de la respuesta final.

### Funcionalidades clave implementadas

| Característica | Descripción |
|---|---|
| 🔐 **Autenticación JWT** | Tokens firmados con expiración configurable y revocación en memoria al cerrar sesión |
| 🔒 **RBAC estricto** | Middleware de roles que restringe cada endpoint según el perfil del usuario |
| 🔢 **Correlativo atómico** | `SELECT … FOR UPDATE` garantiza seriales únicos bajo concurrencia máxima (RNF10) |
| 📄 **PDF automático** | Generación de proformas con marca corporativa en el momento de creación y aprobación |
| ⚙️ **Máquina de estados** | Flujo formal `Borrador → En revisión → Aprobada/Rechazada → Enviada → Aceptada` |
| 🛡️ **Flujo de aprobación HU08** | Solo el Jefe puede aprobar o rechazar cotizaciones, con registro histórico completo |
| 📊 **Consultas avanzadas** | Listado paginado con 10 filtros combinables, ordenamiento dinámico y conteo paralelo |
| 📝 **Auditoría completa** | Cada acción relevante se registra en `bitacora_auditoria` con IP, usuario y metadatos |

---

## 🏗 Arquitectura del Sistema

El sistema implementa una **arquitectura de capas MVC estricta** con separación total de responsabilidades:

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENTE / SWAGGER UI                      │
│                  HTTP + Bearer JWT Token                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                    CAPA DE ENRUTAMIENTO                      │
│          src/routes/*.js  —  Express Router                  │
│   authRoutes · quotationRoutes · userRoutes                  │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌───────────▼───────────────────────┐
│  MIDDLEWARES        │   │         CONTROLADORES              │
│  authMiddleware.js  │   │  authController.js                 │
│  roleMiddleware.js  │   │  quotationController.js            │
│  JWT verify + RBAC  │   │  userController.js                 │
└─────────────────────┘   └───────────┬───────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────┐
                    │            SERVICIOS                    │
                    │        pdfService.js (PDFKit)          │
                    └─────────────────┬─────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────┐
                    │              MODELOS                    │
                    │   QuotationModel.js · UserModel.js     │
                    │   Pool MySQL · Transacciones · RBAC    │
                    └─────────────────┬─────────────────────┘
                                      │
                    ┌─────────────────▼─────────────────────┐
                    │          BASE DE DATOS MySQL 8.0+      │
                    │  8 tablas · Pool de 10 conexiones      │
                    │  Charset utf8mb4 · Timezone UTC        │
                    └───────────────────────────────────────┘
```

### Principios de seguridad implementados

- **Hashing bcrypt** con factor de costo configurable (12 rondas por defecto en producción)
- **Protección brute-force**: bloqueo automático de cuenta tras 3 intentos fallidos por 15 minutos
- **Cabeceras HTTP seguras** via `helmet` (CSP, X-Frame-Options, HSTS)
- **CORS** restrictivo configurado por variable de entorno
- **Consultas 100% parametrizadas** — cero concatenación de strings en SQL
- **Pool de conexiones** con liberación garantizada en bloques `finally`
- **Concurrencia atómica** mediante transacciones con `SELECT … FOR UPDATE`

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
| PDF | PDFKit | 0.x | Generación de proformas en formato A4 |
| Upload | Multer | 1.4.x | Validación y almacenamiento de PDFs |
| Seguridad | Helmet | 7.x | Cabeceras HTTP de seguridad |
| Logging | Morgan | 1.10.x | Registro de peticiones HTTP |
| Variables | dotenv | 16.x | Gestión de entorno |
| Testing | Jest + Supertest | 29.x | Pruebas unitarias e integración |
| Dev server | Nodemon | 3.x | Recarga automática en desarrollo |

---

## 📁 Estructura de Archivos

```
rc-tractoparts/
│
├── 📂 scripts/
│   └── seed-users.js              # Sembrado seguro de usuarios con hashes auto-verificados
│
├── 📂 sql/
│   ├── init.sql                   # 8 tablas base + roles iniciales (Sprint 1)
│   └── migrate_sprint2_estados.sql # ENUM Borrador + tabla historial (Sprint 2)
│
├── 📂 src/
│   ├── 📂 config/
│   │   └── db.js                  # Pool MySQL (Singleton) + testConnection()
│   │
│   ├── 📂 controllers/
│   │   ├── authController.js      # Login / Logout (HU01)
│   │   ├── quotationController.js # CRUD cotizaciones + HU08 aprobación + historial
│   │   └── userController.js      # CRUD usuarios (solo Jefe — HU02)
│   │
│   ├── 📂 middlewares/
│   │   ├── authMiddleware.js      # Verificación JWT + revocación en memoria
│   │   └── roleMiddleware.js      # RBAC: authorize(['Jefe', 'Ejecutivo', ...])
│   │
│   ├── 📂 models/
│   │   ├── QuotationModel.js      # DAL completo: state machine, transacciones, historial
│   │   └── UserModel.js           # DAL usuarios: CRUD + brute-force counters
│   │
│   ├── 📂 routes/
│   │   ├── authRoutes.js          # POST /api/auth/login|logout
│   │   ├── quotationRoutes.js     # 10 rutas — orden fijo-antes-paramétrico crítico
│   │   └── userRoutes.js          # /api/usuarios (Jefe solamente)
│   │
│   ├── 📂 services/
│   │   └── pdfService.js          # Generación PDF corporativo (PDFKit, A4, auto-triggered)
│   │
│   ├── 📂 utils/
│   │   └── auditLog.js            # logEvent() — escritura asíncrona a bitacora_auditoria
│   │
│   ├── app.js                     # Express: CORS, helmet, morgan, rutas, error handler global
│   └── server.js                  # Inicio servidor + testConnection() + graceful shutdown
│
├── 📂 tests/
│   ├── 📂 unit/
│   │   └── calcularTotales.test.js       # 12 pruebas UT-01→UT-08 + EDGE cases
│   └── 📂 integration/
│       └── correlativo.concurrencia.test.js  # CC-01: 20 peticiones simultáneas
│
├── .env.example                   # Plantilla de variables de entorno
├── .gitignore
├── package.json
└── README.md
```

---

## ⚙️ Instalación y Configuración

### Requisitos previos

Asegúrate de tener instalado en tu sistema:

- **[Node.js](https://nodejs.org/) v18.0.0 o superior** — verificar con `node -v`
- **[MySQL 8.0+](https://dev.mysql.com/downloads/)** — servidor local o remoto accesible
- **[Git](https://git-scm.com/)** — para clonar el repositorio

### Paso 1 — Clonar e instalar dependencias

```bash
# Clonar el repositorio
git clone https://github.com/AdrianGareca/rc-tractoparts.git
cd rc-tractoparts

# Instalar todas las dependencias de producción y desarrollo
npm install
```

### Paso 2 — Crear el archivo de variables de entorno

```bash
# Copiar la plantilla y abrirla para editar
cp .env.example .env
```

Edita `.env` con tus valores reales (ver sección [Variables de Entorno](#-variables-de-entorno)).

### Paso 3 — Inicializar la base de datos

Ejecuta los scripts SQL en **MySQL Workbench** o desde la terminal en el orden indicado:

```sql
-- Script 1: Estructura base (Sprint 1) — 8 tablas + roles
SOURCE sql/init.sql;

-- Script 2: Expansión Sprint 2 — agrega estado 'Borrador' y tabla de historial
SOURCE sql/migrate_sprint2_estados.sql;
```

> **Nota:** Si usas MySQL Workbench, haz doble clic en el esquema `rc_tractoparts` en el panel izquierdo para seleccionarlo (aparece en **negrita**) antes de ejecutar los scripts.

### Paso 4 — Sembrar usuarios de prueba

El script genera hashes bcrypt en tiempo de ejecución y los auto-verifica antes de tocar la base de datos. Nunca se copian hashes externos.

```bash
# Vista previa: muestra el SQL generado sin escribir en la BD
npm run seed

# Ejecutar: aplica los usuarios directamente en la base de datos
npm run seed:execute
```

Los usuarios sembrados son:

| Usuario | Contraseña | Rol |
|---|---|---|
| `jefe` | `jefe123` | Jefe |
| `adrian_admin` | `admin123` | Jefe |
| `carlos_admin` | `admin123` | Administracion |
| `elena_ejec` | `ejecutivo123` | Ejecutivo |

---

## 🔑 Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con las siguientes variables. El archivo `.env` está en `.gitignore` y **nunca debe subirse al repositorio**.

```env
# ── Aplicación ────────────────────────────────────────────
NODE_ENV=development          # development | production | test
PORT=3000                     # Puerto en el que escucha Express
APP_NAME=RC-Tractoparts-API

# ── Base de Datos (MySQL) ──────────────────────────────────
DB_HOST=localhost
DB_PORT=3306
DB_USER=root                  # Usuario MySQL con permisos sobre rc_tractoparts
DB_PASSWORD=tu_contraseña     # Contraseña del usuario MySQL
DB_NAME=rc_tractoparts        # Base de datos principal
DB_NAME_TEST=rc_tractoparts_test  # BD exclusiva para pruebas automatizadas

# Ajuste del pool de conexiones
DB_CONNECTION_LIMIT=10        # Máximo de conexiones simultáneas en el pool
DB_QUEUE_LIMIT=0              # 0 = cola ilimitada

# ── Autenticación y Seguridad ──────────────────────────────
JWT_SECRET=cambia_esto_por_una_clave_larga_y_aleatoria_de_64_caracteres
JWT_EXPIRES_IN=8h             # Duración del token (8 horas = jornada laboral completa)
BCRYPT_ROUNDS=12              # Factor de costo bcrypt (mayor = más seguro y lento)

# ── Protección Brute-Force ─────────────────────────────────
MAX_LOGIN_ATTEMPTS=3          # Intentos fallidos antes de bloquear la cuenta
LOCK_DURATION_MINUTES=15      # Duración del bloqueo en minutos

# ── Archivos PDF ───────────────────────────────────────────
UPLOAD_DIR=uploads/cotizaciones   # Directorio relativo para almacenar PDFs
MAX_PDF_SIZE_MB=10            # Tamaño máximo de PDF en megabytes

# ── CORS ───────────────────────────────────────────────────
CORS_ORIGIN=http://localhost:5500  # Origen(s) permitido(s); separar con coma si son varios
```

> ⚠️ **`JWT_SECRET`** debe ser una cadena larga, aleatoria e impredecible. Genera una segura con: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

## 🗄 Base de Datos

### Esquema de tablas

| Tabla | Tipo | Descripción |
|---|---|---|
| `roles` | Catálogo | 3 perfiles del sistema: Ejecutivo, Administracion, Jefe |
| `usuarios` | Fuerte | Cuentas de usuario con hash bcrypt y control brute-force |
| `clientes` | Fuerte | Contrapartes comerciales (razón social, NIT) |
| `productos` | Fuerte | Catálogo interno de piezas y repuestos |
| `cotizaciones_correlativo` | Débil | Contador atómico de seriales por año calendario |
| `cotizaciones` | Débil | Registro principal de cada cotización (header) |
| `cotizacion_detalles` | Débil | Ítems de línea de cada cotización |
| `cotizacion_historial_estados` | Débil | Historial cronológico de transiciones de estado |
| `bitacora_auditoria` | Débil | Log de auditoría inmutable (INSERT-only) |

### Formato del correlativo generado

```
COT-YYYY-NNNN
│    │     └── Número secuencial del año, 0-rellenado a 4 dígitos
│    └──────── Año calendario de 4 dígitos
└───────────── Prefijo fijo de la empresa
```

Ejemplo: `COT-2026-0042` — cotización número 42 del año 2026.

---

## 🚀 Ejecución del Proyecto

### Modo desarrollo (con recarga automática)

```bash
npm run dev
```

Al iniciar, el servidor ejecuta `testConnection()` antes de aceptar tráfico HTTP. Si la base de datos no es accesible, el proceso termina con código de error `1`. Si todo está correcto, verás:

```
============================================================
[Server] RC-Tractoparts-API running
[Server] Environment : development
[Server] Listening on: http://localhost:3000
[Server] Health check: http://localhost:3000/health
============================================================
[DB] Connected to MySQL — host: localhost:3306 | database: rc_tractoparts
```

### Endpoint de diagnóstico

```bash
curl http://localhost:3000/health
# { "status": "ok", "service": "RC-Tractoparts-API", "timestamp": "..." }
```

### Modo producción

```bash
npm start
```

### Ejecutar pruebas

```bash
# Pruebas unitarias (no requiere BD)
npm run test:unit

# Todas las pruebas (requiere BD de test configurada en DB_NAME_TEST)
npm test

# Sembrar usuarios en la BD
npm run seed:execute
```

---

## 📚 Documentación Interactiva (Swagger)

Con el servidor en ejecución, accede a la documentación completa de la API en:

```
http://localhost:3000/api-docs/
```

La interfaz Swagger UI permite:
- **Explorar** todos los endpoints con sus esquemas de request/response
- **Autenticarte** con el token JWT obtenido del login (botón **Authorize 🔒**)
- **Probar** cada endpoint directamente desde el navegador sin necesidad de Postman

> **Flujo recomendado en Swagger:**
> 1. `POST /api/auth/login` → copiar el `token` del response
> 2. Clic en **Authorize 🔒** → pegar `Bearer <token>`
> 3. Explorar libremente todos los endpoints protegidos

---

## 🗺 Mapa Completo de Endpoints

### 🔐 Autenticación — `/api/auth`

| Método | Endpoint | Auth | Roles | Descripción |
|---|---|---|---|---|
| `POST` | `/api/auth/login` | ❌ Pública | — | Autenticación con credenciales; devuelve JWT |
| `POST` | `/api/auth/logout` | ✅ JWT | Todos | Revoca el token activo en memoria |

**Body de login:**
```json
{
  "nombre_usuario": "jefe",
  "password": "jefe123"
}
```

**Response exitoso (200):**
```json
{
  "success": true,
  "message": "Authentication successful.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": 1,
      "nombre_completo": "Jefe del Sistema",
      "nombre_usuario": "jefe",
      "rol": "Jefe"
    }
  }
}
```

---

### 👥 Usuarios — `/api/usuarios`

> Todos los endpoints de usuarios requieren rol **Jefe**.

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/usuarios` | Listar todos los usuarios del sistema |
| `POST` | `/api/usuarios` | Crear un nuevo usuario |
| `GET` | `/api/usuarios/:id` | Obtener detalle de un usuario |
| `PUT` | `/api/usuarios/:id` | Actualizar perfil, rol o contraseña |
| `DELETE` | `/api/usuarios/:id` | Desactivar usuario (soft delete, `activo = 0`) |

**Body para crear usuario:**
```json
{
  "nombre_completo": "María López",
  "nombre_usuario": "maria_ejec",
  "password": "contraseña_segura",
  "id_rol": 1
}
```

**Tabla de roles disponibles:**

| `id_rol` | Nombre | Descripción |
|---|---|---|
| `1` | `Ejecutivo` | Crea y envía cotizaciones, sube PDFs |
| `2` | `Administracion` | Gestión operativa, puede cancelar revisiones |
| `3` | `Jefe` | Aprobación total, administración de usuarios |

---

### 📋 Cotizaciones — `/api/cotizaciones`

#### Endpoints de colección y resumen

| Método | Endpoint | Roles | Descripción |
|---|---|---|---|
| `GET` | `/api/cotizaciones/resumen` | Todos | Conteo de cotizaciones agrupado por estado |
| `GET` | `/api/cotizaciones/pendientes-aprobacion` | Jefe | Cola de aprobación: todas las cotizaciones en `En revision` |
| `GET` | `/api/cotizaciones` | Todos | Listado paginado, filtrado y ordenado |
| `POST` | `/api/cotizaciones` | Ejecutivo, Admin, Jefe | Crear cotización (genera correlativo atómico + PDF automático) |

#### Filtros disponibles en `GET /api/cotizaciones`

| Parámetro | Tipo | Ejemplo | Descripción |
|---|---|---|---|
| `q` | string | `COT-2026` | Búsqueda libre en correlativo, razón social y NIT |
| `razon_social` | string | `Minera` | Coincidencia parcial en nombre del cliente |
| `nit` | string | `1234567` | Coincidencia parcial en NIT del cliente |
| `estado` | string | `En revision` | Filtro exacto por estado del ciclo de vida |
| `id_cliente` | number | `5` | Filtro por ID de cliente |
| `id_ejecutivo` | number | `3` | Filtro por ID de ejecutivo |
| `fecha_desde` | date | `2026-01-01` | Límite inferior de fecha de emisión (YYYY-MM-DD) |
| `fecha_hasta` | date | `2026-06-30` | Límite superior de fecha de emisión (YYYY-MM-DD) |
| `moneda` | string | `USD` | `USD` o `BOB` |
| `tiene_pdf` | boolean | `true` | `true` = solo con PDF · `false` = solo sin PDF |
| `page` | number | `1` | Página a recuperar (base 1) |
| `limit` | number | `20` | Registros por página (máximo 100) |
| `sort_by` | string | `fecha_emision` | Campo de ordenamiento |
| `sort_order` | string | `DESC` | `ASC` o `DESC` |

**Ejemplo de request con filtros:**
```
GET /api/cotizaciones?estado=En+revision&moneda=USD&page=1&limit=10&sort_by=creado_en&sort_order=DESC
```

**Response paginado:**
```json
{
  "success": true,
  "data": [ ...cotizaciones... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalRecords": 47,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### Endpoints de recurso individual

| Método | Endpoint | Roles | Descripción |
|---|---|---|---|
| `GET` | `/api/cotizaciones/:id` | Todos | Detalle completo: header + ítems + aprobación |
| `GET` | `/api/cotizaciones/:id/historial` | Todos | Historial cronológico de cambios de estado |
| `PUT` | `/api/cotizaciones/:id/estado` | Según rol | Transición de estado (validada por la máquina de estados) |
| `POST` | `/api/cotizaciones/:id/aprobar` | **Solo Jefe** | Aprobar o rechazar la cotización (HU08) |
| `POST` | `/api/cotizaciones/:id/pdf` | Ejecutivo | Subir PDF manualmente (multipart, campo `archivo`) |
| `GET` | `/api/cotizaciones/:id/pdf` | Todos | Descargar el PDF vinculado a la cotización |

**Body para cambiar estado** (`PUT /:id/estado`):
```json
{
  "nuevo_estado": "En revision",
  "observacion": "Cotización lista para revisión interna."
}
```

**Body para aprobación HU08** (`POST /:id/aprobar`):
```json
{
  "aprobado": true,
  "observaciones": "Márgenes dentro del rango aceptable. Aprobada para envío al cliente."
}
```
```json
{
  "aprobado": false,
  "observaciones": "El precio unitario del ítem 3 supera el límite autorizado. Requiere revisión."
}
```

> ⚠️ El campo `observaciones` es **obligatorio cuando `aprobado` es `false`**. El ejecutivo necesita conocer el motivo del rechazo para poder corregir la cotización.

**Body para crear cotización** (`POST /`):
```json
{
  "id_cliente": 1,
  "descripcion": "Suministro de repuestos para retroexcavadora CAT 320D — mantenimiento 1000 hrs.",
  "fecha_emision": "2026-06-01",
  "fecha_validez": "2026-07-01",
  "monto_total": 15750.00,
  "moneda": "USD",
  "observaciones": "Precio incluye transporte hasta almacén del cliente.",
  "detalles": [
    {
      "descripcion_item": "Filtro de aceite CAT 1R-0716",
      "cantidad": 4,
      "precio_unitario": 85.00,
      "id_producto": null
    },
    {
      "descripcion_item": "Kit de sellos hidráulicos — cilindro de pluma",
      "cantidad": 1,
      "precio_unitario": 450.00,
      "id_producto": 12
    }
  ]
}
```

---

## ⚙️ Máquina de Estados

Cada cotización sigue un ciclo de vida formal con transiciones validadas por rol. Ninguna transición puede saltar pasos del flujo sin autorización.

```
                    ┌─────────────┐
                    │   BORRADOR  │  ← Estado inicial tras la creación
                    └──────┬──────┘
                           │ Ejecutivo / Admin / Jefe
                           │ (valida: ítems, monto, fecha_validez)
                    ┌──────▼──────┐
                    │ EN REVISION │  ← En cola de aprobación del Jefe
                    └──────┬──────┘
              ┌────────────┴──────────────┐
              │  Solo JEFE                │  Solo JEFE
    ┌─────────▼─────────┐     ┌──────────▼──────────┐
    │ APROBADA INTERNA  │     │      RECHAZADA       │
    └─────────┬─────────┘     └──────────┬───────────┘
              │ Ejec/Admin/Jefe          │ Ejec/Admin
    ┌─────────▼─────────┐      ┌─────────▼───────────┐
    │ ENVIADA AL CLIENTE│      │       BORRADOR       │ ← Rework
    └─────────┬─────────┘      └─────────────────────┘
         ┌────┴────┐
         ▼         ▼
    ┌──────────┐ ┌───────────┐
    │ ACEPTADA │ │ RECHAZADA │  ← Respuesta del cliente
    └────┬─────┘ └─────┬─────┘
         └──────┬───────┘
                ▼
          ┌──────────┐
          │ ARCHIVADA│  ← Estado terminal
          └──────────┘
```

---

## 🔐 Matriz de Roles y Permisos

| Acción | Ejecutivo | Administracion | Jefe |
|---|:---:|:---:|:---:|
| Login / Logout | ✅ | ✅ | ✅ |
| Ver cotizaciones | ✅ | ✅ | ✅ |
| Crear cotización | ✅ | ✅ | ✅ |
| Enviar a revisión (`Borrador → En revision`) | ✅ | ✅ | ✅ |
| Cancelar revisión (`En revision → Borrador`) | ❌ | ✅ | ✅ |
| **Aprobar cotización** (`En revision → Aprobada`) | ❌ | ❌ | ✅ |
| **Rechazar cotización** (`En revision → Rechazada`) | ❌ | ❌ | ✅ |
| Enviar al cliente (`Aprobada → Enviada`) | ✅ | ✅ | ✅ |
| Registrar respuesta cliente (`Aceptada / Rechazada`) | ✅ | ✅ | ✅ |
| Subir PDF manualmente | ✅ | ❌ | ❌ |
| Descargar PDF | ✅ | ✅ | ✅ |
| Ver historial de estados | ✅ | ✅ | ✅ |
| Ver cola de aprobación | ❌ | ❌ | ✅ |
| Gestión de usuarios (CRUD) | ❌ | ❌ | ✅ |

---

## 🧪 Pruebas Automatizadas

### Pruebas unitarias (sin BD)

```bash
npm run test:unit
```

La suite ejecuta **12 pruebas** que validan la lógica de cálculo de subtotales y totales de cotización:

| ID | Descripción | Resultado |
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
| EDGE-02 | Precio cero es válido y devuelve `0.00` | ✅ |
| EDGE-03 | Un solo ítem: total = subtotal | ✅ |
| EDGE-04 | Suma con decimales periódicos redondeada correctamente | ✅ |

### Prueba de concurrencia (con BD)

```bash
npm test
```

La prueba `CC-01` dispara **20 peticiones simultáneas** de creación de cotización y verifica que todos los correlativos generados sean únicos. Valida el bloqueo `SELECT … FOR UPDATE` bajo carga real.

---

## 🔧 Solución de Problemas

### `UnauthorizedAccess` al ejecutar npm en PowerShell (Windows)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### `Error Code: 1046 — No database selected` en MySQL Workbench

Haz doble clic sobre el esquema `rc_tractoparts` en el panel izquierdo de Workbench para que aparezca en **negrita** antes de ejecutar el script.

### `401 Invalid credentials` en el login a pesar de credenciales correctas

El hash almacenado en la BD no fue generado a partir de la contraseña proporcionada. Ejecuta el script de sembrado para regenerar los hashes correctamente:

```bash
npm run seed:execute
```

> **Nunca copies hashes bcrypt de fuentes externas.** Cada hash debe generarse en tiempo de ejecución con `bcrypt.hash()` y verificarse con `bcrypt.compare()` antes de persistirlo.

### `Error: Cannot find module 'pdfkit'`

```bash
npm install pdfkit
```

### El servidor inicia pero no conecta a la BD

1. Verifica que MySQL esté corriendo: `mysql -u root -p`
2. Confirma que las variables `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME` en `.env` sean correctas
3. Verifica que el usuario tenga permisos sobre la base de datos:
   ```sql
   GRANT ALL PRIVILEGES ON rc_tractoparts.* TO 'tu_usuario'@'localhost';
   FLUSH PRIVILEGES;
   ```

### `FORBIDDEN_TRANSITION` al cambiar el estado de una cotización

El rol del usuario autenticado no tiene permiso para ejecutar esa transición específica. Consulta la [Matriz de Roles y Permisos](#-matriz-de-roles-y-permisos) y la [Máquina de Estados](#-máquina-de-estados) para verificar el flujo correcto.

---

## 👨‍💻 Autores y Contexto Académico

Proyecto desarrollado como trabajo práctico universitario en la **Universidad Tecnológica Privada de Santa Cruz (UTEPSA)** — Ingeniería de Sistemas, aplicando metodología **XP + SCRUM** con sprints productivos de dos semanas.

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