import { MESSAGE_TYPES } from '../src/shared-constants.js';
import { getCurrentTab, sendTabMessage } from '../src/shared-messaging.js';

async function getLocalStorageValue(key) {
    try {
        const tab = await getCurrentTab();

        if (!tab) {
            return null;
        }

        const response = await sendTabMessage(tab.id, {
            type: MESSAGE_TYPES.GET_LOCAL_STORAGE_VALUE,
            payload: { key },
        });

        return JSON.parse(response?.data ?? 'null');
    } catch (_) {
        return null;
    }
}

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

async function uploadICSDirect(icsContent) {
    const userId = (await getLocalStorageValue('pulse'))
        ?.userInfoStore
        ?.userId_;

    if (!userId) {
        throw new Error('Не удалось определить userId');
    }

    const formData = new FormData();
    formData.append(
        'file',
        new Blob([icsContent], { type: 'text/calendar;charset=utf-8' }),
        'calendar.ics',
    );
    formData.append('user_id', userId);
    formData.append('filename', 'calendar.ics');

    const response = await fetch('https://vpn.sk-serv.ru:9443/upload', {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload error: ${await response.text()}`);
    }

    return response.json();
}

async function getEvents() {
    try {
        const tab = await getCurrentTab();

        if (!tab) {
            return [];
        }

        const pulseData = await getLocalStorageValue('pulse');
        const userId = pulseData?.userInfoStore?.userId_;

        if (!userId) {
            return [];
        }

        const dateStart = new Date('2025-12-01T10:00:00Z');
        const dateEnd = new Date('2026-12-31T10:00:00Z');
        const response = await sendTabMessage(tab.id, {
            type: MESSAGE_TYPES.EXECUTE_PAGE_REQUEST,
            payload: {
                tasks: [
                    {
                        objectName: 'Календарь',
                        methodName: 'ПолучитьСобытия',
                        params: {
                            датнач: dateStart.toISOString().split('T')[0],
                            даткнц: dateEnd.toISOString().split('T')[0],
                            фильтр: {
                                сотрудник: `{"fieldType":5,"value":"${userId}"}`,
                                внутренние: '0,1,4',
                                внешние: null,
                            },
                        },
                    },
                ],
                info: {
                    workMonth: '2025-08-01T00:00:00.000',
                },
            },
        });

        return extractEventsFromApiResponse(response);
    } catch (_) {
        return [];
    }
}

export async function syncCalendar() {
    const events = await getEvents();
    const ics = generateICS(events);
    return uploadICSDirect(ics);
}
