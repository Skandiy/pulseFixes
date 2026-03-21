import { MESSAGE_TYPES, STORAGE_KEYS, URLS } from '../src/shared-constants.js';
import { getExtensionSettings, getSyncSettings, setLocalSetting, setSyncSetting } from '../src/shared-settings.js';
import { getCurrentTab, sendTabMessage } from '../src/shared-messaging.js';
import { syncCalendar } from './calendarSync.js';
import { haveSettingsChanged } from './state.js';
import {
    applyCheckboxValues,
    renderManifestInfo,
    setAdvancedVisibility,
    setReloadNoticeVisibility,
    setSettingsVisibility,
} from './ui.js';

async function requestPageSettings(tabId) {
    const pageSettings = await sendTabMessage(tabId, {
        type: MESSAGE_TYPES.GET_SETTINGS,
    });

    return JSON.parse(pageSettings);
}

function buildAdvancedSettingsUnlock(onUnlocked) {
    let count = 0;
    let timer = null;

    return async () => {
        if (count < 0) {
            return;
        }

        clearTimeout(timer);
        count += 1;

        if (count < 10) {
            timer = setTimeout(() => {
                count = 0;
            }, 1000);
            return;
        }

        await setLocalSetting(STORAGE_KEYS.ADVANCED_SETTINGS, true);
        onUnlocked();
        clearTimeout(timer);
        count = -1;
    };
}

export async function initializePopup(state, elements) {
    renderManifestInfo(elements, chrome.runtime.getManifest());

    const extensionSettings = await getExtensionSettings();
    const syncSettings = await getSyncSettings();

    state.storageSettings = syncSettings;
    state.currentEnabledFeatures = Boolean(extensionSettings.enableFeatures);
    state.advancedSettingsVisible = Boolean(extensionSettings.advancedSettings);

    elements.enableFeatures.checked = state.currentEnabledFeatures;
    applyCheckboxValues(elements.checkboxes, syncSettings);
    setSettingsVisibility(elements, state.currentEnabledFeatures);
    setAdvancedVisibility(elements, state.advancedSettingsVisible);
}

export function bindPopupEvents(state, elements) {
    elements.applyButton.addEventListener('click', async () => {
        const tab = await getCurrentTab();

        if (!tab) {
            return;
        }

        await chrome.tabs.reload(tab.id);
        window.close();
    });

    elements.enableFeatures.addEventListener('click', async (event) => {
        const enabled = event.target.checked;
        await setLocalSetting(STORAGE_KEYS.ENABLE_FEATURES, enabled);

        setSettingsVisibility(elements, enabled);

        if (state.currentEnabledFeatures !== enabled) {
            setReloadNoticeVisibility(elements, true);
            return;
        }

        setReloadNoticeVisibility(elements, haveSettingsChanged(state.pageSettings, state.storageSettings));
    });

    elements.infoButton.addEventListener('click', buildAdvancedSettingsUnlock(() => {
        state.advancedSettingsVisible = true;
        setAdvancedVisibility(elements, true);
    }));

    elements.checkboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', async (event) => {
            const { id, checked } = event.target;
            await setSyncSetting(id, checked);
            state.storageSettings = await getSyncSettings();
            setReloadNoticeVisibility(elements, haveSettingsChanged(state.pageSettings, state.storageSettings));
        });
    });

    elements.syncCalendarButton.addEventListener('click', async () => {
        const calendarData = await syncCalendar();
        elements.calendarLink.textContent = calendarData.url;
        elements.calendarLink.href = calendarData.url;
    });
}

export async function syncPopupWithCurrentTab(state, elements) {
    const tab = await getCurrentTab();

    if (!tab || !tab.url || !tab.url.startsWith(URLS.PULSE_BASE)) {
        return;
    }

    try {
        state.pageSettings = await requestPageSettings(tab.id);
        setReloadNoticeVisibility(elements, haveSettingsChanged(state.pageSettings, state.storageSettings));
    } catch (error) {
        console.warn('Не удалось получить настройки со страницы:', error);
    }
}
