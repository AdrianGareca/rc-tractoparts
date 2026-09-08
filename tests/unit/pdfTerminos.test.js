// =============================================================================
// tests/unit/pdfTerminos.test.js
// El TEXTO de las Condiciones Generales que salen impresas al cliente.
//
// POR QUÉ EXISTE
// Esto no es contenido de la aplicación: es texto legal redactado por la
// abogada de la empresa, y es lo que obliga a RC Tractoparts frente a quien
// recibe la proforma. Un cambio acá no rompe nada, no falla ningún otro test y
// no se nota mirando la pantalla — pero cambia a qué se compromete la empresa.
//
// La huella de más abajo existe para que ese cambio TENGA que ser deliberado.
// Si alguien edita una coma, esta prueba se pone en rojo y obliga a decir «sí,
// esto lo aprobó la abogada» actualizando la huella a mano. Es una molestia a
// propósito.
// =============================================================================

'use strict';

const crypto = require('crypto');
const {
  CLAUSULAS, TITULO_TERMINOS, MARCADOR_EMISOR, textoClausula,
} = require('../../src/services/pdf/terminos');

// Huella del texto aprobado el 2026-09-08, tal como lo entregó la abogada.
//
// PARA ACTUALIZARLA: sólo después de que el cambio esté aprobado. Corré
//   node -e "const{CLAUSULAS}=require('./src/services/pdf/terminos');console.log(require('crypto').createHash('sha256').update(CLAUSULAS.map(c=>c.join('|')).join('\n')).digest('hex'))"
// y pegá el resultado acá.
const HUELLA_APROBADA =
  '9ba75d08bbbc5cfc21f1d5a0d75ea536307c392fd752692088cbdf7ef84b9f68';

const huellaActual = () => crypto
  .createHash('sha256')
  .update(CLAUSULAS.map((c) => c.join('|')).join('\n'))
  .digest('hex');

describe('el texto legal no cambia sin que alguien lo decida', () => {
  test('son exactamente 24 cláusulas', () => {
    expect(CLAUSULAS).toHaveLength(24);
  });

  test('el texto coincide con el aprobado por la abogada', () => {
    if (huellaActual() !== HUELLA_APROBADA) {
      throw new Error(
        'El texto de las Condiciones Generales cambió.\n\n' +
        'Esto es lo que la empresa se compromete a cumplir frente al cliente, y ' +
        'sale impreso en cada proforma. Si el cambio es intencional y está ' +
        'aprobado, actualizá HUELLA_APROBADA en este archivo (arriba están las ' +
        'instrucciones). Si no lo es, revertí src/services/pdf/terminos.js.\n\n' +
        `  esperada: ${HUELLA_APROBADA}\n  actual:   ${huellaActual()}`
      );
    }
  });

  test('cada cláusula tiene título y cuerpo', () => {
    CLAUSULAS.forEach(([titulo, cuerpo], i) => {
      expect(String(titulo).trim().length).toBeGreaterThan(0);
      expect(String(cuerpo).trim().length).toBeGreaterThan(20);
      expect(cuerpo.trim().endsWith('.')).toBe(true);
      expect(Array.isArray(CLAUSULAS[i])).toBe(true);
    });
  });

  test('el título de la hoja es el del documento original', () => {
    expect(TITULO_TERMINOS).toBe('CONDICIONES GENERALES DE LA OFERTA');
  });
});

describe('ninguna cláusula nombra a una empresa a mano', () => {
  // El documento original decía «ROCA IMPORTACIONES S.R.L.» quince veces, pero
  // el sistema emite con DOS entidades y la predeterminada es la empresa
  // unipersonal. Un nombre escrito fijo haría que la mayoría de las
  // cotizaciones saliera con condiciones que obligan a otra persona jurídica.
  const PROHIBIDOS = [
    /ROCA\s+IMPORTACIONES/i,
    /RC\s+TRACTOPARTS/i,
    /Ronald\s+Roca/i,
    /Empresa\s+unipersonal/i,
  ];

  test.each(PROHIBIDOS.map((r) => [r.source, r]))('no aparece %s', (_n, patron) => {
    const culpables = CLAUSULAS
      .map(([titulo, cuerpo], i) => ({ i: i + 1, titulo, cuerpo }))
      .filter(({ cuerpo }) => patron.test(cuerpo));

    if (culpables.length) {
      throw new Error(
        `Estas cláusulas traen un nombre de empresa escrito a mano:\n  ` +
        culpables.map((c) => `${c.i}. ${c.titulo}`).join('\n  ') + '\n\n' +
        `Usá el marcador ${MARCADOR_EMISOR}, que se reemplaza por la entidad que ` +
        'emite cada cotización. Con el nombre fijo, una cotización de la empresa ' +
        'unipersonal saldría obligando a la S.R.L., que es otra persona jurídica.'
      );
    }
  });

  test('nueve cláusulas usan el marcador', () => {
    const conMarcador = CLAUSULAS.filter(([, c]) => c.includes(MARCADOR_EMISOR));
    expect(conMarcador).toHaveLength(9);
  });
});

describe('el nombre del emisor se sustituye', () => {
  test.each([
    ['Roca Importaciones S.R.L.',                    'ROCA IMPORTACIONES S.R.L.'],
    ['Empresa unipersonal de Ronald Roca Cartagena', 'EMPRESA UNIPERSONAL DE RONALD ROCA CARTAGENA'],
  ])('%s se imprime como %s', (entidad, esperado) => {
    const cuerpo = CLAUSULAS.find(([, c]) => c.includes(MARCADOR_EMISOR))[1];
    expect(textoClausula(cuerpo, entidad)).toContain(esperado);
  });

  test('reemplaza TODAS las apariciones, no sólo la primera', () => {
    const doble = `${MARCADOR_EMISOR} y también ${MARCADOR_EMISOR}.`;
    const salida = textoClausula(doble, 'Roca Importaciones S.R.L.');
    expect(salida).toBe('ROCA IMPORTACIONES S.R.L. y también ROCA IMPORTACIONES S.R.L..');
    expect(salida).not.toContain(MARCADOR_EMISOR);
  });

  test('ninguna cláusula renderizada conserva el marcador', () => {
    for (const entidad of ['Roca Importaciones S.R.L.', 'RC Tractoparts', '']) {
      for (const [, cuerpo] of CLAUSULAS) {
        expect(textoClausula(cuerpo, entidad)).not.toContain(MARCADOR_EMISOR);
      }
    }
  });
});
