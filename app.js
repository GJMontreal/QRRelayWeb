'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const STORAGE_CONFIGS = 'qrrelay_configs';
const STORAGE_ACTIVE  = 'qrrelay_active';
const CRED_PREFIX     = 'qrrelay_cred_';

const SYMBOLOGIES = [
    'qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93',
    'itf', 'upc_a', 'upc_e', 'aztec', 'data_matrix', 'pdf417'
];
const SYM_LABELS = {
    qr_code: 'QR Code', ean_13: 'EAN-13', ean_8: 'EAN-8',
    code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93',
    itf: 'ITF', upc_a: 'UPC-A', upc_e: 'UPC-E',
    aztec: 'Aztec', data_matrix: 'Data Matrix', pdf417: 'PDF417'
};

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
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
    jsQRReady: false,
    lastLocation: null,
    cooldownTick: null,
};

// ── UUID ──────────────────────────────────────────────────────────────────────
function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ── Config helpers ────────────────────────────────────────────────────────────
function newConfig(name = 'New Configuration') {
    return {
        id: uid(), name,
        scheme: 'https', host: '', port: '', endpoint: '',
        parameterName: 'code',
        authScheme: 'unauthenticated',
        includeTimestamp: false, includeLocation: false,
        showScannedCode: false, autoSend: false,
        scanCooldown: 2, showServerResponse: true,
        allowedSymbologies: [...SYMBOLOGIES],
        extraParameters: [],
    };
}

function saveConfigs() {
    localStorage.setItem(STORAGE_CONFIGS, JSON.stringify(S.configs));
    localStorage.setItem(STORAGE_ACTIVE, S.activeId || '');
}

function loadConfigs() {
    try { S.configs = JSON.parse(localStorage.getItem(STORAGE_CONFIGS)) || []; }
    catch { S.configs = []; }
    S.activeId = localStorage.getItem(STORAGE_ACTIVE) || null;
    if (!S.configs.length) {
        const c = newConfig('Default'); S.configs.push(c); S.activeId = c.id;
    } else if (!S.configs.find(c => c.id === S.activeId)) {
        S.activeId = S.configs[0].id;
    }
}

function activeCfg() { return S.configs.find(c => c.id === S.activeId) || S.configs[0]; }

// ── Credentials (sessionStorage — cleared on tab close) ───────────────────────
function saveCred(id, key, val) {
    if (val) sessionStorage.setItem(`${CRED_PREFIX}${id}_${key}`, val);
    else sessionStorage.removeItem(`${CRED_PREFIX}${id}_${key}`);
}
function loadCred(id, key) { return sessionStorage.getItem(`${CRED_PREFIX}${id}_${key}`) || ''; }

// ── Camera ────────────────────────────────────────────────────────────────────
async function startCamera() {
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

function stopCamera() {
    stopScanning();
    if (S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; S.videoTrack = null; }
    S.flashOn = false; updateFlashBtn();
}

// ── Barcode detection ─────────────────────────────────────────────────────────
async function buildDetector() {
    if (typeof BarcodeDetector !== 'undefined') {
        const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
        const cfg = activeCfg();
        const wanted = S.inspectMode ? SYMBOLOGIES : (cfg.allowedSymbologies || SYMBOLOGIES);
        // If getSupportedFormats() failed or returned nothing, try the wanted
        // formats directly rather than falling back to qr_code only.
        const formats = supported.length ? wanted.filter(f => supported.includes(f)) : wanted;
        S.detector = new BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
        return;
    }
    // jsQR fallback (QR only)
    if (!S.jsQRReady && !window.jsQR) {
        await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
        S.jsQRReady = true;
    }
    S.detector = null; // use jsQR path in scanLoop
}

async function startScanning() {
    if (S.scanActive) return;
    S.scanActive = true;
    S.isScanning = true;
    await buildDetector();
    scanLoop();
}

function stopScanning() {
    S.scanActive = false;
    if (S.rafId) { cancelAnimationFrame(S.rafId); S.rafId = null; }
}

function resumeScanning() {
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

async function scanLoop() {
    if (!S.scanActive) return;
    if (!S.isScanning) { S.rafId = requestAnimationFrame(scanLoop); return; }

    const video = $('camera-video');
    if (video.readyState >= video.HAVE_ENOUGH_DATA) {
        try {
            let detected = null;

            if (S.detector) {
                const barcodes = await S.detector.detect(video);
                if (barcodes.length) detected = { value: barcodes[0].rawValue, format: barcodes[0].format, cornerPoints: barcodes[0].cornerPoints };
            } else if (window.jsQR) {
                const canvas = $('scan-canvas');
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(img.data, img.width, img.height);
                if (code) detected = { value: code.data, format: 'qr_code', cornerPoints: [code.location.topLeftCorner, code.location.topRightCorner, code.location.bottomRightCorner, code.location.bottomLeftCorner] };
            }

            if (detected && S.isScanning) onDetected(detected);
        } catch (_) { /* empty frame */ }
    }

    S.rafId = requestAnimationFrame(scanLoop);
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

    // Map from video natural coords → displayed coords (object-fit: cover)
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
    ctx.strokeStyle = 'rgba(255, 214, 10, 0.9)';  // yellow, matching inspect mode colour
    ctx.lineWidth   = 3;
    ctx.lineJoin    = 'round';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 214, 10, 0.15)';
    ctx.fill();

    canvas.style.display = 'block';
}

// ── Flashlight ────────────────────────────────────────────────────────────────
async function toggleFlash() {
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

// ── Send flow ─────────────────────────────────────────────────────────────────
function prepareSend() {
    const cfg = activeCfg();
    const needInput = (cfg.extraParameters || []).filter(p => p.inputMode !== 'fixed');
    if (needInput.length) {
        S.pendingParams = {};
        showParamsSheet(needInput);
    } else {
        doSend({});
    }
}

async function doSend(paramValues) {
    const cfg = activeCfg();
    S.isSending = true;
    renderResultPanel();

    try {
        const url = buildURL(cfg, paramValues);
        const headers = buildHeaders(cfg);
        const resp = await fetch(url, { method: 'GET', headers });
        const text = await resp.text();

        if (cfg.showServerResponse) {
            showResponseSheet(text);
        } else {
            showToast(`${resp.status} ${resp.statusText}`);
            startCooldown(cfg.scanCooldown ?? 2);
        }
    } catch (e) {
        showToast(`Error: ${e.message}`);
    } finally {
        S.isSending = false;
        renderResultPanel();
    }
}

function buildURL(cfg, paramValues) {
    const port    = cfg.port ? `:${cfg.port}` : '';
    const rawPath = (cfg.endpoint || '').replace(/^\/+/, '');
    const path    = rawPath ? `/${rawPath}` : '';
    const base    = `${cfg.scheme}://${cfg.host || 'localhost'}${port}${path}`;
    const p       = new URLSearchParams();
    p.set(cfg.parameterName || 'code', S.scannedCode);
    if (cfg.includeTimestamp) p.set('timestamp', new Date().toISOString());
    if (cfg.includeLocation && S.lastLocation) {
        p.set('lat', S.lastLocation.latitude.toFixed(6));
        p.set('lon', S.lastLocation.longitude.toFixed(6));
    }
    for (const param of cfg.extraParameters || []) {
        const val = param.inputMode === 'fixed' ? param.fixedValue : (paramValues[param.id] || '');
        if (val) p.set(param.name, val);
    }
    return `${base}?${p}`;
}

function buildHeaders(cfg) {
    const h = {};
    const id = cfg.id;
    if (cfg.authScheme === 'bearer') {
        const t = loadCred(id, 'bearerToken');
        if (t) h['Authorization'] = `Bearer ${t}`;
    } else if (cfg.authScheme === 'apiKey') {
        const k = loadCred(id, 'apiKey');
        const n = loadCred(id, 'apiKeyHeader') || 'X-API-Key';
        if (k) h[n] = k;
    } else if (cfg.authScheme === 'basic') {
        const u = loadCred(id, 'username');
        const p = loadCred(id, 'password');
        if (u || p) h['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
    }
    return h;
}

// ── Location ──────────────────────────────────────────────────────────────────
function startLocationWatch() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(pos => { S.lastLocation = pos.coords; }, null, { enableHighAccuracy: true });
}

// ── Cooldown ──────────────────────────────────────────────────────────────────
function startCooldown(seconds) {
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

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, ms = 3200) {
    const el = $('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function updateConfigTitle() {
    const cfg = activeCfg();
    $('config-title-text').textContent = cfg ? cfg.name : '—';
    const multi = S.configs.length > 1;
    $('config-chevron').style.display = multi ? '' : 'none';
}
function updateInspectBtn() { $('btn-inspect').classList.toggle('active', S.inspectMode); }
function updateFlashBtn()   { $('btn-flash').classList.toggle('active', S.flashOn); }

function renderResultPanel() {
    const cfg = activeCfg();
    const panel = $('result-panel');

    if (!S.scannedCode) { panel.style.display = 'none'; return; }
    panel.style.display = 'flex';

    const inspType = $('inspect-type');
    if (S.inspectMode && S.detectedType) {
        inspType.textContent = S.detectedType;
        inspType.style.display = 'block';
    } else {
        inspType.style.display = 'none';
    }

    const codeEl = $('code-display');
    if (cfg.showScannedCode || S.inspectMode) {
        codeEl.textContent = S.scannedCode;
        codeEl.style.display = 'block';
    } else {
        codeEl.style.display = 'none';
    }

    const sendBtn = $('btn-send');
    if (!S.inspectMode) {
        sendBtn.style.display = '';
        sendBtn.disabled = S.isSending;
    } else {
        sendBtn.style.display = 'none';
    }

    $('send-spinner').style.display = S.isSending ? 'block' : 'none';
}

// ── Config switcher ───────────────────────────────────────────────────────────
function renderSwitcher() {
    const el = $('config-switcher');
    el.innerHTML = '';
    S.configs.forEach(cfg => {
        const item = document.createElement('div');
        item.className = 'switcher-item';
        const name = document.createElement('span');
        name.textContent = cfg.name;
        item.appendChild(name);
        if (cfg.id === S.activeId) {
            const chk = document.createElement('span');
            chk.className = 'switcher-check';
            chk.textContent = '✓';
            item.appendChild(chk);
        }
        item.addEventListener('click', () => {
            S.activeId = cfg.id; saveConfigs();
            closeSwitcher(); updateConfigTitle(); resumeScanning();
        });
        el.appendChild(item);
    });
}

function openSwitcher()  { renderSwitcher(); S.switcherOpen = true;  $('config-switcher').style.display = 'block'; $('config-chevron').classList.add('open'); }
function closeSwitcher() { S.switcherOpen = false; $('config-switcher').style.display = 'none'; $('config-chevron').classList.remove('open'); }

// ── Params sheet ──────────────────────────────────────────────────────────────
function showParamsSheet(params) {
    const form = $('params-form');
    form.innerHTML = '';
    params.forEach(p => {
        const sec = document.createElement('div'); sec.className = 'param-section';
        const lbl = document.createElement('div'); lbl.className = 'param-section-label'; lbl.textContent = p.label || p.name;
        const inp = document.createElement('input');
        inp.type = p.inputMode === 'numberpad' ? 'number' : 'text';
        inp.placeholder = p.label || p.name;
        inp.value = S.pendingParams[p.id] || '';
        inp.autocapitalize = 'off'; inp.autocorrect = 'off'; inp.spellcheck = false;
        inp.addEventListener('input', () => { S.pendingParams[p.id] = inp.value; });
        sec.append(lbl, inp); form.appendChild(sec);
    });
    showSheet('sheet-params');
}

// ── Response sheet ────────────────────────────────────────────────────────────
function showResponseSheet(html) {
    const frame = $('response-frame');
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    frame.src = url;
    frame._blobUrl = url;
    showSheet('sheet-response');
}

function hideResponseSheet() {
    hideSheet('sheet-response');
    const frame = $('response-frame');
    if (frame._blobUrl) { URL.revokeObjectURL(frame._blobUrl); frame._blobUrl = null; }
    const cfg = activeCfg();
    startCooldown(cfg.scanCooldown ?? 2);
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────
function showSheet(id) {
    const el = $(id);
    el.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}
function hideSheet(id) {
    const el = $(id);
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => { el.style.display = 'none'; }, { once: true });
}

// ── Slide screens ─────────────────────────────────────────────────────────────
function showScreen(id) {
    const el = $(id);
    el.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}
function hideScreen(id) {
    const el = $(id);
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => { el.style.display = 'none'; }, { once: true });
}

// ── Settings screen ───────────────────────────────────────────────────────────
function showSettings() { renderConfigsList(); showScreen('screen-settings'); }
function hideSettings()  { hideScreen('screen-settings'); }

function renderConfigsList() {
    const container = $('configs-list');
    container.innerHTML = '';

    const section = makeSection('');
    const card = document.createElement('div'); card.className = 'card';

    S.configs.forEach((cfg, i) => {
        const row = document.createElement('div');
        row.className = 'list-row tappable';
        row.style.cursor = 'pointer';

        const main = document.createElement('div'); main.style.cssText = 'flex:1; min-width:0;';
        const title = document.createElement('div'); title.className = 'row-label'; title.textContent = cfg.name;
        const sub = document.createElement('div');
        sub.style.cssText = 'font-size:13px; color:var(--text2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;';
        sub.textContent = `${cfg.scheme}://${cfg.host || '…'}`;
        main.append(title, sub);

        if (cfg.id === S.activeId) {
            const chk = document.createElement('span'); chk.style.color = 'var(--accent)'; chk.textContent = '✓'; row.appendChild(main); row.appendChild(chk);
        } else {
            row.appendChild(main);
        }

        const actions = document.createElement('div'); actions.className = 'config-row-actions';

        const dupBtn = document.createElement('button'); dupBtn.className = 'cfg-action-btn'; dupBtn.title = 'Duplicate';
        dupBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicateCfg(cfg.id); });

        const delBtn = document.createElement('button'); delBtn.className = 'cfg-action-btn danger'; delBtn.title = 'Delete';
        delBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
        delBtn.addEventListener('click', e => { e.stopPropagation(); confirmDelete(cfg.id); });

        const chev = document.createElement('span'); chev.className = 'row-chevron';
        chev.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="1 1 7 7 1 13"/></svg>';

        actions.append(dupBtn, delBtn);
        row.append(actions, chev);
        row.addEventListener('click', () => { S.activeId = cfg.id; saveConfigs(); updateConfigTitle(); showConfigEdit(cfg.id); });

        card.appendChild(row);
    });

    section.appendChild(card);
    container.appendChild(section);
}

function duplicateCfg(id) {
    const orig = S.configs.find(c => c.id === id); if (!orig) return;
    const copy = { ...orig, extraParameters: orig.extraParameters.map(p => ({...p})), id: uid(), name: `${orig.name} Copy` };
    const idx = S.configs.findIndex(c => c.id === id);
    S.configs.splice(idx + 1, 0, copy);
    saveConfigs(); renderConfigsList();
    if (orig.authScheme !== 'unauthenticated') showCredWarning();
}

function showCredWarning() {
    document.querySelectorAll('.cred-warning').forEach(e => e.remove());
    const el = document.createElement('div'); el.className = 'cred-warning';
    el.textContent = 'Credentials not copied — re-enter them in the duplicate';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function confirmDelete(id) {
    const cfg = S.configs.find(c => c.id === id); if (!cfg) return;
    if (!confirm(`Delete "${cfg.name}"?\n\nThis cannot be undone.`)) return;
    const idx = S.configs.findIndex(c => c.id === id);
    S.configs.splice(idx, 1);
    if (S.activeId === id) S.activeId = S.configs[0]?.id || null;
    if (!S.configs.length) { const d = newConfig('Default'); S.configs.push(d); S.activeId = d.id; }
    saveConfigs(); updateConfigTitle(); renderConfigsList();
}

// ── Config edit screen ────────────────────────────────────────────────────────
function showConfigEdit(id) {
    const cfg = S.configs.find(c => c.id === id); if (!cfg) return;
    S.editingId = id;
    renderConfigEdit(cfg);
    showScreen('screen-config-edit');
}

function hideConfigEdit() {
    hideScreen('screen-config-edit');
    renderConfigsList(); updateConfigTitle();
}

function setField(field, value) {
    const cfg = S.configs.find(c => c.id === S.editingId); if (!cfg) return;
    cfg[field] = value; saveConfigs();
    updatePreview(cfg);
}

function previewURL(cfg) {
    const port    = cfg.port ? `:${cfg.port}` : '';
    const rawPath = (cfg.endpoint || '').replace(/^\/+/, '');
    const path    = rawPath ? `/${rawPath}` : '';
    let url = `${cfg.scheme}://${cfg.host || '…'}${port}${path}?${cfg.parameterName || 'code'}=`;
    if (cfg.includeTimestamp) url += `&timestamp=${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
    if (cfg.includeLocation) {
        if (S.lastLocation) url += `&lat=${S.lastLocation.latitude.toFixed(4)}&lon=${S.lastLocation.longitude.toFixed(4)}`;
        else url += `&lat=…&lon=…`;
    }
    for (const p of cfg.extraParameters || []) {
        if (!p.name) continue;
        if (p.inputMode === 'fixed')     url += `&${p.name}=${p.fixedValue}`;
        else if (p.inputMode === 'numberpad') url += `&${p.name}=0`;
        else url += `&${p.name}=…`;
    }
    return url;
}

function updatePreview(cfg) {
    const el = document.getElementById('url-preview-text');
    if (el) el.textContent = previewURL(cfg);
}

function renderConfigEdit(cfg) {
    $('edit-screen-title').textContent = cfg.name || 'Configuration';
    const container = $('config-edit-form');
    container.innerHTML = '';

    // — General
    container.appendChild(makeSection('General', [
        makeTextRow('Name', 'name', cfg.name, cfg, 'My Server', v => {
            setField('name', v); $('edit-screen-title').textContent = v || 'Configuration';
        }),
    ]));

    // — Endpoint
    container.appendChild(makeSection('Endpoint', [
        makeSelectRow('Scheme', 'scheme', ['https','http'], ['HTTPS','HTTP'], cfg),
        makeTextRow('Host', 'host', cfg.host, cfg, 'example.com'),
        makeTextRow('Port', 'port', cfg.port || '', cfg, 'Optional'),
        makeTextRow('Path', 'endpoint', cfg.endpoint, cfg, '/scan'),
        makeTextRow('Parameter', 'parameterName', cfg.parameterName, cfg, 'code'),
    ]));

    // — Authentication
    container.appendChild(makeSection('Authentication', [
        makeSelectRow('Auth', 'authScheme',
            ['unauthenticated','bearer','apiKey','basic'],
            ['None','Bearer Token','API Key','Basic Auth'],
            cfg, () => { saveConfigs(); renderConfigEdit(S.configs.find(c => c.id === S.editingId)); }
        ),
    ]));

    // — Credentials (dynamic)
    if (cfg.authScheme !== 'unauthenticated') {
        container.appendChild(makeCredSection(cfg));
    }

    // — Options
    container.appendChild(makeSection('Options', [
        makeToggleRow('Include Timestamp', 'includeTimestamp', cfg),
        makeToggleRow('Include Location',  'includeLocation',  cfg, () => { if (cfg.includeLocation) startLocationWatch(); }),
        makeToggleRow('Show Scanned Code', 'showScannedCode',  cfg),
        makeToggleRow('Auto Send',         'autoSend',         cfg),
        makeToggleRow('Show Server Response', 'showServerResponse', cfg),
        makeTextRow('Cooldown (seconds)', 'scanCooldown', String(cfg.scanCooldown ?? 2), cfg, '2', v => setField('scanCooldown', parseInt(v) || 0), 'number'),
    ]));

    // — Symbologies
    container.appendChild(makeSymSection(cfg));

    // — Extra Parameters
    container.appendChild(makeExtraParamsSection(cfg));

    // Preview section
    container.appendChild(makePreviewSection(cfg));

    // Bottom padding
    const pad = document.createElement('div'); pad.style.height = '40px';
    container.appendChild(pad);
}

// ── Section builders ──────────────────────────────────────────────────────────
function makeSection(title, rowEls = []) {
    const sec = document.createElement('div'); sec.className = 'list-section';
    if (title) {
        const hdr = document.createElement('div'); hdr.className = 'section-header'; hdr.textContent = title;
        sec.appendChild(hdr);
    }
    if (rowEls.length) {
        const card = document.createElement('div'); card.className = 'card';
        rowEls.forEach(r => card.appendChild(r));
        sec.appendChild(card);
    }
    return sec;
}

function makeTextRow(label, field, value, cfg, placeholder = '', onSave, inputType = 'text') {
    const row = document.createElement('div'); row.className = 'list-row';
    const lbl = document.createElement('span'); lbl.className = 'row-label'; lbl.textContent = label;
    const inp = document.createElement('input'); inp.className = 'text-input';
    inp.type = inputType; inp.placeholder = placeholder; inp.value = value;
    inp.autocapitalize = 'off'; inp.autocorrect = 'off'; inp.spellcheck = false;
    const save = () => {
        const v = inputType === 'number' ? (parseInt(inp.value) || 0) : inp.value;
        setField(field, v);
        if (onSave) onSave(inp.value);
    };
    inp.addEventListener('input', save);
    inp.addEventListener('blur', save);
    row.append(lbl, inp); return row;
}

function makeSelectRow(label, field, options, labels, cfg, onChange) {
    const row = document.createElement('div'); row.className = 'list-row';
    const lbl = document.createElement('span'); lbl.className = 'row-label'; lbl.textContent = label;
    const sel = document.createElement('select'); sel.className = 'select-input';
    options.forEach((opt, i) => {
        const o = document.createElement('option'); o.value = opt; o.textContent = labels[i];
        if (opt === cfg[field]) o.selected = true;
        sel.appendChild(o);
    });
    sel.addEventListener('change', () => { setField(field, sel.value); if (onChange) onChange(); });
    row.append(lbl, sel); return row;
}

function makeToggleRow(label, field, cfg, onChange) {
    const row = document.createElement('div'); row.className = 'list-row';
    const lbl = document.createElement('span'); lbl.className = 'row-label'; lbl.textContent = label;

    const wrap = document.createElement('label'); wrap.className = 'toggle';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!cfg[field];
    const track = document.createElement('div'); track.className = 'toggle-track';
    const thumb = document.createElement('div'); thumb.className = 'toggle-thumb';
    inp.addEventListener('change', () => { setField(field, inp.checked); if (onChange) onChange(); });
    wrap.append(inp, track, thumb);

    row.append(lbl, wrap); return row;
}

function makeCredSection(cfg) {
    const items = [];
    if (cfg.authScheme === 'bearer') {
        items.push({ label: 'Token', key: 'bearerToken', secure: true });
    } else if (cfg.authScheme === 'apiKey') {
        items.push({ label: 'Header Name', key: 'apiKeyHeader', placeholder: 'X-API-Key' });
        items.push({ label: 'API Key', key: 'apiKey', secure: true });
    } else if (cfg.authScheme === 'basic') {
        items.push({ label: 'Username', key: 'username' });
        items.push({ label: 'Password', key: 'password', secure: true });
    }

    const sec = makeSection('Credentials');
    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px; color:var(--text2); padding: 0 32px 6px; line-height:1.5;';
    note.textContent = 'Credentials are stored in session storage and cleared when this tab is closed.';
    sec.insertBefore(note, sec.querySelector('.card'));

    const card = document.createElement('div'); card.className = 'card';
    items.forEach(item => {
        const row = document.createElement('div'); row.className = 'list-row';
        const lbl = document.createElement('span'); lbl.className = 'row-label'; lbl.textContent = item.label;
        const inp = document.createElement('input'); inp.className = 'text-input';
        inp.type = item.secure ? 'password' : 'text';
        inp.placeholder = item.placeholder || (item.secure ? '••••••••' : '');
        inp.value = loadCred(cfg.id, item.key);
        inp.autocomplete = 'off';
        inp.addEventListener('change', () => saveCred(cfg.id, item.key, inp.value));
        row.append(lbl, inp); card.appendChild(row);
    });
    sec.appendChild(card);
    return sec;
}

function makeSymSection(cfg) {
    const sec = makeSection('Allowed Symbologies');
    const card = document.createElement('div'); card.className = 'card';
    SYMBOLOGIES.forEach(sym => {
        const row = document.createElement('div'); row.className = 'list-row';
        const lbl = document.createElement('span'); lbl.className = 'row-label'; lbl.textContent = SYM_LABELS[sym];
        const wrap = document.createElement('label'); wrap.className = 'toggle';
        const inp = document.createElement('input'); inp.type = 'checkbox';
        inp.checked = (cfg.allowedSymbologies || []).includes(sym);
        const track = document.createElement('div'); track.className = 'toggle-track';
        const thumb = document.createElement('div'); thumb.className = 'toggle-thumb';
        inp.addEventListener('change', () => {
            let syms = [...(cfg.allowedSymbologies || [])];
            syms = inp.checked ? [...new Set([...syms, sym])] : syms.filter(s => s !== sym);
            setField('allowedSymbologies', syms);
        });
        wrap.append(inp, track, thumb);
        row.append(lbl, wrap); card.appendChild(row);
    });
    sec.appendChild(card);
    return sec;
}

function makePreviewSection(cfg) {
    const sec = makeSection('Preview');
    const card = document.createElement('div'); card.className = 'card';
    const row = document.createElement('div'); row.className = 'list-row';
    row.style.alignItems = 'flex-start';
    const txt = document.createElement('div');
    txt.id = 'url-preview-text';
    txt.style.cssText = 'font-size:12px; color:var(--text2); word-break:break-all; line-height:1.5; font-family:monospace; padding:2px 0;';
    txt.textContent = previewURL(cfg);
    row.appendChild(txt); card.appendChild(row); sec.appendChild(card);
    return sec;
}

function makeExtraParamsSection(cfg) {
    const sec = document.createElement('div'); sec.className = 'list-section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding: 0 32px 6px;';
    const hdr = document.createElement('div'); hdr.className = 'section-header'; hdr.style.padding = '0'; hdr.textContent = 'Extra Parameters';
    const addBtn = document.createElement('button'); addBtn.className = 'add-param-btn'; addBtn.textContent = '+ Add';
    addBtn.addEventListener('click', () => {
        if (!cfg.extraParameters) cfg.extraParameters = [];
        cfg.extraParameters.push({ id: uid(), name: '', label: '', inputMode: 'keyboard', fixedValue: '' });
        saveConfigs(); renderConfigEdit(cfg);
    });
    headerRow.append(hdr, addBtn); sec.appendChild(headerRow);

    (cfg.extraParameters || []).forEach((param, idx) => {
        const card = document.createElement('div'); card.className = 'extra-param-card';

        const modeOptions = ['keyboard', 'numberpad', 'fixed'];
        const modeLabels  = ['Text', 'Number', 'Fixed'];

        [
            makeTextRow('Key',   'name',  param.name,  param, 'query_key',   v => { param.name  = v; saveConfigs(); updatePreview(cfg); }),
            makeTextRow('Label', 'label', param.label, param, 'User prompt', v => { param.label = v; saveConfigs(); updatePreview(cfg); }),
            makeSelectRow('Mode', 'inputMode', modeOptions, modeLabels, param, () => {
                saveConfigs(); renderConfigEdit(cfg);
            }),
        ].forEach(r => card.appendChild(r));

        if (param.inputMode === 'fixed') {
            const r = makeTextRow('Value', 'fixedValue', param.fixedValue, param, 'Fixed value', v => { param.fixedValue = v; saveConfigs(); });
            card.appendChild(r);
        }

        const delRow = document.createElement('div');
        delRow.className = 'list-row danger-row';
        delRow.textContent = 'Delete Parameter';
        delRow.addEventListener('click', () => {
            cfg.extraParameters.splice(idx, 1); saveConfigs(); renderConfigEdit(cfg);
        });
        card.appendChild(delRow);
        sec.appendChild(card);
    });

    return sec;
}

// ── Event wiring ──────────────────────────────────────────────────────────────
function wire() {
    $('btn-inspect').addEventListener('click', () => {
        S.inspectMode = !S.inspectMode; updateInspectBtn();
        if (S.scanActive) { stopScanning(); } resumeScanning();
    });

    $('btn-flash').addEventListener('click', toggleFlash);

    $('btn-config-title').addEventListener('click', () => {
        if (S.configs.length < 2) return;
        S.switcherOpen ? closeSwitcher() : openSwitcher();
    });

    document.addEventListener('click', e => {
        if (S.switcherOpen && !e.target.closest('#config-switcher') && !e.target.closest('#btn-config-title')) closeSwitcher();
    });

    $('btn-settings').addEventListener('click', showSettings);
    $('btn-settings-back').addEventListener('click', hideSettings);

    $('btn-config-add').addEventListener('click', () => {
        const cfg = newConfig(); S.configs.push(cfg); saveConfigs(); showConfigEdit(cfg.id);
    });

    $('btn-edit-back').addEventListener('click', hideConfigEdit);

    $('btn-send').addEventListener('click', prepareSend);
    $('btn-scan-again').addEventListener('click', resumeScanning);

    $('btn-params-cancel').addEventListener('click', () => hideSheet('sheet-params'));
    $('btn-params-send').addEventListener('click', () => { hideSheet('sheet-params'); doSend(S.pendingParams); });

    $('btn-response-close').addEventListener('click', hideResponseSheet);

    // Prevent body scroll on iOS
    document.addEventListener('touchmove', e => { if (e.target === document.body) e.preventDefault(); }, { passive: false });
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
    loadConfigs();
    updateConfigTitle();
    updateInspectBtn();
    updateFlashBtn();
    wire();
    fetch('https://api.github.com/repos/GJMontreal/QRRelayWeb/commits/main')
        .then(r => r.json()).then(d => {
            const el = document.getElementById('version-label');
            if (el && d.sha) el.textContent = d.sha.slice(0, 7);
        }).catch(() => {});
    await startCamera();
}

document.addEventListener('DOMContentLoaded', init);
