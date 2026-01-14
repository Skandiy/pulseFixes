/**
 * Функция для отправки уведомления в background
 *
 * @param id
 * @param payload
 */
const showNotificationFromContent = (id, payload) => {
    chrome.runtime.sendMessage({
        type: "show-notification",
        id: id,
        payload: payload
    }, (response) => {
        if (response?.status === "ok") {

        }
    });
}

// function showNotification() {
//     console.log('showNotification')
//     new Notification("Привет из content.js!", {
//         body: "Это уведомление отображается через new Notification()",
//         icon: "https://via.placeholder.com/128" // можно заменить на свою иконку
//     });
// }

/**
 * Загружает и встраивает скрипты и стили, указанные в modules.json
 */
(async () => {
    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const {scripts = [], styles = []} = await response.json();

    // 2. Загружаем настройки из хранилища (sync)
    const settings = await new Promise((resolve) => {
        chrome.storage.sync.get(null, resolve);
    });

    // 2. Загружаем настройки из хранилища (local)
    settings.enableFeatures = await new Promise((resolve) => {
        chrome.storage.local.get(null, (settings) => {
            resolve(settings.enableFeatures ?? false)
        })
    });
    settings.advancedSettings = await new Promise((resolve) => {
        chrome.storage.local.get(null, (settings) => {
            resolve(settings.advancedSettings ?? false)
        })
    });

    if (!!settings.enableFeatures) {
        // 1. Добавляем стили
        for (const path of styles) {
            let styleUrl = '';
            if (path instanceof Object) {
                if (!!settings[path.key]) {
                    styleUrl = chrome.runtime.getURL(path.value);
                } else {
                    continue;
                }
            } else {
                styleUrl = chrome.runtime.getURL(path);
            }

            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = styleUrl;
            link.crossOrigin = '';
            link.dataset.from = 'pulse-extension';
            document.head.appendChild(link);
        }

        window.PULSE_EXTENSION_SETTINGS = JSON.stringify(settings);

        // Обработчик запроса от popup.js
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg?.type === 'GET_PULSE_EXTENSION_SETTINGS') {
                sendResponse(window.PULSE_EXTENSION_SETTINGS);
            }

            if (msg?.type === 'EXECUTE_PAGE_REQUEST') {
                (async () => {
                    try {
                        const data = await sendRequest(msg.payload);

                        sendResponse({
                            ok: true,
                            data
                        });
                    } catch (err) {
                        sendResponse({
                            ok: false,
                            error: err.message
                        });
                    }
                })();

                return true;
            }

            if (msg?.type === 'GET_LOCAL_STORAGE_VALUE') {
                try {
                    sendResponse({
                        ok: true,
                        data: localStorage.getItem(msg.payload.key)
                    });
                } catch (err) {
                    sendResponse({
                        ok: false,
                        data: null
                    });
                }
            }
        });

        // 3. Создаем inline-скрипт, который диспатчит событие
        const script = document.createElement('script');
        script.textContent = `
            (function() {
              window.PULSE_EXTENSION_SETTINGS = ${JSON.stringify(settings)};
              const event = new CustomEvent('PulseExtensionSettingsLoaded', {
                detail: window.PULSE_EXTENSION_SETTINGS
              });
              
              window.dispatchEvent(event);
            })();
          `;
        document.documentElement.appendChild(script);

        chrome.storage.sync.get(null, (currentSettings) => {
            // При загрузке страницы отправляем настройки в background
            chrome.runtime.sendMessage({
                type: 'PageLoadedSettings',
                payload: currentSettings
            });
        });


        // 4. Вставляем inline-скрипты из modules.json
        for (const path of scripts) {
            try {
                const scriptText = await fetch(chrome.runtime.getURL(path)).then(r => r.text());

                const script = document.createElement('script');
                script.textContent = scriptText;
                script.dataset.from = 'pulse-extension';
                document.documentElement.appendChild(script);
            } catch (err) {
                console.error(`Не удалось загрузить скрипт ${path}:`, err);
            }
        }

        /**
         * Принимает уведомления из rules.js, а так же может из других мест на странице
         */
        window.addEventListener("message", (event) => {
            if (event.source !== window) return; // фильтр, чтобы не ловить чужие события
            if (event.data.type && event.data.type === "SHOW_NOTIFICATION") {
                // уведомление без получения разрешения от пользователя
                showNotificationFromContent(event.data.id, event.data.payload)

                // Уведомление для которого нужно, чтобы пользователь на сайте разрешил уведомления
                // console.log('Notification.permission', Notification.permission)
                // // Проверяем разрешение
                // if (Notification.permission === "granted") {
                //     showNotification();
                // } else if (Notification.permission !== "denied") {
                //     console.log('Notification.requestPermission')
                //     Notification.requestPermission().then(permission => {
                //         if (permission === "granted") {
                //             showNotification();
                //         }
                //     }).catch(err => {
                //         console.log(err)
                //     });
                // }
            }
        });
    }
})();

function sendRequest(payload) {
    return new Promise((resolve, reject) => {
        fetch("https://pulse.stack-it.ru/app/stackgateway/billing/pulse/kvpl", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "s-access-token": JSON.parse(localStorage.getItem('common')).authSystemStore.token_,
            },
            body: JSON.stringify(payload)
        })
            .then(response => response.json())
            .then(data => resolve(data))
            .catch(error => reject(error));
    })
}