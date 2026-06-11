<div align="center">

# ðŸšœ RC Tractoparts
### Sistema de GestiÃ³n de Cotizaciones y Proformas

**Plataforma full-stack empresarial para la gestiÃ³n integral del ciclo de vida de cotizaciones comerciales**

---

![Node.js](https://img.shields.io/badge/Node.js-â‰¥18.0.0-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-Tests_12%2F12_âœ“-C21325?style=for-the-badge&logo=jest&logoColor=white)
![Swagger](https://img.shields.io/badge/Swagger-UI_/api--docs-85EA2D?style=for-the-badge&logo=swagger&logoColor=black)
![Sprint](https://img.shields.io/badge/Sprint-2_Completado-1B2B4B?style=for-the-badge)
![License](https://img.shields.io/badge/Licencia-UNLICENSED-red?style=for-the-badge)

</div>

---

## ðŸ“‹ Tabla de Contenidos

1. [DescripciÃ³n General](#-descripciÃ³n-general)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Matriz JerÃ¡rquica de Roles](#-matriz-jerÃ¡rquica-de-roles)
4. [MÃ¡quina de Estados â€” Ciclo de Vida de Cotizaciones](#-mÃ¡quina-de-estados)
5. [Capa de Seguridad y ValidaciÃ³n](#-capa-de-seguridad-y-validaciÃ³n)
6. [Stack TecnolÃ³gico](#-stack-tecnolÃ³gico)
7. [Estructura de Archivos](#-estructura-de-archivos)
8. [InstalaciÃ³n y ConfiguraciÃ³n](#-instalaciÃ³n-y-configuraciÃ³n)
9. [Variables de Entorno](#-variables-de-entorno)
10. [Base de Datos](#-base-de-datos)
11. [EjecuciÃ³n del Proyecto](#-ejecuciÃ³n-del-proyecto)
12. [DocumentaciÃ³n Interactiva (Swagger)](#-documentaciÃ³n-interactiva-swagger)
13. [Mapa Completo de Endpoints](#-mapa-completo-de-endpoints)
14. [Pruebas Automatizadas](#-pruebas-automatizadas)
15. [SoluciÃ³n de Problemas](#-soluciÃ³n-de-problemas)

---

## ðŸ“– DescripciÃ³n General

RC Tractoparts es una empresa boliviana de importaciÃ³n de maquinaria pesada y repuestos con sede en **Santa Cruz de la Sierra, Bolivia**. Este repositorio contiene la **plataforma full-stack** del Sistema de GestiÃ³n de Cotizaciones y Proformas, desarrollado bajo metodologÃ­a **XP/SCRUM** en dos sprints productivos.

El sistema automatiza el ciclo completo de una cotizaciÃ³n comercial: desde su creaciÃ³n por el Ejecutivo de ventas, pasando por la revisiÃ³n tÃ©cnica del Administrador (con comentarios de supervisiÃ³n), la aprobaciÃ³n definitiva del Jefe, el envÃ­o formal al cliente y el cierre de venta como `Aceptada`.

### Funcionalidades clave implementadas

| CaracterÃ­stica | DescripciÃ³n |
|---|---|
| ðŸ” **AutenticaciÃ³n JWT** | Tokens firmados con expiraciÃ³n configurable y revocaciÃ³n en memoria al cerrar sesiÃ³n |
| ðŸ”’ **RBAC jerÃ¡rquico** | SysAdmin â€º Jefe â€º Administrador â€º Ejecutivo â€” cada endpoint valida el rol antes de ejecutar |
| ðŸ”¢ **Correlativo atÃ³mico** | `SELECT â€¦ FOR UPDATE` garantiza seriales Ãºnicos bajo concurrencia mÃ¡xima (RNF10) |
| ðŸ“„ **PDF automÃ¡tico** | GeneraciÃ³n de proformas con marca corporativa en el momento de creaciÃ³n y aprobaciÃ³n |
| âš™ï¸ **MÃ¡quina de estados** | Flujo formal `Pendiente â†’ En revision â†’ Aprobada internamente â†’ Aceptada` con cierre de venta |
| ðŸ’¬ **Comentarios del Administrador** | Campo `comentarios_admin` para observaciones de supervisiÃ³n visibles solo por el Jefe |
| â¸ **Estado En Espera** | El Administrador puede suspender la revisiÃ³n mientras verifica stock con proveedores |
| ðŸ›¡ï¸ **Flujo de aprobaciÃ³n HU08** | Solo Jefe/SysAdmin pueden aprobar, rechazar o cerrar una venta |
| ðŸ“Š **Consultas avanzadas** | Listado paginado con 10 filtros combinables, ordenamiento dinÃ¡mico y conteo paralelo |
| ðŸ“ **AuditorÃ­a completa** | Cada acciÃ³n se registra en `bitacora_auditoria` con IP, usuario, rol y metadatos |
| ðŸŒ **Dashboard SPA** | Interfaz web con patrones Strategy, Command, Observer y Mediator â€” sin frameworks externos |

---

## ðŸ— Arquitectura del Sistema

El sistema implementa una **arquitectura de capas MVC estricta** con separaciÃ³n total de responsabilidades:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚               CLIENTE â€” SPA / Swagger UI                        â”‚
â”‚          public/  (HTML + Vanilla JS + CSS)                     â”‚
â”‚                HTTP + Bearer JWT Token                          â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                          â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    CAPA DE ENRUTAMIENTO                          â”‚
â”‚          src/routes/*.js  â€”  Express Router                     â”‚
â”‚   authRoutes Â· quotationRoutes Â· clientRoutes Â· userRoutes      â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
           â”‚                          â”‚
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  MIDDLEWARES        â”‚   â”‚         CONTROLADORES                  â”‚
â”‚  authMiddleware.js  â”‚   â”‚  authController.js                     â”‚
â”‚  roleMiddleware.js  â”‚   â”‚  quotationController.js                â”‚
â”‚  auditMiddleware.js â”‚   â”‚  clientController.js                   â”‚
â”‚  JWT verify + RBAC  â”‚   â”‚  userController.js                     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                      â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚            SERVICIOS                        â”‚
                    â”‚        pdfService.js (PDFKit)              â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                      â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚              MODELOS (DAL)                  â”‚
                    â”‚   QuotationModel.js Â· UserModel.js         â”‚
                    â”‚   ClientModel.js Â· AuditModel.js           â”‚
                    â”‚   Pool MySQL Â· Transacciones Â· RBAC        â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                                      â”‚
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚          BASE DE DATOS MySQL 8.0+          â”‚
                    â”‚  9 tablas Â· Pool de 10 conexiones          â”‚
                    â”‚  Charset utf8mb4 Â· Timezone UTC            â”‚
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Patrones de diseÃ±o del frontend (SPA)

| PatrÃ³n | UbicaciÃ³n | PropÃ³sito |
|---|---|---|
| **Strategy** | `dashboardView.js` | `ExecutiveStrategy` vs `ManagerStrategy` â€” renderizado por rol |
| **Command** | `dashboardView.js` | `ApproveQuotationCommand`, `ChangeStatusCommand`, etc. |
| **Observer** | `quotationForm.js` | `LineItemsSubject` notifica a `RowSubtotalObserver`, `IvaObserver`, `GrandTotalObserver` |
| **Mediator** | `quotationForm.js` | `FormMediator` coordina `LineItemsComponent`, `TotalsComponent` y `FileUploadComponent` |

---

## ðŸ‘¥ Matriz JerÃ¡rquica de Roles

El sistema implementa una jerarquÃ­a de autoridad descendente. Cada nivel hereda todas las capacidades de los niveles inferiores y agrega las propias.

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  NIVEL 4 â€” SysAdmin  (Control absoluto del sistema)           â”‚
â”‚  â€¢ Todas las transiciones de cualquier estado                 â”‚
â”‚  â€¢ Puede revertir incluso estados avanzados a Pendiente       â”‚
â”‚  â€¢ GestiÃ³n de usuarios (igual que Jefe)                       â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  NIVEL 3 â€” Jefe  (Aprobador comercial final)                  â”‚
â”‚  â€¢ Aprueba y rechaza desde cualquier estado activo            â”‚
â”‚  â€¢ Marca cotizaciones como "Aceptada" (cierre de venta)       â”‚
â”‚  â€¢ GestiÃ³n completa de usuarios (CRUD)                        â”‚
â”‚  â€¢ Ve la Cola de AprobaciÃ³n con todos los estados activos     â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  NIVEL 2 â€” Administrador  (Revisor tÃ©cnico y comentarista)    â”‚
â”‚  â€¢ Deja comentarios de supervisiÃ³n (comentarios_admin)        â”‚
â”‚  â€¢ Puede poner una cotizaciÃ³n "En Espera" con justificaciÃ³n   â”‚
â”‚  â€¢ Puede retirar una cotizaciÃ³n de revisiÃ³n â†’ Pendiente       â”‚
â”‚  â€¢ NO puede aprobar ni rechazar (autoridad exclusiva del Jefe)â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚  NIVEL 1 â€” Ejecutivo  (Ventas y proformas)                    â”‚
â”‚  â€¢ Crea cotizaciones y agrega Ã­tems de lÃ­nea                  â”‚
â”‚  â€¢ EnvÃ­a a revisiÃ³n una vez que el borrador estÃ¡ completo     â”‚
â”‚  â€¢ Marca como "Enviada al cliente" tras aprobaciÃ³n interna    â”‚
â”‚  â€¢ Ve Ãºnicamente sus propias cotizaciones en el dashboard     â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Tabla detallada de permisos por acciÃ³n

| AcciÃ³n | Ejecutivo | Administrador | Jefe | SysAdmin |
|---|:---:|:---:|:---:|:---:|
| Login / Logout | âœ… | âœ… | âœ… | âœ… |
| Ver cotizaciones (propias) | âœ… | âœ… | âœ… | âœ… |
| Crear cotizaciÃ³n | âœ… | âœ… | âœ… | âœ… |
| Enviar a revisiÃ³n (`Pendiente â†’ En revision`) | âœ… | âœ… | âœ… | âœ… |
| Dejar comentario de supervisiÃ³n | âŒ | âœ… | âŒ | âœ… |
| Poner en espera con comentario (`â†’ En espera`) | âŒ | âœ… | âœ… | âœ… |
| Retirar de revisiÃ³n (`En revision â†’ Pendiente`) | âŒ | âœ… | âœ… | âœ… |
| **Aprobar** (`â†’ Aprobada internamente`) | âŒ | âŒ | âœ… | âœ… |
| **Rechazar** (`â†’ Rechazada`) | âŒ | âŒ | âœ… | âœ… |
| Enviar al cliente (`â†’ Enviada al cliente`) | âœ… | âŒ | âœ… | âœ… |
| **Aceptar â€” Cierre de Venta** (`â†’ Aceptada`) | âœ…* | âŒ | âœ… | âœ… |
| Ver cola de aprobaciÃ³n completa | âŒ | âŒ | âœ… | âœ… |
| Subir/descargar PDF | âœ… | âœ… | âœ… | âœ… |
| Ver historial de estados | âœ… | âœ… | âœ… | âœ… |
| GestiÃ³n de usuarios (CRUD) | âŒ | âŒ | âœ… | âœ… |

> \* El Ejecutivo puede registrar `Aceptada` Ãºnicamente desde `Enviada al cliente` (respuesta del cliente). El Jefe y SysAdmin pueden marcarla desde `Aprobada internamente` o `Enviada al cliente` como cierre de venta directo.

---

## âš™ï¸ MÃ¡quina de Estados

Cada cotizaciÃ³n sigue un ciclo de vida formal con transiciones validadas por rol en `ROLE_TRANSITIONS` (fuente de verdad Ãºnica en `QuotationModel.js`). Ninguna transiciÃ³n puede ejecutarse sin el rol correcto.

```
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                    â”‚    PENDIENTE    â”‚  â† Estado inicial al crear
                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜
            Ejecutivo/Admin  â”‚  envÃ­a a revisiÃ³n
            (valida: Ã­tems,  â”‚  monto_total, fecha_validez)
                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”
          â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â–¶â”‚   EN REVISION   â”‚â—€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
          â”‚         â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”˜                            â”‚
          â”‚    Admin retira  â”‚  Jefe/SysAdmin deciden              â”‚
          â”‚                  â”‚                                      â”‚
          â”‚    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                  â”‚
          â”‚    â”‚             â”‚                  â”‚                  â”‚
          â”‚  â”Œâ”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚            â”Œâ”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”          â”‚
          â”‚  â”‚  EN ESPERA  â”‚  â”‚            â”‚  RECHAZADA â”‚          â”‚
          â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚            â””â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”˜          â”‚
          â”‚  Admin/Jefe        â”‚                  â”‚ Ejecutivo        â”‚
          â”‚  retoma           â”‚                  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
          â”‚                  â–¼                         (rework)
          â”‚     â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
          â”‚     â”‚  APROBADA INTERNAMENTE â”‚  â† Jefe/SysAdmin aprueban
          â”‚     â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
          â”‚           â”Œâ”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
          â”‚           â”‚  Ejecutivo envÃ­a          Jefe/Sys  â”‚
          â”‚           â”‚  al cliente               cierran   â”‚
          â”‚    â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”       â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”
          â”‚    â”‚  ENVIADA AL CLIENTE â”‚       â”‚    ACEPTADA      â”‚
          â”‚    â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜       â”‚ (Cierre de Venta)â”‚
          â”‚           â”‚                      â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
          â”‚     â”Œâ”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”
          â”‚     â”‚           â”‚
          â”‚  â”Œâ”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â” â”Œâ”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”
          â”‚  â”‚ ACEPTADA â”‚ â”‚RECHAZADA â”‚
          â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
          â”‚
          â””â”€â”€ Todos los estados activos â†’ ARCHIVADA (terminal)
```

### Transiciones por rol (resumen)

| Estado Actual | Ejecutivo | Administrador | Jefe / SysAdmin |
|---|---|---|---|
| `Pendiente` | â†’ En revision, Archivada | â†’ En revision, En espera, Archivada | â†’ Cualquiera |
| `En revision` | *(solo lectura)* | â†’ En espera, Pendiente, Archivada | â†’ Cualquiera |
| `En espera` | *(solo lectura)* | â†’ En revision, Pendiente, Archivada | â†’ Cualquiera |
| `Aprobada internamente` | â†’ Enviada al cliente | â†’ Archivada | â†’ **Aceptada**, Enviada, Rechazada, Archivada |
| `Enviada al cliente` | â†’ Aceptada, Rechazada, Archivada | â†’ Archivada | â†’ **Aceptada**, Rechazada, Archivada |
| `Rechazada` | â†’ Pendiente, Archivada | â†’ Pendiente, Archivada | â†’ Pendiente, Aprobada int., Archivada |
| `Aceptada` | â†’ Archivada | â†’ Archivada | â†’ Archivada |
| `Archivada` | *(terminal)* | *(terminal)* | *(terminal)* |

---

## ðŸ›¡ Capa de Seguridad y ValidaciÃ³n

### ValidaciÃ³n cruzada con Zod

El esquema de validaciÃ³n en `src/validators/quotationValidator.js` aplica reglas cruzadas que no pueden verificarse campo a campo:

```js
// fecha_validez debe ser igual o posterior a fecha_emision
.refine(
  (data) => !data.fecha_emision || !data.fecha_validez ||
            data.fecha_validez >= data.fecha_emision,
  {
    message: 'La fecha de validez no puede ser anterior a la fecha de emisiÃ³n.',
    path: ['fecha_validez'],
  }
)
```

**Reglas de validaciÃ³n implementadas:**

| Regla | Campo | Tipo |
|---|---|---|
| `fecha_validez >= fecha_emision` | Fechas | Cross-field (Zod `.refine`) |
| MÃ­nimo 1 Ã­tem de lÃ­nea | `detalles` | Array mÃ­nimo (`.min(1)`) |
| `monto_total` obligatorio para envÃ­o a revisiÃ³n | Header | Pre-flight check |
| `cantidad > 0` por Ã­tem | `detalles[].cantidad` | NumÃ©rico positivo |
| `precio_unitario >= 0` por Ã­tem | `detalles[].precio_unitario` | NumÃ©rico no negativo |
| `observaciones` obligatorio al rechazar | AprobaciÃ³n | Condicional (`aprobado = false`) |

### MitigaciÃ³n de XSS almacenado (OWASP A03)

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

Esta funciÃ³n protege los campos: `descripcion`, `cliente_nombre`, `ejecutivo_nombre`, `observaciones`, `obs_aprobacion`, `comentarios_admin` y todos los Ã­tems de lÃ­nea.

### Otras medidas de seguridad activas

| Medida | ImplementaciÃ³n |
|---|---|
| **Hashing bcrypt** | Factor de costo configurable (12 rondas por defecto en producciÃ³n) |
| **Brute-force protection** | Bloqueo automÃ¡tico tras 3 intentos fallidos, 15 minutos de espera |
| **Cabeceras HTTP seguras** | `helmet` (CSP, X-Frame-Options, HSTS, X-Content-Type-Options) |
| **CORS restrictivo** | Origen configurado por variable de entorno `CORS_ORIGIN` |
| **Consultas parametrizadas** | Cero concatenaciÃ³n de strings en SQL â€” solo prepared statements |
| **InyecciÃ³n de sort column** | Whitelist explÃ­cita `SORTABLE_COLUMNS` â€” ningÃºn valor externo llega al `ORDER BY` |
| **Concurrencia atÃ³mica** | Transacciones con `SELECT â€¦ FOR UPDATE` para el correlativo |
| **Defense-in-depth** | El controller re-verifica el rol despuÃ©s del middleware (doble barrera) |
| **Token revocation** | Tokens invalidados en memoria al hacer logout (antes de su expiraciÃ³n JWT) |

---

## ðŸ›  Stack TecnolÃ³gico

| Capa | TecnologÃ­a | VersiÃ³n | PropÃ³sito |
|---|---|---|---|
| Runtime | Node.js | â‰¥ 18.0.0 | Entorno de ejecuciÃ³n JavaScript |
| Framework | Express.js | 4.x | Servidor HTTP y enrutamiento |
| Base de datos | MySQL | 8.0+ | Persistencia relacional |
| Driver DB | mysql2 | 3.9.x | Pool de conexiones con soporte Promise |
| AutenticaciÃ³n | jsonwebtoken | 9.x | Firma y verificaciÃ³n de tokens JWT |
| Hashing | bcryptjs | 2.4.x | EncriptaciÃ³n segura de contraseÃ±as |
| ValidaciÃ³n | zod | 3.x | ValidaciÃ³n de esquemas con cross-field rules |
| PDF | PDFKit | 0.x | GeneraciÃ³n de proformas en formato A4 |
| Upload | Multer | 1.4.x | ValidaciÃ³n y almacenamiento de PDFs |
| Seguridad | Helmet | 7.x | Cabeceras HTTP de seguridad |
| Logging | Morgan | 1.10.x | Registro de peticiones HTTP |
| API Docs | Swagger UI Express | 5.x | DocumentaciÃ³n interactiva en `/api-docs/` |
| Variables | dotenv | 16.x | GestiÃ³n de entorno |
| Testing | Jest + Supertest | 29.x | Pruebas unitarias e integraciÃ³n |
| Dev server | Nodemon | 3.x | Recarga automÃ¡tica en desarrollo |

---

## ðŸ“ Estructura de Archivos

```
rc-tractoparts/
â”‚
â”œâ”€â”€ ðŸ“‚ public/                         # Frontend SPA (servida como archivos estÃ¡ticos)
â”‚   â”œâ”€â”€ index.html                     # PÃ¡gina de login
â”‚   â”œâ”€â”€ dashboard.html                 # Dashboard principal (SPA)
â”‚   â”œâ”€â”€ ðŸ“‚ css/
â”‚   â”‚   â””â”€â”€ styles.css                 # Sistema de diseÃ±o: variables CSS, badges, grid
â”‚   â””â”€â”€ ðŸ“‚ js/
â”‚       â”œâ”€â”€ ðŸ“‚ services/
â”‚       â”‚   â”œâ”€â”€ apiClient.js           # Wrapper Fetch con auto-adjuntar token JWT
â”‚       â”‚   â””â”€â”€ authSession.js         # SesiÃ³n en memoria (user, token, logout)
â”‚       â””â”€â”€ ðŸ“‚ views/
â”‚           â”œâ”€â”€ authView.js            # Formulario de login
â”‚           â”œâ”€â”€ dashboardView.js       # Strategy (Ejecutivo/Jefe) + Commands + UI
â”‚           â””â”€â”€ quotationForm.js       # Formulario reactivo: Observer + Mediator
â”‚
â”œâ”€â”€ ðŸ“‚ scripts/
â”‚   â”œâ”€â”€ seed-users.js                  # Sembrado seguro de usuarios con hashes bcrypt
â”‚   â”œâ”€â”€ migrate-en-espera.js           # MigraciÃ³n: agrega estado 'En espera'
â”‚   â””â”€â”€ run-migration-comentarios-admin.js  # MigraciÃ³n: columna comentarios_admin
â”‚
â”œâ”€â”€ ðŸ“‚ sql/
â”‚   â”œâ”€â”€ init.sql                       # Esquema base: 9 tablas + ENUM + roles iniciales
â”‚   â”œâ”€â”€ migration_add_en_espera.sql    # ENUM 'En espera'
â”‚   â”œâ”€â”€ migration_add_comentarios_admin.sql  # Columna comentarios_admin
â”‚   â””â”€â”€ migration_add_sysadmin_role.sql     # Rol SysAdmin
â”‚
â”œâ”€â”€ ðŸ“‚ src/
â”‚   â”œâ”€â”€ ðŸ“‚ config/
â”‚   â”‚   â””â”€â”€ db.js                      # Pool MySQL (Singleton) + testConnection()
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ controllers/
â”‚   â”‚   â”œâ”€â”€ authController.js          # Login / Logout (HU01)
â”‚   â”‚   â”œâ”€â”€ quotationController.js     # CRUD cotizaciones + HU08 aprobaciÃ³n + historial
â”‚   â”‚   â”œâ”€â”€ clientController.js        # CRUD clientes
â”‚   â”‚   â””â”€â”€ userController.js          # CRUD usuarios (Jefe/SysAdmin â€” HU02)
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ middlewares/
â”‚   â”‚   â”œâ”€â”€ authMiddleware.js          # VerificaciÃ³n JWT + revocaciÃ³n en memoria
â”‚   â”‚   â”œâ”€â”€ roleMiddleware.js          # RBAC: authorize(['Jefe', 'SysAdmin', ...])
â”‚   â”‚   â””â”€â”€ auditMiddleware.js         # Registro automÃ¡tico de accesos
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ models/
â”‚   â”‚   â”œâ”€â”€ QuotationModel.js          # DAL completo: state machine, transacciones, historial
â”‚   â”‚   â”œâ”€â”€ UserModel.js               # DAL usuarios: CRUD + brute-force counters
â”‚   â”‚   â”œâ”€â”€ ClientModel.js             # DAL clientes
â”‚   â”‚   â””â”€â”€ AuditModel.js              # DAL bitÃ¡cora de auditorÃ­a
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ routes/
â”‚   â”‚   â”œâ”€â”€ authRoutes.js              # POST /api/auth/login|logout
â”‚   â”‚   â”œâ”€â”€ quotationRoutes.js         # 10 rutas â€” orden fijo-antes-paramÃ©trico crÃ­tico
â”‚   â”‚   â”œâ”€â”€ clientRoutes.js            # /api/clientes
â”‚   â”‚   â””â”€â”€ userRoutes.js              # /api/usuarios
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ services/
â”‚   â”‚   â””â”€â”€ pdfService.js              # GeneraciÃ³n PDF corporativo (PDFKit, A4, auto-triggered)
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ utils/
â”‚   â”‚   â””â”€â”€ auditLog.js                # logEvent() â€” escritura asÃ­ncrona a bitacora_auditoria
â”‚   â”‚
â”‚   â”œâ”€â”€ ðŸ“‚ validators/
â”‚   â”‚   â”œâ”€â”€ authValidator.js           # Zod schemas para login
â”‚   â”‚   â”œâ”€â”€ quotationValidator.js      # Zod schemas con cross-field fecha_validez >= fecha_emision
â”‚   â”‚   â””â”€â”€ validate.js                # Middleware wrapper para schemas Zod
â”‚   â”‚
â”‚   â”œâ”€â”€ app.js                         # Express: CORS, helmet, morgan, Swagger, rutas, error handler
â”‚   â””â”€â”€ server.js                      # Inicio servidor + testConnection() + graceful shutdown
â”‚
â”œâ”€â”€ ðŸ“‚ tests/
â”‚   â”œâ”€â”€ ðŸ“‚ unit/
â”‚   â”‚   â”œâ”€â”€ calcularTotales.test.js    # 12 pruebas UT-01â†’UT-08 + EDGE cases
â”‚   â”‚   â””â”€â”€ validationEdgeCases.test.js  # Edge cases de validaciÃ³n Zod
â”‚   â””â”€â”€ ðŸ“‚ integration/
â”‚       â””â”€â”€ correlativo.concurrencia.test.js  # CC-01: 20 peticiones simultÃ¡neas
â”‚
â”œâ”€â”€ ðŸ“‚ uploads/cotizaciones/           # PDFs generados y subidos
â”œâ”€â”€ .env.example                       # Plantilla de variables de entorno
â”œâ”€â”€ package.json
â””â”€â”€ README.md
```

---

## âš™ï¸ InstalaciÃ³n y ConfiguraciÃ³n

### Requisitos previos

- **[Node.js](https://nodejs.org/) v18.0.0 o superior** â€” verificar con `node -v`
- **[MySQL 8.0+](https://dev.mysql.com/downloads/)** â€” servidor local o remoto accesible
- **[Git](https://git-scm.com/)** â€” para clonar el repositorio

### Paso 1 â€” Clonar e instalar dependencias

```bash
git clone https://github.com/AdrianGareca/rc-tractoparts.git
cd rc-tractoparts
npm install
```

### Paso 2 â€” Crear el archivo de variables de entorno

```bash
cp .env.example .env
# Editar .env con los valores reales
```

### Paso 3 â€” Inicializar la base de datos

Ejecutar los scripts SQL en **MySQL Workbench** o desde la terminal en el orden indicado:

```sql
SOURCE sql/init.sql;
SOURCE sql/migration_add_en_espera.sql;
SOURCE sql/migration_add_comentarios_admin.sql;
SOURCE sql/migration_add_sysadmin_role.sql;
```

> **Nota:** Seleccionar el esquema `rc_tractoparts` (doble clic para que aparezca en negrita) antes de ejecutar los scripts en MySQL Workbench.

### Paso 4 â€” Sembrar usuarios de prueba

```bash
npm run seed:execute
```

Los usuarios sembrados son:

| Usuario | ContraseÃ±a | Rol |
|---|---|---|
| `sysadmin` | `sysadmin123` | SysAdmin |
| `jefe` | `jefe123` | Jefe |
| `adrian_admin` | `admin123` | Jefe |
| `carlos_admin` | `admin123` | Administracion |
| `elena_ejec` | `ejecutivo123` | Ejecutivo |

---

## ðŸ”‘ Variables de Entorno

```env
# â”€â”€ AplicaciÃ³n â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
NODE_ENV=development
PORT=3000
APP_NAME=RC-Tractoparts-API

# â”€â”€ Base de Datos (MySQL) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_contraseÃ±a
DB_NAME=rc_tractoparts
DB_NAME_TEST=rc_tractoparts_test
DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0

# â”€â”€ AutenticaciÃ³n y Seguridad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
JWT_SECRET=cambia_esto_por_clave_larga_y_aleatoria_de_64_caracteres
JWT_EXPIRES_IN=8h
BCRYPT_ROUNDS=12

# â”€â”€ ProtecciÃ³n Brute-Force â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
MAX_LOGIN_ATTEMPTS=3
LOCK_DURATION_MINUTES=15

# â”€â”€ Archivos PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
UPLOAD_DIR=uploads/cotizaciones
MAX_PDF_SIZE_MB=10

# â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CORS_ORIGIN=http://localhost:5500
```

> âš ï¸ Generar un `JWT_SECRET` seguro: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`

---

## ðŸ—„ Base de Datos

### Esquema de tablas

| Tabla | DescripciÃ³n |
|---|---|
| `roles` | CatÃ¡logo de perfiles: SysAdmin, Ejecutivo, Administracion, Jefe |
| `usuarios` | Cuentas con hash bcrypt y control brute-force |
| `clientes` | Contrapartes comerciales (razÃ³n social, NIT) |
| `productos` | CatÃ¡logo interno de piezas y repuestos |
| `cotizaciones_correlativo` | Contador atÃ³mico de seriales por aÃ±o calendario |
| `cotizaciones` | Registro principal de cada cotizaciÃ³n (header + estado + `comentarios_admin`) |
| `cotizacion_detalles` | Ãtems de lÃ­nea de cada cotizaciÃ³n |
| `cotizacion_historial_estados` | Historial cronolÃ³gico de transiciones de estado |
| `bitacora_auditoria` | Log de auditorÃ­a inmutable (INSERT-only) |

### Formato del correlativo generado

```
COT-YYYY-NNNN
â”‚    â”‚     â””â”€â”€ NÃºmero secuencial del aÃ±o, 0-rellenado a 4 dÃ­gitos
â”‚    â””â”€â”€â”€â”€â”€â”€â”€â”€ AÃ±o calendario de 4 dÃ­gitos
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Prefijo fijo de la empresa
```

---

## ðŸš€ EjecuciÃ³n del Proyecto

```bash
# Desarrollo (recarga automÃ¡tica)
npm run dev

# ProducciÃ³n
npm start

# Sembrar usuarios
npm run seed:execute

# Pruebas unitarias
npm run test:unit

# Todas las pruebas
npm test
```

Al iniciar correctamente verÃ¡s:

```
============================================================
[Server] RC-Tractoparts-API running
[Server] Environment : development
[Server] Listening on: http://localhost:3000
[Server] Health check: http://localhost:3000/health
[Server] API Docs   : http://localhost:3000/api-docs/
============================================================
[DB] Connected to MySQL â€” host: localhost:3306 | database: rc_tractoparts
```

---

## ðŸ“š DocumentaciÃ³n Interactiva (Swagger)

Con el servidor corriendo, la documentaciÃ³n completa e interactiva de la API estÃ¡ disponible en:

```
http://localhost:3000/api-docs/
```

Swagger UI estÃ¡ **completamente configurado y operacional**. Permite:

- **Explorar** todos los endpoints con sus esquemas de request/response
- **Autenticarse** con el token JWT del login (botÃ³n **Authorize ðŸ”’**)
- **Probar** cada endpoint directamente desde el navegador

> **Flujo recomendado:**
> 1. `POST /api/auth/login` â†’ copiar el `token` del response
> 2. Clic en **Authorize ðŸ”’** â†’ pegar `Bearer <token>`
> 3. Explorar todos los endpoints protegidos

---

## ðŸ—º Mapa Completo de Endpoints

### ðŸ” AutenticaciÃ³n â€” `/api/auth`

| MÃ©todo | Endpoint | Auth | DescripciÃ³n |
|---|---|---|---|
| `POST` | `/api/auth/login` | âŒ PÃºblica | Devuelve JWT firmado |
| `POST` | `/api/auth/logout` | âœ… JWT | Revoca el token activo |

### ðŸ‘¥ Usuarios â€” `/api/usuarios` (Jefe / SysAdmin)

| MÃ©todo | Endpoint | DescripciÃ³n |
|---|---|---|
| `GET` | `/api/usuarios` | Listar usuarios |
| `POST` | `/api/usuarios` | Crear usuario |
| `GET` | `/api/usuarios/:id` | Detalle de usuario |
| `PUT` | `/api/usuarios/:id` | Actualizar usuario |
| `DELETE` | `/api/usuarios/:id` | Desactivar usuario (soft delete) |

### ðŸ¢ Clientes â€” `/api/clientes`

| MÃ©todo | Endpoint | Auth | DescripciÃ³n |
|---|---|---|---|
| `GET` | `/api/clientes` | âœ… JWT | Listar clientes |
| `POST` | `/api/clientes` | âœ… JWT | Crear cliente |
| `GET` | `/api/clientes/:id` | âœ… JWT | Detalle de cliente |
| `PUT` | `/api/clientes/:id` | âœ… JWT | Actualizar cliente |

### ðŸ“‹ Cotizaciones â€” `/api/cotizaciones`

| MÃ©todo | Endpoint | Roles | DescripciÃ³n |
|---|---|---|---|
| `GET` | `/api/cotizaciones/resumen` | Todos | Conteo por estado |
| `GET` | `/api/cotizaciones/pendientes-aprobacion` | Jefe, SysAdmin | Cola de aprobaciÃ³n: `Pendiente` + `En revision` + `En espera` |
| `GET` | `/api/cotizaciones` | Todos | Listado paginado con 10 filtros |
| `POST` | `/api/cotizaciones` | Todos | Crear cotizaciÃ³n + PDF automÃ¡tico |
| `GET` | `/api/cotizaciones/:id` | Todos | Detalle: header + Ã­tems + historial |
| `GET` | `/api/cotizaciones/:id/historial` | Todos | Historial cronolÃ³gico de estados |
| `PUT` | `/api/cotizaciones/:id/estado` | SegÃºn rol | TransiciÃ³n de estado (state machine) |
| `POST` | `/api/cotizaciones/:id/aprobar` | Jefe, SysAdmin | Aprobar o rechazar (HU08) |
| `PATCH` | `/api/cotizaciones/:id/comentario-admin` | Administracion | Guardar comentario de supervisiÃ³n |
| `POST` | `/api/cotizaciones/:id/pdf` | Ejecutivo | Subir PDF manualmente |
| `GET` | `/api/cotizaciones/:id/pdf` | Todos | Descargar PDF adjunto |

#### ParÃ¡metros de filtrado en `GET /api/cotizaciones`

| ParÃ¡metro | Tipo | DescripciÃ³n |
|---|---|---|
| `q` | string | BÃºsqueda libre en correlativo, razÃ³n social y NIT |
| `razon_social` | string | Coincidencia parcial en nombre del cliente |
| `nit` | string | Coincidencia parcial en NIT |
| `estado` | string | Filtro exacto por estado del ciclo de vida |
| `id_cliente` | number | Filtro por ID de cliente |
| `id_ejecutivo` | number | Filtro por ID de ejecutivo |
| `fecha_desde` | YYYY-MM-DD | LÃ­mite inferior de fecha de emisiÃ³n |
| `fecha_hasta` | YYYY-MM-DD | LÃ­mite superior de fecha de emisiÃ³n |
| `moneda` | `USD` \| `BOB` | Filtra por moneda |
| `tiene_pdf` | `true` \| `false` | Solo con o sin PDF adjunto |
| `page` | number | PÃ¡gina (base 1, por defecto 1) |
| `limit` | number | Registros por pÃ¡gina (mÃ¡ximo 100, por defecto 20) |
| `sort_by` | string | Columna de ordenamiento |
| `sort_order` | `ASC` \| `DESC` | DirecciÃ³n del ordenamiento |

---

## ðŸ§ª Pruebas Automatizadas

### Pruebas unitarias

```bash
npm run test:unit
```

Ejecuta **12 pruebas** que validan la lÃ³gica de cÃ¡lculo de subtotales y la validaciÃ³n Zod:

| ID | DescripciÃ³n | Estado |
|---|---|---|
| UT-01 | Subtotal exacto para Ã­tem simple | âœ… |
| UT-02 | Redondeo a 2 decimales en decimales periÃ³dicos | âœ… |
| UT-03 | Suma correcta de mÃºltiples Ã­tems | âœ… |
| UT-04 | Array vacÃ­o devuelve `0.00` | âœ… |
| UT-05 | Cantidad fraccional produce subtotal correcto | âœ… |
| UT-06 | Precio unitario mÃ¡ximo no lanza excepciÃ³n | âœ… |
| UT-07 | Cantidad negativa lanza error de validaciÃ³n | âœ… |
| UT-08 | Precio negativo lanza error de validaciÃ³n | âœ… |
| EDGE-01 | Cantidad cero lanza error de validaciÃ³n | âœ… |
| EDGE-02 | Precio cero es vÃ¡lido (`0.00`) | âœ… |
| EDGE-03 | Un solo Ã­tem: total = subtotal | âœ… |
| EDGE-04 | Suma con decimales periÃ³dicos redondeada correctamente | âœ… |

### Prueba de concurrencia

`CC-01` â€” dispara **20 peticiones simultÃ¡neas** y verifica que todos los correlativos sean Ãºnicos. Valida el `SELECT â€¦ FOR UPDATE` bajo carga real.

---

## ðŸ”§ SoluciÃ³n de Problemas

### `UnauthorizedAccess` en PowerShell (Windows)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### `Error Code: 1046 â€” No database selected` en MySQL Workbench

Doble clic sobre `rc_tractoparts` en el panel izquierdo (debe aparecer en **negrita**) antes de ejecutar el script.

### `401 Invalid credentials` con credenciales correctas

El hash almacenado no corresponde. Resembrar:

```bash
npm run seed:execute
```

### `FORBIDDEN_TRANSITION` al cambiar estado

El rol del usuario no tiene permiso para esa transiciÃ³n. Consultar la secciÃ³n [MÃ¡quina de Estados](#-mÃ¡quina-de-estados).

### La Cola de AprobaciÃ³n aparece vacÃ­a para el Jefe

Verificar que existan cotizaciones en estado `Pendiente`, `En revision` o `En espera`. El endpoint `/api/cotizaciones/pendientes-aprobacion` incluye los tres estados activos.

---

## ðŸ‘¨â€ðŸ’» Autores y Contexto AcadÃ©mico

| | |
|---|---|
| **InstituciÃ³n** | UTEPSA â€” Universidad TecnolÃ³gica Privada de Santa Cruz |
| **Carrera** | IngenierÃ­a de Sistemas |
| **Empresa** | RC Tractoparts â€” Importaciones de Maquinaria Pesada |
| **MetodologÃ­a** | XP / SCRUM con sprints de dos semanas |
| **Sprint actual** | Sprint 2 â€” Ciclo de vida completo y gestiÃ³n documental |

---

<div align="center">

**RC Tractoparts â€” Departamento de Sistemas**
Santa Cruz de la Sierra, Bolivia Â· 2026

</div>
