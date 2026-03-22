import { STORAGE_CONFIGS, STORAGE_ACTIVE, CRED_PREFIX, SYMBOLOGIES } from './constants.js';
import { S } from './state.js';

export function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

export function newConfig(name = 'New Configuration') {
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

export function saveConfigs() {
    localStorage.setItem(STORAGE_CONFIGS, JSON.stringify(S.configs));
    localStorage.setItem(STORAGE_ACTIVE, S.activeId || '');
}

export function loadConfigs() {
    try { S.configs = JSON.parse(localStorage.getItem(STORAGE_CONFIGS)) || []; }
    catch { S.configs = []; }
    S.activeId = localStorage.getItem(STORAGE_ACTIVE) || null;
    if (!S.configs.length) {
        const c = newConfig('Default'); S.configs.push(c); S.activeId = c.id;
    } else if (!S.configs.find(c => c.id === S.activeId)) {
        S.activeId = S.configs[0].id;
    }
}

export function activeCfg() { return S.configs.find(c => c.id === S.activeId) || S.configs[0]; }

// ── Credentials (sessionStorage — cleared on tab close) ───────────────────────
export function saveCred(id, key, val) {
    if (val) sessionStorage.setItem(`${CRED_PREFIX}${id}_${key}`, val);
    else sessionStorage.removeItem(`${CRED_PREFIX}${id}_${key}`);
}

export function loadCred(id, key) {
    return sessionStorage.getItem(`${CRED_PREFIX}${id}_${key}`) || '';
}
