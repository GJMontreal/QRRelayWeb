import { S } from './state.js';
import { activeCfg, saveConfigs, uid, newConfig, loadCred, saveCred } from './config.js';
import { SYMBOLOGIES, SYM_LABELS } from './constants.js';
import { $ } from './utils.js';
import { showScreen, hideScreen, updateConfigTitle, showCredWarning, refreshScannerEngineLabel } from './ui.js';
import { startLocationWatch } from './camera.js';

// ── Settings screen ───────────────────────────────────────────────────────────
export function showSettings() { renderConfigsList(); refreshScannerEngineLabel(); showScreen('screen-settings'); }
export function hideSettings()  { hideScreen('screen-settings'); }

// ── Config list ───────────────────────────────────────────────────────────────
export function renderConfigsList() {
    const container = $('configs-list');
    container.innerHTML = '';

    const section = makeSection('');
    const card = document.createElement('div'); card.className = 'card';

    S.configs.forEach(cfg => {
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
            const chk = document.createElement('span'); chk.style.color = 'var(--accent)'; chk.textContent = '✓';
            row.appendChild(main); row.appendChild(chk);
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

export function duplicateCfg(id) {
    const orig = S.configs.find(c => c.id === id); if (!orig) return;
    const copy = { ...orig, extraParameters: orig.extraParameters.map(p => ({...p})), id: uid(), name: `${orig.name} Copy` };
    const idx = S.configs.findIndex(c => c.id === id);
    S.configs.splice(idx + 1, 0, copy);
    saveConfigs(); renderConfigsList();
    if (orig.authScheme !== 'unauthenticated') showCredWarning();
}

export function confirmDelete(id) {
    const cfg = S.configs.find(c => c.id === id); if (!cfg) return;
    if (!confirm(`Delete "${cfg.name}"?\n\nThis cannot be undone.`)) return;
    const idx = S.configs.findIndex(c => c.id === id);
    S.configs.splice(idx, 1);
    if (S.activeId === id) S.activeId = S.configs[0]?.id || null;
    if (!S.configs.length) { const d = newConfig('Default'); S.configs.push(d); S.activeId = d.id; }
    saveConfigs(); updateConfigTitle(); renderConfigsList();
}

// ── Config edit screen ────────────────────────────────────────────────────────
export function showConfigEdit(id) {
    const cfg = S.configs.find(c => c.id === id); if (!cfg) return;
    S.editingId = id;
    renderConfigEdit(cfg);
    showScreen('screen-config-edit');
}

export function hideConfigEdit() {
    hideScreen('screen-config-edit');
    renderConfigsList(); updateConfigTitle();
}

export function setField(field, value) {
    const cfg = S.configs.find(c => c.id === S.editingId); if (!cfg) return;
    cfg[field] = value; saveConfigs();
    updatePreview(cfg);
}

export function previewURL(cfg) {
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
        if (p.inputMode === 'fixed')          url += `&${p.name}=${p.fixedValue}`;
        else if (p.inputMode === 'numberpad') url += `&${p.name}=0`;
        else                                  url += `&${p.name}=…`;
    }
    return url;
}

export function updatePreview(cfg) {
    const el = document.getElementById('url-preview-text');
    if (el) el.textContent = previewURL(cfg);
}

export function renderConfigEdit(cfg) {
    $('edit-screen-title').textContent = cfg.name || 'Configuration';
    const container = $('config-edit-form');
    container.innerHTML = '';

    container.appendChild(makeSection('General', [
        makeTextRow('Name', 'name', cfg.name, cfg, 'My Server', v => {
            setField('name', v); $('edit-screen-title').textContent = v || 'Configuration';
        }),
    ]));

    container.appendChild(makeSection('Endpoint', [
        makeSelectRow('Scheme', 'scheme', ['https','http'], ['HTTPS','HTTP'], cfg),
        makeTextRow('Host', 'host', cfg.host, cfg, 'example.com'),
        makeTextRow('Port', 'port', cfg.port || '', cfg, 'Optional'),
        makeTextRow('Path', 'endpoint', cfg.endpoint, cfg, '/scan'),
        makeTextRow('Parameter', 'parameterName', cfg.parameterName, cfg, 'code'),
    ]));

    container.appendChild(makeSection('Authentication', [
        makeSelectRow('Auth', 'authScheme',
            ['unauthenticated','bearer','apiKey','basic'],
            ['None','Bearer Token','API Key','Basic Auth'],
            cfg, () => { saveConfigs(); renderConfigEdit(S.configs.find(c => c.id === S.editingId)); }
        ),
    ]));

    if (cfg.authScheme !== 'unauthenticated') {
        container.appendChild(makeCredSection(cfg));
    }

    container.appendChild(makeSection('Options', [
        makeToggleRow('Include Timestamp', 'includeTimestamp', cfg),
        makeToggleRow('Include Location',  'includeLocation',  cfg, () => { if (cfg.includeLocation) startLocationWatch(); }),
        makeToggleRow('Show Scanned Code', 'showScannedCode',  cfg),
        makeToggleRow('Auto Send',         'autoSend',         cfg),
        makeToggleRow('Show Server Response', 'showServerResponse', cfg),
        makeTextRow('Cooldown (seconds)', 'scanCooldown', String(cfg.scanCooldown ?? 2), cfg, '2', v => setField('scanCooldown', parseInt(v) || 0), 'number'),
    ]));

    container.appendChild(makeSymSection(cfg));
    container.appendChild(makeExtraParamsSection(cfg));
    container.appendChild(makePreviewSection(cfg));

    const pad = document.createElement('div'); pad.style.height = '40px';
    container.appendChild(pad);
}

// ── Section builders ──────────────────────────────────────────────────────────
export function makeSection(title, rowEls = []) {
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

export function makeTextRow(label, field, value, cfg, placeholder = '', onSave, inputType = 'text') {
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

export function makeSelectRow(label, field, options, labels, cfg, onChange) {
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

export function makeToggleRow(label, field, cfg, onChange) {
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

export function makeCredSection(cfg) {
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

export function makeSymSection(cfg) {
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

export function makePreviewSection(cfg) {
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

export function makeExtraParamsSection(cfg) {
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
