import {
    CALENDAR_SYNC_FREQUENCIES,
    DEFAULT_CALENDAR_SYNC_FREQUENCY,
    DEFAULT_CALENDAR_SYNC_TIME,
} from './shared-constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Запас, на который выгрузка считается «уже пора». Без него будильник, сработавший
 * на несколько секунд раньше отметки суток, откладывал бы синхронизацию ровно
 * на день: прошло 23:59:58, а нужно 24:00:00.
 */
const DUE_GRACE_MS = 60 * 60 * 1000;

export function getFrequency(value) {
    return CALENDAR_SYNC_FREQUENCIES.find((item) => item.value === value)
        ?? CALENDAR_SYNC_FREQUENCIES.find((item) => item.value === DEFAULT_CALENDAR_SYNC_FREQUENCY);
}

/** Сколько суток между автоматическими выгрузками. 0 — расписания нет. */
export function getFrequencyDays(value) {
    return getFrequency(value).days;
}

export function parseSyncTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    const hours = match ? Number(match[1]) : NaN;
    const minutes = match ? Number(match[2]) : NaN;

    if (!Number.isInteger(hours) || hours > 23 || !Number.isInteger(minutes) || minutes > 59) {
        return parseSyncTime(DEFAULT_CALENDAR_SYNC_TIME);
    }

    return { hours, minutes };
}

export function formatSyncTime(value) {
    const { hours, minutes } = parseSyncTime(value);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Ближайшее наступление заданного времени суток строго позже from. */
function nextSlotAfter(time, from) {
    const { hours, minutes } = parseSyncTime(time);
    const slot = new Date(from);

    slot.setHours(hours, minutes, 0, 0);

    if (slot.getTime() <= from) {
        slot.setDate(slot.getDate() + 1);
    }

    return slot;
}

/**
 * Прошло ли достаточно времени с последней удачной выгрузки. Проверяется в момент
 * срабатывания будильника: сам будильник всегда стоит на ближайшее время суток,
 * а редкие периодичности пропускают лишние срабатывания здесь.
 */
export function isSyncDue(syncedAt, days, now = Date.now()) {
    if (!days) {
        return false;
    }

    if (!syncedAt) {
        return true;
    }

    return now - syncedAt >= (days * DAY_MS) - DUE_GRACE_MS;
}

/**
 * Когда расписание выгрузит календарь в следующий раз (мс), либо null, если
 * автоматической выгрузки нет. Считается только из настроек и отметки последней
 * выгрузки, поэтому popup показывает ровно тот же момент, на который стоит будильник.
 */
export function getNextSyncAt(settingsTime, frequency, syncedAt, now = Date.now()) {
    const days = getFrequencyDays(frequency);

    if (!days) {
        return null;
    }

    const slot = nextSlotAfter(settingsTime, now);

    if (!syncedAt) {
        return slot.getTime();
    }

    // Сутки прибавляем через дату, а не через миллисекунды: при переводе часов
    // время выгрузки должно остаться тем же, что выбрал пользователь.
    const earliest = syncedAt + (days * DAY_MS) - DUE_GRACE_MS;

    while (slot.getTime() < earliest) {
        slot.setDate(slot.getDate() + 1);
    }

    return slot.getTime();
}
