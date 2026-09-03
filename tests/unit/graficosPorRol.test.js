// =============================================================================
// tests/unit/graficosPorRol.test.js
// Los gráficos llegan a TODOS los roles que miran reportes, no sólo al
// Ejecutivo.
//
// POR QUÉ EXISTE
// Adrián lo notó mirando la aplicación: «la admin y el jefe ven las métricas?
// parece que solo lo ven los demás usuarios». Tenía razón, y el motivo era
// estructural, no un olvido puntual.
//
// El tablero se arma con una estrategia por rol, y los reportes tienen DOS
// caminos distintos que no comparten código:
//
//   Ejecutivo              → renderExecutiveMetrics → renderMisMetricas
//   Jefe / Administración  → renderReportes
//
// Los gráficos se agregaron primero en el camino del Ejecutivo. Los dos roles
// que más miran tendencias —los que deciden— se quedaron con tablas, y nada
// falla: las dos pantallas funcionan perfecto, sólo que una tiene gráficos y la
// otra no. Es el tipo de hueco que se descubre por casualidad.
//
// Este archivo lo vuelve imposible de repetir en silencio: cada pantalla de
// reportes tiene que montar al menos un gráfico.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../..');
const MODULOS    = path.join(RAIZ, 'public/js/views/dashboard/modules');
const ESTRATEGIAS = path.join(RAIZ, 'public/js/views/dashboard/strategies');

const leer = (p) => fs.readFileSync(p, 'utf8');

const REPORTES    = leer(path.join(MODULOS, 'reportesView.js'));
const MIS_METRICAS = leer(path.join(MODULOS, 'misMetricas.js'));

describe('cada pantalla de reportes dibuja algo', () => {
  // Las dos funciones de entrada, con el rol que llega a cada una.
  const PANTALLAS = [
    ['renderReportes',          'Jefe y Administración'],
    ['renderExecutiveMetrics',  'Ejecutivo'],
  ];

  test.each(PANTALLAS)('%s (%s) existe', (fn) => {
    expect(REPORTES).toContain(`function ${fn}(`);
  });

  test('renderReportes monta gráficos propios', () => {
    // Se comprueba que la LLAMADA esté, no sólo que la función exista: una
    // función de montaje que nadie invoca es exactamente el fallo silencioso
    // que este archivo previene.
    expect(REPORTES).toMatch(/montarGraficosReportes\s*\(/);

    // Se EXCLUYE la declaración de la función. Contarla junto con las llamadas
    // hacía que una sola llamada diera 2 y el test pasara igual — es decir, no
    // detectaba el caso de que faltara en uno de los dos repintados, que es
    // justo el que este bloque viene a cubrir.
    const llamadas = (REPORTES.match(/(?<!function\s)montarGraficosReportes\s*\(\s*dataEl/g) || []).length;
    if (llamadas < 2) {
      throw new Error(
        `El reporte de Jefe/Administración se repinta en DOS lugares (la carga ` +
        `inicial y el cambio de moneda) y montarGraficosReportes se llama ` +
        `${llamadas} vez/veces.\n\n` +
        'Si falta en uno, los gráficos desaparecen al cambiar de moneda y no ' +
        'vuelven hasta recargar la página — sin ningún error.'
      );
    }
  });

  test('renderExecutiveMetrics monta los gráficos del ejecutivo', () => {
    expect(REPORTES).toMatch(/renderMisMetricas\s*\(/);
    expect(MIS_METRICAS).toMatch(/montarGraficos\s*\(el,/);
  });

  test('las dos pantallas usan el MISMO módulo de gráficos', () => {
    // Dos implementaciones distintas se desincronizan: se arregla un bug en una
    // y la otra se queda con él.
    const desdeReportes = /from ['"][^'"]*shared\/graficos\.js['"]/.test(REPORTES);
    const desdeMetricas = /from ['"][^'"]*shared\/graficos\.js['"]/.test(MIS_METRICAS);
    expect(desdeReportes).toBe(true);
    expect(desdeMetricas).toBe(true);
  });
});

describe('los roles que tienen pestaña de Reportes llegan a los gráficos', () => {
  const ESPERADOS = ['adminStrategy.js', 'managerStrategy.js'];

  test.each(ESPERADOS)('%s abre la pestaña de reportes', (archivo) => {
    const src = leer(path.join(ESTRATEGIAS, archivo));
    expect(src).toMatch(/data-tab="reportes"/);
    expect(src).toMatch(/renderReportes/);
  });

  test('ninguna estrategia con pestaña de reportes se quedó sin gráficos', () => {
    const archivos = fs.readdirSync(ESTRATEGIAS).filter((f) => f.endsWith('.js'));
    const sinGraficos = [];

    for (const archivo of archivos) {
      const src = leer(path.join(ESTRATEGIAS, archivo));
      if (!/data-tab="reportes"/.test(src)) continue;

      // La estrategia delega en una de las dos funciones de reportesView, y las
      // dos montan gráficos. Si apareciera una tercera vía, cae acá.
      const delega = /renderReportes|renderExecutiveMetrics|renderAdvancedReports/.test(src);
      if (!delega) sinGraficos.push(archivo);
    }

    if (sinGraficos.length) {
      throw new Error(
        'Estas estrategias muestran una pestaña de Reportes pero no delegan en ' +
        'reportesView:\n  ' + sinGraficos.join('\n  ') +
        '\n\nSu reporte no va a tener gráficos, y nada va a fallar: la pantalla ' +
        'funciona, sólo que ese rol ve menos que los demás.'
      );
    }
  });
});

describe('el gráfico no se lleva puesta la pantalla si falla', () => {
  test.each([
    ['reportesView.js',  REPORTES,     'montarGraficosReportes'],
    ['misMetricas.js',   MIS_METRICAS, 'montarGraficos'],
  ])('%s envuelve el montaje en try/catch', (archivo, src, fn) => {
    const i = src.indexOf(`function ${fn}(`);
    expect(i).toBeGreaterThan(-1);

    const cuerpo = src.slice(i, i + 2600);
    if (!/try\s*\{/.test(cuerpo) || !/catch\s*\(/.test(cuerpo)) {
      throw new Error(
        `${archivo}: ${fn} no está protegida.\n\n` +
        'Un gráfico es un agregado. Si el dibujado lanza, quien entró a ver sus ' +
        'números se queda sin ellos — que es peor que no tener el gráfico.'
      );
    }
  });
});
