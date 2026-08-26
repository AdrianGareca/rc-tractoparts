// =============================================================================
// tests/unit/uploadFilename.test.js
// Red de seguridad del nombre con que se guardan los archivos subidos.
//
// BUG QUE ESTO ARREGLA — path traversal en la escritura de archivos.
//
// Las rutas de subida construían el nombre interpolando req.params.id sin
// sanear:
//     `LICDOC-${req.params.id}-${unique}${ext}`
//
// Multer hace path.join(destino, ese_nombre), así que un id con ../ escapaba
// del directorio. Y es alcanzable: Express decodifica los params DESPUÉS de
// hacer el match de la ruta, así que `..%2f..%2f..%2ftmp%2fevil` llega al
// callback como '../../../tmp/evil' (verificado contra un Express real).
//
// Peor aún, multer escribe el archivo ANTES de que corra el controller — o sea
// antes de la validación del id y antes del control de permisos. Cualquier
// usuario autenticado que llegara a la ruta podía escribir (y sobrescribir)
// archivos en cualquier parte del filesystem, con una extensión de la lista
// permitida.
// =============================================================================

'use strict';

const path = require('path');
const { buildUploadFilename, sanitizeIdSegment, arreglarNombreOriginal } = require('../../src/utils/uploadFilename');

/** ¿El archivo termina dentro del directorio de destino? */
function quedaDentro(destino, filename) {
  const destAbs  = path.resolve(destino);
  const finalAbs = path.resolve(path.join(destino, filename));
  return finalAbs.startsWith(destAbs + path.sep) || finalAbs === destAbs;
}

const DESTINO = 'storage/licitaciones';

/** Vectores que Express entrega decodificados en req.params.id. */
const ATAQUES = [
  '../../evil',
  '../../../evil',
  '../../../../../../tmp/evil',
  '../../../../../../../../etc/passwd',
  'a/../../..',
  '/etc/passwd',
  '..\\..\\evil',
  './../../evil',
  '....//....//evil',
];

describe('sanitizeIdSegment', () => {
  test('deja pasar un id numérico normal', () => {
    expect(sanitizeIdSegment('42')).toBe('42');
    expect(sanitizeIdSegment(42)).toBe('42');
  });

  test.each(ATAQUES)('neutraliza %s', (ataque) => {
    const limpio = sanitizeIdSegment(ataque);
    expect(limpio).not.toMatch(/[/\\]/);   // sin separadores de ruta
    expect(limpio).not.toContain('..');    // sin saltos de directorio
  });

  test('un id ausente cae a "draft"', () => {
    expect(sanitizeIdSegment(undefined)).toBe('draft');
    expect(sanitizeIdSegment(null)).toBe('draft');
    expect(sanitizeIdSegment('')).toBe('draft');
  });

  test('un id que queda vacío tras limpiar cae a "draft"', () => {
    // '../..' no tiene ni un dígito que rescatar.
    expect(sanitizeIdSegment('../..')).toBe('draft');
  });
});

describe('buildUploadFilename — ningún ataque escapa del directorio', () => {
  test.each(ATAQUES)('id = %s queda dentro del destino', (ataque) => {
    const nombre = buildUploadFilename({ prefix: 'LICDOC', id: ataque, originalname: 'doc.pdf' });

    expect(quedaDentro(DESTINO, nombre)).toBe(true);
  });

  test('el nombre generado nunca contiene separadores de ruta', () => {
    for (const ataque of ATAQUES) {
      const nombre = buildUploadFilename({ prefix: 'LICDOC', id: ataque, originalname: 'x.pdf' });
      expect(nombre).not.toMatch(/[/\\]/);
    }
  });

  test('una extensión maliciosa tampoco escapa', () => {
    const nombre = buildUploadFilename({
      prefix: 'LICDOC', id: '5', originalname: 'doc.../../../evil.pdf',
    });

    expect(quedaDentro(DESTINO, nombre)).toBe(true);
    expect(nombre).not.toMatch(/[/\\]/);
  });
});

describe('buildUploadFilename — el caso normal sigue igual', () => {
  test('mantiene el formato PREFIJO-id-único.ext', () => {
    const nombre = buildUploadFilename({ prefix: 'LICDOC', id: '7', originalname: 'contrato.PDF' });

    expect(nombre).toMatch(/^LICDOC-7-\d+-[0-9a-f]+\.pdf$/);
  });

  test('normaliza la extensión a minúsculas', () => {
    expect(buildUploadFilename({ prefix: 'COT', id: '1', originalname: 'a.XLSX' })).toMatch(/\.xlsx$/);
  });

  test('sin extensión no agrega punto suelto', () => {
    const nombre = buildUploadFilename({ prefix: 'COT', id: '1', originalname: 'sinextension' });

    expect(nombre).not.toMatch(/\.$/);
    expect(nombre).toMatch(/^COT-1-/);
  });

  test('dos llamadas seguidas no colisionan', () => {
    const a = buildUploadFilename({ prefix: 'COT', id: '1', originalname: 'x.pdf' });
    const b = buildUploadFilename({ prefix: 'COT', id: '1', originalname: 'x.pdf' });

    expect(a).not.toBe(b);
  });
});

describe('arreglarNombreOriginal — deshace el mojibake de Busboy', () => {
  // Busboy decodifica el nombre del multipart como Latin1 por default. Un
  // cliente que manda el nombre en UTF-8 (la mayoría) produce mojibake: acá se
  // simula exactamente eso — se toman los bytes UTF-8 del nombre real y se
  // interpretan como Latin1, tal como llegarían a file.originalname.
  const simularMojibake = (nombreReal) => Buffer.from(nombreReal, 'utf8').toString('latin1');

  test.each([
    'informe_año_2026.pdf',
    'cotización final.pdf',
    '报告.pdf',
    '📄 documento.pdf',
  ])('recupera el nombre real de %s', (nombreReal) => {
    expect(arreglarNombreOriginal(simularMojibake(nombreReal))).toBe(nombreReal);
  });

  test('un nombre puramente ASCII queda igual', () => {
    expect(arreglarNombreOriginal('contrato.pdf')).toBe('contrato.pdf');
  });

  test('ausente no revienta', () => {
    expect(arreglarNombreOriginal(undefined)).toBe('');
    expect(arreglarNombreOriginal(null)).toBe('');
  });
});

describe('el patrón viejo ERA vulnerable (documenta el bug)', () => {
  /** Copia literal del callback que había antes del arreglo. */
  const patronViejo = (paramsId, originalname) =>
    `LICDOC-${paramsId || 'draft'}-1785170000-deadbeef${path.extname(originalname).toLowerCase()}`;

  test('con el patrón viejo, un id malicioso escapaba del directorio', () => {
    const nombre = patronViejo('../../../../../../tmp/evil', 'doc.pdf');

    // Esto es lo que hacía multer: path.join(destino, nombre).
    expect(quedaDentro(DESTINO, nombre)).toBe(false);
  });

  test('con el patrón nuevo, el mismo id queda contenido', () => {
    const nombre = buildUploadFilename({
      prefix: 'LICDOC', id: '../../../../../../tmp/evil', originalname: 'doc.pdf',
    });

    expect(quedaDentro(DESTINO, nombre)).toBe(true);
  });
});
