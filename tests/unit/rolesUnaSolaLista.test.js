// =============================================================================
// tests/unit/rolesUnaSolaLista.test.js
// Los roles del sistema se escriben en un solo lugar — y ese lugar coincide con
// la base de datos.
//
// EL PROBLEMA MEDIDO
// Los cinco nombres de rol estaban escritos a mano 168 veces en 37 archivos. Con
// esa cantidad de copias ya habían aparecido dos que no coinciden con ninguna:
//
//   auditView.js  id_rol: { 1: 'Ejecutivo', 2: 'Administración', 3: 'Jefe', 4: 'SysAdmin' }
//
// Ahí hay DOS bugs, y ninguno da error:
//
//   • falta 'Proyectos', que es el id 5. Ese rol se agregó después y el mapa no
//     se actualizó. La bitácora —el registro de quién le dio qué permiso a
//     quién— muestra un «5» pelado donde debería decir el nombre del rol. Quien
//     audita quién habilitó el módulo de licitaciones ve un número que tiene
//     que ir a buscar a otro lado.
//
//   • 'Administración' lleva tilde, y en la base es 'Administracion' sin tilde.
//     La bitácora contradice al resto de la interfaz.
//
// POR QUÉ UN NOMBRE MAL ESCRITO NO SE NOTA
// Porque una comparación de rol que no coincide no explota: devuelve false. El
// permiso simplemente no se da, o se da de más, y el sistema sigue andando. Es
// la peor forma de fallar que hay — sin síntoma.
//
// QUÉ FIJA ESTE ARCHIVO
// Tres cosas que tienen que decir lo mismo: la constante del servidor, la del
// navegador, y el INSERT de la tabla `roles` en sql/init.sql. Esa última es la
// que importa: es la única de las tres que manda de verdad.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { ROLES, NOMBRES_DE_ROL, nombreDeRol } = require('../../src/config/roles');

import { ROLES as ROLES_FRONT, nombreDeRol as nombreDeRolFront } from '../../public/js/shared/roles.js';

const RAIZ = path.resolve(__dirname, '../..');

/**
 * Los roles tal como los siembra la base: se leen del INSERT de sql/init.sql.
 *
 * Se parsea el archivo en lugar de consultar MySQL a propósito: este test es
 * unitario y tiene que correr sin base levantada. Y el .sql es igual de
 * autoritativo — es lo que se ejecuta para crearla.
 */
function rolesDelSql() {
  const sql = fs.readFileSync(path.join(RAIZ, 'sql/init.sql'), 'utf8');

  const desde = sql.indexOf('INSERT INTO roles');
  expect(desde).toBeGreaterThan(-1);

  // El corte NO puede ser el primer ';': las descripciones lo llevan adentro
  // ('Sales executive; registers quotations'), asi que cortar ahi dejaba UNA
  // sola fila y el test decia que la base tenia un rol. Se corta en la
  // secuencia comilla-parentesis-punto y coma, que solo aparece al final.
  const hasta = sql.indexOf("');", desde) + 3;
  const bloque = sql.slice(desde, hasta);

  // Cada fila es  (1, 'Ejecutivo', '...')  — se toma el id y el nombre.
  const filas = [...bloque.matchAll(/\(\s*(\d+)\s*,\s*'([^']+)'/g)];
  return filas.map(([, id, nombre]) => ({ id: Number(id), nombre }));
}

// ---------------------------------------------------------------------------
describe('la constante del servidor coincide con la base', () => {
  const delSql = rolesDelSql();

  test('el .sql tiene los cinco roles', () => {
    // Si este número cambia, es porque se agregó o sacó un rol — y entonces hay
    // que mirar los dos tests de abajo, que van a estar rojos.
    expect(delSql.length).toBe(5);
  });

  test('mismos ids y mismos nombres, en el mismo orden', () => {
    expect(ROLES).toEqual(delSql);
  });

  test('los nombres no llevan tilde, como en la base', () => {
    // 'Administración' con tilde fue uno de los dos errores que dispararon este
    // archivo. Una comparación contra el nombre con tilde nunca coincide.
    for (const { nombre } of ROLES) {
      expect(nombre.normalize('NFD')).toBe(nombre);
    }
  });
});

// ---------------------------------------------------------------------------
describe('el navegador dice lo mismo que el servidor', () => {
  // Copia deliberada: el servidor es CommonJS y el navegador módulos nativos, y
  // no hay paso de compilación que pueda compartir un archivo. Lo que sí se
  // puede es exigir que no se separen — igual que con las transiciones y con la
  // matemática del dinero.
  test('mismos roles', () => {
    expect(ROLES_FRONT).toEqual(ROLES);
  });

  test('traducen el id igual', () => {
    for (const { id } of ROLES) {
      expect(nombreDeRolFront(id)).toBe(nombreDeRol(id));
    }
  });
});

// ---------------------------------------------------------------------------
describe('traducir un id a un nombre', () => {
  test('devuelve el nombre de cada rol', () => {
    expect(nombreDeRol(1)).toBe('Ejecutivo');
    expect(nombreDeRol(2)).toBe('Administracion');
    expect(nombreDeRol(3)).toBe('Jefe');
    expect(nombreDeRol(4)).toBe('SysAdmin');
  });

  test('conoce Proyectos, que es el que faltaba', () => {
    // El bug concreto: el mapa de la bitácora llegaba hasta el 4.
    expect(nombreDeRol(5)).toBe('Proyectos');
  });

  test('acepta el id como texto, que es como llega del JSON', () => {
    // Las claves de un objeto JSON son cadenas, así que el detalle de la
    // bitácora trae '5' y no 5. Comparar con === contra un número no coincide.
    expect(nombreDeRol('5')).toBe('Proyectos');
  });

  test('un id desconocido se muestra tal cual y no como «undefined»', () => {
    // Si mañana aparece un rol 6 antes de que esta lista se actualice, la
    // bitácora tiene que mostrar algo legible. «undefined» en la pantalla es
    // peor que el número: parece que el sistema se rompió.
    expect(nombreDeRol(99)).toBe('99');
    expect(nombreDeRol(null)).toBe('—');
    expect(nombreDeRol(undefined)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
describe('nadie vuelve a escribir el mapa de ids a mano', () => {
  function listarJs(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
    });
  }

  test('no queda ningún objeto que traduzca ids de rol por su cuenta', () => {
    const archivos = [
      ...listarJs(path.join(RAIZ, 'src')),
      ...listarJs(path.join(RAIZ, 'public/js')),
    ].filter((f) => !f.endsWith(path.join('config', 'roles.js'))
                 && !f.endsWith(path.join('shared', 'roles.js')));

    // El patrón exacto que había: un literal que arranca mapeando el 1 al
    // Ejecutivo. No se busca cualquier mención de un rol —eso son 168 y la
    // mayoría son comparaciones legítimas— sino la TABLA de traducción
    // duplicada, que es la que se desactualiza sin avisar.
    const culpables = archivos.filter((f) =>
      /1:\s*'Ejecutivo'/.test(fs.readFileSync(f, 'utf8'))
    );

    expect(culpables.map((f) => path.relative(RAIZ, f))).toEqual([]);
  });
});
