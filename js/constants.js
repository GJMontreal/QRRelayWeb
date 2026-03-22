export const STORAGE_CONFIGS = 'qrrelay_configs';
export const STORAGE_ACTIVE  = 'qrrelay_active';
export const CRED_PREFIX     = 'qrrelay_cred_';

export const SYMBOLOGIES = [
    'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93',
    'itf', 'upc_a', 'upc_e', 'aztec', 'data_matrix', 'pdf417'
];

export const SYM_LABELS = {
    qr_code: 'QR Code', ean_13: 'EAN-13', ean_8: 'EAN-8',
    code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93',
    itf: 'ITF', upc_a: 'UPC-A', upc_e: 'UPC-E',
    aztec: 'Aztec', data_matrix: 'Data Matrix', pdf417: 'PDF417'
};

// zxing-wasm format name ↔ our symbology key
export const ZXING_FORMAT_MAP = {
    qr_code: 'QRCode', ean_13: 'EAN13', ean_8: 'EAN8',
    code_128: 'Code128', code_39: 'Code39', code_93: 'Code93',
    itf: 'ITF', upc_a: 'UPCA', upc_e: 'UPCE',
    aztec: 'Aztec', data_matrix: 'DataMatrix', pdf417: 'PDF417'
};

export const ZXING_TO_SYM = Object.fromEntries(
    Object.entries(ZXING_FORMAT_MAP).map(([k, v]) => [v, k])
);
