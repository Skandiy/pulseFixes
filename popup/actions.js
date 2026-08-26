import {
    CALENDAR_SYNC_FREQUENCIES,
    CALENDAR_SYNC_STATE_KEY,
    MESSAGE_TYPES,
    SETTING_KEYS,
    URLS,
} from '../src/shared-constants.js';
import { getExtensionSettings, setSetting } from '../src/shared-settings.js';
import { getCurrentTab, sendRuntimeMessage, sendTabMessage } from '../src/shared-messaging.js';
import { formatSyncTime, getFrequency, getFrequencyDays, getNextSyncAt } from '../src/calendar-schedule.js';
import {
    EMPTY_CALENDAR_SYNC_STATE,
    getCalendarLinks,
    readCalendarSyncState,
} from '../src/calendar-sync.js';
import { isReloadRequired } from './state.js';
import {
    applyCheckboxValues,
    flashButtonDone,
    renderCalendarError,
    renderCalendarLinks,
    renderManifestInfo,
    renderSyncFrequencies,
    setAdvancedVisibility,
    setButtonBusy,
    setCalendarScheduleHint,
    setCalendarSettingsOpen,
    setCalendarTimeVisible,
    setReloadNoticeVisibility,
    setSettingsVisibility,
    setSyncFrequency,
    setUnlockProgress,
    showSettingsPage,
    showToast,
} from './ui.js';

const PAGE_SETTINGS_ATTEMPTS = 3;
const PAGE_SETTINGS_RETRY_DELAY = 150;

const UNLOCK_CLICKS = 10;
const UNLOCK_WARM_AT = 5;
const UNLOCK_RESET_DELAY = 1000;

const CALENDAR_MIN_BUSY_MS = 420;
const CALENDAR_ERROR_LIMIT = 160;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Отдаёт результат не раньше, чем через milliseconds. Отказ тоже выдерживает паузу:
 * иначе мгновенная ошибка успевала бы только моргнуть спиннером, и нажатие
 * читалось бы как «кнопка не сработала».
 */
async function withMinimumDuration(promise, milliseconds) {
    const [outcome] = await Promise.all([
        promise.then((value) => ({ value }), (error) => ({ error })),
        delay(milliseconds),
    ]);

    if ('error' in outcome) {
        throw outcome.error;
    }

    return outcome.value;
}

/** Текст под кнопку: без стека и без простыни, если сервер ответил целой страницей. */
function describeError(error) {
    const message = String(error?.message ?? error ?? '').trim() || 'Неизвестная ошибка';

    if (message.length <= CALENDAR_ERROR_LIMIT) {
        return message;
    }

    return `${message.slice(0, CALENDAR_ERROR_LIMIT - 1)}…`;
}

/**
 * Возвращает настройки, с которыми загрузилась страница, либо null,
 * если контент-скрипт не отвечает — значит, функции расширения на странице не внедрены.
 */
async function requestPageSettings(tabId) {
    for (let attempt = 0; attempt < PAGE_SETTINGS_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
            // Страница могла ещё не догрузить контент-скрипт
            await delay(PAGE_SETTINGS_RETRY_DELAY);
        }

        try {
            const rawSettings = await sendTabMessage(tabId, {
                type: MESSAGE_TYPES.GET_SETTINGS,
            });

            if (typeof rawSettings !== 'string') {
                return null;
            }

            return JSON.parse(rawSettings);
        } catch (error) {
            if (attempt === PAGE_SETTINGS_ATTEMPTS - 1) {
                console.warn('Не удалось получить настройки со страницы:', error);
            }
        }
    }

    return null;
}

function refreshReloadNotice(state, elements) {
    setReloadNoticeVisibility(elements, isReloadRequired(state));
}

function rememberSetting(state, key, value) {
    state.storageSettings = {
        ...state.storageSettings,
        [key]: value,
    };
}

function buildAdvancedSettingsUnlock(elements, onUnlocked) {
    let count = 0;
    let timer = null;

    return async () => {
        if (count < 0) {
            return;
        }

        clearTimeout(timer);
        count += 1;

        if (count < UNLOCK_CLICKS) {
            setUnlockProgress(elements, count >= UNLOCK_WARM_AT);
            timer = setTimeout(() => {
                count = 0;
                setUnlockProgress(elements, false);
            }, UNLOCK_RESET_DELAY);
            return;
        }

        clearTimeout(timer);
        count = -1;
        setUnlockProgress(elements, false);

        try {
            await setSetting(SETTING_KEYS.ADVANCED_SETTINGS, true);
        } catch (error) {
            console.error('Не удалось открыть расширенные настройки:', error);
            showToast(elements, 'Не удалось открыть расширенные настройки', { error: true });
            // запись не прошла — даём попробовать ещё раз, а не блокируем счётчик навсегда
            count = 0;
            return;
        }

        onUnlocked();
    };
}

// ------------------------------------------------------ синхронизация календаря

const DATE_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const TIME_FORMAT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Разница в календарных днях, а не в сутках: 23:50 и 00:10 — это «вчера», а не «14 часов назад». */
function calendarDayOffset(timestamp, now) {
    const date = new Date(timestamp);
    const from = new Date(now);

    return Math.round((
        new Date(date.getFullYear(), date.getMonth(), date.getDate())
        - new Date(from.getFullYear(), from.getMonth(), from.getDate())
    ) / 86400000);
}

function formatMoment(timestamp, now = Date.now()) {
    const time = TIME_FORMAT.format(timestamp);
    const offset = calendarDayOffset(timestamp, now);

    if (offset === 0) {
        return `сегодня в ${time}`;
    }

    if (offset === -1) {
        return `вчера в ${time}`;
    }

    if (offset === 1) {
        return `завтра в ${time}`;
    }

    return `${DATE_FORMAT.format(timestamp)} в ${time}`;
}

/**
 * Следующий срок считается тем же кодом, что и в service worker: подпись под
 * расписанием обязана называть ровно тот момент, на который стоит будильник.
 */
function describeSchedule(settings, syncState) {
    const nextRunAt = getNextSyncAt(
        settings[SETTING_KEYS.CALENDAR_SYNC_TIME],
        settings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY],
        syncState.syncedAt,
    );

    return [
        syncState.syncedAt
            ? `Последняя выгрузка: ${formatMoment(syncState.syncedAt)}`
            : 'Выгрузок ещё не было',
        nextRunAt
            ? `следующая — ${formatMoment(nextRunAt)}`
            : 'автоматическая выгрузка выключена',
    ].join(' · ');
}

/**
 * Показываем запомненный ответ сервиса: ссылка на подписку постоянна, и ждать
 * новой выгрузки, чтобы её увидеть, не нужно.
 *
 * Ошибка выводится только если она свежее последней удачной выгрузки — иначе
 * старый сбой висел бы над рабочей ссылкой.
 */
function renderCalendarState(state, elements) {
    const syncState = state.calendarSyncState;

    renderCalendarLinks(elements, getCalendarLinks(syncState));

    const isErrorFresh = Boolean(syncState.lastError)
        && (!syncState.syncedAt || syncState.lastErrorAt > syncState.syncedAt);

    renderCalendarError(elements, isErrorFresh ? syncState.lastError : null);
    setCalendarScheduleHint(elements, describeSchedule(state.storageSettings, syncState));
}

/** Выгрузку ведёт service worker — она не обрывается вместе с закрытым popup. */
async function requestCalendarSync() {
    try {
        return await sendRuntimeMessage({ type: MESSAGE_TYPES.CALENDAR_SYNC_RUN })
            ?? { ok: false, error: 'Фоновый процесс расширения не ответил', state: null };
    } catch (error) {
        return { ok: false, error: describeError(error), state: null };
    }
}

/**
 * Ход запроса виден на самой кнопке, а отказ — в плашке прямо под ней: тост здесь
 * не годится, он перекрывает карточку и исчезает раньше, чем его успевают прочитать.
 * Прошлую ссылку при неудаче не убираем — она остаётся рабочей.
 *
 * Отметка занятости нужна из-за первой выгрузки по включению тумблера: кнопку на
 * время запроса блокирует setButtonBusy, а тумблер — нет, и второй запуск встал бы
 * поверх первого.
 */
async function runCalendarSyncFlow(state, elements) {
    if (state.calendarSyncBusy) {
        return;
    }

    state.calendarSyncBusy = true;
    renderCalendarError(elements, null);
    setButtonBusy(elements.syncCalendarButton, true);

    try {
        const outcome = await withMinimumDuration(requestCalendarSync(), CALENDAR_MIN_BUSY_MS);

        setButtonBusy(elements.syncCalendarButton, false);

        if (outcome.state) {
            state.calendarSyncState = outcome.state;
        }

        renderCalendarState(state, elements);

        if (outcome.ok) {
            flashButtonDone(elements.syncCalendarButton);
        } else {
            renderCalendarError(elements, outcome.error);
        }
    } finally {
        setButtonBusy(elements.syncCalendarButton, false);
        state.calendarSyncBusy = false;
    }
}

function formatPlanOverride(value) {
    return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * Пустое поле — отметка плана считается автоматически, число — ручное значение для проверки подсветки.
 */
function parsePlanOverride(rawValue) {
    const trimmed = String(rawValue ?? '').trim().replace(',', '.');

    if (!trimmed) {
        return null;
    }

    const hours = Number(trimmed);

    return Number.isFinite(hours) && hours >= 0 ? hours : undefined;
}

export async function initializePopup(state, elements) {
    renderManifestInfo(elements, chrome.runtime.getManifest());

    const extensionSettings = await getExtensionSettings();

    state.storageSettings = extensionSettings;
    state.advancedSettingsVisible = Boolean(extensionSettings[SETTING_KEYS.ADVANCED_SETTINGS]);

    const enabled = Boolean(extensionSettings[SETTING_KEYS.ENABLE_FEATURES]);

    elements.enableFeatures.checked = enabled;
    applyCheckboxValues(elements.checkboxes, extensionSettings);
    elements.workloadPlanOverride.value = formatPlanOverride(
        extensionSettings[SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE]
    );

    renderSyncFrequencies(elements, CALENDAR_SYNC_FREQUENCIES);
    state.calendarSyncState = await readCalendarSyncState();
    applyCalendarSettings(state, elements);

    setAdvancedVisibility(elements, state.advancedSettingsVisible, { animate: false });
    showSettingsPage(elements, state.activeSettingsPage, { animate: false });
    setSettingsVisibility(elements, enabled, { animate: false });
    refreshReloadNotice(state, elements);
}

/** Значения расписания и то, какие из них вообще показаны, целиком выводятся из настроек. */
function applyCalendarSettings(state, elements) {
    // Через getFrequency, а не напрямую: значение из старой сборки не нашлось бы
    // среди пунктов, и периодичность осталась бы без подписи вовсе.
    const frequency = getFrequency(state.storageSettings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY]).value;

    setSyncFrequency(frequency);
    elements.calendarSyncTime.value = formatSyncTime(
        state.storageSettings[SETTING_KEYS.CALENDAR_SYNC_TIME]
    );

    setCalendarSettingsOpen(elements, Boolean(state.storageSettings[SETTING_KEYS.CALENDAR_SYNC]));
    setCalendarTimeVisible(elements, getFrequencyDays(frequency) > 0);
    renderCalendarState(state, elements);
}

export function bindPopupEvents(state, elements) {
    /*
     * Выгрузку по расписанию ведёт service worker, и новые ссылки он кладёт прямо в
     * хранилище. Открытый в этот момент popup показывал бы прошлые до самого закрытия,
     * поэтому запомненный ответ обновляется по событию, а не только при открытии.
     */
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[CALENDAR_SYNC_STATE_KEY]) {
            return;
        }

        state.calendarSyncState = {
            ...EMPTY_CALENDAR_SYNC_STATE,
            ...(changes[CALENDAR_SYNC_STATE_KEY].newValue ?? {}),
        };

        renderCalendarState(state, elements);
    });

    elements.applyButton.addEventListener('click', async () => {
        if (!state.pulseTabId) {
            return;
        }

        await chrome.tabs.reload(state.pulseTabId);
        window.close();
    });

    elements.enableFeatures.addEventListener('change', async (event) => {
        const enabled = event.target.checked;

        try {
            await setSetting(SETTING_KEYS.ENABLE_FEATURES, enabled);
        } catch (error) {
            console.error('Не удалось сохранить включение расширения:', error);
            event.target.checked = !enabled;
            showToast(elements, 'Не удалось сохранить настройку', { error: true });
            return;
        }

        rememberSetting(state, SETTING_KEYS.ENABLE_FEATURES, enabled);

        if (enabled) {
            state.activeSettingsPage = 'root';
            showSettingsPage(elements, state.activeSettingsPage, { animate: false });
        }

        setSettingsVisibility(elements, enabled);
        refreshReloadNotice(state, elements);
    });

    elements.infoButton.addEventListener('click', buildAdvancedSettingsUnlock(elements, () => {
        state.advancedSettingsVisible = true;
        rememberSetting(state, SETTING_KEYS.ADVANCED_SETTINGS, true);
        setAdvancedVisibility(elements, true);
        showToast(elements, 'Расширенные настройки открыты');
        refreshReloadNotice(state, elements);
    }));

    elements.openPageButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const pageId = button.dataset.openPage;

            if (!pageId) {
                return;
            }

            state.activeSettingsPage = pageId;
            showSettingsPage(elements, pageId, { direction: 'forward' });
        });
    });

    elements.backButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const pageId = button.dataset.backPage || 'root';
            state.activeSettingsPage = pageId;
            showSettingsPage(elements, pageId, { direction: 'back' });
        });
    });

    elements.checkboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', async (event) => {
            const { id, checked } = event.target;

            try {
                await setSetting(id, checked);
            } catch (error) {
                console.error(`Не удалось сохранить настройку ${id}:`, error);
                event.target.checked = !checked;
                showToast(elements, 'Не удалось сохранить настройку', { error: true });
                return;
            }

            rememberSetting(state, id, checked);

            // Настройки синхронизации существуют только при включённом тумблере,
            // поэтому раскрываем их после записи, а не по самому клику: не сохранилось —
            // и переключатель, и блок под ним остаются в прежнем состоянии.
            if (id === SETTING_KEYS.CALENDAR_SYNC) {
                setCalendarSettingsOpen(elements, checked);

                // Ждать первого срока по расписанию незачем: до него подписываться
                // не на что, и включение выглядело бы как «ничего не произошло».
                if (checked) {
                    void runCalendarSyncFlow(state, elements);
                }
            }

            refreshReloadNotice(state, elements);
        });
    });

    async function savePlanOverride(hours) {
        try {
            await setSetting(SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE, hours);
        } catch (error) {
            console.error('Не удалось сохранить отметку плана:', error);
            elements.workloadPlanOverride.value = formatPlanOverride(
                state.storageSettings[SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE]
            );
            showToast(elements, 'Не удалось сохранить отметку плана', { error: true });
            return;
        }

        rememberSetting(state, SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE, hours);
        refreshReloadNotice(state, elements);
    }

    elements.workloadPlanOverride.addEventListener('change', async (event) => {
        const hours = parsePlanOverride(event.target.value);

        if (hours === undefined) {
            event.target.value = formatPlanOverride(
                state.storageSettings[SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE]
            );
            showToast(elements, 'Введите число часов или очистите поле', { error: true });
            return;
        }

        await savePlanOverride(hours);
    });

    elements.resetWorkloadPlanOverrideButton.addEventListener('click', async () => {
        elements.workloadPlanOverride.value = '';
        await savePlanOverride(null);
    });

    async function saveCalendarSetting(key, value, previousValue, restore) {
        try {
            await setSetting(key, value);
        } catch (error) {
            console.error(`Не удалось сохранить настройку ${key}:`, error);
            restore(previousValue);
            showToast(elements, 'Не удалось сохранить расписание', { error: true });
            return false;
        }

        rememberSetting(state, key, value);
        return true;
    }

    elements.calendarSyncFrequency.addEventListener('change', async (event) => {
        const frequency = event.detail.value;
        const saved = await saveCalendarSetting(
            SETTING_KEYS.CALENDAR_SYNC_FREQUENCY,
            frequency,
            getFrequency(state.storageSettings[SETTING_KEYS.CALENDAR_SYNC_FREQUENCY]).value,
            setSyncFrequency,
        );

        if (!saved) {
            return;
        }

        setCalendarTimeVisible(elements, getFrequencyDays(frequency) > 0);
        renderCalendarState(state, elements);
    });

    elements.calendarSyncTime.addEventListener('change', async (event) => {
        const stored = formatSyncTime(state.storageSettings[SETTING_KEYS.CALENDAR_SYNC_TIME]);

        // Очищенное поле — не «выключить расписание», а незаконченный ввод: возвращаем прежнее
        if (!event.target.value) {
            event.target.value = stored;
            return;
        }

        const time = formatSyncTime(event.target.value);
        const saved = await saveCalendarSetting(
            SETTING_KEYS.CALENDAR_SYNC_TIME,
            time,
            stored,
            (previous) => { elements.calendarSyncTime.value = previous; },
        );

        if (saved) {
            renderCalendarState(state, elements);
        }
    });

    elements.syncCalendarButton.addEventListener('click', () => {
        void runCalendarSyncFlow(state, elements);
    });

    /*
     * Ссылку на .ics копируем, а не открываем: её вставляют в календарь, который
     * расширение не знает — от Outlook до почты на телефоне.
     */
    elements.calendarCopyLink.addEventListener('click', async () => {
        const fileUrl = state.calendarSyncState.fileUrl;

        if (!fileUrl) {
            return;
        }

        try {
            await navigator.clipboard.writeText(fileUrl);
            showToast(elements, 'Ссылка на файл календаря скопирована');
        } catch (error) {
            console.error('Не удалось скопировать ссылку на календарь:', error);
            showToast(elements, 'Не удалось скопировать ссылку', { error: true });
        }
    });
}

export async function syncPopupWithCurrentTab(state, elements) {
    const tab = await getCurrentTab();

    if (!tab || !tab.id || !tab.url || !tab.url.startsWith(URLS.PULSE_BASE)) {
        state.pulseTabId = null;
        state.pageSettings = null;
        state.pageFeaturesActive = false;
        refreshReloadNotice(state, elements);
        return;
    }

    state.pulseTabId = tab.id;
    state.pageSettings = await requestPageSettings(tab.id);
    state.pageFeaturesActive = Boolean(state.pageSettings?.[SETTING_KEYS.ENABLE_FEATURES]);

    refreshReloadNotice(state, elements);
}
