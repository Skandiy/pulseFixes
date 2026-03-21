export function getCurrentTab() {
    return chrome.tabs.query({ active: true, currentWindow: true })
        .then((tabs) => tabs[0] ?? null);
}

export function sendTabMessage(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
}

export function sendRuntimeMessage(message) {
    return chrome.runtime.sendMessage(message);
}
