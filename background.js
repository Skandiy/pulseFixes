import {
    CALENDAR_SYNC_ALARM,
    MESSAGE_TYPES,
    NOTIFICATION_STATE_KEY,
    SETTINGS_STORAGE_AREA,
    SETTINGS_STORAGE_KEY,
    SETTING_KEYS,
    URLS,
} from './src/shared-constants.js';
import { getExtensionSettings } from './src/shared-settings.js';
import { getFrequencyDays, getNextSyncAt, isSyncDue } from './src/calendar-schedule.js';
import {
    buildSyncedState,
    readCalendarSyncState,
    syncCalendar,
    updateCalendarSyncState,
} from './src/calendar-sync.js';

// MV3 Service Worker

// Настройки переезжают в единственный ключ при первом же чтении. Дёргаем его сразу после
// обновления, чтобы миграция прошла до того, как пользователь откроет Pulse или popup.
function prepareSettings() {
    getExtensionSettings()
        .then(() => scheduleCalendarSync())
        .catch((error) => {
            console.error('[Trick Plus] Не удалось подготовить настройки:', error);
        });
}

chrome.runtime.onInstalled.addListener(prepareSettings);
chrome.runtime.onStartup.addListener(prepareSettings);

// ------------------------------------------------- расписание выгрузки календаря

/** Через сколько повторить попытку, если вкладка Пульса не открыта или сеть подвела. */
const CALENDAR_RETRY_DELAY_MS = 30 * 60 * 1000;

/**
 * Сколько раз подряд пробуем повторить. Дальше ждём следующего срока по расписанию:
 * если Пульс не открывали все выходные, стучаться в него каждые полчаса бессмысленно.
 */
const CALENDAR_MAX_RETRIES = 12;

/**
 * По какому промежутку видно, что это уже не серия повторов, а новый срок по расписанию:
 * повторы идут через полчаса, между сроками проходят часы. Без этого исчерпанный счётчик
 * навсегда лишал бы повторов и все следующие дни тоже.
 */
const CALENDAR_RETRY_STREAK_GAP_MS = CALENDAR_RETRY_DELAY_MS * 2;

const CALENDAR_ERROR_LIMIT = 160;

/** Текст под кнопку: без стека и без простыни, если сервер ответил целой страницей. */
function describeCalendarError(error) {
    const message = String(error?.message ?? error ?? '').trim() || 'Неизвестная ошибка';

    if (message.length <= CALENDAR_ERROR_LIMIT) {
        return message;
    }

    return `${message.slice(0, CALENDAR_ERROR_LIMIT - 1)}…`;
}

async function isCalendarSyncScheduled() {
    const settings = await getExtensionSettings();

    return Boolean(settings[SETTING_KEYS.ENABLE_FEATURES])
        && Boolean(settings[SETTING_KEYS.CALENDAR_SYNC])
        && getFrequencyDays(settings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY]) > 0;
}

/**
 * Ставит будильник на ближайший срок по расписанию. Вызывается после каждой попытки и
 * при любой правке настроек, поэтому расписание не накапливает состояние: момент
 * срабатывания всегда пересчитывается из настроек и отметки последней выгрузки.
 */
async function scheduleCalendarSync({ retry = false } = {}) {
    if (!(await isCalendarSyncScheduled())) {
        await chrome.alarms.clear(CALENDAR_SYNC_ALARM);
        return null;
    }

    const settings = await getExtensionSettings();
    const state = await readCalendarSyncState();
    const scheduledAt = getNextSyncAt(
        settings[SETTING_KEYS.CALENDAR_SYNC_TIME],
        settings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY],
        state.syncedAt,
    );

    // Повтор не может увести выгрузку дальше очередного срока — только приблизить
    const when = retry
        ? Math.min(scheduledAt, Date.now() + CALENDAR_RETRY_DELAY_MS)
        : scheduledAt;

    await chrome.alarms.create(CALENDAR_SYNC_ALARM, { when });

    return when;
}

/**
 * Выгружает календарь и запоминает ответ сервиса. Ошибку не пробрасывает: она тоже
 * часть состояния — popup показывает её под кнопкой, даже если выгрузку запускал не он.
 *
 * Счётчик повторов ведётся только для фоновых запусков: ручной запуск повторять некому.
 */
async function runCalendarSync({ manual = false } = {}) {
    try {
        const result = await syncCalendar();

        if (!result.subscribeUrl) {
            throw new Error('Сервер не вернул ссылку на календарь');
        }

        return {
            ok: true,
            state: await updateCalendarSyncState(buildSyncedState(result, Date.now())),
        };
    } catch (error) {
        console.error('[Trick Plus] Не удалось синхронизировать календарь:', error);

        const previous = await readCalendarSyncState();

        return {
            ok: false,
            error: describeCalendarError(error),
            state: await updateCalendarSyncState({
                lastError: describeCalendarError(error),
                lastErrorAt: Date.now(),
                retryCount: manual ? previous.retryCount : (previous.retryCount ?? 0) + 1,
            }),
        };
    }
}

/**
 * Будильник всегда стоит на ближайшее выбранное время суток, а редкие периодичности
 * пропускают лишние срабатывания здесь. Так смена времени в настройках сразу двигает
 * выгрузку, и при этом «раз в неделю» остаётся раз в неделю.
 */
async function runScheduledCalendarSync() {
    if (!(await isCalendarSyncScheduled())) {
        await chrome.alarms.clear(CALENDAR_SYNC_ALARM);
        return;
    }

    const settings = await getExtensionSettings();
    const state = await readCalendarSyncState();
    const days = getFrequencyDays(settings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY]);

    if (!isSyncDue(state.syncedAt, days)) {
        await scheduleCalendarSync();
        return;
    }

    const isRetry = state.lastErrorAt
        && Date.now() - state.lastErrorAt <= CALENDAR_RETRY_STREAK_GAP_MS;

    if (!isRetry && state.retryCount) {
        await updateCalendarSyncState({ retryCount: 0 });
    }

    const outcome = await runCalendarSync();

    await scheduleCalendarSync({
        retry: !outcome.ok && outcome.state.retryCount <= CALENDAR_MAX_RETRIES,
    });
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== CALENDAR_SYNC_ALARM) {
        return;
    }

    runScheduledCalendarSync().catch((error) => {
        console.error('[Trick Plus] Расписание выгрузки календаря сорвалось:', error);
    });
});

/*
 * Расписание правится из popup, а исполняется здесь. Отметку последней выгрузки
 * слушать не нужно и нельзя: пишет её только этот же worker и сразу после записи
 * сам ставит будильник — событие хранилища перебило бы отложенный повтор
 * очередным сроком по расписанию.
 */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== SETTINGS_STORAGE_AREA || !changes[SETTINGS_STORAGE_KEY]) {
        return;
    }

    scheduleCalendarSync().catch((error) => {
        console.error('[Trick Plus] Не удалось пересчитать расписание календаря:', error);
    });
});

const recentByMsgId = Object.create(null);

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

// ------------------------------------------------------------- push-уведомления

/**
 * Уведомление создаётся с requireInteraction и ждёт клика сколько угодно, а service
 * worker выгружается через полминуты простоя. Поэтому адрес заявки переживает выгрузку
 * в chrome.storage.session: иначе к моменту клика от переменной в модуле ничего не
 * остаётся и не работает ни одна кнопка — включая «Закрыть».
 */
const NOTIFICATION_META_LIMIT = 50;

const NOTIFICATION_BUTTONS = Object.freeze({
    OPEN: 0,
    CLOSE: 1,
});

async function readNotificationMeta() {
    try {
        const stored = await chrome.storage.session.get(NOTIFICATION_STATE_KEY);

        return stored?.[NOTIFICATION_STATE_KEY] ?? {};
    } catch (error) {
        console.error('[Trick Plus] Не удалось прочитать данные уведомлений:', error);

        return {};
    }
}

async function rememberNotification(notificationId, meta) {
    const all = await readNotificationMeta();

    all[notificationId] = meta;

    // Строковые ключи идут в порядке добавления, поэтому лишние с начала — самые старые
    const ids = Object.keys(all);

    ids.slice(0, Math.max(0, ids.length - NOTIFICATION_META_LIMIT))
        .forEach((id) => delete all[id]);

    await chrome.storage.session.set({ [NOTIFICATION_STATE_KEY]: all });
}

async function forgetNotification(notificationId) {
    const all = await readNotificationMeta();

    if (!(notificationId in all)) {
        return;
    }

    delete all[notificationId];

    await chrome.storage.session.set({ [NOTIFICATION_STATE_KEY]: all });
}

/**
 * Вкладка, в которой открывать заявку: та, где пришло уведомление, а если её закрыли или
 * увели на другой сайт — любая другая с Пульсом. Новую заводим, только когда Пульса не
 * открыто вовсе: вторая копия рядом с первой пользователю не нужна.
 */
async function findNotificationTab(meta) {
    const origin = new URL(meta.url).origin;

    if (meta.tabId != null) {
        try {
            const tab = await chrome.tabs.get(meta.tabId);

            if (tab?.url?.startsWith(origin)) {
                return tab;
            }
        } catch (_) {
            // вкладку закрыли
        }
    }

    const tabs = await chrome.tabs.query({ url: `${origin}/*` });

    return tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
}

/**
 * Открывает заявку и переводит фокус на её вкладку и окно. Без фокуса кнопка срабатывает
 * незаметно: страница меняется где-то в фоне, а пользователь остаётся там же, где был.
 */
async function openNotificationTarget(meta) {
    if (!meta?.url) {
        return;
    }

    const tab = await findNotificationTab(meta);

    if (!tab) {
        await chrome.tabs.create({ url: meta.url, active: true });
        return;
    }

    // Уже открытую заявку не перезагружаем — достаточно перейти на вкладку
    await chrome.tabs.update(tab.id, tab.url === meta.url
        ? { active: true }
        : { active: true, url: meta.url });

    if (tab.windowId != null) {
        await chrome.windows.update(tab.windowId, { focused: true });
    }
}

/**
 * Показывает уведомление и запоминает, куда ведёт «Перейти к заявке». Сначала запись,
 * потом показ: клик может прилететь раньше, чем допишется хранилище.
 */
async function showTaskNotification(msgId, payload, sender) {
    const subtitle = payload.subtitle || '';
    const relativePath = extractTargetPathFromSubtitle(subtitle);

    const base = sender?.tab?.url
        ? new URL(sender.tab.url).origin
        : URLS.PULSE_BASE;

    const notificationId = `pulse:${Date.now()}:${msgId}`;

    await rememberNotification(notificationId, {
        tabId: sender?.tab?.id ?? null,
        url: relativePath ? new URL(relativePath, base).href : null,
    });

    await chrome.notifications.create(notificationId, {
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
}

/**
 * Закрываем уведомление в любом случае — даже если открывать нечего или переход сорвался.
 * Иначе «Закрыть» молча не делает ничего, а само оно с requireInteraction не уйдёт.
 */
async function handleNotificationButton(notificationId, buttonIndex) {
    const meta = (await readNotificationMeta())[notificationId] ?? null;

    try {
        if (buttonIndex === NOTIFICATION_BUTTONS.OPEN) {
            await openNotificationTarget(meta);
        }
    } finally {
        await chrome.notifications.clear(notificationId);
        await forgetNotification(notificationId);
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
    if (message?.type === MESSAGE_TYPES.CALENDAR_SYNC_RUN) {
        // Выгрузку ведёт worker, а не popup: закрытое окно не должно обрывать запрос
        runCalendarSync({ manual: true })
            .then(async (outcome) => {
                await scheduleCalendarSync();
                sendResponse(outcome);
            })
            .catch((error) => sendResponse({
                ok: false,
                error: describeCalendarError(error),
                state: null,
            }));
        return true;
    }

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

    // Отметку ставим до показа: показ асинхронный, а дубли приходят подряд
    recentByMsgId[msgId] = 1;
    setTimeout(() => delete recentByMsgId[msgId], 10_000);

    showTaskNotification(msgId, message.payload || {}, sender)
        .then(() => sendResponse({ status: 'ok' }))
        .catch((error) => {
            console.error('[Trick Plus] Не удалось показать уведомление:', error);
            sendResponse({ status: 'error', error: error?.message ?? String(error) });
        });

    return true;
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    handleNotificationButton(notificationId, buttonIndex).catch((error) => {
        console.error('[Trick Plus] Кнопка уведомления не сработала:', error);
    });
});

chrome.notifications.onClosed.addListener((notificationId) => {
    forgetNotification(notificationId).catch((error) => {
        console.error('[Trick Plus] Не удалось убрать данные уведомления:', error);
    });
});
