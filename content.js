/**
 * Загружает и встраивает скрипты и стили, указанные в modules.json
 */
(async () => {
    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const {scripts = [], styles = []} = await response.json();

    // 2. Загружаем настройки из хранилища (sync или local)
    const settings = await new Promise((resolve) => {
        chrome.storage.sync.get(null, resolve);
    });

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

    // fixme от сюда нет доступа к popup чтобы понять какие настройки являются расширенными
    // const advancedSettings = await new Promise((resolve) => {
    //     // console.log(chrome.storage.local.get(null, resolve))
    //     chrome.storage.local.get(null, (settings) => {
    //         resolve(settings.advancedSettings ?? false)
    //     })
    // });
    //
    // if (!advancedSettings) {
    //     console.log(document.querySelectorAll('.advancedSettings'))
    //     document.querySelectorAll('.advancedSettings').forEach((item) => {
    //         console.log(item)
    //     });
    // }

    window.PULSE_EXTENSION_SETTINGS = JSON.stringify(settings);

    // Обработчик запроса от popup.js
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg?.type === 'GET_PULSE_EXTENSION_SETTINGS') {
            sendResponse(window.PULSE_EXTENSION_SETTINGS);
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
})();
