// =============================================================================
// tests/unit/expressComportamiento.test.js
// Los comportamientos de Express en los que se apoya la aplicación.
//
// POR QUÉ EXISTE
// Se escribió al pasar de Express 4 a Express 5 (2026-09-06). Ese salto cambia
// tres cosas que NO hacen fallar nada al arrancar: la aplicación levanta igual,
// no hay error en los registros, y el problema sólo aparece cuando un usuario
// hace la petición justa.
//
// Antes de aplicarlo se revisó el código a mano y ninguna de las tres mordía.
// Esto deja esa revisión hecha, para que nadie tenga que repetirla de memoria.
//
// CÓMO SE PRUEBA
// Igual que tests/unit/cabecerasSeguridad.test.js: se levanta un Express mínimo
// y se le hacen peticiones reales. No se lee la configuración — se mide lo que
// hace el servidor.
// =============================================================================

'use strict';

const express = require('express');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');

/** Levanta una app, le hace una petición y devuelve status + cuerpo. */
function pedir(montar, ruta) {
  return new Promise((resolve, reject) => {
    const app = express();
    montar(app);

    const srv = app.listen(0, () => {
      const { port } = srv.address();
      http.get({ host: '127.0.0.1', port, path: ruta }, (res) => {
        let cuerpo = '';
        res.on('data', (d) => { cuerpo += d; });
        res.on('end', () => { srv.close(); resolve({ status: res.statusCode, cuerpo }); });
      }).on('error', (e) => { srv.close(); reject(e); });
    });
    srv.on('error', reject);
  });
}

describe('la versión mayor de Express', () => {
  test('es la 5, que es la que asumen las pruebas de este archivo', () => {
    // Las tres comprobaciones de abajo describen el comportamiento de Express 5.
    // Si alguien volviera a la 4, seguirían pasando pero ya no significarían lo
    // mismo — sobre todo la de los errores en funciones async, que en la 4
    // simplemente no ocurre.
    const mayor = Number(require('express/package.json').version.split('.')[0]);
    expect(mayor).toBe(5);
  });
});

describe('un error dentro de una función async llega al manejador de errores', () => {
  // ESTE ES EL CAMBIO QUE MÁS IMPORTA.
  //
  // En Express 4, si una ruta `async` lanzaba y nadie la envolvía en try/catch,
  // la promesa quedaba rechazada sin dueño: el manejador global NUNCA se
  // enteraba y la petición se quedaba colgada hasta que el navegador se cansaba.
  // El usuario veía una rueda girando para siempre, sin mensaje.
  //
  // Express 5 las reenvía al manejador de errores. Eso convierte un cuelgue en
  // un 500 con cuerpo JSON, que es lo que el frontend sabe mostrar.
  //
  // Los controladores de este proyecto tienen su try/catch, así que no se
  // depende de esto para funcionar — pero sí es la red que atrapa el día que
  // alguien escriba una ruta async y se olvide del try.
  test('devuelve 500 con JSON en vez de dejar la petición colgada', async () => {
    const r = await pedir((app) => {
      app.get('/explota', async () => { throw new Error('fallo a proposito'); });
      // eslint-disable-next-line no-unused-vars
      app.use((err, req, res, next) => {
        res.status(500).json({ success: false, message: 'error interno' });
      });
    }, '/explota');

    if (r.status !== 500) {
      throw new Error(
        `Se esperaba 500 y llegó ${r.status}.\n\n` +
        'Un error dentro de una ruta async dejó de llegar al manejador global. ' +
        'Eso significa que ese tipo de fallo ya no responde nada: la petición se ' +
        'cuelga y el usuario ve la pantalla cargando para siempre, sin mensaje ' +
        'ni error visible en el servidor.\n\n' +
        'Suele pasar por volver a Express 4, donde este reenvío no existe.'
      );
    }
    expect(JSON.parse(r.cuerpo).success).toBe(false);
  });
});

describe('los parámetros de la URL se leen como los espera el código', () => {
  // Express 5 cambió el intérprete por defecto de `extended` (qs) a `simple`
  // (el de Node). La diferencia sólo se nota con parámetros de lista o
  // anidados: `?ids[]=1&ids[]=2` deja de dar un arreglo.
  //
  // Hoy la aplicación lee SÓLO parámetros planos (estado, page, limit, q…), y
  // por eso el cambio no la afecta. Se comprueba que siga siendo así.
  test('un parámetro plano llega como texto', async () => {
    const r = await pedir((app) => {
      app.get('/x', (req, res) => res.json({ v: req.query.estado }));
    }, '/x?estado=Pendiente');
    expect(JSON.parse(r.cuerpo).v).toBe('Pendiente');
  });

  test('el código no lee parámetros anidados ni de lista', () => {
    // Si alguien empieza a necesitarlos, tiene que declarar el intérprete a
    // mano en src/app.js  (app.set('query parser', 'extended'))  o el valor
    // llegará como una cadena rara y la consulta fallará sin decir por qué.
    const RAIZ = path.resolve(__dirname, '../../src');
    const sospechosos = [];

    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { recorrer(p); continue; }
        if (!e.name.endsWith('.js')) continue;

        const src = fs.readFileSync(p, 'utf8');
        // req.query.algo[...]  o  req.query['algo[b]']
        const re = /req\.query(\.[a-zA-Z_][\w]*\s*\[|\s*\[\s*['"`][^'"`]*\[)/g;
        if (re.test(src)) sospechosos.push(path.relative(RAIZ, p));
      }
    };
    recorrer(RAIZ);

    if (sospechosos.length) {
      throw new Error(
        'Hay código leyendo parámetros de URL anidados o de lista en:\n  ' +
        sospechosos.join('\n  ') + '\n\n' +
        'Express 5 usa el intérprete `simple` por defecto y no los arma: el ' +
        'valor llega como una cadena literal y la consulta falla sin error claro.\n\n' +
        "Arreglo: agregar  app.set('query parser', 'extended')  en src/app.js."
      );
    }
  });
});

describe('los formularios con campos anidados se siguen interpretando', () => {
  test('src/app.js declara extended: true de forma explícita', () => {
    // En Express 4 `extended` valía true por defecto; en la 5 vale false. La
    // aplicación lo pone explícito, así que el cambio no la tocó — pero si
    // alguien "limpia" ese parámetro por considerarlo redundante, los cuerpos
    // de formulario con campos anidados dejan de armarse en silencio.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/app.js'), 'utf8');

    const m = src.match(/express\.urlencoded\(\s*\{([^}]*)\}/);
    if (!m) {
      throw new Error('No se encontró express.urlencoded({...}) en src/app.js.');
    }
    if (!/extended\s*:\s*true/.test(m[1])) {
      throw new Error(
        `express.urlencoded quedó como «{${m[1].trim()}}».\n\n` +
        'Sin `extended: true` explícito, Express 5 usa false y los campos de ' +
        'formulario anidados llegan sin armar. No hay error: los datos ' +
        'simplemente no están.'
      );
    }
  });
});
