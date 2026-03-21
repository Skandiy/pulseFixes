export const MESSAGE_TYPES = Object.freeze({
    SHOW_NOTIFICATION: 'show-notification',
    GET_SETTINGS: 'GET_PULSE_EXTENSION_SETTINGS',
    EXECUTE_PAGE_REQUEST: 'EXECUTE_PAGE_REQUEST',
    GET_LOCAL_STORAGE_VALUE: 'GET_LOCAL_STORAGE_VALUE',
    WINDOW_SHOW_NOTIFICATION: 'SHOW_NOTIFICATION',
});

export const STORAGE_KEYS = Object.freeze({
    ENABLE_FEATURES: 'enableFeatures',
    ADVANCED_SETTINGS: 'advancedSettings',
});

export const URLS = Object.freeze({
    PULSE_BASE: 'https://pulse.stack-it.ru',
    PULSE_KVPL: 'https://pulse.stack-it.ru/app/stackgateway/billing/pulse/kvpl',
});

export const DEFAULT_SYNC_SETTINGS = Object.freeze({
    changeTheme: false,
    changeCalendar: false,
    selectActiveTask: false,
    pushNotificationsEnabled: false,
    perProject: false,
    perPulse: false,
    perTask: false,
});

export const DEFAULT_LOCAL_SETTINGS = Object.freeze({
    [STORAGE_KEYS.ENABLE_FEATURES]: false,
    [STORAGE_KEYS.ADVANCED_SETTINGS]: false,
});
