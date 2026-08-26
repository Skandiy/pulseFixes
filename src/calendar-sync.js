import {
    CALENDAR_SYNC_STATE_KEY,
    CALENDAR_UPLOAD_API_KEY,
    MESSAGE_TYPES,
    URLS,
} from './shared-constants.js';

/**
 * Потолок на всю синхронизацию. Без него прелоадер на кнопке крутился бы сколько
 * угодно: ни сбор событий через контент-скрипт, ни выгрузка сами по себе не обрываются.
 */
export const SYNC_TIMEOUT_MS = 15000;

/**
 * Сервис называет директорию пользователя его id и по нему же считает токен
 * ссылки, поэтому принимает только латиницу, цифры и . _ - : @
 */
const USER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$/;

/** Окно выгрузки: прошлый месяц целиком и год вперёд. */
const HISTORY_MONTHS = 1;
const FUTURE_MONTHS = 12;

// -------------------------------------------------------------- вкладка Pulse

/**
 * Вкладка, через которую собираются события. Запрос к Pulse обязан уйти из контекста
 * страницы: сессия живёт в её cookies, и из service worker'а их не получить.
 * Активная вкладка предпочтительнее — в ней контент-скрипт точно уже отработал.
 */
export async function findPulseTabId() {
    const tabs = await chrome.tabs.query({ url: `${URLS.PULSE_BASE}/*` });

    if (!tabs.length) {
        return null;
    }

    return (tabs.find((tab) => tab.active) ?? tabs[0]).id ?? null;
}

async function getLocalStorageValue(tabId, key) {
    try {
        const response = await chrome.tabs.sendMessage(tabId, {
            type: MESSAGE_TYPES.GET_LOCAL_STORAGE_VALUE,
            payload: { key },
        });

        return JSON.parse(response?.data ?? 'null');
    } catch (_) {
        return null;
    }
}

// ------------------------------------------------------------------- ICS

function formatICSDate(date) {
    return date
        .toISOString()
        .replace(/[-:]/g, '')
        .split('.')[0] + 'Z';
}

function normalizeDateTimeValue(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();

    if (!trimmed) {
        return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed}T00:00:00`;
    }

    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(trimmed)) {
        return `${trimmed.replace(' ', 'T')}:00`;
    }

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
        return trimmed.replace(' ', 'T');
    }

    return trimmed.replace(' ', 'T');
}

function parseDateTime(value, fallbackDate, fallbackTime) {
    const normalizedValue = normalizeDateTimeValue(value);

    if (normalizedValue) {
        const parsed = new Date(normalizedValue);

        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    if (fallbackDate && fallbackTime) {
        const fallback = new Date(`${fallbackDate.split('T')[0]}T${fallbackTime}:00`);

        if (!Number.isNaN(fallback.getTime())) {
            return fallback;
        }
    }

    return null;
}

function escapeICSValue(value) {
    return String(value ?? '-')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function foldICSLine(value) {
    let text = value;
    const maxLength = 70;
    const parts = [];

    while (text.length > maxLength) {
        parts.push(text.slice(0, maxLength));
        text = text.slice(maxLength);
    }

    parts.push(text);

    return parts.join('\r\n ');
}

function buildIcsDescription(comment) {
    if (!comment) {
        return '-';
    }

    return foldICSLine(escapeICSValue(comment));
}

function buildIcsSummary(name) {
    return foldICSLine(escapeICSValue(name || 'Без названия'));
}

function parseReminderDuration(value) {
    const normalized = String(value ?? '').trim().toLowerCase();

    if (!normalized) {
        return null;
    }

    if (/^\d+$/.test(normalized)) {
        return `PT${normalized}M`;
    }

    const match = normalized.match(/^(\d+)\s*(min|mins|minute|minutes|hour|hours|day|days)$/i);

    if (!match) {
        return null;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('day')) {
        return `P${amount}D`;
    }

    if (unit.startsWith('hour')) {
        return `PT${amount}H`;
    }

    return `PT${amount}M`;
}

function extractEventsFromTaskResult(result) {
    if (Array.isArray(result)) {
        return result.flatMap((item) => {
            if (Array.isArray(item?.events)) {
                return item.events;
            }

            return item && typeof item === 'object'
                ? [item]
                : [];
        });
    }

    if (Array.isArray(result?.события)) {
        return result.события;
    }

    if (Array.isArray(result?.events)) {
        return result.events;
    }

    return [];
}

export function extractEventsFromApiResponse(response) {
    if (!Array.isArray(response?.data?.tasks)) {
        return [];
    }

    return response.data.tasks.flatMap((task) => extractEventsFromTaskResult(task?.result));
}

function eventToVEVENT(event) {
    const startDate = parseDateTime(event.start, event.date, event.time);
    const endDate = parseDateTime(event.end) ?? startDate;

    if (!startDate || !endDate) {
        return null;
    }

    const lines = [
        'BEGIN:VEVENT',
        `UID:event-${event.id}@vpn.sk-serv.ru`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:${buildIcsSummary(event.name)}`,
        `DESCRIPTION:${buildIcsDescription(event.comment)}`,
    ];

    if (event.notify) {
        event.notify.split(',').forEach((notifyValue) => {
            const duration = parseReminderDuration(notifyValue);

            if (duration) {
                lines.push(
                    'BEGIN:VALARM',
                    `TRIGGER:-${duration}`,
                    'ACTION:DISPLAY',
                    'DESCRIPTION:Напоминание',
                    'END:VALARM',
                );
            }
        });
    }

    lines.push('END:VEVENT');

    return lines.join('\r\n');
}

function generateICS(events) {
    const calendar = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Your Company//Calendar Export//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
    ];

    for (const event of events) {
        const vevent = eventToVEVENT(event);

        if (vevent) {
            calendar.push(vevent);
        }
    }

    calendar.push('END:VCALENDAR');

    return calendar.join('\r\n');
}

// ---------------------------------------------------------------- выгрузка

function normalizeUserId(rawUserId) {
    // GUID приходит то в фигурных скобках, то без них, а форма записи должна быть
    // одна и та же всегда: от неё зависит ссылка, уже настроенная на телефоне.
    return String(rawUserId ?? '').trim().replace(/^\{|\}$/g, '');
}

async function readUploadError(response) {
    try {
        const body = await response.json();

        if (body?.message) {
            return body.message;
        }
    } catch (_) {
        // тело не JSON — покажем хотя бы статус
    }

    return `Сервис календаря ответил ${response.status}`;
}

async function uploadICS(icsContent, userId, signal) {
    if (!CALENDAR_UPLOAD_API_KEY) {
        throw new Error('В сборке не задан ключ выгрузки календаря');
    }

    const formData = new FormData();
    formData.append(
        'file',
        new Blob([icsContent], { type: 'text/calendar;charset=utf-8' }),
        'trick.ics',
    );
    formData.append('user_id', userId);
    formData.append('filename', 'Трик — мои события.ics');

    const response = await fetch(URLS.CALENDAR_UPLOAD, {
        method: 'POST',
        headers: { 'X-Api-Key': CALENDAR_UPLOAD_API_KEY },
        body: formData,
        signal,
    });

    if (!response.ok) {
        throw new Error(await readUploadError(response));
    }

    return response.json();
}

/** Окно считается от текущей даты: расписание работает годами, фиксированные даты протухли бы. */
function getExportRange(now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth() - HISTORY_MONTHS, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + FUTURE_MONTHS + 1, 0);

    return { start, end };
}

function toApiDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

async function getEvents(tabId, userId) {
    try {
        const now = new Date();
        const { start, end } = getExportRange(now);
        const response = await chrome.tabs.sendMessage(tabId, {
            type: MESSAGE_TYPES.EXECUTE_PAGE_REQUEST,
            payload: {
                tasks: [
                    {
                        objectName: 'Календарь',
                        methodName: 'ПолучитьСобытия',
                        params: {
                            датнач: toApiDate(start),
                            даткнц: toApiDate(end),
                            фильтр: {
                                сотрудник: `{"fieldType":5,"value":"${userId}"}`,
                                внутренние: '0,1,4',
                                внешние: null,
                            },
                        },
                    },
                ],
                info: {
                    workMonth: `${toApiDate(new Date(now.getFullYear(), now.getMonth(), 1))}T00:00:00.000`,
                },
            },
        });

        return extractEventsFromApiResponse(response);
    } catch (_) {
        return [];
    }
}

// ------------------------------------------------------------ ответ сервиса

function isIcsUrl(url) {
    return typeof url === 'string' && /\.ics(?:[?#]|$)/i.test(url);
}

/** Первый непустой адрес: пустая строка в ответе — это «поля нет», а не ссылка. */
function pickUrl(...values) {
    return values.find((value) => typeof value === 'string' && value) ?? null;
}

/**
 * Сервис отдаёт готовые адреса подписки под каждый календарь — apple_url, google_url и
 * страницу subscribe_url, — а ещё сам файл. Имена полей у него за годы менялись, поэтому
 * каждое ищется с запасными вариантами. Ссылку на .ics отбираем по расширению: из неё
 * собираются кнопки Apple и Google для ответов постарше, где своих адресов ещё не было.
 */
export function normalizeCalendarResult(payload) {
    const candidates = [
        payload?.ics_url,
        payload?.icsUrl,
        payload?.file_url,
        payload?.fileUrl,
        payload?.download_url,
        payload?.url,
        payload?.subscribe_url,
        payload?.subscribeUrl,
    ].filter((value) => typeof value === 'string' && value);

    const fileUrl = candidates.find(isIcsUrl) ?? candidates[0] ?? null;

    return {
        subscribeUrl: pickUrl(payload?.subscribe_url, payload?.subscribeUrl, payload?.url, fileUrl),
        fileUrl,
        appleUrl: pickUrl(payload?.apple_url, payload?.appleUrl),
        googleUrl: pickUrl(payload?.google_url, payload?.googleUrl),
    };
}

/**
 * Адреса под кнопки подписки. Своих адресов Apple и Google может не оказаться —
 * в ответе старого сервиса и в состоянии, запомненном до этой версии, — тогда оба
 * собираются из ссылки на файл, как раньше.
 */
export function getCalendarLinks(state) {
    const fileUrl = state?.fileUrl ?? null;

    return {
        subscribeUrl: state?.subscribeUrl ?? null,
        fileUrl,
        appleUrl: state?.appleUrl ?? toWebcalUrl(fileUrl),
        googleUrl: state?.googleUrl ?? toGoogleCalendarUrl(fileUrl),
    };
}

/** webcal:// подхватывает системный календарь: подписка, а не разовый импорт файла. */
function toWebcalUrl(url) {
    return typeof url === 'string' && url
        ? url.replace(/^https?:/i, 'webcal:')
        : null;
}

function toGoogleCalendarUrl(url) {
    return typeof url === 'string' && url
        ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(url)}`
        : null;
}

// -------------------------------------------------------------- сама выгрузка

async function collectAndUpload(signal) {
    const tabId = await findPulseTabId();

    if (tabId === null) {
        throw new Error('Откройте вкладку Пульса — события забираются из неё');
    }

    const userId = normalizeUserId((await getLocalStorageValue(tabId, 'pulse'))?.userInfoStore?.userId_);

    if (!USER_ID_RE.test(userId)) {
        throw new Error(userId
            ? `Идентификатор сотрудника не подходит для ссылки: ${userId}`
            : 'Не удалось определить сотрудника — откройте вкладку Пульса');
    }

    const events = await getEvents(tabId, userId);

    // Пустой календарь сервис примет, и на телефоне пропадут все события.
    // Тихая ошибка сбора выглядит ровно так же, поэтому не выгружаем.
    if (events.length === 0) {
        throw new Error('Пульс не вернул ни одного события — выгрузка отменена');
    }

    return normalizeCalendarResult(await uploadICS(generateICS(events), userId, signal));
}

export async function syncCalendar() {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SYNC_TIMEOUT_MS);

    /*
     * Сигнал обрывает саму выгрузку, гонка ниже закрывает остальной путь: сбор событий
     * идёт через chrome.tabs.sendMessage, а он сигнала не принимает и может не ответить
     * вовсе. Обработчик здесь навешивается раньше, чем свой навесит fetch, поэтому
     * наружу уходит понятное сообщение, а не служебная ошибка прерывания.
     */
    const deadline = new Promise((_, reject) => {
        abort.signal.addEventListener('abort', () => {
            reject(new Error(`Синхронизация не уложилась в ${SYNC_TIMEOUT_MS / 1000} с`));
        }, { once: true });
    });

    const work = collectAndUpload(abort.signal);
    // Проигравший гонку промис всё равно должен быть обработан: иначе прилетит
    // unhandled rejection уже после того, как ошибку показали пользователю.
    work.catch(() => {});

    try {
        return await Promise.race([work, deadline]);
    } finally {
        clearTimeout(timer);
    }
}

// -------------------------------------------------- запомненный ответ сервиса

/**
 * Ссылочная часть ответа сервиса. Вынесена отдельно, потому что удачная выгрузка обязана
 * заменить её целиком: адреса кнопок сервис волен поменять, и поле, уцелевшее от прошлого
 * ответа, увело бы кнопку на подписку, которой у него уже нет. На неудачной выгрузке —
 * наоборот, прошлые ссылки остаются: рабочая подписка не должна пропадать из-за сбоя.
 */
export const EMPTY_CALENDAR_LINKS = Object.freeze({
    subscribeUrl: null,
    fileUrl: null,
    appleUrl: null,
    googleUrl: null,
});

export const EMPTY_CALENDAR_SYNC_STATE = Object.freeze({
    ...EMPTY_CALENDAR_LINKS,
    syncedAt: null,
    lastError: null,
    lastErrorAt: null,
    retryCount: 0,
});

/**
 * Что запоминается после удачной выгрузки. Ссылки идут поверх пустого набора, а не поверх
 * прошлого состояния: сервис отдаёт их заново каждый раз, и любое поле, пропавшее из
 * свежего ответа, должно пропасть и из хранилища — иначе кнопка ведёт на старый адрес.
 */
export function buildSyncedState(result, syncedAt) {
    return {
        ...EMPTY_CALENDAR_LINKS,
        ...result,
        syncedAt,
        lastError: null,
        lastErrorAt: null,
        retryCount: 0,
    };
}

export async function readCalendarSyncState() {
    try {
        const result = await chrome.storage.local.get(CALENDAR_SYNC_STATE_KEY);
        const stored = result?.[CALENDAR_SYNC_STATE_KEY];

        return stored && typeof stored === 'object'
            ? { ...EMPTY_CALENDAR_SYNC_STATE, ...stored }
            : { ...EMPTY_CALENDAR_SYNC_STATE };
    } catch (_) {
        return { ...EMPTY_CALENDAR_SYNC_STATE };
    }
}

export async function updateCalendarSyncState(patch) {
    const next = { ...(await readCalendarSyncState()), ...patch };

    await chrome.storage.local.set({ [CALENDAR_SYNC_STATE_KEY]: next });

    return next;
}
