import { MESSAGE_TYPES, STORAGE_KEYS, URLS } from './shared-constants.js';
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

function appendScripts(scripts) {
    const bridgeScript = document.createElement('script');
    bridgeScript.src = chrome.runtime.getURL('scripts/pageBridge.js');
    bridgeScript.dataset.from = 'pulse-extension';
    document.documentElement.appendChild(bridgeScript);

    for (const path of scripts) {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(path);
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

function getAccessToken() {
    const SHARED_TOKEN_STORAGE = localStorage.getItem('SHARED_TOKEN_STORAGE');

    if (!SHARED_TOKEN_STORAGE) {
        throw new Error('SHARED_TOKEN_STORAGE storage entry is missing');
    }

    const parsed = JSON.parse(SHARED_TOKEN_STORAGE);
    const token = parsed?.token;

    if (!token) {
        throw new Error('auth token is missing');
    }

    return token;
}

function sendRequest(payload) {
    return fetch(URLS.PULSE_KVPL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'authorization': 'Bearer '+getAccessToken(),
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
    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const { scripts = [], styles = [] } = await response.json();
    const settings = await getExtensionSettings();

    if (!settings[STORAGE_KEYS.ENABLE_FEATURES]) {
        return;
    }

    appendStyles(styles, settings);
    setPageSettings(settings);
    registerRuntimeMessageHandlers();
    appendScripts(scripts);
    registerWindowNotificationBridge();
}
