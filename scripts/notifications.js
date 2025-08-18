function showLocalNotification(title, text) {
    window.postMessage({
        type: "SHOW_NOTIFICATION",
        title: title,
        text: text
    }, "*");
}