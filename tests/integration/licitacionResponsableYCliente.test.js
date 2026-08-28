// =============================================================================
// tests/integration/licitacionResponsableYCliente.test.js
//
// Hallazgo ALTO — id_responsable de una licitación no validaba el rol, y no se
// podía corregir después de creada.
//   - createLicitacion sólo comprobaba que id_responsable existiera como FK en
//     usuarios, nunca que su ROL fuera uno que la matriz de transiciones
//     reconoce (Proyectos / Jefe / SysAdmin). Un Ejecutivo o Administracion
//     puesto por error como responsable quedaba sin poder editar la licitación
//     ni cambiar su estado (403 en ambos casos), sin forma de reasignarlo.
//   - updateLicitacionSchema no incluía id_responsable: ahora se puede
//     reasignar en la edición, restringido a Jefe/SysAdmin.
//
// Hallazgo MEDIO — no se verificaba que el cliente convocante estuviera activo.
//   - createLicitacion / updateLicitacion ahora reutilizan
//     clienteLinkGuard.verificarCliente (el mismo control que ya existía para
//     cotizaciones) para bloquear un id_cliente inexistente o desactivado.
//   - Una edición que NO cambia el id_cliente no se bloquea aunque ese cliente
//     se haya desactivado después de asignado (mismo criterio que cotizaciones).
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

jest.setTimeout(30000);

const PASSWORD = 'TestLicRC01!';

const USERS = {
  jefe:       { username: 'test_lic_jefe',   id_rol: 3, nombre: 'Test Jefe LICRC' },
  proyectos1: { username: 'test_lic_proy1',  id_rol: 5, nombre: 'Test Proyectos LICRC Uno' },
  proyectos2: { username: 'test_lic_proy2',  id_rol: 5, nombre: 'Test Proyectos LICRC Dos' },
  ejecutivo:  { username: 'test_lic_ejec',   id_rol: 1, nombre: 'Test Ejecutivo LICRC' },
};

const CLIENTE_ACTIVO   = 'Test Cliente LICRC Activo';
const CLIENTE_INACTIVO = 'Test Cliente LICRC Inactivo';

let ids = {};       // username -> user id
let tokenJefe;
let tokenProyectos1;
let clienteActivoId;
let clienteInactivoId;
const licitacionesCreadas = [];
const clientesTemporales  = [];

async function crearUsuario({ username, id_rol, nombre }) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [res] = await pool.execute(
    `INSERT INTO usuarios (nombre_completo, nombre_usuario, password_hash, id_rol, activo)
     VALUES (?, ?, ?, ?, 1)`,
    [nombre, username, hash, id_rol]
  );
  return res.insertId;
}

async function login(username) {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ nombre_usuario: username, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data.token;
}

beforeAll(async () => {
  // Limpieza de una corrida previa que haya fallado a mitad de camino.
  await pool.execute(
    `DELETE FROM licitaciones WHERE nombre LIKE 'Test Licitacion LICRC%'`
  );
  for (const u of Object.values(USERS)) {
    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [u.username]);
  }
  await pool.execute('DELETE FROM clientes WHERE razon_social IN (?, ?)', [CLIENTE_ACTIVO, CLIENTE_INACTIVO]);

  for (const [key, u] of Object.entries(USERS)) {
    ids[key] = await crearUsuario(u);
  }

  const [c1] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 1)', [CLIENTE_ACTIVO]);
  clienteActivoId = c1.insertId;
  const [c2] = await pool.execute('INSERT INTO clientes (razon_social, activo) VALUES (?, 0)', [CLIENTE_INACTIVO]);
  clienteInactivoId = c2.insertId;

  tokenJefe       = await login(USERS.jefe.username);
  tokenProyectos1 = await login(USERS.proyectos1.username);
});

afterAll(async () => {
  // Las licitaciones primero: un cliente temporal referenciado por una FK
  // todavía viva no se puede borrar (fk_lic_cliente ON DELETE RESTRICT).
  for (const licId of licitacionesCreadas) {
    await pool.execute('DELETE FROM licitaciones WHERE id = ?', [licId]);
  }
  for (const u of Object.values(USERS)) {
    await pool.execute('DELETE FROM usuarios WHERE nombre_usuario = ?', [u.username]);
  }
  await pool.execute('DELETE FROM clientes WHERE id IN (?, ?)', [clienteActivoId ?? 0, clienteInactivoId ?? 0]);
  for (const clienteId of clientesTemporales) {
    await pool.execute('DELETE FROM clientes WHERE id = ?', [clienteId]);
  }
  await pool.end();
});

const bodyBase = (overrides = {}) => ({
  nombre:     'Test Licitacion LICRC ' + Date.now() + Math.random(),
  id_cliente: clienteActivoId,
  ...overrides,
});

describe('LICRC — id_responsable valida el rol y se puede reasignar', () => {

  test('LICRC-01: crear con id_responsable de rol incorrecto (Ejecutivo) → 422', async () => {
    const res = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_responsable: ids.ejecutivo }));

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  test('LICRC-02: crear con id_responsable de rol correcto (Proyectos) → 201', async () => {
    const res = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_responsable: ids.proyectos1 }));

    expect(res.status).toBe(201);
    licitacionesCreadas.push(res.body.data.id);
    expect(res.body.data.id_responsable).toBe(ids.proyectos1);
  });

  test('LICRC-03: editar reasignando a un id_responsable válido (Jefe) → 200', async () => {
    const created = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_responsable: ids.proyectos1 }));
    expect(created.status).toBe(201);
    const licId = created.body.data.id;
    licitacionesCreadas.push(licId);

    const res = await request(app)
      .put(`/api/licitaciones/${licId}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({
        nombre:         created.body.data.nombre,
        id_cliente:     clienteActivoId,
        id_responsable: ids.proyectos2,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.id_responsable).toBe(ids.proyectos2);
  });

  test('LICRC-04: editar reasignando a un id_responsable de rol incorrecto → 422', async () => {
    const created = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_responsable: ids.proyectos1 }));
    expect(created.status).toBe(201);
    const licId = created.body.data.id;
    licitacionesCreadas.push(licId);

    const res = await request(app)
      .put(`/api/licitaciones/${licId}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({
        nombre:         created.body.data.nombre,
        id_cliente:     clienteActivoId,
        id_responsable: ids.ejecutivo,
      });

    expect(res.status).toBe(422);

    // El responsable original no debe haber cambiado.
    const [rows] = await pool.execute('SELECT id_responsable FROM licitaciones WHERE id = ?', [licId]);
    expect(rows[0].id_responsable).toBe(ids.proyectos1);
  });

  test('LICRC-05: un Proyectos (no Jefe/SysAdmin) NO puede reasignar el responsable → 403', async () => {
    const created = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenProyectos1}`)
      .send(bodyBase());
    expect(created.status).toBe(201);
    const licId = created.body.data.id;
    licitacionesCreadas.push(licId);
    expect(created.body.data.id_responsable).toBe(ids.proyectos1);

    const res = await request(app)
      .put(`/api/licitaciones/${licId}`)
      .set('Authorization', `Bearer ${tokenProyectos1}`)
      .send({
        nombre:         created.body.data.nombre,
        id_cliente:     clienteActivoId,
        id_responsable: ids.proyectos2,
      });

    expect(res.status).toBe(403);
  });
});

describe('LICRC — el cliente convocante debe existir y estar activo', () => {

  test('LICRC-06: crear con id_cliente desactivado → 422', async () => {
    const res = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_cliente: clienteInactivoId, id_responsable: ids.proyectos1 }));

    expect(res.status).toBe(422);
  });

  test('LICRC-07: editar CAMBIANDO el cliente hacia uno desactivado → 422', async () => {
    const created = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_responsable: ids.proyectos1 }));
    expect(created.status).toBe(201);
    const licId = created.body.data.id;
    licitacionesCreadas.push(licId);

    const res = await request(app)
      .put(`/api/licitaciones/${licId}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({
        nombre:     created.body.data.nombre,
        id_cliente: clienteInactivoId,
      });

    expect(res.status).toBe(422);
  });

  test('LICRC-08: editar SIN cambiar el cliente no se bloquea aunque ese cliente se desactive después', async () => {
    const [clienteTemp] = await pool.execute(
      'INSERT INTO clientes (razon_social, activo) VALUES (?, 1)',
      ['Test Cliente LICRC Temporal ' + Date.now()]
    );
    const clienteTempId = clienteTemp.insertId;
    clientesTemporales.push(clienteTempId);

    const created = await request(app)
      .post('/api/licitaciones')
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send(bodyBase({ id_cliente: clienteTempId, id_responsable: ids.proyectos1 }));
    expect(created.status).toBe(201);
    const licId = created.body.data.id;
    licitacionesCreadas.push(licId);

    // El cliente se desactiva DESPUÉS de asignarlo — eso ya estaba así antes.
    await pool.execute('UPDATE clientes SET activo = 0 WHERE id = ?', [clienteTempId]);

    const res = await request(app)
      .put(`/api/licitaciones/${licId}`)
      .set('Authorization', `Bearer ${tokenJefe}`)
      .send({
        nombre:     'Test Licitacion LICRC renombrada ' + Date.now(),
        id_cliente: clienteTempId, // el MISMO cliente, no está cambiando
      });

    expect(res.status).toBe(200);
    // La limpieza del cliente temporal queda para afterAll, después de borrar
    // la licitación que todavía lo referencia (fk_lic_cliente RESTRICT).
  });
});
