Markdown
# RC Tractoparts - Sistema de Gestión de Cotizaciones (Backend)

Este repositorio contiene la API REST core para el **Sistema de Gestión de Cotizaciones y Proformas de RC Tractoparts**, estructurado bajo el patrón arquitectónico **Modelo-Vista-Controlador (MVC)** utilizando Node.js, Express y MySQL.

## Tecnologías Utilizadas
* **Entorno de Ejecución:** Node.js
* **Framework Web:** Express.js
* **Base de Datos:** MySQL (Gestión mediante Pool de conexiones relacionales)
* **Seguridad:** JSON Web Tokens (JWT) & Encriptación con Bcryptjs
* **Pruebas:** Jest / Supertest

---

## Estructura del Proyecto (Sprint 1)
```text
rc-tractoparts/
├── sql/
│   └── init.sql                        # Script de inicialización de la Base de Datos (8 tablas base)
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
Requisitos Previos e Instalación
1. Clonar el repositorio e instalar dependencias
Descarga las librerías necesarias ejecutando en la terminal de la raíz del proyecto:

Bash
npm install
2. Configurar Variables de Entorno
Crea un archivo local llamado .env en la raíz del proyecto (basándote en .env.example) y configura tus credenciales de MySQL:

Fragmento de código
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=tu_usuario_mysql         # Ej: root
DB_PASSWORD=Admin123*
DB_NAME=rc_tractoparts
JWT_SECRET=tu_clave_secreta_jwt
(Nota: El archivo .env está configurado en .gitignore para no ser subido al repositorio por motivos de seguridad).

3. Configuración de la Base de Datos (MySQL)
Abre MySQL Workbench yéctate a tu servidor local.

Abre el script ubicado en sql/init.sql.

Asegúrate de añadir o tener seleccionada la base de datos ejecutando al inicio:

SQL
CREATE DATABASE IF NOT EXISTS rc_tractoparts;
USE rc_tractoparts;
Ejecuta el script completo (icono del rayito ) para desplegar las tablas e insertar los datos iniciales.

 Comandos de Ejecución
Modo Desarrollo (con recarga automática mediante Nodemon):

Bash
npm run dev
Al levantar, el servidor validará la conexión y expondrá el endpoint de diagnóstico en http://localhost:3000/health.

Ejecutar Pruebas Unitarias (Jest):

Bash
npm run test:unit
Ejecuta la suite de 12 pruebas automáticas que validan la lógica de cálculo de totales y la simulación de concurrencia.

 Características Clave Implementadas (Sprint 1)
HU01 - Autenticación Segura: Control de acceso mediante JWT con expiración y revocación de tokens en memoria para cierres de sesión efectivos.

HU03 - Generador de Correlativos Atómicos: Implementación de SELECT ... FOR UPDATE dentro de una transacción aislada de MySQL. Esto previene la duplicidad de números de cotización bajo ráfagas de peticiones concurrentes (Garantiza el RNF10).

Matriz de Permisos Rígida: Middleware interceptor basado en roles (Ejecutivo, Administracion, Jefe) que valida el acceso por endpoint según las especificaciones técnicas del negocio.

Validación de Archivos: Carga segura de PDFs para soporte de cotizaciones utilizando filtros Multer por tamaño y tipo MIME.

 Solución de Problemas Comunes (F.A.Q)
Error de ejecución de scripts en PowerShell (UnauthorizedAccess)
Si Windows bloquea el comando npm, ejecuta lo siguiente en la terminal antes de lanzar el comando:

PowerShell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
Error Error Code: 1046. No database selected en Workbench
Asegúrate de dar doble clic sobre el esquema rc_tractoparts en la barra lateral izquierda de MySQL Workbench para marcarlo en negrita antes de ejecutar el script init.sql.


###  Súbelo de una vez a GitHub:
Una vez que reemplaces el texto en tu archivo `README.md`, abre una pestaña de terminal libre y ejecuta las tres líneas mágicas:

```bash
git add README.md
git commit -m "Enhance README with full troubleshooting and setups"
git push