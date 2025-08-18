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

window.addEventListener("DOMContentLoaded", load, false);