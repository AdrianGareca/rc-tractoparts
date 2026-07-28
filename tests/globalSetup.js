// =============================================================================
// tests/globalSetup.js
// Marca el instante en que arranca la corrida de tests.
//
// globalTeardown.js usa esta marca para borrar SÓLO los archivos generados
// durante la corrida, sin tocar los que ya estaban en disco (por ejemplo, PDFs
// de una prueba manual de la app).
//
// Se resta un segundo por el redondeo de mtime de algunos sistemas de archivos:
// sin ese margen, un archivo creado en el primer segundo podría quedar con una
// marca de tiempo apenas anterior al inicio y sobrevivir a la limpieza.
// =============================================================================

'use strict';

module.exports = async function globalSetup() {
  process.env.__TEST_RUN_STARTED_AT = String(Date.now() - 1000);
};
