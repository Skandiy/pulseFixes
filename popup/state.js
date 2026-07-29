export function createPopupState() {
    return {
        pageSettings: null,
        storageSettings: {},
        currentEnabledFeatures: false,
        advancedSettingsVisible: false,
        activeSettingsPage: 'root',
    };
}

export function haveSettingsChanged(pageSettings, storageSettings) {
    if (!pageSettings) {
        return false;
    }

    const getComparableSettings = (settings) => {
        const {
            advancedSettings,
            enableFeatures,
            ...comparableSettings
        } = settings || {};

        return comparableSettings;
    };

    return JSON.stringify(getComparableSettings(pageSettings)) !== JSON.stringify(getComparableSettings(storageSettings));
}
