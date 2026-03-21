import { initializePopup, bindPopupEvents, syncPopupWithCurrentTab } from './actions.js';
import { createPopupState } from './state.js';
import { getPopupElements } from './ui.js';

async function loadPopup() {
    const state = createPopupState();
    const elements = getPopupElements();

    await initializePopup(state, elements);
    bindPopupEvents(state, elements);
    await syncPopupWithCurrentTab(state, elements);
}

window.addEventListener('DOMContentLoaded', () => {
    loadPopup().catch((error) => {
        console.error('Popup initialization failed:', error);
    });
}, false);
