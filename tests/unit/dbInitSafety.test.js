// =============================================================================
// tests/unit/dbInitSafety.test.js
// Seguro de sql/init.js: el modo --test NUNCA puede apuntar a la BD de producción.
//
// init.sql arranca con DROP DATABASE, y desde que `pretest` lo ejecuta en cada
// `npm test` esto corre solo, sin que nadie lo escriba. Un DB_NAME_TEST mal
// configurado (igual a DB_NAME, o vacío) borraría la base real sin preguntar.
// =============================================================================

'use strict';

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

const mysql      = require('mysql2/promise');
const { run }    = require('../../sql/init');

describe('sql/init.js — seguro del modo --test', () => {
  // Restauramos SOLO las dos claves que tocamos, en el mismo objeto process.env.
  // Reasignar process.env entero contamina a los demás archivos de test: con
  // --runInBand todos comparten proceso, y cada suite de integración recrea su
  // pool de MySQL leyendo estas variables al momento de cargarse.
  const ENV_KEYS = ['DB_NAME', 'DB_NAME_TEST'];
  const saved    = {};

  beforeEach(() => {
    mysql.createConnection.mockReset();
    ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; });
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  test('rechaza si DB_NAME_TEST es igual a DB_NAME', async () => {
    process.env.DB_NAME      = 'rc_tractoparts';
    process.env.DB_NAME_TEST = 'rc_tractoparts';

    await expect(run(true)).rejects.toThrow(/DB_NAME_TEST/);

    // Lo importante: ni siquiera se abrió la conexión, así que no hubo DROP.
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });

  test('rechaza si DB_NAME_TEST no está definida', async () => {
    process.env.DB_NAME = 'rc_tractoparts';
    delete process.env.DB_NAME_TEST;

    await expect(run(true)).rejects.toThrow(/DB_NAME_TEST/);
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });

  test('la comparación ignora mayúsculas y espacios sobrantes', async () => {
    process.env.DB_NAME      = 'rc_tractoparts';
    process.env.DB_NAME_TEST = '  RC_TractoParts ';

    await expect(run(true)).rejects.toThrow(/DB_NAME_TEST/);
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });

  test('deja pasar una BD de test legítimamente distinta', async () => {
    process.env.DB_NAME      = 'rc_tractoparts';
    process.env.DB_NAME_TEST = 'rc_tractoparts_test';

    const connection = { query: jest.fn().mockResolvedValue([]), end: jest.fn().mockResolvedValue() };
    mysql.createConnection.mockResolvedValue(connection);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await run(true);

    expect(mysql.createConnection).toHaveBeenCalledTimes(1);
    expect(connection.query).toHaveBeenCalledTimes(1);
    // El script se reescribe contra la BD de test, nunca contra la real.
    const executedSql = connection.query.mock.calls[0][0];
    expect(executedSql).toContain('rc_tractoparts_test');
    expect(executedSql).not.toMatch(/\brc_tractoparts\b(?!_test)/);
    expect(connection.end).toHaveBeenCalled();
  });
});
