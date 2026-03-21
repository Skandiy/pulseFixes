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

function parseDateTime(date, time) {
    return new Date(`${date.split('T')[0]}T${time}:00`);
}

function buildIcsDescription(comment) {
    if (!comment) {
        return '-';
    }

    let text = comment.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    text = text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');

    const maxLength = 70;
    const parts = [];

    while (text.length > maxLength) {
        parts.push(text.slice(0, maxLength));
        text = text.slice(maxLength);
    }

    parts.push(text);

    return parts.join('\r\n ');
}

function eventToVEVENT(event) {
    const startDate = parseDateTime(event.date, event.time);
    const endDate = new Date(event.end.replace(' ', 'T') + ':00');
    const lines = [
        'BEGIN:VEVENT',
        `UID:event-${event.id}@vpn.sk-serv.ru`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:${event.name}`,
        `DESCRIPTION:${buildIcsDescription(event.comment)}`,
    ];

    if (event.notify) {
        event.notify.split(',').forEach((notifyValue) => {
            const minutes = parseInt(notifyValue, 10);

            if (!Number.isNaN(minutes)) {
                lines.push(
                    'BEGIN:VALARM',
                    `TRIGGER:-PT${minutes}M`,
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
        calendar.push(eventToVEVENT(event));
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

        return response?.data?.tasks?.[0]?.result?.события ?? [];
    } catch (_) {
        return [];
    }
}

export async function syncCalendar() {
    const events = await getEvents();
    const ics = generateICS(events);
    return uploadICSDirect(ics);
}
