// =============================================================================
// src/config/swagger.js
// La configuración de OpenAPI y las respuestas de error compartidas.
//
// POR QUÉ ESTÁ ACÁ Y NO EN app.js
// Dos razones. La primera es que app.js arma el servidor entero —seguridad,
// sesiones, archivos estáticos, rutas, manejo de errores— y sesenta líneas de
// configuración de documentación en el medio no ayudan a leer ninguna de esas
// cosas. La segunda pesa más: mientras vivía dentro de app.js, comprobar el
// spec obligaba a construir la aplicación completa, con su conexión a la base
// de datos incluida. Acá se puede pedir y mirar sin levantar nada.
//
// EL PROBLEMA QUE RESUELVE components.responses
// De las 2982 líneas de src/routes, 2058 eran comentarios de Swagger — el 69%.
// No había un solo $ref en el proyecto: cada endpoint copiaba a mano el mismo
// bloque de error, y «Token ausente o inválido.» estaba escrito 26 veces.
//
// Eso todavía sería sólo repetición. Lo que lo convierte en un problema es que
// las copias YA se habían desincronizado:
//
//   «Error interno del servidor.»    22 veces
//   «Error interno del servidor»      4 veces   ← sin punto final
//   «Token ausente o inválido.»      26 veces
//   «Token JWT ausente o inválido»    3 veces   ← otra redacción
//
// La documentación que se publica describía el mismo error de tres formas
// según el endpoint. Quien la lee no tiene manera de saber si son tres
// situaciones distintas o la misma escrita por tres personas. Con una
// respuesta compartida no hay dónde desincronizarse.
// =============================================================================

'use strict';

const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

/**
 * Forma del cuerpo de error que devuelve toda la API.
 *
 * Se declara una vez y se referencia desde cada respuesta: si mañana el
 * middleware de errores agrega un campo, se agrega acá y aparece en los
 * cuarenta y pico de endpoints a la vez.
 */
const ERROR_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean', example: false },
    message: { type: 'string', example: 'Descripción del error.' },
  },
};

/**
 * Las respuestas de error que repetían todos los endpoints.
 *
 * El nombre de cada una dice QUÉ pasó, no el número: `NoAutorizado` se entiende
 * al leer la ruta, `Respuesta401` obliga a ir a buscar qué significaba.
 */
const RESPUESTAS_COMPARTIDAS = {
  NoAutorizado: {
    description: 'Falta el token de acceso, está vencido o no es válido.',
    content: { 'application/json': { schema: ERROR_SCHEMA } },
  },

  SinPermiso: {
    description: 'El rol de la cuenta no alcanza para esta operación.',
    content: { 'application/json': { schema: ERROR_SCHEMA } },
  },

  DatosInvalidos: {
    description: 'Los datos enviados no pasaron la validación.',
    content: { 'application/json': { schema: ERROR_SCHEMA } },
  },

  NoEncontrado: {
    description: 'No existe un registro con ese identificador.',
    content: { 'application/json': { schema: ERROR_SCHEMA } },
  },

  ErrorInterno: {
    description: 'Error inesperado del servidor.',
    content: { 'application/json': { schema: ERROR_SCHEMA } },
  },
};

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API de Gestión de Cotizaciones — RC Tractoparts',
      version: '1.0.0',
      description: 'Documentación interactiva de la API para el control de cotizaciones, usuarios y auditorías (XP-SCRUM).',
    },
    // Relative server URL: Swagger UI resolves every "Try it out" request
    // against the SAME origin the docs page was loaded from. Locally that is
    // http://localhost:3000; in production it is https://rctractoparts.org —
    // no hardcoded host, no per-environment lists, no HTTPS→HTTP mixed-content
    // blocks. (A hardcoded localhost here previously made the production docs
    // fire requests at the viewer's own machine instead of the real API.)
    servers: [
      {
        url: '/',
        description: 'Servidor actual (mismo origen de esta página)',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Introduce tu token JWT. Pega SOLO el token sin el prefijo "Bearer".',
        },
      },
      schemas: {
        Error: ERROR_SCHEMA,
      },
      responses: RESPUESTAS_COMPARTIDAS,
    },
    // Apply bearerAuth globally so every endpoint shows the padlock icon
    // and Swagger UI automatically injects the Authorization header.
    security: [{ bearerAuth: [] }],
  },
  apis: [
    path.join(__dirname, '..', 'routes', '*.js').replace(/\\/g, '/'),
    path.join(__dirname, '..', 'controllers', '*.js').replace(/\\/g, '/'),
  ],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = { swaggerOptions, swaggerSpec, RESPUESTAS_COMPARTIDAS, ERROR_SCHEMA };
