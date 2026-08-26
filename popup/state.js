import { SETTING_KEYS } from '../src/shared-constants.js';
import { EMPTY_CALENDAR_SYNC_STATE } from '../src/calendar-sync.js';

export function createPopupState() {
    return {
        // Запомненный ответ сервиса календаря и отметки последних выгрузок
        calendarSyncState: { ...EMPTY_CALENDAR_SYNC_STATE },
        // Идёт выгрузка: её запускают и кнопка, и включение тумблера синхронизации
        calendarSyncBusy: false,
        // Настройки, с которыми реально загрузилась страница Pulse (null — расширение на странице не активно)
        pageSettings: null,
        // true, если контент-скрипт ответил, то есть функции расширения уже внедрены в страницу
        pageFeaturesActive: false,
        // id вкладки Pulse, которую имеет смысл перезагружать (null — подходящей вкладки нет)
        pulseTabId: null,
        storageSettings: {},
        advancedSettingsVisible: false,
        activeSettingsPage: 'root',
    };
}

/*
 * enableFeatures сравнивается отдельно: он определяет, внедряется ли расширение в страницу вообще.
 *
 * Настройки синхронизации календаря на страницу не влияют совсем — её выгружают popup и
 * service worker. Без них в списке правка расписания предлагала бы перезагрузить Пульс
 * без всякой причины.
 */
const RELOAD_IGNORED_KEYS = Object.freeze([
    SETTING_KEYS.ENABLE_FEATURES,
    SETTING_KEYS.CALENDAR_SYNC,
    SETTING_KEYS.CALENDAR_SYNC_FREQUENCY,
    SETTING_KEYS.CALENDAR_SYNC_TIME,
]);

function normalizeValue(value) {
    return value === undefined ? null : value;
}

export function haveSettingsChanged(pageSettings, storageSettings) {
    if (!pageSettings) {
        return false;
    }

    const keys = new Set([
        ...Object.keys(pageSettings),
        ...Object.keys(storageSettings || {}),
    ]);

    for (const ignoredKey of RELOAD_IGNORED_KEYS) {
        keys.delete(ignoredKey);
    }

    for (const key of keys) {
        if (normalizeValue(pageSettings[key]) !== normalizeValue(storageSettings?.[key])) {
            return true;
        }
    }

    return false;
}

/**
 * Единственный источник правды для плашки «нужна перезагрузка».
 * Считается целиком из состояния, а не накапливается по событиям, поэтому
 * причина «включили/выключили расширение» не теряется при переключении функций.
 */
export function isReloadRequired(state) {
    if (!state.pulseTabId) {
        return false;
    }

    const storageEnabled = Boolean(state.storageSettings?.[SETTING_KEYS.ENABLE_FEATURES]);

    // Расширение включили или выключили после загрузки страницы
    if (storageEnabled !== state.pageFeaturesActive) {
        return true;
    }

    // Ничего не внедрено и не будет — перезагружать нечего
    if (!storageEnabled) {
        return false;
    }

    return haveSettingsChanged(state.pageSettings, state.storageSettings);
}
