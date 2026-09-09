// =============================================================================
// tests/unit/gastoDosIdentificadores.test.js
// Borrar un gasto lleva DOS identificadores en la URL, y el error dice cuál falló.
//
// POR QUÉ EXISTE
// La ruta es DELETE /api/licitaciones/:id/gastos/:gastoId. Hasta el 2026-09-09
// los dos identificadores se validaban con un `if` escrito a mano que devolvía
// «ID inválido.» a secas: quien recibía el error no tenía forma de saber si el
// que estaba mal era el de la licitación o el del gasto. Y encima calculaba el
// error de parseId para descartarlo enseguida.
//
// Era la última validación de id a mano que quedaba en todo src/ — el trinquete
// de tests/unit/parseIdCompartido.test.js la contaba, y bajó a 0 al sacarla.
//
// Este archivo existe porque el cambio NO rompió ninguna prueba: el endpoint no
// estaba cubierto. Un comportamiento que se puede cambiar sin que nada se queje
// es un comportamiento que nadie está cuidando.
//
// No hace falta base de datos: se le pasa un `res` de mentira y se mira qué
// respondió. Lo que se prueba es la decisión, no la consulta.
// =============================================================================

'use strict';

jest.mock('../../src/models/LicitacionModel', () => ({ findById: jest.fn() }));
jest.mock('../../src/models/LicitacionGastoModel', () => ({
  findById: jest.fn(), remove: jest.fn(), delete: jest.fn(),
}));
jest.mock('../../src/utils/auditLog', () => ({
  logEvent: jest.fn().mockResolvedValue(undefined),
  AuditActions: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const LicitacionModel = require('../../src/models/LicitacionModel');
const Controller = require('../../src/controllers/licitacionGastoController');

/** Un `res` que anota el status y el cuerpo en vez de escribir en un socket. */
function resFalso() {
  const r = { statusCode: null, cuerpo: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json   = (b) => { r.cuerpo = b; return r; };
  return r;
}

const reqFalso = (id, gastoId) => ({
  params: { id, gastoId },
  user:   { id: 1, rol: 'Jefe', nombre_usuario: 'jefe.prueba' },
  ip:     '127.0.0.1',
  socket: {},
});

beforeEach(() => {
  LicitacionModel.findById.mockReset();
});

describe('el error dice CUÁL de los dos identificadores está mal', () => {
  test('un id de gasto inválido nombra al gasto, no a la licitación', async () => {
    const res = resFalso();
    await Controller.deleteGasto(reqFalso('7', 'abc'), res);

    expect(res.statusCode).toBe(400);
    expect(res.cuerpo.success).toBe(false);
    expect(res.cuerpo.message).toContain('gasto');
    expect(res.cuerpo.message).not.toContain('licitación');

    // El mensaje viejo, que no distinguía entre los dos.
    expect(res.cuerpo.message).not.toBe('ID inválido.');
  });

  test('un id de licitación inválido nombra a la licitación', async () => {
    const res = resFalso();
    await Controller.deleteGasto(reqFalso('abc', '3'), res);

    expect(res.statusCode).toBe(400);
    expect(res.cuerpo.message).toContain('licitación');
    expect(res.cuerpo.message).not.toBe('ID inválido.');
  });
});

describe('lo barato se comprueba antes que lo caro', () => {
  test('con el id de gasto inválido no se consulta la base', async () => {
    // El id del gasto se valida ANTES de ir a buscar la licitación. Sin ese
    // orden, una URL con el gastoId mal escrito costaría una consulta a MySQL
    // para terminar rechazada igual.
    const res = resFalso();
    await Controller.deleteGasto(reqFalso('7', '0'), res);

    expect(res.statusCode).toBe(400);
    expect(LicitacionModel.findById).not.toHaveBeenCalled();
  });

  test('con los dos identificadores válidos sí se busca la licitación', async () => {
    LicitacionModel.findById.mockResolvedValue(null);   // no existe → 404
    const res = resFalso();
    await Controller.deleteGasto(reqFalso('7', '3'), res);

    expect(LicitacionModel.findById).toHaveBeenCalledWith(7);
    expect(res.statusCode).toBe(404);
    expect(res.cuerpo.message).toContain('7');
  });
});

describe('los identificadores que sí sirven', () => {
  test.each([
    ['7', '3'],
    ['1', '1'],
    ['9999', '12345'],
  ])('id=%s gastoId=%s pasan la validación', async (id, gastoId) => {
    LicitacionModel.findById.mockResolvedValue(null);
    const res = resFalso();
    await Controller.deleteGasto(reqFalso(id, gastoId), res);

    // Llegó hasta la búsqueda: el 404 significa que la validación los aceptó.
    expect(res.statusCode).toBe(404);
  });

  test.each([
    ['cero en el gasto',        '7',  '0'],
    ['negativo en el gasto',    '7',  '-2'],
    ['gasto ausente',           '7',  undefined],
    ['cero en la licitación',   '0',  '3'],
    ['licitación ausente',      undefined, '3'],
  ])('%s se rechaza con 400', async (_nombre, id, gastoId) => {
    const res = resFalso();
    await Controller.deleteGasto(reqFalso(id, gastoId), res);
    expect(res.statusCode).toBe(400);
  });
});
