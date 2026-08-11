// =============================================================================
// tests/integration/editarNoPisaMoneda.test.js
// Editar una cotización NO puede cambiarle la moneda ni la razón social emisora.
//
// EL BUG
// `updateQuotationSchema` se armaba con el MISMO shape que el de creación, y
// ese shape trae `.default('BOB')` y `.default('Empresa unipersonal de Ronald
// Roca Cartagena')`. Como `validate()` reemplaza `req.body` con la salida de
// Zod, esos dos campos NUNCA llegaban `undefined` al controlador — así que el
// fallback `req.body.moneda || existing.moneda` era código muerto: el primer
// término siempre tenía valor.
//
// POR QUÉ IMPORTA MÁS QUE UN CAMPO MAL GUARDADO
// La cuenta bancaria que se imprime en la proforma se resuelve POR
// `entidad_emisora` (src/services/pdf/bankData.js). Y el monto se rotula con
// la moneda, incluido el «SON: … BOLIVIANOS» en letras.
//
// Entonces una cotización de Roca Importaciones S.R.L. por USD 10.000 que
// vuelve a Pendiente para una corrección menor, y se reenvía con el cuerpo
// mínimo que documenta Swagger, se guarda como Bs 10.000 de la otra razón
// social — y el PDF que recibe el cliente le pide transferir a la cuenta
// equivocada, por una décima parte del valor real.
//
// Ningún importe cambió. Sólo dos campos que nadie tocó.
//
// Prerequisitos: NODE_ENV=test — la base de pruebas debe existir y estar migrada.
// =============================================================================

'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const request  = require('supertest');
const bcrypt   = require('bcryptjs');
const app      = require('../../src/app');
const { pool } = require('../../src/config/db');

jest.setTimeout(30000);   // el PUT regenera el PDF

let token, ejecId, clienteId, cotizacionId;

const USUARIO  = 'test_ejec_moneda';
const PASSWORD = 'TestMoneda01!';
const CLIENTE  = 'Test Client MONEDA';

/** La otra razón social, la que NO es el valor por defecto del esquema. */
const ENTIDAD_SECUNDARIA = 'Roca Importaciones S.R.L.';

beforeAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion IN (SELECT id FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?))', [USUARIO]);
  await pool.execute('DELETE FROM cotizaciones WHERE id_ejecutivo IN (SELECT id FROM usuarios WHERE nombre_usuario = ?)', [USUARIO]);
  await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [USUARIO]);
  await pool.execute('DELETE FROM clientes WHERE razon_social = ?', [CLIENTE]);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const [u] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, 1, 1)`,
    ['Test Ejecutivo MONEDA', USUARIO, hash]
  );
  ejecId = u.insertId;

  const [c] = await pool.execute(
    `INSERT INTO clientes (razon_social, activo) VALUES (?, 1)`, [CLIENTE]
  );
  clienteId = c.insertId;

  // Una cotización en USD y de la razón social SECUNDARIA: los dos valores
  // distintos de los que el esquema pone por defecto.
  const [q] = await pool.execute(
    `INSERT INTO cotizaciones
       (numero_correlativo, id_cliente, id_ejecutivo, descripcion, fecha_emision,
        estado, moneda, entidad_emisora, monto_total)
     VALUES (?, ?, ?, ?, CURDATE(), 'Pendiente', 'USD', ?, 10000.00)`,
    [`MON-${Date.now()}`.slice(0, 20), clienteId, ejecId,
     'Cotización en dólares de la razón social secundaria', ENTIDAD_SECUNDARIA]
  );
  cotizacionId = q.insertId;

  await pool.execute(
    `INSERT INTO cotizacion_detalles (id_cotizacion, descripcion_item, cantidad, precio_unitario, subtotal, unidad)
     VALUES (?, 'Repuesto importado', 1, 10000.00, 10000.00, 'UND')`,
    [cotizacionId]
  );

  const login = await request(app).post('/api/auth/login')
    .send({ nombre_usuario: USUARIO, password: PASSWORD });
  expect(login.status).toBe(200);
  token = login.body.data.token;
});

afterAll(async () => {
  await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [cotizacionId ?? 0]);
  await pool.execute('DELETE FROM usuarios WHERE id = ?', [ejecId ?? 0]);
  await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId ?? 0]);
  await pool.end();
});

/** El cuerpo MÍNIMO que documenta Swagger para un PUT: sin moneda ni entidad. */
const cuerpoMinimo = () => ({
  id_cliente:    clienteId,
  descripcion:   'Descripción corregida tras la observación del Jefe',
  fecha_emision: '2026-07-24',
  detalles: [
    { descripcion_item: 'Repuesto importado', cantidad: 1, precio_unitario: 10000 },
  ],
});

const leer = async () => {
  const [rows] = await pool.execute(
    'SELECT moneda, entidad_emisora, monto_total FROM cotizaciones WHERE id = ?',
    [cotizacionId]
  );
  return rows[0];
};

describe('MON — editar no puede pisar la moneda ni la razón social', () => {

  test('MON-01: un PUT sin `moneda` CONSERVA la moneda que ya tenía', async () => {
    const antes = await leer();
    expect(antes.moneda).toBe('USD');   // el punto de partida es el que creemos

    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoMinimo());

    expect(res.status).toBe(200);

    const despues = await leer();
    // Si esto falla con 'BOB', una cotización de USD 10.000 pasó a leerse como
    // Bs 10.000 sin que nadie tocara un importe.
    expect(despues.moneda).toBe('USD');
  });

  test('MON-02: un PUT sin `entidad_emisora` CONSERVA la razón social emisora', async () => {
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpoMinimo());

    expect(res.status).toBe(200);

    const despues = await leer();
    // La cuenta bancaria del PDF se resuelve por este campo. Si acá aparece la
    // entidad principal, el cliente recibe una proforma que le pide transferir
    // a la cuenta de la otra empresa.
    expect(despues.entidad_emisora).toBe(ENTIDAD_SECUNDARIA);
  });

  test('MON-03: mandar `moneda` explícita SÍ la cambia — el cambio deliberado sigue funcionando', async () => {
    // El arreglo no puede convertir los campos en inmutables: cambiar la moneda
    // a propósito es una operación legítima del formulario.
    const res = await request(app)
      .put(`/api/cotizaciones/${cotizacionId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...cuerpoMinimo(), moneda: 'BOB', entidad_emisora: 'Empresa unipersonal de Ronald Roca Cartagena' });

    expect(res.status).toBe(200);

    const despues = await leer();
    expect(despues.moneda).toBe('BOB');
    expect(despues.entidad_emisora).toBe('Empresa unipersonal de Ronald Roca Cartagena');

    // Se restaura para no dejar la fila en un estado raro si se agregan tests.
    await pool.execute(
      'UPDATE cotizaciones SET moneda = ?, entidad_emisora = ? WHERE id = ?',
      ['USD', ENTIDAD_SECUNDARIA, cotizacionId]
    );
  });

  test('MON-04: crear SIN moneda sigue cayendo a BOB — el default de creación no se toca', async () => {
    // El default existe por una razón buena: los ejecutivos calculan en
    // Bolivianos y una creación sin moneda debe quedar en BOB, no en nulo.
    // Lo que estaba mal era aplicarlo también al EDITAR.
    const res = await request(app)
      .post('/api/cotizaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id_cliente:    clienteId,
        descripcion:   'Cotización nueva sin moneda explícita',
        fecha_emision: '2026-07-24',
        detalles: [{ descripcion_item: 'Repuesto', cantidad: 1, precio_unitario: 50 }],
      });

    expect(res.status).toBe(201);

    const [rows] = await pool.execute(
      'SELECT moneda, entidad_emisora FROM cotizaciones WHERE id = ?', [res.body.data.id]
    );
    expect(rows[0].moneda).toBe('BOB');
    expect(rows[0].entidad_emisora).toBe('Empresa unipersonal de Ronald Roca Cartagena');

    await pool.execute('DELETE FROM cotizacion_detalles WHERE id_cotizacion = ?', [res.body.data.id]);
    await pool.execute('DELETE FROM cotizaciones WHERE id = ?', [res.body.data.id]);
  });
});
