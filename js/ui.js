import { S } from './state.js';
import { activeCfg, saveConfigs } from './config.js';
import { $, showToast } from './utils.js';
import { resumeScanning, startCooldown } from './camera.js';
import { prepareSend, doSend } from './network.js';

// ── Toolbar state buttons ──────────────────────────────────────────────────────
export function updateConfigTitle() {
    const cfg = activeCfg();
    $('config-title-text').textContent = cfg ? cfg.name : '—';
    const multi = S.configs.length > 1;
    $('config-chevron').style.display = multi ? '' : 'none';
}

export function updateInspectBtn() { $('btn-inspect').classList.toggle('active', S.inspectMode); }
export function updateFlashBtn()   { $('btn-flash').classList.toggle('active', S.flashOn); }

// ── Result panel ──────────────────────────────────────────────────────────────
export function renderResultPanel() {
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
    if (S.inspectMode) {
        sendBtn.style.display = 'none';
    } else {
        sendBtn.style.display = '';
        sendBtn.disabled = S.isSending;
    }

    $('send-spinner').style.display = S.isSending ? 'block' : 'none';
}

// ── Config switcher ───────────────────────────────────────────────────────────
export function renderSwitcher() {
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

export function openSwitcher() {
    renderSwitcher();
    S.switcherOpen = true;
    $('config-switcher').style.display = 'block';
    $('config-chevron').classList.add('open');
}

export function closeSwitcher() {
    S.switcherOpen = false;
    $('config-switcher').style.display = 'none';
    $('config-chevron').classList.remove('open');
}

// ── Panels (sheets and slide screens share the same show/hide mechanism) ─────
export function showScreen(id) {
    const el = $(id);
    el.style.display = 'flex';
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}

export function hideScreen(id) {
    const el = $(id);
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => { el.style.display = 'none'; }, { once: true });
}

// ── Scanner engine label ──────────────────────────────────────────────────────
export function refreshScannerEngineLabel() {
    const el = document.getElementById('scanner-engine-label');
    if (!el) return;
    if (S.detector) el.textContent = 'scanner: BarcodeDetector (native)';
    else if (S.zxingWasm) el.textContent = 'scanner: zxing-wasm';
    else el.textContent = 'scanner: initialising…';
}

// ── Params sheet ──────────────────────────────────────────────────────────────
export function showParamsSheet(params) {
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
    showScreen('sheet-params');
}

// ── Response sheet ────────────────────────────────────────────────────────────
export function showResponseSheet(html) {
    const frame = $('response-frame');
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    frame.src = url;
    frame._blobUrl = url;
    showScreen('sheet-response');
}

export function hideResponseSheet() {
    hideScreen('sheet-response');
    const frame = $('response-frame');
    if (frame._blobUrl) { URL.revokeObjectURL(frame._blobUrl); frame._blobUrl = null; }
    const cfg = activeCfg();
    startCooldown(cfg.scanCooldown ?? 2);
}

// ── Credential warning ────────────────────────────────────────────────────────
export function showCredWarning() {
    document.querySelectorAll('.cred-warning').forEach(e => e.remove());
    const el = document.createElement('div'); el.className = 'cred-warning';
    el.textContent = 'Credentials not copied — re-enter them in the duplicate';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}
