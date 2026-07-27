// =============================================================================
// src/services/pdf/bankData.js
// Entidad emisora y resolución de los DATOS BANCARIOS que imprime la proforma.
//
// Extraído de pdfService.js sin cambios de comportamiento.
// Cubierto por tests/unit/pdfBankData.test.js.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// normalizeEntidad — mapea el nombre comercial legado a la razón social actual,
// para que una cotización guardada antes del renombre siga resolviendo su
// cuenta bancaria.
// ---------------------------------------------------------------------------
const PRIMARY_ENTIDAD = 'Empresa unipersonal de Ronald Roca Cartagena';

function normalizeEntidad(raw) {
  const value = (raw && String(raw).trim()) || PRIMARY_ENTIDAD;
  return value === 'RC Tractoparts' ? PRIMARY_ENTIDAD : value;
}

// ---------------------------------------------------------------------------
// Bank-account resolution (dynamic per issuing entity)
//
// BANK_ACCOUNTS holds the canonical DATOS BANCARIOS for each issuing entity.
// It is the resilient FALLBACK used when the DB-provided bank fields are absent
// (e.g. before the cuentas_bancarias migration is applied on a given
// environment) — mirroring the graceful-degradation approach used elsewhere in
// the codebase. Keys are the canonical entidad_emisora values produced by
// normalizeEntidad().
// ---------------------------------------------------------------------------
const BANK_ACCOUNTS = {
  'Empresa unipersonal de Ronald Roca Cartagena': {
    beneficiario: 'Ronald Roca Cartagena',
    banco:        'BANCO UNIÓN S.A.',
    cuenta:       '10000060054760',
  },
  'Roca Importaciones S.R.L.': {
    beneficiario: 'ROCA IMPORTACIONES S.R.L.',
    banco:        'BANCO UNION S.A.',
    cuenta:       '1-000-00-66027513',
  },
};

// ---------------------------------------------------------------------------
// resolveBankData
// Returns the { beneficiario, banco, cuenta } to print in the DATOS BANCARIOS
// block. DB-provided fields (attached by QuotationModel.findById from the
// cuentas_bancarias table) take precedence; otherwise the built-in
// BANK_ACCOUNTS map keyed by the normalized issuing entity is used.
// ---------------------------------------------------------------------------
function resolveBankData(quotation) {
  if (quotation.banco_beneficiario || quotation.banco_nombre || quotation.banco_cuenta) {
    return {
      beneficiario: quotation.banco_beneficiario || '—',
      banco:        quotation.banco_nombre       || '—',
      cuenta:       quotation.banco_cuenta        || '—',
    };
  }
  const entidad = normalizeEntidad(quotation.entidad_emisora);
  return BANK_ACCOUNTS[entidad] || BANK_ACCOUNTS[PRIMARY_ENTIDAD];
}

module.exports = { PRIMARY_ENTIDAD, normalizeEntidad, BANK_ACCOUNTS, resolveBankData };
