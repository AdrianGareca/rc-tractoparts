// =============================================================================
// tests/unit/draftLockRelease.test.js
// Liberación del draft-lock (reserva global del próximo correlativo).
//
// Regresión cubierta: si el DELETE en BD falla durante 'cotizacion:draft:leave',
// la propiedad del lock NO debe perderse — el 'disconnect' posterior es el
// último reintento antes de que la reserva quede huérfana y deje el cartel
// "Fulano está redactando SC-…" pegado para todos hasta reiniciar el server.
// =============================================================================

'use strict';

jest.mock('../../src/models/QuotationLockModel', () => ({
  releaseBySocketId: jest.fn(),
}));

const QuotationLockModel = require('../../src/models/QuotationLockModel');
const { _releaseIfOwner, _draftLockOwners } = require('../../src/realtime/socketServer');

describe('socketServer — _releaseIfOwner', () => {
  beforeEach(() => {
    _draftLockOwners.clear();
    QuotationLockModel.releaseBySocketId.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('un socket que no posee el lock no toca la base de datos', async () => {
    await _releaseIfOwner({ id: 'sock-sin-lock' });

    expect(QuotationLockModel.releaseBySocketId).not.toHaveBeenCalled();
  });

  test('un release exitoso quita la propiedad y no reintenta', async () => {
    _draftLockOwners.add('sock-1');
    QuotationLockModel.releaseBySocketId.mockResolvedValue(true);

    await _releaseIfOwner({ id: 'sock-1' });
    expect(_draftLockOwners.has('sock-1')).toBe(false);

    // Segunda pasada (el 'disconnect' que sigue al 'leave'): ya no es dueño,
    // así que no debe volver a pegarle a la BD.
    await _releaseIfOwner({ id: 'sock-1' });
    expect(QuotationLockModel.releaseBySocketId).toHaveBeenCalledTimes(1);
  });

  test('affectedRows = 0 (ya liberado por otra vía) igual suelta la propiedad', async () => {
    _draftLockOwners.add('sock-2');
    QuotationLockModel.releaseBySocketId.mockResolvedValue(false);

    await _releaseIfOwner({ id: 'sock-2' });

    expect(_draftLockOwners.has('sock-2')).toBe(false);
  });

  test('si el DELETE falla, conserva la propiedad para que el disconnect reintente', async () => {
    _draftLockOwners.add('sock-3');

    // 1) 'cotizacion:draft:leave' — la BD tiene un hipo transitorio.
    QuotationLockModel.releaseBySocketId.mockRejectedValueOnce(new Error('ECONNRESET'));
    await _releaseIfOwner({ id: 'sock-3' });

    // La fila sigue en cotizacion_borrador_lock: NO podemos declararnos liberados.
    expect(_draftLockOwners.has('sock-3')).toBe(true);

    // 2) 'disconnect' — segunda (y última) oportunidad de limpiar la reserva.
    QuotationLockModel.releaseBySocketId.mockResolvedValueOnce(true);
    await _releaseIfOwner({ id: 'sock-3' });

    expect(QuotationLockModel.releaseBySocketId).toHaveBeenCalledTimes(2);
    expect(_draftLockOwners.has('sock-3')).toBe(false);
  });
});
