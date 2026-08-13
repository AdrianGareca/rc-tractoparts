// =============================================================================
// src/controllers/origenClienteController.js
// Origen Cliente Controller — GET /api/origenes-cliente, POST /api/origenes-cliente
//
// El catálogo de cómo llegó cada cliente a la empresa (Feria comercial,
// Recomendación, Visita en frío…), que crece desde el "+" del modal de cliente
// y alimenta el reporte "Clientes por origen".
//
// TODO EL COMPORTAMIENTO VIVE EN catalogoSimple.js — ver el comentario de
// brandController.js. Este archivo y aquél eran gemelos de 99 y 104 líneas; la
// cabecera de éste lo decía sin rodeos ("Mirrors brandController.js — same
// validation/uniqueness/audit contract"), y aun así se habían separado en tres
// detalles que ninguno hacía fallar nada.
//
// Lo que queda acá es lo ÚNICO propio de los orígenes: qué modelo consultar,
// cómo se llama la entidad en la bitácora, y que "origen" es masculino.
// =============================================================================

'use strict';

const OrigenClienteModel = require('../models/OrigenClienteModel');
const { AuditActions } = require('../utils/auditLog');
const { crearControladorDeCatalogo } = require('./catalogoSimple');

const catalogo = crearControladorDeCatalogo({
  modelo:     OrigenClienteModel,
  tabla:      'origenes_cliente',
  accion:     AuditActions.CREAR_ORIGEN_CLIENTE,
  sustantivo: 'origen',
  genero:     'm',        // "El origen", "el nombre del origen" — con la contracción
  plural:     'orígenes', // el plural no es regular: lleva tilde
});

// Se conservan los nombres originales de los métodos porque son los que
// referencian las rutas y la documentación de Swagger.
const OrigenClienteController = {
  getOrigenes:  catalogo.listar,
  createOrigen: catalogo.crear,
};

module.exports = OrigenClienteController;
