let cacheNotifications = {};

// Слушаем сообщения из content.js или других частей расширения
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('addEventListener')
    if (message.type === "show-notification") {
        if (!cacheNotifications[message.id]) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: "icons/128.png", // путь к иконке
                title: message.title || "Уведомление",
                message: message.message || "Текст уведомления",
                priority: 2
            });
            sendResponse({ status: "ok" });

            cacheNotifications[message.id] = 1

            setTimeout(() => {
                cacheNotifications = {};
            }, 10_000)
        }
    }
    return true; // если планируется асинхронный sendResponse
});