import { S } from './state.js';
import { loadConfigs, newConfig, saveConfigs } from './config.js';
import { $ } from './utils.js';
import { updateConfigTitle, updateInspectBtn, updateFlashBtn, openSwitcher, closeSwitcher, hideSheet, hideResponseSheet } from './ui.js';
import { showSettings, hideSettings, showConfigEdit, hideConfigEdit } from './config-edit.js';
import { startCamera, stopScanning, resumeScanning, toggleFlash } from './camera.js';
import { prepareSend, doSend } from './network.js';

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
