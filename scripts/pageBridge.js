(function () {
    const settings = JSON.parse(window.name)?.__PULSE_EXTENSION_SETTINGS__ || null;
    if (!settings) return;

    window.PULSE_EXTENSION_SETTINGS = settings;

    window.name = undefined

    window.dispatchEvent(
        new CustomEvent('PulseExtensionSettingsLoaded', {
            detail: settings
        })
    );
})();
