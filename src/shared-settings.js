import {
    DEFAULT_SETTINGS,
    LEGACY_LOCAL_SETTING_KEYS,
    SETTINGS_SCHEMA_VERSION,
    SETTINGS_STORAGE_AREA,
    SETTINGS_STORAGE_KEY,
} from './shared-constants.js';

const SCHEMA_VERSION_FIELD = '__schemaVersion';
const MIGRATED_IN_FIELD = '__migratedIn';

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMetaField(key) {
    return key.startsWith('__');
}

function currentExtensionVersion() {
    try {
        return chrome.runtime.getManifest()?.version ?? null;
    } catch (_) {
        return null;
    }
}

function storageGet(area, keys) {
    return chrome.storage[area].get(keys).catch(() => ({}));
}

function readStored() {
    return chrome.storage[SETTINGS_STORAGE_AREA].get(SETTINGS_STORAGE_KEY)
        .then((result) => result?.[SETTINGS_STORAGE_KEY] ?? null);
}

function pickMeta(stored) {
    const meta = {};

    if (isRecord(stored)) {
        for (const [key, value] of Object.entries(stored)) {
            if (isMetaField(key)) {
                meta[key] = value;
            }
        }
    }

    return meta;
}

function writeStored(settings, meta = {}) {
    const stored = {
        ...settings,
        ...meta,
        [SCHEMA_VERSION_FIELD]: SETTINGS_SCHEMA_VERSION,
    };

    return chrome.storage[SETTINGS_STORAGE_AREA]
        .set({ [SETTINGS_STORAGE_KEY]: stored })
        .then(() => stored);
}

/** Служебные поля наружу не отдаём: настройки уезжают на страницу и сравниваются по ключам. */
function toPublicSettings(stored) {
    const values = {};

    if (isRecord(stored)) {
        for (const [key, value] of Object.entries(stored)) {
            if (!isMetaField(key)) {
                values[key] = value;
            }
        }
    }

    return { ...DEFAULT_SETTINGS, ...values };
}

/** Из старого хранилища берём только те поля, которые расширение знает сегодня. */
function pickKnownSettings(source) {
    const picked = {};

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            picked[key] = source[key];
        }
    }

    return picked;
}

/**
 * До версии 5 настройки лежали россыпью: часть в chrome.storage.sync, часть в local.
 * Читаем sync целиком, а не по списку имён: popup исторически писал туда любой id чекбокса,
 * поэтому в реальных профилях встречаются ключи, которых уже нет в DEFAULT_SETTINGS.
 *
 * Старые ключи здесь НЕ удаляются — удаление вынесено в cleanupLegacyStorage, иначе два
 * контекста, стартовавшие одновременно, могли бы получить пустой legacy и записать поверх
 * чужой миграции чистые дефолты.
 */
async function migrateLegacyStorage() {
    const [legacySync, legacyLocal] = await Promise.all([
        storageGet('sync', null),
        storageGet('local', LEGACY_LOCAL_SETTING_KEYS),
    ]);

    // Пока читали старые ключи, соседний контекст мог успеть записать новый
    const existing = await readStored();

    if (isRecord(existing)) {
        return existing;
    }

    return writeStored({
        ...DEFAULT_SETTINGS,
        ...pickKnownSettings(legacySync),
        ...pickKnownSettings(legacyLocal),
    }, {
        [MIGRATED_IN_FIELD]: currentExtensionVersion(),
    });
}

let cleanupDone = false;

/**
 * Подчищает старые ключи. Вызывается только после того, как консолидированный ключ прочитан,
 * то есть миграция гарантированно завершилась в каком-то из контекстов.
 *
 * chrome.storage.local — «свой» для каждой машины, его остатки убираем сразу.
 *
 * chrome.storage.sync реплицируется на все устройства пользователя, и удаление тоже
 * реплицируется. Поэтому sync чистим не в той версии, где прошла миграция, а начиная со
 * следующей: за это время обновление доедет до остальных машин, и они успеют перенести
 * настройки к себе, а не увидят пустой sync под старой сборкой.
 */
async function cleanupLegacyStorage(stored) {
    if (cleanupDone) {
        return;
    }

    cleanupDone = true;

    const migratedIn = isRecord(stored) ? stored[MIGRATED_IN_FIELD] : null;
    const syncCleanupAllowed = !migratedIn || migratedIn !== currentExtensionVersion();

    try {
        const [legacySync, legacyLocal] = await Promise.all([
            syncCleanupAllowed ? storageGet('sync', null) : Promise.resolve({}),
            storageGet('local', LEGACY_LOCAL_SETTING_KEYS),
        ]);

        const syncKeys = Object.keys(legacySync);
        const localKeys = Object.keys(legacyLocal);

        await Promise.all([
            syncKeys.length ? chrome.storage.sync.remove(syncKeys) : null,
            localKeys.length ? chrome.storage.local.remove(localKeys) : null,
        ]);
    } catch (error) {
        cleanupDone = false;
        console.warn('[Trick Plus] Не удалось убрать старые ключи настроек:', error);
    }
}

let readPromise = null;

/** Одна очередь на запись, чтобы быстрые клики в popup не затирали друг друга. */
let writeQueue = Promise.resolve();

/**
 * Настройки правит popup, а живут они в кэше каждого контекста отдельно — своего у
 * service worker'а хватило бы до его выгрузки. Обновляем кэш по событию хранилища:
 * иначе фоновая выгрузка календаря шла бы по расписанию, выключенному минуту назад.
 *
 * Контент-скрипт этим не затрагивается: страница получила свою копию настроек при
 * загрузке, и расхождение с хранилищем — ровно то, из-за чего popup предлагает
 * перезагрузить вкладку.
 */
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== SETTINGS_STORAGE_AREA || !changes[SETTINGS_STORAGE_KEY]) {
        return;
    }

    const stored = changes[SETTINGS_STORAGE_KEY].newValue;

    readPromise = isRecord(stored) ? Promise.resolve(toPublicSettings(stored)) : null;
});

export function getDefaultSettings() {
    return { ...DEFAULT_SETTINGS };
}

export function getExtensionSettings() {
    if (!readPromise) {
        readPromise = readStored()
            .then((stored) => {
                if (isRecord(stored)) {
                    // не блокирует чтение: старые ключи уже никем не используются
                    cleanupLegacyStorage(stored);
                    return stored;
                }

                return migrateLegacyStorage();
            })
            .then(toPublicSettings)
            .catch((error) => {
                readPromise = null;
                throw error;
            });
    }

    return readPromise;
}

/**
 * Сохраняет изменения поверх актуального снимка настроек.
 * Снимок перечитывается прямо в очереди записи, чтобы не затереть правку из другого контекста.
 * Возвращает полный объект настроек после записи.
 */
export function updateSettings(patch) {
    writeQueue = writeQueue
        .catch(() => {})
        .then(async () => {
            const stored = await readStored();
            const current = isRecord(stored) ? toPublicSettings(stored) : await getExtensionSettings();
            const next = { ...current, ...patch };

            await writeStored(next, pickMeta(stored));
            readPromise = Promise.resolve(next);

            return next;
        });

    return writeQueue;
}

export function setSetting(key, value) {
    return updateSettings({ [key]: value });
}
