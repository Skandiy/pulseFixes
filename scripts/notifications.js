/**
 * Отправляет событие уведомления в content.js
 *
 * @param id
 * @param payload
 */
function showLocalNotification(id, payload) {
    window.postMessage({
        type: "SHOW_NOTIFICATION",
        id: id,
        payload: payload
    }, "*");
}