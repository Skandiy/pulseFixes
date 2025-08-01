let settings = null

const load = async function () {
    const reloadNotice = document.getElementById('reloadNotice');
    const permissionsBlock = document.getElementById('addPermissions');
    document.getElementById('applyBtn').addEventListener('click', () => {
        getCurrentTab(tab => {
            chrome.tabs.reload(tab.id);
            window.close(); // Закрываем popup
        });
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

        // reloadNotice.style.display = changed ? 'block' : 'none';
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

    // Навешиваем обработчик на все чекбоксы
    checkboxes.forEach(input => input.addEventListener('change', checkboxChange));




    const perProject = document.querySelector('#perProject');
    const perPulse = document.querySelector('#perPulse');
    /*  */
    perProject.addEventListener("click", function () {
        chrome.storage.sync.set({perProject: perProject.checked})
    });
    perPulse.addEventListener("click", function () {
        chrome.storage.sync.set({perPulse: perPulse.checked})
    });
    /*  */
    window.removeEventListener("load", load, false);

    chrome.storage.sync.get(null, (stored) => {
        Object.keys(stored).forEach((key) => {
            try {
                document.querySelector('#' + key).checked = stored[key];
            } catch (e) {
                console.error(e)
            }
        })
    })
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
            if (!deepEqual(JSON.stringify(storageSettings), JSON.stringify(settings))) {
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

            // Получаем настройки из chrome.storage.sync
            chrome.storage.sync.get(null, (storageSettings) => {
                if (!deepEqual(JSON.stringify(storageSettings), pageSettings)) {
                    showNotification();
                }
            });
        });
    }
}

window.addEventListener("DOMContentLoaded", load, false);