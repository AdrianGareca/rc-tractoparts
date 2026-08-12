// =============================================================================
// tests/unit/estadosVenta.test.js
// «Qué cuenta como venta» se responde en un solo lugar.
//
// EL PROBLEMA MEDIDO
// La pregunta estaba respondida CUATRO veces, distinto, en tres archivos:
//
//   LicitacionModel (total comprometido)  Aprobada internamente, Enviada al
//                                         cliente, Confirmada, Aceptada
//   analyticsRepository (top clientes)    Confirmada, Aceptada, Enviada al cliente
//   analyticsRepository (leaderboard)     Confirmada, Aceptada
//
// Consecuencia concreta: el MISMO cliente, en el MISMO mes, aparecía con dos
// cifras distintas según qué pantalla se abriera. No es un detalle técnico —
// es que dos reportes de la misma empresa se contradecían, y no había forma de
// saber cuál era el bueno sin leer SQL.
//
// LA DECISIÓN, TOMADA CON EL ÁREA COMERCIAL
// Venta es lo que el cliente CONFIRMÓ. Nada más.
//
// Una cotización enviada al cliente es esfuerzo comercial, no ingreso: todavía
// puede rechazarse. Una aprobada internamente ni siquiera salió de la empresa.
// Contarlas como venta infla los números con plata que no entró.
//
// Este archivo la fija para que no vuelva a divergir.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { ESTADOS_VENTA, ESTADOS_DECIDIDOS, marcadoresDe } = require('../../src/models/quotation/constants');

const RAIZ = path.resolve(__dirname, '../../src');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}
const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

/** Delimitadores de una lista: corchete o parentesis, de apertura y cierre. */
const Q1 = String.fromCharCode(91);   // [
const Q2 = String.fromCharCode(40);   // (
const Q3 = String.fromCharCode(93);   // ]
const Q4 = String.fromCharCode(41);   // )

// ---------------------------------------------------------------------------
describe('la definición de venta', () => {
  test('es exactamente Confirmada y su alias histórico', () => {
    // Si alguien la amplía, este test lo obliga a venir acá y leer por qué es
    // así — en vez de agregar un estado a un IN de SQL sin que nadie se entere.
    expect(ESTADOS_VENTA).toEqual(['Confirmada', 'Aceptada']);
  });

  test('NO incluye lo que todavía puede rechazarse', () => {
    expect(ESTADOS_VENTA).not.toContain('Enviada al cliente');
    expect(ESTADOS_VENTA).not.toContain('Aprobada internamente');
  });

  test('«decididos» es otra cosa y no se unifica con «venta»', () => {
    // Uno cuenta lo GANADO, el otro lo RESUELTO. El segundo es el denominador
    // de la conversión: sin el rechazo adentro, la tasa daría siempre 100%.
    expect(ESTADOS_DECIDIDOS).toContain('Rechazada');
    expect(ESTADOS_VENTA).not.toContain('Rechazada');
  });

  test('los marcadores coinciden con la cantidad de estados', () => {
    // Un marcador de más o de menos desalinea TODOS los parámetros que siguen
    // en la consulta, y MySQL filtra por el valor equivocado sin dar error.
    expect(marcadoresDe(ESTADOS_VENTA)).toBe('?, ?');
    expect(marcadoresDe(ESTADOS_DECIDIDOS)).toBe('?, ?, ?');
    expect(marcadoresDe([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('nadie vuelve a escribir la lista a mano', () => {
  // Las combinaciones exactas que estaban repartidas por el SQL. Si alguna
  // reaparece, es que alguien respondió la pregunta por su cuenta otra vez.
  const COMBINACIONES = [
    "'Aprobada internamente', 'Enviada al cliente', 'Confirmada', 'Aceptada'",
    "'Confirmada', 'Aceptada', 'Enviada al cliente'",
    "'Confirmada', 'Aceptada'",
  ];

  test.each(COMBINACIONES)('«%s» no aparece escrita en SQL', (combo) => {
    const culpables = [];

    for (const f of archivos) {
      // El propio archivo de constantes las NOMBRA para explicar de dónde
      // salieron; exigir que no aparezcan volvería imposible documentarlo.
      if (rel(f) === 'models/quotation/constants.js') continue;

      // HITOS_LICITACION NO es duplicacion, aunque hoy tenga los mismos valores.
      // Responde otra pregunta: que cambios de estado vale la pena AVISARLE al
      // responsable del concurso. Si manana el negocio decide que «Enviada al
      // cliente» no cuenta como venta, eso NO significa dejar de avisar cuando
      // una cotizacion sale al cliente — al reves, es justo cuando Proyectos
      // necesita enterarse. Dos listas iguales hoy que cambian por razones
      // distintas: unificarlas ataria dos decisiones que deben ser libres.
      if (rel(f) === 'controllers/quotation/stateTransitionEffects.js') continue;

      fs.readFileSync(f, 'utf8').split(String.fromCharCode(10)).forEach((linea, i) => {
        const t = linea.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        // Se exige la lista COMPLETA, no una subcadena. ESTADOS_EN_LA_CANCHA
        // contiene «Confirmada, Aceptada» entre sus cuatro elementos y es otra
        // cosa: el denominador de la conversion, que incluye el rechazo.
        // Buscar subcadena la acusaba de duplicar algo que no duplica.
        //
        // Se compara con operaciones de cadena y no con una expresion regular:
        // la lista trae comillas y parentesis, y escaparla correctamente a
        // traves de las capas de escritura ya fallo dos veces.
        const pos = linea.indexOf(combo);
        if (pos > 0) {
          const antes   = linea[pos - 1];
          const despues = linea[pos + combo.length];
          const esListaEntera = (antes === Q1 || antes === Q2) &&
                                (despues === Q3 || despues === Q4);
          if (esListaEntera) culpables.push(rel(f) + ":" + (i + 1));
        }
      });
    }

    if (culpables.length > 0) {
      throw new Error(
        `Esta lista de estados sigue escrita a mano en:\n  ${culpables.join('\n  ')}\n\n` +
        'Usá ESTADOS_VENTA de models/quotation/constants.js con marcadoresDe(). ' +
        'Las cuatro copias que había respondían distinto la misma pregunta, y el ' +
        'mismo cliente aparecía con dos cifras según qué pantalla se abriera.'
      );
    }
  });
});
