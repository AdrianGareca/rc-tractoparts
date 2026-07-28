// =============================================================================
// tests/globalTeardown.js
// Borra los archivos que la corrida de tests dejó en disco.
//
// POR QUÉ EXISTE: los tests de integración crean cotizaciones reales, y cada
// creación genera un PDF de ~1,4 MB en uploads/cotizaciones. Nadie los borraba.
// Después de unos días de trabajo el directorio tenía 803 archivos y 1,1 GB, y
// la suite había pasado de 223 s a 843 s — con tres suites fallando por timeout.
// Los PDFs quedan además huérfanos: `pretest` recrea la base de test en cada
// corrida, así que ninguna fila los referencia.
//
// CRITERIO DE BORRADO: sólo se eliminan los archivos con fecha de modificación
// POSTERIOR al arranque de la corrida (la marca la deja globalSetup.js). Un PDF
// que ya estaba antes —por ejemplo de una prueba manual de la app— no se toca.
// =============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');

/** Directorios donde los tests dejan archivos. */
const DIRS = [
  process.env.UPLOAD_DIR || 'uploads/cotizaciones',
  'storage/excels',
  'storage/licitaciones',
];

module.exports = async function globalTeardown() {
  const inicio = Number(process.env.__TEST_RUN_STARTED_AT || 0);
  if (!inicio) return;   // sin marca de inicio no se borra nada

  let borrados = 0;
  let bytes    = 0;

  for (const dir of DIRS) {
    const abs = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(abs)) continue;

    for (const nombre of fs.readdirSync(abs)) {
      const archivo = path.join(abs, nombre);
      try {
        const st = fs.statSync(archivo);
        if (!st.isFile() || st.mtimeMs < inicio) continue;   // preexistente: se respeta
        bytes += st.size;
        fs.unlinkSync(archivo);
        borrados++;
      } catch {
        // Un archivo que desaparece entre el readdir y el unlink no es un error.
      }
    }
  }

  if (borrados > 0) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    console.log(`\n[tests] Limpieza: ${borrados} archivo(s) generados durante la corrida (${mb} MB).`);
  }
};
