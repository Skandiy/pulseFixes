// Слушаем сообщения из content.js или других частей расширения
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('addEventListener')
    if (message.type === "show-notification") {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/128.png", // путь к иконке
            title: message.title || "Уведомление",
            message: message.message || "Текст уведомления",
            priority: 2
        });
        sendResponse({ status: "ok" });
    }
    return true; // если планируется асинхронный sendResponse
});