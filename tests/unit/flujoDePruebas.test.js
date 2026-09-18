// =============================================================================
// tests/unit/flujoDePruebas.test.js
// Las pruebas de GitHub corren con las mismas versiones que producción.
//
// POR QUÉ EXISTE
// .github/workflows/pruebas.yml levanta Node y MySQL para correr la suite. Su
// valor depende de que sean LOS MISMOS que corren en el servidor: si mañana el
// Dockerfile pasa a Node 22 y el flujo sigue en 20, las pruebas quedarían en
// verde probando una versión que ya nadie usa, y el día que algo se rompa por la
// versión nueva, nada lo va a avisar.
//
// Las dos fuentes de verdad son las del despliegue: el FROM del Dockerfile y la
// imagen del servicio db en docker-compose.yml. El flujo las tiene que copiar.
//
// Se lee el YAML con expresiones regulares y no con una librería: son cuatro
// datos puntuales, y sumar una dependencia para esto no se justifica.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const flujo      = leer('.github/workflows/pruebas.yml');
const dockerfile = leer('Dockerfile');
const compose    = leer('docker-compose.yml');

describe('el flujo de pruebas de GitHub', () => {
  test('usa la misma versión de Node que el Dockerfile', () => {
    const produccion = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]);
    const enFlujo    = /node-version:\s*'?(\d+)/.exec(flujo)?.[1];

    // Las dos etapas del Dockerfile tienen que coincidir entre sí, además.
    expect(new Set(produccion).size).toBe(1);
    expect(enFlujo).toBe(produccion[0]);
  });

  test('usa la misma imagen de MySQL que docker-compose.yml', () => {
    const produccion = /image:\s*(mysql:[\w.]+)/.exec(compose)?.[1];
    const enFlujo    = /image:\s*(mysql:[\w.]+)/.exec(flujo)?.[1];

    expect(produccion).toBeDefined();
    expect(enFlujo).toBe(produccion);
  });

  test('usa el mismo método de autenticación de MySQL que producción', () => {
    // docker-compose arranca MySQL con mysql_native_password; si eso cambia,
    // el paso del flujo que lo imita tiene que cambiar con él.
    expect(compose).toMatch(/mysql_native_password/);
    expect(flujo).toMatch(/IDENTIFIED WITH mysql_native_password/);
  });

  test('corre en cada push a main y en cada PR contra main', () => {
    expect(flujo).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(flujo).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  test('corre la suite completa y la revisión de estilo', () => {
    // `npm test` y no `jest` directo: así corre `pretest`, que crea la base.
    expect(flujo).toMatch(/run:\s*npm test\s*$/m);
    expect(flujo).toMatch(/run:\s*npm run lint\s*$/m);
  });

  test('la base de prueba no se llama igual que la real', () => {
    // init.js aborta si coinciden; esto lo dice antes de llegar a GitHub.
    const nombre = /DB_NAME:\s*(\S+)/.exec(flujo)?.[1];
    const test   = /DB_NAME_TEST:\s*(\S+)/.exec(flujo)?.[1];
    expect(test).toBeDefined();
    expect(test).not.toBe(nombre);
  });
});
