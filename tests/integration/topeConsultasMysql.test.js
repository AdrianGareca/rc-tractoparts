// =============================================================================
// tests/integration/topeConsultasMysql.test.js
// La pista de tope funciona contra un MySQL de verdad.
//
// tests/unit/topeConsultas.test.js prueba el SQL que se arma y lo que responde
// el controlador, pero con un error de mentira. Lo que sólo se puede comprobar
// acá es que MySQL ENTIENDE la pista y que el error que devuelve de verdad es
// el que esTopeExcedido reconoce. Si una versión de MySQL la ignorara en
// silencio, los reportes volverían a correr sin límite y ninguna prueba unitaria
// se enteraría.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const { pool } = require('../../src/config/db');
const { conTope, esTopeExcedido } = require('../../src/utils/topeConsultas');

jest.setTimeout(30000);

afterAll(() => pool.end());

// Un producto cruzado de las columnas del catálogo de MySQL: miles de filas
// por lado, que no terminan en un milisegundo en ningún servidor.
const CONSULTA_LENTA = `
  SELECT COUNT(*) AS n
    FROM information_schema.columns a, information_schema.columns b, information_schema.columns c`;

test('MySQL corta la consulta al vencer el tope, con el error que esTopeExcedido reconoce', async () => {
  let error = null;
  try {
    await pool.execute(conTope(CONSULTA_LENTA, 1));
  } catch (e) {
    error = e;
  }

  expect(error).not.toBeNull();
  expect(esTopeExcedido(error)).toBe(true);
});

test('con tope holgado, una consulta normal devuelve su resultado', async () => {
  const [filas] = await pool.execute(conTope('SELECT 1 + 1 AS dos'));
  expect(filas[0].dos).toBe(2);
});
