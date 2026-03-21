import {
    DEFAULT_LOCAL_SETTINGS,
    DEFAULT_SYNC_SETTINGS,
    STORAGE_KEYS,
} from './shared-constants.js';

function storageGet(area, keys = null) {
    return chrome.storage[area].get(keys);
}

function storageSet(area, data) {
    return chrome.storage[area].set(data);
}

export function getDefaultSettings() {
    return {
        ...DEFAULT_SYNC_SETTINGS,
        ...DEFAULT_LOCAL_SETTINGS,
    };
}

export async function getSyncSettings() {
    const stored = await storageGet('sync', null);

    return {
        ...DEFAULT_SYNC_SETTINGS,
        ...stored,
    };
}

export async function getLocalSettings() {
    const stored = await storageGet('local', [
        STORAGE_KEYS.ENABLE_FEATURES,
        STORAGE_KEYS.ADVANCED_SETTINGS,
    ]);

    return {
        ...DEFAULT_LOCAL_SETTINGS,
        ...stored,
    };
}

export async function getExtensionSettings() {
    const [syncSettings, localSettings] = await Promise.all([
        getSyncSettings(),
        getLocalSettings(),
    ]);

    return {
        ...syncSettings,
        ...localSettings,
    };
}

export function setSyncSetting(key, value) {
    return storageSet('sync', { [key]: value });
}

export function setLocalSetting(key, value) {
    return storageSet('local', { [key]: value });
}
