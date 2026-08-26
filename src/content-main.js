import { MESSAGE_TYPES, SETTING_KEYS, URLS, WEB_STORAGE_KEYS } from './shared-constants.js';
import { migrateWebStorage } from './legacy-storage.js';
import { getExtensionSettings } from './shared-settings.js';

function appendStyles(styles, settings) {
    for (const path of styles) {
        let stylePath = path;

        if (typeof path === 'object') {
            if (!settings[path.key]) {
                continue;
            }

            stylePath = path.value;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = chrome.runtime.getURL(stylePath);
        link.dataset.from = 'pulse-extension';
        document.head.appendChild(link);
    }
}

function appendScripts(scripts, settings) {
    const bridgeScript = document.createElement('script');
    bridgeScript.src = chrome.runtime.getURL('scripts/pageBridge.js');
    bridgeScript.dataset.from = 'pulse-extension';
    document.documentElement.appendChild(bridgeScript);

    for (const path of scripts) {
        let scriptPath = path;

        if (typeof path === 'object') {
            if (!settings[path.key]) {
                continue;
            }

            scriptPath = path.value;
        }

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(scriptPath);
        script.async = false;
        script.dataset.from = 'pulse-extension';
        document.documentElement.appendChild(script);
    }
}

function setPageSettings(settings) {
    window.PULSE_EXTENSION_SETTINGS = JSON.stringify(settings);
    window.name = JSON.stringify({
        __PULSE_EXTENSION_SETTINGS__: settings,
    });
}

function syncPageLocalStorageSettings(settings) {
    if (settings[SETTING_KEYS.TRICK_DEBUG_LOGGING]) {
        localStorage.setItem(WEB_STORAGE_KEYS.DEBUG_ENABLED, '1');
        return;
    }

    localStorage.removeItem(WEB_STORAGE_KEYS.DEBUG_ENABLED);
}

function sendRequest(payload) {
    return fetch(URLS.PULSE_KVPL, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    }).then((response) => response.json());
}

function registerRuntimeMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type === MESSAGE_TYPES.GET_SETTINGS) {
            sendResponse(window.PULSE_EXTENSION_SETTINGS);
            return false;
        }

        if (message?.type === MESSAGE_TYPES.EXECUTE_PAGE_REQUEST) {
            sendRequest(message.payload)
                .then((data) => sendResponse({ ok: true, data }))
                .catch((error) => sendResponse({ ok: false, error: error.message }));
            return true;
        }

        if (message?.type === MESSAGE_TYPES.GET_LOCAL_STORAGE_VALUE) {
            sendResponse({
                ok: true,
                data: localStorage.getItem(message.payload.key),
            });
        }

        return false;
    });
}

function registerWindowNotificationBridge() {
    window.addEventListener('message', (event) => {
        if (event.source !== window) {
            return;
        }

        if (event.data?.type === MESSAGE_TYPES.WINDOW_SHOW_NOTIFICATION) {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.SHOW_NOTIFICATION,
                id: event.data.id,
                payload: event.data.payload,
            });
        }

        if (event.data?.type === MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST) {
            sendRequest(event.data.payload)
                .then((data) => {
                    window.postMessage({
                        type: MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST_RESULT,
                        id: event.data.id,
                        response: {
                            ok: true,
                            data,
                        },
                    }, '*');
                })
                .catch((error) => {
                    window.postMessage({
                        type: MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST_RESULT,
                        id: event.data.id,
                        response: {
                            ok: false,
                            error: error.message,
                        },
                    }, '*');
                });
        }

        if (event.data?.type === MESSAGE_TYPES.WINDOW_EXECUTE_LOCAL_HTTP_REQUEST) {
            chrome.runtime.sendMessage({
                type: MESSAGE_TYPES.EXECUTE_LOCAL_HTTP_REQUEST,
                payload: event.data.payload,
            })
                .then((response) => {
                    window.postMessage({
                        type: MESSAGE_TYPES.WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT,
                        id: event.data.id,
                        response,
                    }, '*');
                })
                .catch((error) => {
                    window.postMessage({
                        type: MESSAGE_TYPES.WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT,
                        id: event.data.id,
                        response: {
                            ok: false,
                            error: error.message,
                        },
                    }, '*');
                });
        }
    });
}

export async function bootstrapContent() {
    // Первым делом и без await: переименование ключей должно случиться до первого обращения
    // к ним со страницы и не зависеть от того, переживёт ли fetch обновление расширения.
    migrateWebStorage();

    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const { scripts = [], styles = [] } = await response.json();

    // Консолидация настроек в один ключ обязана произойти ДО проверки enableFeatures:
    // иначе у существующих пользователей первый запуск прочитает пустой ключ, увидит
    // дефолтный false и выключит расширение, так и не выполнив миграцию.
    const settings = await getExtensionSettings();

    if (!settings[SETTING_KEYS.ENABLE_FEATURES]) {
        return;
    }

    appendStyles(styles, settings);
    syncPageLocalStorageSettings(settings);
    setPageSettings(settings);
    registerRuntimeMessageHandlers();
    appendScripts(scripts, settings);
    registerWindowNotificationBridge();
}
