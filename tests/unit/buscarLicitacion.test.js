// =============================================================================
// tests/unit/buscarLicitacion.test.js
// El preámbulo compartido de los endpoints de licitaciones.
//
// POR QUÉ EXISTE
// buscarLicitacion() reemplazó siete copias del mismo bloque en tres
// controladores. Ese es justamente el riesgo: ahora un fallo acá no rompe UN
// endpoint, rompe los siete a la vez — y el más silencioso de todos sería que
// dejara de devolver `error` cuando la licitación no existe, porque entonces
// cada controlador seguiría de largo con `licitacion` en null y reventaría más
// abajo con un mensaje que no dice nada del ID que faltaba.
//
// El modelo se reemplaza por un doble: lo que se prueba es la decisión (400,
// 404 o pasar), no la consulta a la base.
// =============================================================================

'use strict';

jest.mock('../../src/models/LicitacionModel', () => ({ findById: jest.fn() }));

const LicitacionModel = require('../../src/models/LicitacionModel');
const { buscarLicitacion } = require('../../src/controllers/licitacion/buscarLicitacion');

beforeEach(() => {
  LicitacionModel.findById.mockReset();
});

describe('cuando el id de la URL no sirve', () => {
  test.each([
    ['texto',      'abc'],
    ['vacío',      ''],
    ['cero',       '0'],
    ['negativo',   '-3'],
    ['ausente',    undefined],
  ])('%s devuelve 400 y no consulta la base', async (_nombre, valor) => {
    const { id, licitacion, error } = await buscarLicitacion(valor);

    expect(error).not.toBeNull();
    expect(error.status).toBe(400);
    expect(id).toBeNull();
    expect(licitacion).toBeNull();

    // Lo importante: NI SIQUIERA se preguntó a la base. Un id inválido no
    // debería llegar nunca a MySQL.
    expect(LicitacionModel.findById).not.toHaveBeenCalled();
  });

  test('el mensaje es el de parseId, en español y nombrando la entidad', () => {
    return buscarLicitacion('abc').then(({ error }) => {
      expect(error.body.success).toBe(false);
      expect(error.body.message).toBe('El identificador de licitación no es válido.');
    });
  });
});

describe('cuando la licitación no existe', () => {
  test('devuelve 404 con el ID adentro del mensaje', async () => {
    LicitacionModel.findById.mockResolvedValue(null);

    const { id, licitacion, error } = await buscarLicitacion('77');

    expect(error).not.toBeNull();
    expect(error.status).toBe(404);
    expect(error.body.success).toBe(false);
    // El ID tiene que aparecer: es lo que le dice a quien reporta el problema
    // CUÁL buscó. Un «no se encontró» a secas no sirve para nada.
    expect(error.body.message).toBe('No se encontró la licitación con ID 77.');

    // El id sí se devuelve aunque no haya registro — hubo un id válido.
    expect(id).toBe(77);
    expect(licitacion).toBeNull();
  });

  test('nunca devuelve error null con licitacion null', async () => {
    // La combinación imposible. Si alguna vez saliera, los siete controladores
    // seguirían de largo creyendo que encontraron algo.
    LicitacionModel.findById.mockResolvedValue(null);
    const { licitacion, error } = await buscarLicitacion('5');
    expect(licitacion === null && error === null).toBe(false);
  });
});

describe('cuando la licitación existe', () => {
  test('devuelve el id, el registro y error en null', async () => {
    const fila = { id: 12, titulo: 'Repuestos línea amarilla', estado: 'Cotizando' };
    LicitacionModel.findById.mockResolvedValue(fila);

    const { id, licitacion, error } = await buscarLicitacion('12');

    expect(error).toBeNull();
    expect(id).toBe(12);
    expect(licitacion).toBe(fila);   // el mismo objeto, sin copiar ni recortar
  });

  test('consulta la base con el id ya convertido a número', async () => {
    LicitacionModel.findById.mockResolvedValue({ id: 9 });
    await buscarLicitacion('9');

    // Con el string '9' MySQL igual respondería, pero el resto del controlador
    // compara ids con === y ahí un string sí cambia el resultado.
    expect(LicitacionModel.findById).toHaveBeenCalledWith(9);
    expect(LicitacionModel.findById).toHaveBeenCalledTimes(1);
  });

  test("'12abc' se lee como 12, igual que parseId", async () => {
    // Decisión heredada de parseId y documentada allá: la URL apunta sin
    // ambigüedad al 12. Se comprueba acá para que el cambio de un módulo al
    // otro no altere el comportamiento sin que nadie lo note.
    LicitacionModel.findById.mockResolvedValue({ id: 12 });
    const { id, error } = await buscarLicitacion('12abc');
    expect(error).toBeNull();
    expect(id).toBe(12);
  });
});

describe('los errores de la base no se disfrazan', () => {
  test('si findById falla, la excepción sale hacia el controlador', async () => {
    // El try/catch de cada endpoint es el que convierte esto en un 500 y lo
    // registra con su propio nombre. Atraparlo acá lo volvería un 404 y
    // escondería una caída de la base detrás de «no se encontró».
    LicitacionModel.findById.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(buscarLicitacion('5')).rejects.toThrow('ECONNREFUSED');
  });
});
