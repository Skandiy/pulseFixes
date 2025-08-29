// Дедуп по message.id (как у тебя было) + мета по уведомлению
const recentByMsgId = Object.create(null);       // messageId -> 1
const notifMeta      = Object.create(null);       // notificationId -> { tabId, url }

/**
 * Извлекает путь из subtitle.
 * Поддерживает:
 *  - Markdown: [текст](/projects/229/issues/219090)
 *  - Голый текст: ... /projects/229/issues/219090 ...
 *  - Полные URL: https://host/pulse/projects/...
 * Возвращает строку вида: /pulse/projects/229/issues/219090 (с сохранёнными ?query и #hash, если были)
 */
function extractTargetPathFromSubtitle(subtitle) {
    if (!subtitle || typeof subtitle !== 'string') return null;

    // 1) Markdown-ссылка
    let m = subtitle.match(/\[[^\]]*]\(([^)]+)\)/);
    let raw = m ? m[1] : null;

    // 2) Если Markdown не найден — ищем "голый" путь
    if (!raw) {
        const m2 = subtitle.match(/(\/(?:pulse\/)?projects\/\d+\/issues\/\d+(?:[/?#][^\s)]*)?)/i);
        raw = m2 ? m2[1] : null;
    }
    if (!raw) return null;

    raw = raw.trim().replace(/^['"]|['"]$/g, '');

    // 3) Если это полный URL — забираем только path(+query+hash)
    try {
        if (/^https?:\/\//i.test(raw)) {
            const u = new URL(raw);
            raw = u.pathname + (u.search || '') + (u.hash || '');
        }
    } catch (_) {}

    // 4) Гарантируем ведущий слеш
    if (!raw.startsWith('/')) raw = '/' + raw;

    // 5) Ровно один префикс /pulse
    if (!raw.startsWith('/pulse/')) {
        if (raw === '/pulse') raw = '/pulse/';
        raw = raw.startsWith('/pulse') ? raw : '/pulse' + raw;
    }
    raw = raw.replace(/^\/pulse\/+/, '/pulse/');

    return raw;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'show-notification') return;

    // Дедуп по message.id на короткое время
    const msgId = message.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (recentByMsgId[msgId]) {
        sendResponse?.({ status: 'dup' });
        return true;
    }

    const payload = message.payload || {};
    const subtitle = payload.subtitle || '';
    const relativePath = extractTargetPathFromSubtitle(subtitle);

    // База для абсолютного URL — та же вкладка, откуда пришло сообщение; иначе — fallback
    const base = (sender?.tab?.url ? new URL(sender.tab.url).origin : 'https://pulse.stack-it.ru');
    const fullUrl = relativePath ? new URL(relativePath, base).href : null;

    // Генерируем свой notificationId (обязательно!)
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
        ],
        // isClickable: true, // если захочешь обрабатывать клик по телу уведомления
    }, () => {
        // Сохраняем метаданные для обработки кликов
        notifMeta[notificationId] = {
            tabId: sender?.tab?.id ?? null,
            url: fullUrl
        };
    });

    recentByMsgId[msgId] = 1;
    setTimeout(() => { delete recentByMsgId[msgId]; }, 10_000);

    sendResponse?.({ status: 'ok' });
    return true;
});

// Клик по кнопкам
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    const meta = notifMeta[notificationId];
    if (!meta) return;

    if (buttonIndex === 0) {
        // Первая кнопка: открыть ссылку в той же вкладке
        if (meta.tabId != null && meta.url) {
            chrome.tabs.update(meta.tabId, { url: meta.url });
        }
        chrome.notifications.clear(notificationId);
        delete notifMeta[notificationId];
    } else if (buttonIndex === 1) {
        // Вторая кнопка: закрыть уведомление
        chrome.notifications.clear(notificationId);
        delete notifMeta[notificationId];
    }
});

// Чистим мету при закрытии уведомления (на всякий случай)
chrome.notifications.onClosed.addListener((notificationId, byUser) => {
    if (notifMeta[notificationId]) {
        delete notifMeta[notificationId];
    }
});



chrome.webRequest.onHeadersReceived.addListener(
    function (details) {
        let headers = details.responseHeaders.filter(
            (header) => header.name.toLowerCase() !== "content-security-policy"
        );

        // Подставляем свой CSP (или просто убираем полностью)
        headers.push({
            name: "Content-Security-Policy",
            value: "frame-ancestors *;" // либо 'self' https://ваш-домен.ru
        });

        return { responseHeaders: headers };
    },
    { urls: ["*://chat.stack-it.ru/*"] },
    ["blocking", "responseHeaders"]
);
