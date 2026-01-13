/**
 * Синхронизация календаря
 */
async function syncCalendar() {
    const events = await getEvents();
    const ics = generateICS(events);
    const calData = await uploadICSDirect(ics);
    document.querySelector('#calendarIosLink').textContent = calData.url;
    document.querySelector('#calendarIosLink').href = calData.url;
}

/**
 * Генерирует файл ICS
 *
 * @param events
 * @returns {string}
 */
function generateICS(events) {
    const calendar = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Your Company//Calendar Export//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ];

    for (const event of events) {
        calendar.push(eventToVEVENT(event));
    }

    calendar.push("END:VCALENDAR");

    return calendar.join("\r\n");
}

/**
 * Загружает ICS напрямую на сервер
 *
 * @param {string} icsContent
 * @returns {Promise<{url: string}>}
 */
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
        'calendar.ics'
    );

    formData.append('user_id', userId);
    formData.append('filename', 'calendar.ics');

    const response = await fetch(
        'https://vpn.sk-serv.ru:9443/upload',
        {
            method: 'POST',
            body: formData,
        }
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upload error: ${text}`);
    }

    return response.json();
}

/**
 * Форматирует дату в формате ISO 8601
 *
 * @param date
 * @returns {string}
 */
function formatICSDate(date) {
    return date
        .toISOString()
        .replace(/[-:]/g, "")
        .split(".")[0] + "Z";
}

/**
 * Парсит дату и время в формате ISO 8601
 *
 * @param date
 * @param time
 * @returns {Date}
 */
function parseDateTime(date, time) {
    return new Date(`${date.split("T")[0]}T${time}:00`);
}

/**
 * Добавляет событие в ics
 *
 * @param event
 * @returns {string}
 */
function eventToVEVENT(event) {
    const startDate = parseDateTime(event.date, event.time);
    const endDate = new Date(event.end.replace(" ", "T") + ":00");

    const lines = [
        "BEGIN:VEVENT",
        `UID:event-${event.id}@vpn.sk-serv.ru`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:${event.name}`,
        `DESCRIPTION:${buildIcsDescription(event.comment)}`,
    ];

    /* ---------- Повторения ---------- */
    // if (event.repeatType && event.customRepeat) {
    //     try {
    //         const repeat = JSON.parse(event.customRepeat);
    //
    //         // intervalType:
    //         // 1 — недели, 2 — месяцы (пример, можно расширять)
    //         if (repeat.intervalType === 1) {
    //             lines.push(
    //                 `RRULE:FREQ=WEEKLY;INTERVAL=${repeat.interval};UNTIL=${formatICSDate(
    //                     new Date(repeat.ending)
    //                 )}`
    //             );
    //         }
    //     } catch (e) {
    //         // если repeat некорректный — просто пропускаем
    //     }
    // }

    /* ---------- Уведомления ---------- */
    if (event.notify) {
        event.notify.split(",").forEach((n) => {
            const minutes = parseInt(n);
            if (!isNaN(minutes)) {
                lines.push(
                    "BEGIN:VALARM",
                    `TRIGGER:-PT${minutes}M`,
                    "ACTION:DISPLAY",
                    "DESCRIPTION:Напоминание",
                    "END:VALARM"
                );
            }
        });
    }

    lines.push("END:VEVENT");

    return lines.join("\r\n");
}

/**
 * Создание описания события
 *
 * @param comment
 * @returns {string}
 */
function buildIcsDescription(comment) {
    if (!comment) return '-';

    // 1. Нормализуем переносы строк
    let text = comment.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 2. Экранируем спецсимволы RFC 5545
    text = text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');

    // 3. Line folding (75 OCTETS, не символов — упрощённо 70)
    const maxLength = 70;
    const parts = [];

    while (text.length > maxLength) {
        parts.push(text.slice(0, maxLength));
        text = text.slice(maxLength);
    }
    parts.push(text);

    return parts.join('\r\n ');
}

function getLocalStorageValue(key) {
    return new Promise((resolve) => {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) resolve(null);

                chrome.tabs.sendMessage(
                    tabs[0].id,
                    {
                        type: 'GET_LOCAL_STORAGE_VALUE',
                        payload: { key },
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('sendMessage error:', chrome.runtime.lastError.message);
                            resolve(null);
                        }

                        try {
                            resolve(JSON.parse(response.data));
                        } catch (e) {
                            resolve(null);
                        }
                    }
                );
            });
        } catch (e) {
            resolve(null);
        }
    })
}

/**
 * Получение событий календаря
 */
function getEvents() {
    return new Promise((resolve) => {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (!tabs[0]) resolve([]);

                const dateStart = new Date("2025-12-01T10:00:00Z");
                const dateEnd = new Date("2026-12-31T10:00:00Z");

                chrome.tabs.sendMessage(
                    tabs[0].id,
                    {
                        type: 'EXECUTE_PAGE_REQUEST',
                        payload: {
                            "tasks": [
                                {
                                    "objectName": "Календарь",
                                    "methodName": "ПолучитьСобытия",
                                    "params": {
                                        "датнач": dateStart.toISOString().split('T')[0],
                                        "даткнц": dateEnd.toISOString().split('T')[0],
                                        "фильтр": {
                                            "сотрудник": "{\"fieldType\":5,\"value\":\"" + (await getLocalStorageValue('pulse')).userInfoStore.userId_ + "\"}",
                                            "внутренние": "0,1,4",
                                            "внешние": null
                                        }
                                    }
                                }
                            ],
                            "info": {
                                "workMonth": "2025-08-01T00:00:00.000"
                            }
                        },
                    },
                    (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('sendMessage error:', chrome.runtime.lastError.message);
                            resolve([]);
                        }

                        resolve(response.data.tasks[0].result['события'] ?? [])
                    }
                );
            });
        } catch (e) {
            console.error(e)
        }
    })
}