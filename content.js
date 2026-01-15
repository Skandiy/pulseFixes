const showNotificationFromContent = (id, payload) => {
    chrome.runtime.sendMessage({
        type: "show-notification",
        id,
        payload
    });
};

(async () => {
    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const { scripts = [], styles = [] } = await response.json();

    const syncSettings = await chrome.storage.sync.get(null);

    const enableFeatures = await chrome.storage.local.get('enableFeatures')
        .then(r => r.enableFeatures ?? false);

    const advancedSettings = await chrome.storage.local.get('advancedSettings')
        .then(r => r.advancedSettings ?? false);

    const settings = {
        ...syncSettings,
        enableFeatures,
        advancedSettings
    };

    if (!settings.enableFeatures) return;

    for (const path of styles) {
        let styleUrl = '';
        if (typeof path === 'object') {
            if (!settings[path.key]) continue;
            styleUrl = chrome.runtime.getURL(path.value);
        } else {
            styleUrl = chrome.runtime.getURL(path);
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleUrl;
        link.dataset.from = 'pulse-extension';
        document.head.appendChild(link);
    }

    window.PULSE_EXTENSION_SETTINGS = JSON.stringify(settings);

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === 'GET_PULSE_EXTENSION_SETTINGS') {
            sendResponse(window.PULSE_EXTENSION_SETTINGS);
        }

        if (msg?.type === 'EXECUTE_PAGE_REQUEST') {
            sendRequest(msg.payload)
                .then(data => sendResponse({ ok: true, data }))
                .catch(err => sendResponse({ ok: false, error: err.message }));
            return true;
        }

        if (msg?.type === 'GET_LOCAL_STORAGE_VALUE') {
            sendResponse({ ok: true, data: localStorage.getItem(msg.payload.key) });
        }
    });

    // const inlineScript = document.createElement('script');
    // inlineScript.textContent = `
    //     (function() {
    //         window.PULSE_EXTENSION_SETTINGS = ${JSON.stringify(settings)};
    //         window.dispatchEvent(
    //             new CustomEvent('PulseExtensionSettingsLoaded', {
    //                 detail: window.PULSE_EXTENSION_SETTINGS
    //             })
    //         );
    //     })();
    // `;
    // document.documentElement.appendChild(inlineScript);

    // передаём данные в window
    window.name = JSON.stringify({
        __PULSE_EXTENSION_SETTINGS__: settings
    });

    // подключаем внешний файл
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('scripts/pageBridge.js');
    script.dataset.from = 'pulse-extension';
    document.documentElement.appendChild(script);

    for (const path of scripts) {
        // const text = await fetch(chrome.runtime.getURL(path)).then(r => r.text());
        // const script = document.createElement('script');
        // script.textContent = text;
        // script.dataset.from = 'pulse-extension';
        // document.documentElement.appendChild(script);

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(path);
        script.dataset.from = 'pulse-extension';
        document.documentElement.appendChild(script)
    }

    window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        if (event.data?.type === "SHOW_NOTIFICATION") {
            showNotificationFromContent(event.data.id, event.data.payload);
        }
    });
})();

function sendRequest(payload) {
    return fetch("https://pulse.stack-it.ru/app/stackgateway/billing/pulse/kvpl", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "s-access-token": JSON.parse(localStorage.getItem('common')).authSystemStore.token_
        },
        body: JSON.stringify(payload)
    }).then(r => r.json());
}
