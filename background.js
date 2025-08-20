let cacheNotifications = {};

/**
 * Слушаем сообщения из content.js
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('addEventListener')
    if (message.type === "show-notification") {
        if (!cacheNotifications[message.id]) {
            chrome.notifications.create({
                type: "basic",
                iconUrl: message.payload.avatar || "icons/128.png", // путь к иконке
                title: message.payload.title || "Уведомление",
                message: message.payload.subtitle || "Текст уведомления",
                contextMessage: message.payload.member,
                priority: 2,
                requireInteraction: true,
                buttons: [
                    {
                        title: 'btn1',
                    },
                    {
                        title: 'btn2',
                    }
                ]
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