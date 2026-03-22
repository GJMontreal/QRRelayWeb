export const S = {
    configs: [],
    activeId: null,

    scannedCode: '',
    detectedType: '',
    isScanning: true,
    inspectMode: false,
    flashOn: false,
    isSending: false,

    switcherOpen: false,
    editingId: null,
    pendingParams: {},

    stream: null,
    videoTrack: null,
    scanActive: false,
    rafId: null,
    detector: null,
    zxingWasm: false,
    zxingFormats: null,
    _zxCanvas: null,
    lastLocation: null,
    cooldownTick: null,
};
