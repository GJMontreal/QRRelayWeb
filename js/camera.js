import { SYMBOLOGIES, ZXING_FORMAT_MAP, ZXING_TO_SYM, SYM_LABELS } from './constants.js';
import { S } from './state.js';
import { activeCfg } from './config.js';
import { $, showToast } from './utils.js';
// Note: camera ↔ ui and camera ↔ network are mutually dependent.
// All cross-module calls are inside function bodies so ES module
// circular imports resolve correctly at runtime.
import { updateFlashBtn, renderResultPanel, refreshScannerEngineLabel } from './ui.js';
import { prepareSend } from './network.js';

// ── Camera ────────────────────────────────────────────────────────────────────
export async function startCamera() {
    try {
        S.stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const video = $('camera-video');
        video.srcObject = S.stream;
        S.videoTrack = S.stream.getVideoTracks()[0];
        await video.play();
        startScanning();
    } catch (e) {
        showToast('Camera access denied — check browser permissions');
    }
}

export function stopCamera() {
    stopScanning();
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; S.videoTrack = null; }
    S.flashOn = false; updateFlashBtn();
}

// ── Barcode detection ─────────────────────────────────────────────────────────
export async function loadZXingWasm(wanted) {
    if (S.zxingWasm) return;
    if (!window.ZXingWASM) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.0.1/dist/iife/full/index.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }
    S.zxingFormats = wanted.map(sym => ZXING_FORMAT_MAP[sym]).filter(Boolean);
    S.zxingWasm = true;
}

export async function buildDetector() {
    const cfg = activeCfg();
    const wanted = S.inspectMode ? SYMBOLOGIES : (cfg.allowedSymbologies || SYMBOLOGIES);

    if (typeof BarcodeDetector !== 'undefined') {
        const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
        const formats = supported.length ? wanted.filter(f => supported.includes(f)) : wanted;
        S.detector = new BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
        S.zxingWasm = false;
        refreshScannerEngineLabel();
        return;
    }
    S.detector = null;
    await loadZXingWasm(wanted);
    refreshScannerEngineLabel();
}

export async function startScanning() {
    if (S.scanActive) return;
    S.scanActive = true;
    S.isScanning = true;
    await buildDetector();
    scanLoop();
}

export function stopScanning() {
    S.scanActive = false;
    if (S.rafId) { clearTimeout(S.rafId); S.rafId = null; }
}

export function resumeScanning() {
    S.scannedCode = '';
    S.detectedType = '';
    S.isScanning = true;
    const canvas = $('scan-canvas');
    canvas.style.display = 'none';
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    $('camera-video').play();
    renderResultPanel();
    if (!S.scanActive) startScanning();
}

async function detectWithBarcodeDetector(video) {
    const barcodes = await S.detector.detect(video);
    if (!barcodes.length) return null;
    const { rawValue: value, format, cornerPoints } = barcodes[0];
    return { value, format, cornerPoints };
}

async function detectWithZXing(video) {
    if (!S._zxCanvas) {
        S._zxCanvas = document.createElement('canvas');
        S._zxCanvas.style.display = 'none';
        document.body.appendChild(S._zxCanvas);
    }
    const zxc = S._zxCanvas;
    zxc.width = video.videoWidth;
    zxc.height = video.videoHeight;
    const ctx = zxc.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, zxc.width, zxc.height);
    const results = await ZXingWASM.readBarcodes(imageData, { formats: S.zxingFormats, tryHarder: true });
    if (!results.length) return null;
    const { text: value, format, position: p } = results[0];
    const sym = ZXING_TO_SYM[format] || format.toLowerCase();
    const cornerPoints = p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : null;
    return { value, format: sym, cornerPoints };
}

async function scanLoop() {
    if (!S.scanActive) return;

    if (S.isScanning) {
        const video = $('camera-video');
        if (video.readyState >= video.HAVE_ENOUGH_DATA) {
            try {
                const detected = S.detector  ? await detectWithBarcodeDetector(video)
                               : S.zxingWasm ? await detectWithZXing(video)
                               : null;
                if (detected && S.isScanning) onDetected(detected);
            } catch (_) { /* empty frame */ }
        }
    }

    S.rafId = setTimeout(scanLoop, 100); // ~10fps — plenty for barcode detection
}

function onDetected({ value, format, cornerPoints }) {
    S.isScanning = false;
    S.scannedCode = value;
    S.detectedType = SYM_LABELS[format] || format;

    navigator.clipboard.writeText(value).catch(() => {});
    $('camera-video').pause();
    if (cornerPoints) drawOutline(cornerPoints);
    renderResultPanel();

    if (!S.inspectMode && activeCfg().autoSend) prepareSend();
}

function drawOutline(points) {
    const video  = $('camera-video');
    const canvas = $('scan-canvas');
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = video.clientWidth;
    const ch = video.clientHeight;

    canvas.width  = cw;
    canvas.height = ch;

    const scale   = Math.max(cw / vw, ch / vh);
    const offsetX = (cw - vw * scale) / 2;
    const offsetY = (ch - vh * scale) / 2;
    const map = p => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });
    const mapped = points.map(map);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.beginPath();
    ctx.moveTo(mapped[0].x, mapped[0].y);
    for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 214, 10, 0.9)';
    ctx.lineWidth   = 3;
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 214, 10, 0.15)';
    ctx.fill();

    canvas.style.display = 'block';
}

// ── Flashlight ────────────────────────────────────────────────────────────────
export async function toggleFlash() {
    if (!S.videoTrack) return;
    const next = !S.flashOn;
    try {
        await S.videoTrack.applyConstraints({ advanced: [{ torch: next }] });
        S.flashOn = next;
    } catch {
        showToast('Flashlight not supported on this device');
        S.flashOn = false;
    }
    updateFlashBtn();
}

// ── Location ──────────────────────────────────────────────────────────────────
export function startLocationWatch() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
        pos => { S.lastLocation = pos.coords; },
        null,
        { enableHighAccuracy: true }
    );
}

// ── Cooldown ──────────────────────────────────────────────────────────────────
export function startCooldown(seconds) {
    if (!seconds) { resumeScanning(); return; }
    const overlay = $('cooldown-overlay');
    const secEl   = $('cooldown-seconds');
    const ringEl  = $('cooldown-ring-fg');
    const circ = 163.4; // 2π × 26

    ringEl.style.strokeDashoffset = 0;
    secEl.textContent = seconds;
    overlay.style.display = 'flex';

    let remaining = seconds;
    if (S.cooldownTick) clearInterval(S.cooldownTick);
    S.cooldownTick = setInterval(() => {
        remaining--;
        const progress = (seconds - remaining) / seconds;
        ringEl.style.strokeDashoffset = circ * progress;
        if (remaining <= 0) {
            clearInterval(S.cooldownTick);
            overlay.style.display = 'none';
            resumeScanning();
        } else {
            secEl.textContent = remaining;
        }
    }, 1000);
}
