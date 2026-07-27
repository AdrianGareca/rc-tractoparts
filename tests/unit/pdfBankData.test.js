// =============================================================================
// tests/unit/pdfBankData.test.js
// Red de seguridad de los DATOS BANCARIOS impresos en la proforma.
//
// Esto decide a qué cuenta le pide el cliente que transfiera. Un fallback mal
// resuelto no rompe nada visible: imprime la cuenta de la OTRA razón social y
// el dinero termina donde no corresponde.
// =============================================================================

'use strict';

const {
  PRIMARY_ENTIDAD,
  normalizeEntidad,
  BANK_ACCOUNTS,
  resolveBankData,
} = require('../../src/services/pdf/bankData');

describe('normalizeEntidad', () => {
  test('deja pasar las dos razones sociales vigentes', () => {
    expect(normalizeEntidad(PRIMARY_ENTIDAD)).toBe(PRIMARY_ENTIDAD);
    expect(normalizeEntidad('Roca Importaciones S.R.L.')).toBe('Roca Importaciones S.R.L.');
  });

  test("mapea el nombre comercial legado 'RC Tractoparts' a la razón social actual", () => {
    expect(normalizeEntidad('RC Tractoparts')).toBe(PRIMARY_ENTIDAD);
  });

  test('vacío, null o undefined caen a la entidad principal', () => {
    expect(normalizeEntidad(null)).toBe(PRIMARY_ENTIDAD);
    expect(normalizeEntidad(undefined)).toBe(PRIMARY_ENTIDAD);
    expect(normalizeEntidad('')).toBe(PRIMARY_ENTIDAD);
    expect(normalizeEntidad('   ')).toBe(PRIMARY_ENTIDAD);
  });

  test('recorta espacios alrededor', () => {
    expect(normalizeEntidad('  Roca Importaciones S.R.L.  ')).toBe('Roca Importaciones S.R.L.');
  });
});

describe('resolveBankData — datos que vienen de la BD', () => {
  test('los campos de cuentas_bancarias tienen prioridad', () => {
    expect(resolveBankData({
      entidad_emisora:    'Roca Importaciones S.R.L.',
      banco_beneficiario: 'Beneficiario BD',
      banco_nombre:       'Banco BD',
      banco_cuenta:       '999',
    })).toEqual({ beneficiario: 'Beneficiario BD', banco: 'Banco BD', cuenta: '999' });
  });

  test('alcanza con UN campo de la BD para tomar esa rama', () => {
    const r = resolveBankData({ entidad_emisora: PRIMARY_ENTIDAD, banco_cuenta: '123' });

    expect(r.cuenta).toBe('123');
    // Los que faltan se imprimen como guion, NO se mezclan con el fallback:
    // media cuenta correcta y media inventada seria peor que un dato ausente.
    expect(r.beneficiario).toBe('—');
    expect(r.banco).toBe('—');
  });

  test('no mezcla los datos de la BD con los del fallback', () => {
    const r = resolveBankData({ entidad_emisora: PRIMARY_ENTIDAD, banco_nombre: 'Banco X' });

    expect(r.beneficiario).not.toBe(BANK_ACCOUNTS[PRIMARY_ENTIDAD].beneficiario);
  });
});

describe('resolveBankData — fallback por entidad emisora', () => {
  test('sin datos de BD usa la cuenta de la entidad principal', () => {
    expect(resolveBankData({ entidad_emisora: PRIMARY_ENTIDAD }))
      .toEqual(BANK_ACCOUNTS[PRIMARY_ENTIDAD]);
  });

  test('resuelve la cuenta de Roca Importaciones', () => {
    expect(resolveBankData({ entidad_emisora: 'Roca Importaciones S.R.L.' }))
      .toEqual(BANK_ACCOUNTS['Roca Importaciones S.R.L.']);
  });

  test('una cotización con el nombre legado resuelve la cuenta correcta', () => {
    expect(resolveBankData({ entidad_emisora: 'RC Tractoparts' }))
      .toEqual(BANK_ACCOUNTS[PRIMARY_ENTIDAD]);
  });

  test('sin entidad emisora cae a la principal', () => {
    expect(resolveBankData({})).toEqual(BANK_ACCOUNTS[PRIMARY_ENTIDAD]);
    expect(resolveBankData({ entidad_emisora: null })).toEqual(BANK_ACCOUNTS[PRIMARY_ENTIDAD]);
  });

  test('una entidad desconocida cae a la principal en vez de romper el PDF', () => {
    expect(resolveBankData({ entidad_emisora: 'Empresa Inexistente S.A.' }))
      .toEqual(BANK_ACCOUNTS[PRIMARY_ENTIDAD]);
  });

  test('las dos entidades NO comparten cuenta', () => {
    const a = resolveBankData({ entidad_emisora: PRIMARY_ENTIDAD });
    const b = resolveBankData({ entidad_emisora: 'Roca Importaciones S.R.L.' });

    expect(a.cuenta).not.toBe(b.cuenta);
    expect(a.beneficiario).not.toBe(b.beneficiario);
  });
});

describe('BANK_ACCOUNTS', () => {
  test('cada entidad trae beneficiario, banco y cuenta', () => {
    Object.values(BANK_ACCOUNTS).forEach((c) => {
      expect(c.beneficiario).toBeTruthy();
      expect(c.banco).toBeTruthy();
      expect(c.cuenta).toBeTruthy();
    });
  });

  test('las claves son valores canónicos de normalizeEntidad', () => {
    Object.keys(BANK_ACCOUNTS).forEach((k) => {
      expect(normalizeEntidad(k)).toBe(k);
    });
  });
});
