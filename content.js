/**
 * Загружает и встраивает скрипты и стили, указанные в modules.json
 */
(async () => {
    const modulesJsonUrl = chrome.runtime.getURL('modules.json');
    const response = await fetch(modulesJsonUrl);
    const { scripts = [], styles = [] } = await response.json();

    // 1. Добавляем стили
    for (const path of styles) {
        const styleUrl = chrome.runtime.getURL(path);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleUrl;
        link.crossOrigin = '';
        link.dataset.from = 'pulse-extension';
        document.head.appendChild(link);
    }

    // 2. Вставляем inline-скрипты
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
