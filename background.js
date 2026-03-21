import { MESSAGE_TYPES, URLS } from './src/shared-constants.js';

// MV3 Service Worker

const recentByMsgId = Object.create(null);
const notifMeta = Object.create(null);

async function executeLocalHttpRequest(payload) {
    const controller = new AbortController();
    const timeoutMs = Number.isInteger(payload?.timeoutMs) ? payload.timeoutMs : 1200;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(payload.url, {
            method: payload?.method || 'GET',
            headers: payload?.headers || undefined,
            body: payload?.body || undefined,
            signal: controller.signal,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());
        let body = null;

        if (payload?.responseType === 'json') {
            try {
                body = await response.json();
            } catch (_) {
                body = null;
            }
        } else if (payload?.responseType === 'text') {
            body = await response.text();
        }

        return {
            ok: true,
            data: {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body,
            },
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || 'Local HTTP request failed',
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Извлекает путь из subtitle (БЕЗ ИЗМЕНЕНИЙ)
 */
function extractTargetPathFromSubtitle(subtitle) {
    if (!subtitle || typeof subtitle !== 'string') return null;

    let m = subtitle.match(/\[[^\]]*]\(([^)]+)\)/);
    let raw = m ? m[1] : null;

    if (!raw) {
        const m2 = subtitle.match(/(\/(?:pulse\/)?projects\/\d+\/issues\/\d+(?:[/?#][^\s)]*)?)/i);
        raw = m2 ? m2[1] : null;
    }
    if (!raw) return null;

    raw = raw.trim().replace(/^['"]|['"]$/g, '');

    try {
        if (/^https?:\/\//i.test(raw)) {
            const u = new URL(raw);
            raw = u.pathname + (u.search || '') + (u.hash || '');
        }
    } catch (_) {}

    if (!raw.startsWith('/')) raw = '/' + raw;

    if (!raw.startsWith('/pulse/')) {
        raw = raw.startsWith('/pulse') ? raw : '/pulse' + raw;
    }
    raw = raw.replace(/^\/pulse\/+/, '/pulse/');

    return raw;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.EXECUTE_LOCAL_HTTP_REQUEST) {
        executeLocalHttpRequest(message.payload)
            .then((result) => sendResponse(result))
            .catch((error) => sendResponse({
                ok: false,
                error: error?.message || 'Local HTTP request failed',
            }));
        return true;
    }

    if (message?.type !== MESSAGE_TYPES.SHOW_NOTIFICATION) return;

    const msgId = message.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (recentByMsgId[msgId]) {
        sendResponse({ status: 'dup' });
        return true;
    }

    const payload = message.payload || {};
    const subtitle = payload.subtitle || '';
    const relativePath = extractTargetPathFromSubtitle(subtitle);

    const base = sender?.tab?.url
        ? new URL(sender.tab.url).origin
        : URLS.PULSE_BASE;

    const fullUrl = relativePath ? new URL(relativePath, base).href : null;
    const notificationId = `pulse:${Date.now()}:${msgId}`;

    chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: payload.avatar || 'icons/128.png',
        title: payload.title || 'Уведомление',
        message: subtitle || 'Текст уведомления',
        contextMessage: payload.member || '',
        priority: 2,
        requireInteraction: true,
        buttons: [
            { title: 'Перейти к заявке' },
            { title: 'Закрыть' }
        ]
    });

    notifMeta[notificationId] = {
        tabId: sender?.tab?.id ?? null,
        url: fullUrl
    };

    recentByMsgId[msgId] = 1;
    setTimeout(() => delete recentByMsgId[msgId], 10_000);

    sendResponse({ status: 'ok' });
    return true;
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const meta = notifMeta[notificationId];
    if (!meta) return;

    if (buttonIndex === 0 && meta.tabId != null && meta.url) {
        chrome.tabs.update(meta.tabId, { url: meta.url });
    }

    chrome.notifications.clear(notificationId);
    delete notifMeta[notificationId];
});

chrome.notifications.onClosed.addListener((notificationId) => {
    delete notifMeta[notificationId];
});
