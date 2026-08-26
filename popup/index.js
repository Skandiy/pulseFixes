import { initializePopup, bindPopupEvents, syncPopupWithCurrentTab } from './actions.js';
import { createPopupState } from './state.js';
import { getPopupElements } from './ui.js';

let bootLockReleased = false;

/**
 * До этого момента переключатели стоят без анимации: их состояние приезжает из хранилища
 * уже после разбора документа, и иначе popup при каждом открытии заново проигрывал бы
 * «включение» у давно включённых настроек.
 *
 * Принудительный пересчёт стилей обязателен: он фиксирует новые состояния, пока переходы
 * ещё выключены. Без него снятие блокировки и есть то самое изменение, за которое
 * цепляется анимация.
 */
function releaseBootLock() {
    if (bootLockReleased) {
        return;
    }

    bootLockReleased = true;
    void document.body.offsetHeight;
    document.body.classList.remove('is-booting');
}

async function loadPopup() {
    const state = createPopupState();
    const elements = getPopupElements();

    await initializePopup(state, elements);
    bindPopupEvents(state, elements);
    releaseBootLock();
    await syncPopupWithCurrentTab(state, elements);
}

window.addEventListener('DOMContentLoaded', () => {
    loadPopup().catch((error) => {
        console.error('Popup initialization failed:', error);
        releaseBootLock();
    });
}, false);
