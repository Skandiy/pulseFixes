// Возвращает кнопку «Ответить» у комментариев задачи.
//
// Pulse рисует её только тогда, когда сервер разрешил ответы:
// РеестрЗаметок.ПолучитьОграничения → { ответ: true }. Всё остальное — плашка «Ответить …»
// над редактором и поле «заметки-ответ» при сохранении — в Pulse осталось, поэтому достаточно
// подменить этот флаг в ответе сервера, и сайт сам покажет свою кнопку.
//
// Скрипт должен стоять в modules.json раньше rules.js: тот подменяет JSON.parse/JSON.stringify
// (а в режиме отладки ещё и дописывает id задачам), и чужие ответы через них гонять нельзя.
(() => {
    const OBJECT_NAME = 'РеестрЗаметок';
    const METHOD_NAME = 'ПолучитьОграничения';
    const REPLY_LIMIT_KEY = 'ответ';

    const nativeJson = getNativeJson();
    const proto = XMLHttpRequest.prototype;
    const originalSend = proto.send;
    const getResponseText = Object.getOwnPropertyDescriptor(proto, 'responseText').get;
    const getResponse = Object.getOwnPropertyDescriptor(proto, 'response').get;

    function isNative(fn) {
        return /\{\s*\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));
    }

    function getNativeJson() {
        if (isNative(JSON.parse) && isNative(JSON.stringify)) {
            return { parse: JSON.parse, stringify: JSON.stringify };
        }

        // Порядок в modules.json всё-таки нарушили — берём нетронутый JSON из чистого iframe.
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        document.documentElement.appendChild(frame);
        const { parse, stringify } = frame.contentWindow.JSON;
        frame.remove();
        return { parse, stringify };
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    /** Номера задач запроса, которые спрашивают ограничения заметок. */
    function findLimitTaskIndexes(body) {
        if (typeof body !== 'string' || !body.includes(METHOD_NAME)) {
            return [];
        }

        let payload;
        try {
            payload = nativeJson.parse(body);
        } catch (_) {
            return [];
        }

        if (!isPlainObject(payload) || !Array.isArray(payload.tasks)) {
            return [];
        }

        const indexes = [];
        payload.tasks.forEach((task, index) => {
            if (task?.objectName === OBJECT_NAME && task?.methodName === METHOD_NAME) {
                indexes.push(index);
            }
        });
        return indexes;
    }

    /** Разрешает ответы в ответе сервера. Возвращает true, если что-то поменялось. */
    function allowReplies(payload, indexes) {
        if (!isPlainObject(payload) || !Array.isArray(payload.tasks)) {
            return false;
        }

        let changed = false;
        for (const index of indexes) {
            const result = payload.tasks[index]?.result;

            if (!isPlainObject(result)) {
                console.warn(`[Trick Plus] ${OBJECT_NAME}.${METHOD_NAME}: неожиданный ответ, кнопка «Ответить» не возвращена`, payload.tasks[index]);
                continue;
            }

            if (result[REPLY_LIMIT_KEY] !== true) {
                result[REPLY_LIMIT_KEY] = true;
                changed = true;
            }
        }
        return changed;
    }

    function patchResponseText(text, indexes) {
        let payload;
        try {
            payload = nativeJson.parse(text);
        } catch (_) {
            return text;
        }

        return allowReplies(payload, indexes) ? nativeJson.stringify(payload) : text;
    }

    // Подменяем геттеры у конкретного запроса: тогда неважно, в каком порядке Pulse
    // и мы подписались на события XHR, — он в любом случае прочитает уже исправленный ответ.
    function overrideResponse(xhr, indexes) {
        let patchedText = null;
        const readPatchedText = () => {
            if (patchedText === null) {
                patchedText = patchResponseText(getResponseText.call(xhr), indexes);
            }
            return patchedText;
        };

        Object.defineProperty(xhr, 'responseText', {
            configurable: true,
            get() {
                return xhr.readyState === XMLHttpRequest.DONE ? readPatchedText() : getResponseText.call(xhr);
            },
        });

        Object.defineProperty(xhr, 'response', {
            configurable: true,
            get() {
                if (xhr.readyState !== XMLHttpRequest.DONE) {
                    return getResponse.call(xhr);
                }

                if (xhr.responseType === '' || xhr.responseType === 'text') {
                    return readPatchedText();
                }

                const value = getResponse.call(xhr);
                if (xhr.responseType === 'json') {
                    allowReplies(value, indexes);
                }
                return value;
            },
        });
    }

    proto.send = function (body) {
        try {
            const indexes = findLimitTaskIndexes(body);
            if (indexes.length > 0) {
                overrideResponse(this, indexes);
            }
        } catch (error) {
            console.error('[Trick Plus] Не удалось перехватить ограничения заметок', error);
        }

        return originalSend.apply(this, arguments);
    };
})();
