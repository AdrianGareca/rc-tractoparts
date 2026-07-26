// =============================================================================
// tests/unit/quotationFormFileUpload.test.js
// Red de seguridad de la validación del adjunto Excel.
//
// El límite de 10 MB y la restricción a .xlsx espejan lo que el backend acepta
// (magic-number PK ZIP + límite de Multer). Si el front se relaja, el usuario
// sube el archivo, espera, y recibe un error del servidor recién al final.
// =============================================================================

'use strict';

jest.mock('../../public/js/services/apiClient.js', () => ({
  __esModule: true,
  default: {},
  showToast: jest.fn(),
}));

import {
  validateExcelFile,
  MAX_EXCEL_BYTES,
  XLSX_MIME,
} from '../../public/js/views/quotationForm/fileUpload.js';

const file = (name, size = 1024, type = '') => ({ name, size, type });

describe('validateExcelFile — acepta', () => {
  test('un .xlsx por extensión', () => {
    expect(validateExcelFile(file('auditoria.xlsx'))).toEqual({ ok: true });
  });

  test('la extensión sin importar mayúsculas', () => {
    expect(validateExcelFile(file('AUDITORIA.XLSX'))).toEqual({ ok: true });
  });

  test('un archivo con el MIME OpenXML aunque la extensión no coincida', () => {
    expect(validateExcelFile(file('planilla', 1024, XLSX_MIME))).toEqual({ ok: true });
  });

  test('un archivo justo en el límite de 10 MB', () => {
    expect(validateExcelFile(file('x.xlsx', MAX_EXCEL_BYTES))).toEqual({ ok: true });
  });

  test('un archivo vacío (el backend decide)', () => {
    expect(validateExcelFile(file('x.xlsx', 0))).toEqual({ ok: true });
  });
});

describe('validateExcelFile — rechaza', () => {
  test('una extensión distinta, con mensaje', () => {
    const r = validateExcelFile(file('reporte.pdf'));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/\.xlsx/);
  });

  test('un .xls viejo (no es OpenXML)', () => {
    expect(validateExcelFile(file('viejo.xls')).ok).toBe(false);
  });

  test('un .xlsx camuflado en el nombre pero no al final', () => {
    expect(validateExcelFile(file('malicioso.xlsx.exe')).ok).toBe(false);
  });

  test('un archivo que pasa el límite por un byte', () => {
    const r = validateExcelFile(file('grande.xlsx', MAX_EXCEL_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/10 MB/);
  });

  test('la extensión se valida ANTES que el tamaño', () => {
    // Un .pdf gigante debe quejarse del tipo, no del peso.
    const r = validateExcelFile(file('enorme.pdf', MAX_EXCEL_BYTES * 5));
    expect(r.message).toMatch(/\.xlsx/);
  });
});

describe('validateExcelFile — sin archivo', () => {
  test('no es válido y no genera mensaje (no hay nada que avisar)', () => {
    expect(validateExcelFile(null)).toEqual({ ok: false, message: null });
    expect(validateExcelFile(undefined)).toEqual({ ok: false, message: null });
  });
});

describe('constantes', () => {
  test('el límite son 10 MB exactos', () => {
    expect(MAX_EXCEL_BYTES).toBe(10485760);
  });

  test('el MIME es el oficial de OpenXML', () => {
    expect(XLSX_MIME)
      .toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
});
