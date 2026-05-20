```markdown
# RC Tractoparts - Sistema de Gestión de Cotizaciones (Backend)

Este repositorio contiene la API REST core para el **Sistema de Gestión de Cotizaciones y Proformas de RC Tractoparts**, estructurado bajo el patrón arquitectónico **Modelo-Vista-Controlador (MVC)** utilizando Node.js, Express y MySQL.

## 🛠️ Tecnologías Utilizadas
* **Entorno de Ejecución:** Node.js
* **Framework Web:** Express.js
* **Base de Datos:** MySQL (Gestión mediante Pool de conexiones relacionales)
* **Seguridad:** JSON Web Tokens (JWT) & Encriptación con Bcryptjs
* **Pruebas:** Jest / Supertest

## 📂 Estructura del Proyecto (Sprint 1)
```text
rc-tractoparts/
├── sql/
│   └── init.sql                        # Script de inicialización de las 8 tablas base
├── src/
│   ├── config/db.js                    # Configuración del pool de conexiones a MySQL
│   ├── controllers/                    # Controladores de la lógica de negocio (Auth, Cotizaciones, Usuarios)
│   ├── middlewares/                    # Middlewares de autenticación JWT y control de roles (RBAC)
│   ├── models/                         # Modelos con consultas SQL optimizadas (Transacciones y bloqueos)
│   ├── routes/                         # Definición de rutas y endpoints de la API
│   ├── utils/auditLog.js               # Registro asíncrono de logs de auditoría
│   ├── app.js                          # Configuración de Express, CORS, Helmet y Morgan
│   └── server.js                       # Inicialización del servidor y apagado controlado (Graceful Shutdown)
└── tests/                              # Pruebas unitarias e integración (Concurrencia del correlativo)

```

## 🚀 Requisitos Previos e Instalación

### 1. Clonar el repositorio e instalar dependencias

```bash
npm install

```

### 2. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto basándote en el archivo `.env.example`:

```env
PORT=3000
DB_HOST=localhost
DB_USER=tu_usuario
DB_PASSWORD=tu_contraseña
DB_NAME=rc_tractoparts
JWT_SECRET=tu_clave_secreta_jwt

```

### 3. Base de Datos

Importa y ejecuta el archivo `sql/init.sql` en tu servidor local de MySQL para desplegar el esquema de base de datos requerido.

---

## 🏃 Enclavar y Ejecutar el Servidor

* **Modo Desarrollo (con recarga automática):**
```bash
npm run dev

```


* **Ejecutar Pruebas Unitarias:**
```bash
npm run test:unit

```



## 🔒 Características Clave Implementadas (Sprint 1)

* **HU01 - Autenticación Segura:** Control de acceso mediante JWT con expiración y revocación de tokens en memoria para cierres de sesión efectivos.
* **HU03 - Generador de Correlativos Atómicos:** Implementación de `SELECT ... FOR UPDATE` dentro de una transacción aislada de MySQL. Esto previene la duplicidad de números de cotización bajo ráfagas de peticiones concurrentes (Garantiza el RNF10).
* **Matriz de Permisos Rígida:** Middleware interceptor basado en roles (`Ejecutivo`, `Administracion`, `Jefe`) que valida el acceso por endpoint según las especificaciones técnicas del negocio.
* **Validación de Archivos:** Carga segura de PDFs para soporte de cotizaciones utilizando filtros Multer por tamaño y tipo MIME.

```

```