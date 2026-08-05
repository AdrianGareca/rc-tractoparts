// =============================================================================
// tests/unit/copyInterfaz.test.js
// Cómo le habla la aplicación al usuario.
//
// EL HALLAZGO QUE ORIGINÓ ESTE ARCHIVO
// Al revisar los avisos uno por uno quedó claro que la aplicación YA TIENE una
// voz buena, y que sólo un puñado de mensajes se sale de ella:
//
//   «Gasto registrado.»                        ← la mayoría habla así
//   «Documento eliminado.»
//   «Licitación actualizada.»
//
//   «🏆 ¡Cierre de venta registrado! ...»      ← y unos pocos, así
//   «🟢 Cotización enviada al cliente exitosamente.»
//   «Cliente "X" registrado exitosamente.»
//
// El problema no es el gusto de nadie: es que el MISMO hecho se anuncia de dos
// formas distintas según la pantalla. «Cliente registrado.» y «Cliente
// registrado exitosamente.» son el mismo evento con dos voces.
//
// POR QUÉ «EXITOSAMENTE» SOBRA
// El aviso de éxito ya viene en verde y ya dice qué pasó. «Exitosamente» no
// agrega información: sólo alarga la frase que la persona lee al pasar. Y es
// además calco del inglés «successfully» — en español el participio ya lo dice.
//
// POR QUÉ EL EMOJI SOBRA EN UN AVISO
// El aviso dura cuatro segundos en una esquina. El 🏆 le gana la atención a la
// palabra en el momento exacto en que hay que leer rápido, y en un sistema que
// maneja plata sugiere una celebración donde hay un registro contable.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '../../public/js');

function listarJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listarJs(full) : (e.name.endsWith('.js') ? [full] : []);
  });
}
const archivos = listarJs(RAIZ);
const rel = (p) => path.relative(RAIZ, p).split(path.sep).join('/');

// La lista vive en tests/helpers/emojiInterfaz.js: estaba duplicada acá y en
// estilosInline.test.js, y las dos copias se desincronizaron — 👥 faltaba en
// una de las dos, así que «👥 Rendimiento del Equipo» pasaba ambos guardias.
const { ALTERNATIVA: ALT } = require('../helpers/emojiInterfaz');

/** Recorre cada archivo salteando las líneas de comentario. */
function buscar(patron) {
  const hallazgos = [];
  for (const f of archivos) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      const codigo = linea.trim();
      if (codigo.startsWith('//') || codigo.startsWith('*')) return;
      if (patron.test(codigo)) hallazgos.push(`${rel(f)}:${i + 1}  ${codigo.slice(0, 120)}`);
    });
  }
  return hallazgos;
}

// ---------------------------------------------------------------------------
describe('los avisos hablan con una sola voz', () => {
  test('ningún aviso empieza con un emoji', () => {
    // Tres formas de escribir lo mismo:
    //   showToast('🏆 ...')      successMsg: '🟢 ...'
    //   showToast(
    //     '🟢 ...'               ← ésta se colaba: showToast( queda en otra línea
    const hallazgos = buscar(
      new RegExp(`(?:showToast\\(|successMsg:\\s*)['\`](?:${ALT})|^['\`](?:${ALT})`)
    );

    if (hallazgos.length > 0) {
      throw new Error(
        `Estos avisos empiezan con un emoji:\n  ${hallazgos.join('\n  ')}\n\n` +
        'El aviso dura cuatro segundos en una esquina y ya viene coloreado según ' +
        'el tipo. El emoji le gana la atención a la palabra justo cuando hay que ' +
        'leer rápido.'
      );
    }
  });

  test('«exitosamente» no aparece en ningún mensaje', () => {
    const hallazgos = buscar(/exitosamente/i);

    if (hallazgos.length > 0) {
      throw new Error(
        `«Exitosamente» sobra en:\n  ${hallazgos.join('\n  ')}\n\n` +
        'El aviso de éxito ya viene en verde y el participio ya lo dice: ' +
        '«Cliente registrado.» El resto de la aplicación ya habla así, y la ' +
        'mezcla hace que el mismo hecho se anuncie de dos formas según la pantalla.'
      );
    }
  });

  test('ningún título de modal empieza con un emoji', () => {
    const hallazgos = buscar(new RegExp(`openModal\\(\\s*['\`](?:${ALT})`));

    if (hallazgos.length > 0) {
      throw new Error(
        `Estos títulos de modal empiezan con un emoji:\n  ${hallazgos.join('\n  ')}\n\n` +
        'El título ya está en la única barra grande de la ventana: no compite con ' +
        'nada y no necesita que lo señalen.'
      );
    }
  });

  test('ningún botón se rotula con un emoji', () => {
    // Los botones que se arman con textContent no los ve el guardia de
    // estilosInline.test.js, que sólo mira el HTML literal de las plantillas.
    const hallazgos = buscar(new RegExp(`textContent\\s*=\\s*[^;]*['\`](?:${ALT})`));

    if (hallazgos.length > 0) {
      throw new Error(
        `Estos botones llevan un emoji en el rótulo:\n  ${hallazgos.join('\n  ')}\n\n` +
        'Un botón bien rotulado no necesita ninguno.'
      );
    }
  });
});
