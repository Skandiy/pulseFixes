export const BRAND = Object.freeze({
    NAME: 'Trick Plus',
    // Общий префикс всех ключей, которые расширение пишет в chrome.storage и localStorage страницы
    PREFIX: 'trickPlus',
});

export const MESSAGE_TYPES = Object.freeze({
    SHOW_NOTIFICATION: 'show-notification',
    GET_SETTINGS: 'GET_PULSE_EXTENSION_SETTINGS',
    EXECUTE_PAGE_REQUEST: 'EXECUTE_PAGE_REQUEST',
    EXECUTE_LOCAL_HTTP_REQUEST: 'EXECUTE_LOCAL_HTTP_REQUEST',
    GET_LOCAL_STORAGE_VALUE: 'GET_LOCAL_STORAGE_VALUE',
    CALENDAR_SYNC_RUN: 'CALENDAR_SYNC_RUN',
    WINDOW_SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
    WINDOW_EXECUTE_PAGE_REQUEST: 'WINDOW_EXECUTE_PAGE_REQUEST',
    WINDOW_EXECUTE_PAGE_REQUEST_RESULT: 'WINDOW_EXECUTE_PAGE_REQUEST_RESULT',
    WINDOW_EXECUTE_LOCAL_HTTP_REQUEST: 'WINDOW_EXECUTE_LOCAL_HTTP_REQUEST',
    WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT: 'WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT',
});

/**
 * Все настройки расширения лежат в одном ключе chrome.storage.local.
 * До версии 5 они были размазаны по десятку ключей в sync + local; перенос и очистка —
 * в src/shared-settings.js (migrateLegacyStorage / cleanupLegacyStorage).
 */
export const SETTINGS_STORAGE_AREA = 'local';
export const SETTINGS_STORAGE_KEY = `${BRAND.PREFIX}.settings`;
export const SETTINGS_SCHEMA_VERSION = 1;

export const SETTING_KEYS = Object.freeze({
    ENABLE_FEATURES: 'enableFeatures',
    ADVANCED_SETTINGS: 'advancedSettings',
    TRICK_DEBUG_LOGGING: 'trickDebugLogging',
    WORKLOAD_PLAN_OVERRIDE: 'workloadPlanOverride',
    CALENDAR_SYNC: 'calendarSync',
    CALENDAR_SYNC_FREQUENCY: 'calendarSyncFrequency',
    CALENDAR_SYNC_TIME: 'calendarSyncTime',
});

/**
 * Периодичность автоматической выгрузки календаря. days = 0 — расписания нет,
 * выгрузка идёт только по кнопке.
 */
export const CALENDAR_SYNC_FREQUENCIES = Object.freeze([
    { value: 'daily', label: 'Каждый день', days: 1 },
    { value: 'every3days', label: 'Раз в три дня', days: 3 },
    { value: 'weekly', label: 'Раз в неделю', days: 7 },
    { value: 'never', label: 'Только вручную', days: 0 },
]);

export const DEFAULT_CALENDAR_SYNC_FREQUENCY = 'daily';
export const DEFAULT_CALENDAR_SYNC_TIME = '09:00';

export const DEFAULT_SETTINGS = Object.freeze({
    [SETTING_KEYS.ENABLE_FEATURES]: false,
    [SETTING_KEYS.ADVANCED_SETTINGS]: false,
    [SETTING_KEYS.TRICK_DEBUG_LOGGING]: false,
    // null — отметка плана считается автоматически, число — заданные вручную часы
    [SETTING_KEYS.WORKLOAD_PLAN_OVERRIDE]: null,
    [SETTING_KEYS.CALENDAR_SYNC]: false,
    [SETTING_KEYS.CALENDAR_SYNC_FREQUENCY]: DEFAULT_CALENDAR_SYNC_FREQUENCY,
    [SETTING_KEYS.CALENDAR_SYNC_TIME]: DEFAULT_CALENDAR_SYNC_TIME,

    changeTheme: false,
    changeCalendar: false,
    eventPlanning: false,
    selectActiveTask: false,
    workloadPlanMarker: true,
    noteReplyButton: true,
    pushNotificationsEnabled: false,
    emailTrusted: true,
    perProject: false,
    perPulse: false,
    perTask: false,
    diagnosticCssSetPropertyPatch: true,
    diagnosticHeaderDomPatch: true,
    diagnosticEventPlanningObserver: true,
    diagnosticDarkThemeStyles: true,
    diagnosticRulesHooks: true,
    diagnosticTaskProjectGitWatcher: true,
    diagnosticChatPanel: true,
    diagnosticBaseStyles: true,
});

/**
 * Ключи, которые до консолидации лежали в chrome.storage.local россыпью.
 * Область sync читается и чистится целиком, поэтому списка её ключей здесь нет.
 */
export const LEGACY_LOCAL_SETTING_KEYS = Object.freeze([
    'enableFeatures',
    'advancedSettings',
    'trickDebugLogging',
    'workloadPlanOverride',
]);

/**
 * Ключи в localStorage страницы Pulse. Page-context скрипты (scripts/*.js) не могут
 * импортировать модули, поэтому дублируют эти строки у себя — при правке синхронизируй.
 */
export const WEB_STORAGE_KEYS = Object.freeze({
    THEME: `${BRAND.PREFIX}.theme`,
    DEBUG_ENABLED: `${BRAND.PREFIX}.debug.enabled`,
    DEBUG_LOG: `${BRAND.PREFIX}.debug.log`,
    WORKLOAD_PLAN_CACHE: `${BRAND.PREFIX}.workloadPlan.cache`,
    CHAT_TAB: `${BRAND.PREFIX}.chat.tab`,
    CHAT_WIDTH: `${BRAND.PREFIX}.chat.width`,
    CHAT_OPENED: `${BRAND.PREFIX}.chat.opened`,
    CHAT_LEFT_SIDE: `${BRAND.PREFIX}.chat.leftSide`,
    EVENT_PLANNING_EMPLOYEE_CACHE: `${BRAND.PREFIX}.eventPlanning.employeeInfoCache.v1`,
    EVENT_PLANNING_CURRENT_USER: `${BRAND.PREFIX}.eventPlanning.currentUser`,
});

/**
 * Переименование ключей localStorage: старое имя → новое.
 * TRICK_DEBUG_LOGGING в старой схеме отсутствует намеренно: он хранил под одним именем
 * и флаг включения, и сам лог, поэтому разбирается отдельно (см. migrateWebStorage).
 */
export const LEGACY_WEB_STORAGE_KEYS = Object.freeze({
    PulsePlus_Theme: WEB_STORAGE_KEYS.THEME,
    PulsePlus_WorkloadPlan: WEB_STORAGE_KEYS.WORKLOAD_PLAN_CACHE,
    PULSE_FIXES_CHAT_TAB: WEB_STORAGE_KEYS.CHAT_TAB,
    PULSE_FIXES_CHAT_WIDTH: WEB_STORAGE_KEYS.CHAT_WIDTH,
    PULSE_FIXES_CHAT_OPENED: WEB_STORAGE_KEYS.CHAT_OPENED,
    PULSE_FIXES_CHAT_LEFTSIDE: WEB_STORAGE_KEYS.CHAT_LEFT_SIDE,
    'pulsePlus.eventPlanning.employeeInfoCache.v1': WEB_STORAGE_KEYS.EVENT_PLANNING_EMPLOYEE_CACHE,
    'pulsePlus.eventPlanning.currentUser': WEB_STORAGE_KEYS.EVENT_PLANNING_CURRENT_USER,
});

export const LEGACY_DEBUG_WEB_STORAGE_KEY = 'TRICK_DEBUG_LOGGING';

/**
 * Ответ сервиса календаря и время последней выгрузки. Отдельный ключ, а не поле настроек:
 * его переписывает фоновая синхронизация, а popup сравнивает настройки страницы с
 * хранилищем и предлагал бы перезагрузить Pulse после каждой такой записи.
 */
export const CALENDAR_SYNC_STATE_KEY = `${BRAND.PREFIX}.calendarSync`;

/**
 * Куда ведёт кнопка «Перейти к заявке» у каждого показанного уведомления.
 * chrome.storage.session, а не переменная в service worker'е: уведомление ждёт клика
 * сколько угодно, а worker выгружается через полминуты простоя.
 */
export const NOTIFICATION_STATE_KEY = `${BRAND.PREFIX}.notifications`;

/** Имя будильника фоновой выгрузки календаря (chrome.alarms). */
export const CALENDAR_SYNC_ALARM = `${BRAND.PREFIX}.calendarSync`;

export const URLS = Object.freeze({
    PULSE_BASE: 'https://pulse.stack-it.ru',
    PULSE_KVPL: 'https://pulse.stack-it.ru/app/stackgateway/billing/pulse/kvpl',
    CALENDAR_UPLOAD: 'https://calendar.sk-serv.ru/upload',
});

/**
 * Ключ сервиса календаря, он же UPLOAD_API_KEY на сервере. Общий для всех
 * сотрудников: закрывает выгрузку от ботов и посторонних, а не от своих —
 * внутри расширения секрета нет. Ротация ключа = смена этой строки и релиз.
 */
export const CALENDAR_UPLOAD_API_KEY = '7d787f84ab3ce091941068d0a8d520cc756bf4497401cee3ccd6cb2719492973';
