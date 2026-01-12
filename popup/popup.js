let settings = null

const load = async function () {
    window.removeEventListener("load", load, false);

    const reloadNotice = document.getElementById('reloadNotice');
    const permissionsBlock = document.getElementById('settings');
    document.getElementById('applyBtn').addEventListener('click', () => {
        getCurrentTab(tab => {
            chrome.tabs.reload(tab.id);
            window.close(); // Закрываем popup
        });
    });

    const manifest = chrome.runtime.getManifest();

    document.getElementById('ext-name').textContent = manifest.name;
    document.getElementById('ext-version').textContent = manifest.version;

    // Обрабатываем 10 кликов по картинке для показа настроек прав
    chrome.storage.local.get('advancedSettings', (settings) => {
        if (!!settings.advancedSettings) {
            showAdvancedSettings()
        } else {
            const callback = () => {
                let count = 0;
                let timer;
                return () => {
                    if (count < 0) {
                        return;
                    }
                    try {
                        clearTimeout(timer)
                    } catch (e) {}
                    count++
                    if (count < 10) {
                        timer = setTimeout(() => {
                            count = 0;
                        }, 1000)
                    } else {
                        chrome.storage.local.set({advancedSettings: true})
                        showAdvancedSettings()
                        clearTimeout(timer)
                        count = -1
                    }
                }
            }

            document.getElementById('infoBtn').addEventListener('click', callback());
        }
    });

    // Получаем все чекбоксы внутри блока
    const checkboxes = Array.from(permissionsBlock.querySelectorAll('input[type="checkbox"]'));

    getCurrentTab(checkSettings);

    // Проверка на изменения
    function checkForChanges() {
        const changed = checkboxes.some(input => {
            const key = input.id;
            return input.checked !== (settings[key] ?? false);
        });

        reloadNotice.classList.toggle('show', changed);
        return changed;
    }

    function checkboxChange(ev) {
        const key = ev.target.id
        const value = ev.target.checked

        const settings = {};
        settings[key] = value;

        chrome.storage.sync.set(settings)

        checkForChanges()
    }

    chrome.storage.sync.get(null, (stored) => {
        Object.keys(stored).forEach((key) => {
            try {
                document.querySelector('#' + key).checked = stored[key];
            } catch (e) {
                console.error(e)
            }
        })
    })

    // Навешиваем обработчик на все чекбоксы
    checkboxes.forEach(input => input.addEventListener('change', checkboxChange));

    permissionsBlock.querySelector('#syncCalendar').addEventListener('click', syncCalendar)
};

function getCurrentTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        if (!tabs.length) return;
        callback(tabs[0]);
    });
}

function deepEqual(a, b) {
    return a === b;
}

function showNotification() {
    reloadNotice.classList.toggle('show', true);
}

const checkSettings = (tab) => {
    if (!tab || !tab.url || !tab.url.startsWith("https://pulse.stack-it.ru")) {
        console.warn('Активная вкладка не на нужном домене, пропускаем запрос настроек');
        return;
    }

    if (settings != null) {
        // Получаем настройки из chrome.storage.sync
        chrome.storage.sync.get(null, (storageSettings) => {
            const {advancedSettings, ...tmp} = settings;
            if (!deepEqual(JSON.stringify(storageSettings), JSON.stringify(tmp))) {
                showNotification();
            }
        });
    } else {
        // Запрашиваем настройки с контент-скрипта
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PULSE_EXTENSION_SETTINGS' }, (pageSettings) => {
            if (chrome.runtime.lastError || !pageSettings) {
                console.warn('Не удалось получить настройки со страницы:', chrome.runtime.lastError);
                return;
            }

            settings = JSON.parse(pageSettings);

            const {advancedSettings, ...tmp} = settings;

            // Получаем настройки из chrome.storage.sync
            chrome.storage.sync.get(null, (storageSettings) => {
                if (!deepEqual(JSON.stringify(storageSettings), JSON.stringify(tmp))) {
                    showNotification();
                }
            });
        });
    }
}

function showAdvancedSettings() {
    document.querySelectorAll('.advancedSettings').forEach((elem) => {
        elem.classList.add('show')
    })
}

/**
 * Синхронизация календаря
 */
async function syncCalendar() {
    const events = await getEvents();
    const ics = generateICS(events);
    const tgFileId = await sendICSToTelegram({
        botToken: '6814242489:AAGBTeCKjIvaHzGVJlrKej0A2nmwXFafFnU',
        chatId: -1002062079593,
        icsContent: ics,
        filename: "meeting.ics",
    });
    const calData = await publicICS(tgFileId);
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
 * Отправляет файл в Telegram
 *
 * @param botToken
 * @param chatId
 * @param icsContent
 * @param filename
 * @returns {Promise<any>}
 */
async function sendICSToTelegram({
                                     botToken,
                                     chatId,
                                     icsContent,
                                     filename = "event.ics"
                                 }) {
    const formData = new FormData();

    formData.append(
        "document",
        new Blob([icsContent], { type: "text/calendar;charset=utf-8" }),
        filename
    );

    formData.append("chat_id", chatId);

    // formData.append(
    //     "caption",
    //     `@StackMobileBot новый файл календаря`
    // );

    const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        {
            method: "POST",
            body: formData,
        }
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Telegram API error: ${text}`);
    }

    return response.json().then(data => data.result.document.file_id);
}

/**
 * Публикует файл календаря
 *
 * @param telegramFileId
 * @returns {Promise<void>}
 */
async function publicICS(telegramFileId) {
    const response = await fetch("https://vpn.sk-serv.ru:9443/download", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            file_id: telegramFileId,
            user_id: (await getLocalStorageValue('')).user_id,
            filename: "calendar.ics"
        })
    });

    return response.json().then(data => data);
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
                                            "сотрудник": "{\"fieldType\":5,\"value\":\"" + (await getLocalStorageValue('')).user_id + "\"}",
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



window.addEventListener("DOMContentLoaded", load, false);