import { S } from './state.js';
import { activeCfg, loadCred } from './config.js';
import { showToast } from './utils.js';
import { showParamsSheet, showResponseSheet, renderResultPanel } from './ui.js';
import { startCooldown } from './camera.js';

export function buildURL(cfg, paramValues) {
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

export function buildHeaders(cfg) {
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

export function prepareSend() {
    const cfg = activeCfg();
    const needInput = (cfg.extraParameters || []).filter(p => p.inputMode !== 'fixed');
    if (needInput.length) {
        S.pendingParams = {};
        showParamsSheet(needInput);
    } else {
        doSend({});
    }
}

export async function doSend(paramValues) {
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
