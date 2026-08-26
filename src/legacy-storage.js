import {
    LEGACY_DEBUG_WEB_STORAGE_KEY,
    LEGACY_WEB_STORAGE_KEYS,
    WEB_STORAGE_KEYS,
} from './shared-constants.js';

function moveKey(oldKey, newKey) {
    const value = window.localStorage.getItem(oldKey);

    if (value !== null && window.localStorage.getItem(newKey) === null) {
        window.localStorage.setItem(newKey, value);
    }

    window.localStorage.removeItem(oldKey);
}

/**
 * Старый TRICK_DEBUG_LOGGING хранил под одним именем две несовместимые вещи:
 * строку '1' (флаг включения) и JSON с накопленным логом запросов — второе затирало первое.
 * Разводим их по двум ключам.
 */
function moveDebugKey() {
    const value = window.localStorage.getItem(LEGACY_DEBUG_WEB_STORAGE_KEY);

    if (value === null) {
        return;
    }

    if (value === '1' || value === 'true') {
        if (window.localStorage.getItem(WEB_STORAGE_KEYS.DEBUG_ENABLED) === null) {
            window.localStorage.setItem(WEB_STORAGE_KEYS.DEBUG_ENABLED, '1');
        }
    } else if (window.localStorage.getItem(WEB_STORAGE_KEYS.DEBUG_LOG) === null) {
        window.localStorage.setItem(WEB_STORAGE_KEYS.DEBUG_LOG, value);
    }

    window.localStorage.removeItem(LEGACY_DEBUG_WEB_STORAGE_KEY);
}

/**
 * Переносит ключи localStorage страницы Pulse со старых имён (PulsePlus_*, PULSE_FIXES_*)
 * на префикс trickPlus.*. Контент-скрипт делит localStorage со страницей, поэтому
 * миграция успевает отработать до внедрения page-context скриптов.
 *
 * Повторные запуски безвредны: исходные ключи удаляются сразу после переноса.
 */
export function migrateWebStorage() {
    try {
        for (const [oldKey, newKey] of Object.entries(LEGACY_WEB_STORAGE_KEYS)) {
            moveKey(oldKey, newKey);
        }

        moveDebugKey();
    } catch (error) {
        // localStorage может быть недоступен (переполнен или заблокирован политикой) —
        // это не повод ронять загрузку расширения
        console.warn('[Trick Plus] Не удалось перенести ключи localStorage:', error);
    }
}
