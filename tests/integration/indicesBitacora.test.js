// =============================================================================
// tests/integration/indicesBitacora.test.js
// Verifica con EXPLAIN que las consultas sobre bitacora_auditoria usan índice.
//
// POR QUÉ CON EXPLAIN Y NO CRONOMETRANDO
// Medir tiempos en un test es una receta para intermitencias: con pocas filas
// un escaneo completo tarda lo mismo que una lectura por índice, y en CI el
// reloj miente. EXPLAIN pregunta directamente al planificador QUÉ va a hacer,
// que es exactamente lo que queremos fijar: `type` y `key` son la respuesta
// estructural, independiente de la máquina y de la carga.
//
// LO QUE SE PROTEGE
// bitacora_auditoria es de sólo-agregar y nunca se purga: crece con cada login,
// cada cambio de estado y cada PDF. Un escaneo completo hoy no se nota y dentro
// de dos años hace inusable la pestaña de auditoría. Si alguien quita un índice
// o cambia una consulta de forma que deje de aprovecharlo, esto lo dice ahora y
// no cuando ya sea un problema.
//
// Prerrequisito: NODE_ENV=test y la base de test creada (npm run db:init:test).
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const { pool } = require('../../src/config/db');

jest.setTimeout(30000);

// CUÁNTAS FILAS SEMBRAR, Y POR QUÉ ESE NÚMERO
// El planificador de MySQL decide por costo, así que el mismo índice se usa o
// no según el tamaño de la tabla. Midiendo sobre esta misma consulta:
//
//     400 filas → sin índice, 400 filas leídas, "Using filesort"
//   5.000 filas → idx_bitacora_creado, 25 filas leídas, "Backward index scan"
//  20.000 filas → igual que 5.000
//
// Con 400 filas MySQL tiene razón: leer la tabla entera y ordenarla sale más
// barato que saltar del índice a cada fila. Ese es justamente el motivo por el
// que este índice hay que ponerlo ANTES de que haga falta — el día que la
// bitácora sea grande, el ALTER TABLE sobre una tabla grande es la parte cara.
//
// 5.000 es el mínimo que cruza el umbral con margen; más filas sólo harían el
// test más lento sin probar nada nuevo.
const FILAS_SEMILLA = 5000;
const MARCA = 'test_indices_bitacora';

beforeAll(async () => {
  await pool.execute('DELETE FROM bitacora_auditoria WHERE nombre_usuario = ?', [MARCA]);

  const LOTE = 1000;   // insertar 5.000 en una sola sentencia hace un paquete enorme
  for (let inicio = 0; inicio < FILAS_SEMILLA; inicio += LOTE) {
    const valores = [];
    const marcadores = [];
    for (let i = inicio; i < Math.min(inicio + LOTE, FILAS_SEMILLA); i++) {
      marcadores.push('(?, ?, ?, ?, ?, ?)');
      valores.push(
        MARCA,
        i % 7 === 0 ? 'CREAR_COTIZACION' : 'CAMBIAR_ESTADO',
        i % 3 === 0 ? 'cotizaciones' : 'licitaciones',
        i,
        'exito',
        new Date(Date.now() - i * 60000),
      );
    }
    await pool.query(
      `INSERT INTO bitacora_auditoria
         (nombre_usuario, accion, entidad, id_entidad, resultado, creado_en)
       VALUES ${marcadores.join(', ')}`,
      valores
    );
  }

  // ANALYZE refresca las estadísticas del índice; sin esto el planificador
  // puede seguir razonando sobre una tabla que creía vacía.
  await pool.query('ANALYZE TABLE bitacora_auditoria');
});

afterAll(async () => {
  await pool.execute('DELETE FROM bitacora_auditoria WHERE nombre_usuario = ?', [MARCA]);
  await pool.end();
});

/** Primera fila del EXPLAIN de una consulta. */
async function explain(sql, params = []) {
  const [filas] = await pool.query(`EXPLAIN ${sql}`, params);
  return filas[0];
}

// =============================================================================
describe('los índices existen', () => {
  test('bitacora_auditoria tiene idx_bitacora_creado e idx_bitacora_entidad', async () => {
    const [filas] = await pool.query('SHOW INDEX FROM bitacora_auditoria');
    const nombres = new Set(filas.map((f) => f.Key_name));

    expect(nombres).toContain('idx_bitacora_creado');
    expect(nombres).toContain('idx_bitacora_entidad');
  });

  test('las columnas de cada índice están en el orden que las consultas necesitan', async () => {
    const [filas] = await pool.query('SHOW INDEX FROM bitacora_auditoria');
    const columnasDe = (indice) => filas
      .filter((f) => f.Key_name === indice)
      .sort((a, b) => a.Seq_in_index - b.Seq_in_index)
      .map((f) => f.Column_name);

    expect(columnasDe('idx_bitacora_creado')).toEqual(['creado_en', 'id']);
    expect(columnasDe('idx_bitacora_entidad')).toEqual(['entidad', 'id_entidad', 'accion']);
  });
});

// =============================================================================
describe('la pestaña de auditoría no escanea la tabla entera', () => {
  // Esta es la consulta literal de AuditLogModel.findAll sin filtros — el caso
  // por defecto, el que se ejecuta cada vez que alguien abre la pestaña.
  const SQL_LISTADO = `
    SELECT a.id, a.nombre_usuario, a.accion, a.entidad, a.creado_en
      FROM bitacora_auditoria a
     ORDER BY a.creado_en DESC, a.id DESC
     LIMIT 25
  `;

  test('usa idx_bitacora_creado', async () => {
    const plan = await explain(SQL_LISTADO);
    expect(plan.key).toBe('idx_bitacora_creado');
  });

  test('no ordena en memoria (sin filesort)', async () => {
    const plan = await explain(SQL_LISTADO);
    // El índice ya viene ordenado por fecha: MySQL lo recorre hacia atrás.
    expect(plan.Extra ?? '').not.toMatch(/filesort/i);
  });

  test('lee sólo la página que va a mostrar, no las miles que hay', async () => {
    const plan = await explain(SQL_LISTADO);
    // Con índice lee 25 (el LIMIT). Sin índice leería las 5.000.
    expect(plan.rows).toBeLessThan(100);
  });
});

// =============================================================================
describe('la línea de tiempo encuentra su evento de creación por índice', () => {
  // Consulta literal de stateMachine.findStateHistory / LicitacionModel.
  const SQL_TIMELINE = `
    SELECT ba.id, ba.nombre_usuario, ba.creado_en
      FROM bitacora_auditoria ba
     WHERE ba.entidad = ?
       AND ba.id_entidad = ?
       AND ba.accion = ?
       AND ba.resultado = 'exito'
     LIMIT 1
  `;

  test('usa idx_bitacora_entidad', async () => {
    const plan = await explain(SQL_TIMELINE, ['cotizaciones', 42, 'CREAR_COTIZACION']);
    expect(plan.key).toBe('idx_bitacora_entidad');
  });

  test('no es un escaneo completo', async () => {
    const plan = await explain(SQL_TIMELINE, ['cotizaciones', 42, 'CREAR_COTIZACION']);
    // type='ALL' significa exactamente eso: leer la tabla entera.
    expect(plan.type).not.toBe('ALL');
  });

  test('el planificador estima un puñado de filas, no la tabla', async () => {
    const plan = await explain(SQL_TIMELINE, ['cotizaciones', 42, 'CREAR_COTIZACION']);
    expect(plan.rows).toBeLessThan(20);
  });

  test('sirve igual para licitaciones (misma forma de consulta)', async () => {
    const plan = await explain(SQL_TIMELINE, ['licitaciones', 7, 'CREAR_LICITACION']);
    expect(plan.key).toBe('idx_bitacora_entidad');
    expect(plan.type).not.toBe('ALL');
  });
});
