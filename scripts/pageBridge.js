(function () {
    const SHARED_TOKEN_STORAGE_KEY = 'SHARED_TOKEN_STORAGE';
    const SHARED_TOKEN_STORAGE_POLL_INTERVAL_MS = 1500;

    const settings = JSON.parse(window.name)?.__PULSE_EXTENSION_SETTINGS__ || null;
    if (!settings) return;

    window.PULSE_EXTENSION_SETTINGS = settings;

    window.name = undefined;

    function createDefaultSharedTokenStorage() {
        return {
            token: '1',
            refreshToken: '',
            additional: {
                serviceToken: '',
            },
        };
    }

    function normalizeSharedTokenStorage(rawValue) {
        let parsed = null;

        if (typeof rawValue === 'string') {
            try {
                parsed = JSON.parse(rawValue);
            } catch (error) {
                parsed = null;
            }
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            const normalized = createDefaultSharedTokenStorage();
            return {
                serialized: JSON.stringify(normalized),
                shouldWrite: true,
            };
        }

        const token = typeof parsed.token === 'string' && parsed.token.length > 0
            ? parsed.token
            : '1';
        const refreshToken = typeof parsed.refreshToken === 'string'
            ? parsed.refreshToken
            : '';
        const additional = parsed.additional && typeof parsed.additional === 'object' && !Array.isArray(parsed.additional)
            ? parsed.additional
            : {};
        const serviceToken = typeof additional.serviceToken === 'string'
            ? additional.serviceToken
            : '';

        const normalized = JSON.stringify({
            token,
            refreshToken,
            additional: {
                serviceToken,
            },
        });

        return {
            serialized: normalized,
            shouldWrite: rawValue !== normalized,
        };
    }

    function ensureSharedTokenStorageValue() {
        const rawValue = localStorage.getItem(SHARED_TOKEN_STORAGE_KEY);
        const normalized = normalizeSharedTokenStorage(rawValue);

        if (normalized.shouldWrite) {
            localStorage.setItem(SHARED_TOKEN_STORAGE_KEY, normalized.serialized);
            window.dispatchEvent(new StorageEvent('storage', {
                key: SHARED_TOKEN_STORAGE_KEY,
                oldValue: rawValue,
                newValue: normalized.serialized,
                storageArea: localStorage,
                url: window.location.href,
            }));
        }
    }

    function startSharedTokenStorageWatcher() {
        if (!settings.enableFeatures) {
            return;
        }

        ensureSharedTokenStorageValue();
        window.setInterval(() => {
            ensureSharedTokenStorageValue();
        }, SHARED_TOKEN_STORAGE_POLL_INTERVAL_MS);
    }

    window.dispatchEvent(
        new CustomEvent('PulseExtensionSettingsLoaded', {
            detail: settings
        })
    );

    startSharedTokenStorageWatcher();
})();
