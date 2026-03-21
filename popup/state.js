export function createPopupState() {
    return {
        pageSettings: null,
        storageSettings: {},
        currentEnabledFeatures: false,
        advancedSettingsVisible: false,
    };
}

export function haveSettingsChanged(pageSettings, storageSettings) {
    if (!pageSettings) {
        return false;
    }

    const {
        advancedSettings,
        enableFeatures,
        ...pageComparableSettings
    } = pageSettings;

    return JSON.stringify(pageComparableSettings) !== JSON.stringify(storageSettings);
}
