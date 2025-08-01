(function () {
    let pulseSettingsPromise;

    window.getPulseSettings = function (timeout = 5000) {
        if (pulseSettingsPromise) return pulseSettingsPromise;

        pulseSettingsPromise = new Promise((resolve, reject) => {
            if (window.PULSE_EXTENSION_SETTINGS) {
                return resolve(window.PULSE_EXTENSION_SETTINGS);
            }

            const handler = (event) => {
                window.removeEventListener('PulseExtensionSettingsLoaded', handler);
                resolve(event.detail);
            };

            window.addEventListener('PulseExtensionSettingsLoaded', handler);

            setTimeout(() => {
                window.removeEventListener('PulseExtensionSettingsLoaded', handler);
                reject(new Error('Настройки не были загружены за отведённое время.'));
            }, timeout);
        });

        return pulseSettingsPromise;
    };
})();
