function showLocalNotification(id, title, text) {
    window.postMessage({
        type: "SHOW_NOTIFICATION",
        id: id,
        title: title,
        text: text
    }, "*");
}