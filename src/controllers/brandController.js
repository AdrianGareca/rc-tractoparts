// =============================================================================
// src/controllers/brandController.js
// Brand Controller — GET /api/marcas, POST /api/marcas
//
// El catálogo de marcas de repuesto (Caterpillar, Komatsu, Hitachi…), que crece
// desde el "+" de la columna Marca en cada fila del formulario de cotización.
//
// TODO EL COMPORTAMIENTO VIVE EN catalogoSimple.js
// Este archivo tenía 104 líneas, y origenClienteController.js otras 99 diciendo
// exactamente lo mismo — su propia cabecera admitía ser un espejo. Los dos se
// habían separado en tres detalles que nadie notaba, entre ellos registrar la
// auditoría con una cadena suelta que no estaba en AuditActions: el evento se
// guardaba y a la vez era imposible de filtrar.
//
// Lo que queda acá es lo ÚNICO propio de las marcas: qué modelo consultar, cómo
// se llama la entidad en la bitácora, y que "marca" es femenino.
// =============================================================================

'use strict';

const BrandModel = require('../models/BrandModel');
const { AuditActions } = require('../utils/auditLog');
const { crearControladorDeCatalogo } = require('./catalogoSimple');

const catalogo = crearControladorDeCatalogo({
  modelo:     BrandModel,
  tabla:      'marcas',
  // Desde la lista, NUNCA una cadena suelta: lo que no está en AuditActions se
  // guarda igual pero no aparece en el filtro de la bitácora, y la API contesta
  // 422 si alguien lo pide. Acá había exactamente ese bug.
  accion:     AuditActions.CREAR_MARCA,
  sustantivo: 'marca',
  genero:     'f',      // "La marca", "el nombre de la marca"
});

// Se conservan los nombres originales de los métodos porque son los que
// referencian las rutas y la documentación de Swagger.
const BrandController = {
  getBrands:   catalogo.listar,
  createBrand: catalogo.crear,
};

module.exports = BrandController;
