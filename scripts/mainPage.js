(() => {
    const SETTING_KEY = 'workloadPlanMarker';

    const MESSAGE_TYPES = {
        WINDOW_EXECUTE_PAGE_REQUEST: 'WINDOW_EXECUTE_PAGE_REQUEST',
        WINDOW_EXECUTE_PAGE_REQUEST_RESULT: 'WINDOW_EXECUTE_PAGE_REQUEST_RESULT',
    };

    const ROUTE_EVENT = 'TrickPlusMainPageRouteChange';
    const HISTORY_PATCH_FLAG = '__trickPlusMainPageHistoryPatched';

    const SETTING_PLAN_OVERRIDE_KEY = 'workloadPlanOverride';

    const MARKER_ATTR = 'data-pulse-plus-workload-marker';
    const MONTH_MARKER_ATTR = 'data-pulse-plus-workload-month-marker';
    const PLAN_VALUE_ATTR = 'data-pulse-plus-workload-plan';
    const STATE_ATTR = 'data-pulse-plus-workload-state';
    const MARKER_CLASS = 'pulse-plus-workload-marker';
    const MONTH_MARKER_CLASS = 'pulse-plus-workload-month-marker';
    const MONTH_MARKER_DASH_CLASS = 'pulse-plus-workload-month-marker__dash';
    const PLAN_VALUE_CLASS = 'pulse-plus-workload-plan-value';
    const HOST_CLASS = 'pulse-plus-workload-progress-host';
    const POPUP_CLASS = 'pulse-plus-workload-popup';
    const POPUP_VISIBLE_CLASS = `${POPUP_CLASS}--visible`;
    const OWN_NODE_CLASSES = [MARKER_CLASS, MONTH_MARKER_CLASS, MONTH_MARKER_DASH_CLASS, PLAN_VALUE_CLASS, POPUP_CLASS];
    // Внутри этих элементов всё наше: их перестройка (штрихи, текст цифры и попапа) не повод
    // пересчитывать отметки
    const OWN_SUBTREE_SELECTOR = [
        `[${MARKER_ATTR}]`,
        `[${MONTH_MARKER_ATTR}]`,
        `[${PLAN_VALUE_ATTR}]`,
        `.${POPUP_CLASS}`,
    ].join(', ');

    // Попап-пояснение. Наведение ловится по координатам курсора, а не событиями элементов:
    // отметки остаются прозрачными для мыши, и клик рядом с ними по-прежнему открывает «График».
    // Тонкие отметки ловим в полосе ±6px от линии и на 4px выше и ниже, цифру — с запасом 4px.
    const MARKER_HOVER_HALF_WIDTH_PX = 6;
    const MARKER_HOVER_VERTICAL_PX = 4;
    const PLAN_VALUE_HOVER_PADDING_PX = 4;
    const POPUP_GAP_PX = 8;
    const POPUP_VIEWPORT_MARGIN_PX = 8;
    // Темп до конца месяца округляем вверх до 5 минут: если держать его, план точно будет выполнен
    const PACE_STEP_HOURS = 5 / 60;

    // Пунктир плана на месяц собран из отдельных штрихов с постоянным шагом. Длина штриха
    // и разрыв — целые числа физических пикселей экрана: при масштабе 125% штрих 3px занял бы
    // 3,75 пикселя, и после округления при отрисовке соседние штрихи и разрывы расходились бы
    // на пиксель. Поэтому и число штрихов, и отступ считаются в физических пикселях.
    const MONTH_MARKER_DASH_PX = 3;
    const MONTH_MARKER_GAP_PX = 2;
    const MONTH_MARKER_MIN_DASHES = 2;
    // Пока строка не свёрстана и высоту не измерить — столько штрихов у шкалы 8px
    const MONTH_MARKER_FALLBACK_DASHES = 4;
    // Chrome хранит размеры с шагом 1/64 физического пикселя и отбрасывает остаток: без запаса
    // 4 / 1.5 * 1.5 = 3.9999… стало бы 3.984, и у дальних штрихов округление съехало бы.
    const DEVICE_PIXEL_EPSILON = 0.005;

    const PROGRESS_FILL_SELECTOR = '.v-progress-linear__determinate';

    // Заливку красим инлайном: правила Vuetify (".v-application .primary.lighten-1" и его
    // вариант из darkThemeVariablesUsed.css) объявлены с !important и специфичностью выше,
    // чем у селектора из подключаемого файла стилей.
    const STATE_COLORS = {
        warning: '#f2a600',
        danger: '#e53935',
    };

    const SCHEDULE_LINK_SELECTOR = 'a[href*="/pulse/analytics/projects/schedule"]';
    const PERIOD_FILTER_PARAM = 'fltr_период';
    const EMPLOYEE_FILTER_PARAM = 'fltr_исполнитель';
    const POTENTIAL_FIELD = '@потенциал';
    const WORK_HOURS_FIELD = 'рабочихчасов';
    const WORK_TIME_FIELD = 'времяработы';
    const WORK_MODE_FIELD = 'режимработы';
    const WIDGET_TITLE = 'Трудозатраты';
    const WIDGET_TITLE_LOOKUP_DEPTH = 6;
    const VALUES_ROW_LOOKUP_DEPTH = 3;

    // Значения поля "типотсутствия" в ответе метода МояСтраница_ПолучитьТрудозатраты
    const DAY_OFF_TYPE = 4;

    // Отставание от плановой отметки: до 6ч — норма, с 6ч — жёлтый, с 12ч — красный
    const WARNING_THRESHOLD_HOURS = 6;
    const DANGER_THRESHOLD_HOURS = 12;
    // Допуск для сравнения часов (0.001ч ≈ 3,6 секунды) и отдельный — для ошибки округления
    // при делении на шаг: там 0.001 давало бы срабатывание почти за 2 секунды до момента
    const EPSILON = 0.001;
    const FLOAT_EPSILON = 1e-9;

    // Отметка внутри дня двигается, когда накопится 30 минут плана. Момент шага зависит от
    // графика: при потенциале 6ч на смене 08:00-16:30 полчаса плана набегают за 42,5 минуты.
    const PLAN_STEP_HOURS = 0.5;
    // Секунда запаса, чтобы тик гарантированно случился уже после границы, а не за миг до неё
    const PLAN_TICK_SAFETY_MS = 1000;
    // Когда следующий шаг посчитать нельзя (смена кончилась, графика нет), просто дышим
    const PLAN_IDLE_INTERVAL_MS = 30 * 60 * 1000;

    const REFRESH_DEBOUNCE_MS = 250;

    // Кэш между перезагрузками: храним не готовое число, а исходные данные (расписание месяца
    // и карточку сотрудника), чтобы отметку можно было посчитать на текущий момент.
    const PLAN_CACHE_STORAGE_KEY = 'trickPlus.workloadPlan.cache';
    const PLAN_CACHE_VERSION = 2;
    const PLAN_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

    const scheduleCache = new Map();
    const potentialCache = new Map();
    const liveLoadedKeys = new Set();

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    function formatKvplDate(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T00:00:00.000`;
    }

    function parseKvplDate(value) {
        if (typeof value !== 'string') {
            return null;
        }

        const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) {
            return null;
        }

        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    function toDayKey(date) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
    }

    /**
     * Разбирает подписи вида "71ч 50мин", "184ч", "из 184ч" в количество часов.
     */
    function parseHoursText(text) {
        if (typeof text !== 'string') {
            return null;
        }

        const hoursMatch = text.match(/(\d+)\s*ч/);
        const minutesMatch = text.match(/(\d+)\s*мин/);

        if (!hoursMatch && !minutesMatch) {
            return null;
        }

        const hours = hoursMatch ? Number(hoursMatch[1]) : 0;
        const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;

        return hours + minutes / 60;
    }

    function formatHours(value) {
        const totalMinutes = Math.round(value * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        return minutes ? `${hours}ч ${minutes}мин` : `${hours}ч`;
    }

    function isMainPageRoute() {
        return window.location.pathname.replace(/\/+$/, '') === '/pulse';
    }

    function executePageRequest(payload) {
        return new Promise((resolve, reject) => {
            const requestId = `pulse-page-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            function handleMessage(event) {
                if (event.source !== window) {
                    return;
                }

                if (event.data?.type !== MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST_RESULT) {
                    return;
                }

                if (event.data?.id !== requestId) {
                    return;
                }

                window.removeEventListener('message', handleMessage);

                const { response } = event.data;

                if (!response?.ok) {
                    reject(new Error(response?.error || 'Page request failed'));
                    return;
                }

                resolve(response.data);
            }

            window.addEventListener('message', handleMessage);
            window.postMessage({
                type: MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST,
                id: requestId,
                payload,
            }, '*');
        });
    }

    function debounce(fn, delay) {
        let timer = null;

        return function debounced() {
            window.clearTimeout(timer);
            timer = window.setTimeout(fn, delay);
        };
    }

    function hasWidgetTitle(element) {
        let current = element;

        for (let depth = 0; depth < WIDGET_TITLE_LOOKUP_DEPTH && current; depth += 1) {
            if ((current.textContent || '').includes(WIDGET_TITLE)) {
                return true;
            }

            current = current.parentElement;
        }

        return false;
    }

    /**
     * Подпись общего плана ("из 184ч") — правая цифра в строке значений.
     */
    function findPlanLabelSpan(row) {
        for (const span of row.querySelectorAll('span')) {
            const text = (span.textContent || '').trim();

            if (/из/i.test(text) && parseHoursText(text) !== null) {
                return span;
            }
        }

        return null;
    }

    function hasPlanLabel(row) {
        return findPlanLabelSpan(row) !== null;
    }

    /**
     * Ищет строку с подписями ("71ч 50мин" и "из 184ч") рядом со строкой прогресса.
     */
    function findValuesRow(progressRow) {
        let scope = progressRow.parentElement;

        for (let depth = 0; depth < VALUES_ROW_LOOKUP_DEPTH && scope; depth += 1) {
            for (const row of scope.querySelectorAll('.row')) {
                if (row === progressRow || row.contains(progressRow)) {
                    continue;
                }

                if (hasPlanLabel(row)) {
                    return row;
                }
            }

            scope = scope.parentElement;
        }

        return null;
    }

    /**
     * Читает фактические и плановые часы из подписей под строкой прогресса.
     */
    function readWorkloadValues(valuesRow, progressbar) {
        let factHours = null;
        let planHours = null;

        for (const span of valuesRow.querySelectorAll('span')) {
            // добавленную нами цифру плана читать обратно нельзя
            if (span.hasAttribute(PLAN_VALUE_ATTR)) {
                continue;
            }

            const text = (span.textContent || '').trim();
            const hours = parseHoursText(text);

            if (hours === null) {
                continue;
            }

            if (/из/i.test(text)) {
                if (planHours === null) {
                    planHours = hours;
                }
                continue;
            }

            if (factHours === null) {
                factHours = hours;
            }
        }

        if (factHours === null && planHours !== null) {
            const valueNow = Number.parseFloat(progressbar.getAttribute('aria-valuenow'));

            if (Number.isFinite(valueNow)) {
                factHours = (planHours * valueNow) / 100;
            }
        }

        return { factHours, planHours };
    }

    function readLinkParam(link, paramName) {
        try {
            const url = new URL(link.getAttribute('href'), window.location.origin);

            return url.searchParams.get(paramName);
        } catch (error) {
            return null;
        }
    }

    /**
     * Достаёт отображаемый месяц из фильтра периода в ссылке строки прогресса.
     */
    function readMonthFromLink(link) {
        const rawFilter = readLinkParam(link, PERIOD_FILTER_PARAM);

        if (!rawFilter) {
            return null;
        }

        try {
            const from = parseKvplDate(JSON.parse(rawFilter)?.from);

            if (!from) {
                return null;
            }

            return { year: from.getFullYear(), month: from.getMonth() };
        } catch (error) {
            return null;
        }
    }

    function readEmployeeIdFromLink(link) {
        const employeeId = Number.parseInt(String(readLinkParam(link, EMPLOYEE_FILTER_PARAM)), 10);

        return Number.isInteger(employeeId) && employeeId > 0 ? employeeId : null;
    }

    function getFieldValue(result, fieldName) {
        const fields = result?.['поля'];
        const rows = result?.['записи'];

        if (!Array.isArray(fields) || !Array.isArray(rows) || !Array.isArray(rows[0])) {
            return null;
        }

        const fieldIndex = fields.indexOf(fieldName);

        if (fieldIndex < 0) {
            return null;
        }

        return rows[0][fieldIndex] ?? null;
    }

    function toDayMinutes(hours, minutes) {
        if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
            return null;
        }

        if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) {
            return null;
        }

        return hours * 60 + minutes;
    }

    /**
     * Интервал времени суток в минуты от полуночи: "08:00-16:30" (график работы) или
     * "12:00 — 16:00" (период отсутствия — там длинное тире и пробелы).
     */
    function parseTimeRange(value) {
        const match = String(value ?? '').match(/(\d{1,2}):(\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}):(\d{2})/);

        if (!match) {
            return null;
        }

        const start = toDayMinutes(Number(match[1]), Number(match[2]));
        const end = toDayMinutes(Number(match[3]), Number(match[4]));

        return start !== null && end !== null && end > start ? { start, end } : null;
    }

    /**
     * График работы сотрудника: "08:00-16:30" (времяработы) или "08001630" (режимработы).
     */
    function parseWorkDay(workTime, workMode) {
        const workTimeRange = parseTimeRange(workTime);

        if (workTimeRange) {
            return workTimeRange;
        }

        const modeMatch = String(workMode ?? '').match(/^\s*(\d{2})(\d{2})(\d{2})(\d{2})\s*$/);

        if (modeMatch) {
            const start = toDayMinutes(Number(modeMatch[1]), Number(modeMatch[2]));
            const end = toDayMinutes(Number(modeMatch[3]), Number(modeMatch[4]));

            if (start !== null && end !== null && end > start) {
                return { start, end };
            }
        }

        return null;
    }

    function toHours(value) {
        if (typeof value === 'number') {
            return Number.isFinite(value) && value >= 0 ? value : null;
        }

        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value.trim().replace(',', '.'));

            return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
        }

        return null;
    }

    function findWorkloadWidget() {
        let fallback = null;

        for (const link of document.querySelectorAll(SCHEDULE_LINK_SELECTOR)) {
            const progressbar = link.querySelector('[role="progressbar"]');
            const progressRow = link.closest('.row');

            if (!progressbar || !progressRow) {
                continue;
            }

            const valuesRow = findValuesRow(progressRow);

            if (!valuesRow) {
                continue;
            }

            const widget = { link, progressbar, progressRow, valuesRow };

            if (hasWidgetTitle(progressRow)) {
                return widget;
            }

            fallback = fallback || widget;
        }

        return fallback;
    }

    function normalizeScheduleDays(response) {
        const rawDays = response?.tasks?.[0]?.result?.['неделя'];

        if (!Array.isArray(rawDays)) {
            throw new Error('Неожиданный ответ метода МояСтраница_ПолучитьТрудозатраты');
        }

        const daysByKey = new Map();

        for (const rawDay of rawDays) {
            const date = parseKvplDate(rawDay?.['дата']);

            if (!date) {
                continue;
            }

            const key = toDayKey(date);

            const hasAbsence = Boolean(Number(rawDay?.['отсутствие']));
            // "весьдень" = 0 — отсутствие только на часть дня, сам интервал лежит в
            // "периодотсутствия". Поля нет (старый ответ) — считаем отсутствие полным.
            const allDay = rawDay?.['весьдень'];
            const isPartialAbsence = hasAbsence
                && allDay !== undefined
                && allDay !== null
                && Number(allDay) === 0;

            daysByKey.set(key, {
                key,
                isDayOff: Number(rawDay?.['типотсутствия']) === DAY_OFF_TYPE,
                // Выходной внутри периода отпуска приходит с типом отсутствия вместо типа
                // выходного дня, но из плана он исключается уже по этому флагу.
                isFullAbsence: hasAbsence && !isPartialAbsence,
                // Норму дня отсутствие на часть дня не уменьшает, поэтому день остаётся
                // в плане целиком: интервал нужен только чтобы разложить норму по
                // оставшемуся рабочему времени. Интервал не разобрался — день считаем обычным.
                absence: isPartialAbsence ? parseTimeRange(rawDay?.['периодотсутствия']) : null,
            });
        }

        return Array.from(daysByKey.values());
    }

    function loadSchedule(year, month) {
        const cacheKey = `${year}-${pad2(month + 1)}`;
        const cached = scheduleCache.get(cacheKey);

        if (cached) {
            return cached;
        }

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const request = executePageRequest({
            tasks: [
                {
                    objectName: 'МояСтраница',
                    methodName: 'ПолучитьТрудозатраты',
                    params: {
                        date: formatKvplDate(new Date(year, month, daysInMonth)),
                        countDay: daysInMonth,
                    },
                },
            ],
            info: {
                workMonth: formatKvplDate(new Date(year, month, 1)),
            },
        })
            .then(normalizeScheduleDays)
            .catch((error) => {
                scheduleCache.delete(cacheKey);
                throw error;
            });

        scheduleCache.set(cacheKey, request);
        return request;
    }

    /**
     * Потенциал — часы, которые сотрудник должен отмечать за рабочий день.
     * Общий план виджета ("из 184ч") — это максимум рабочих часов, а не цель, поэтому
     * норма дня берётся из карточки сотрудника, а не выводится из этого максимума.
     */
    function readPlanCache(cacheKey) {
        try {
            const raw = window.localStorage.getItem(PLAN_CACHE_STORAGE_KEY);

            if (!raw) {
                return null;
            }

            const cached = JSON.parse(raw);

            if (cached?.version !== PLAN_CACHE_VERSION || cached.key !== cacheKey) {
                return null;
            }

            if (!Array.isArray(cached.days) || !cached.plan || cached.plan.dailyPotential === null) {
                return null;
            }

            if (!Number.isFinite(cached.savedAt) || Date.now() - cached.savedAt > PLAN_CACHE_MAX_AGE_MS) {
                return null;
            }

            return { days: cached.days, plan: cached.plan };
        } catch (error) {
            return null;
        }
    }

    function writePlanCache(cacheKey, days, plan) {
        try {
            window.localStorage.setItem(PLAN_CACHE_STORAGE_KEY, JSON.stringify({
                version: PLAN_CACHE_VERSION,
                key: cacheKey,
                savedAt: Date.now(),
                days,
                plan,
            }));
        } catch (error) {
            // Кэш не критичен: localStorage может быть переполнен или недоступен
        }
    }

    function loadEmployeePlan(employeeId, year, month) {
        const cacheKey = `${employeeId}-${year}-${pad2(month + 1)}`;
        const cached = potentialCache.get(cacheKey);

        if (cached) {
            return cached;
        }

        const request = executePageRequest({
            tasks: [
                {
                    objectName: 'Сотрудники',
                    methodName: 'получить',
                    params: {
                        'номерЗаписи': String(employeeId),
                    },
                },
            ],
            info: {
                workMonth: formatKvplDate(new Date(year, month, 1)),
            },
        })
            .then((response) => {
                const result = response?.tasks?.[0]?.result || null;
                const potential = toHours(getFieldValue(result, POTENTIAL_FIELD));
                const workDay = parseWorkDay(
                    getFieldValue(result, WORK_TIME_FIELD),
                    getFieldValue(result, WORK_MODE_FIELD)
                );

                if (!workDay) {
                    console.warn(
                        '[Trick Plus] Не удалось определить график работы сотрудника,'
                        + ' отметка будет учитывать только прошедшие дни'
                    );
                }

                return {
                    dailyPotential: potential !== null
                        ? potential
                        : toHours(getFieldValue(result, WORK_HOURS_FIELD)),
                    workDay,
                };
            })
            .catch((error) => {
                potentialCache.delete(cacheKey);
                throw error;
            });

        potentialCache.set(cacheKey, request);
        return request;
    }

    function toMinutesOfDay(date) {
        return date.getHours() * 60
            + date.getMinutes()
            + date.getSeconds() / 60
            + date.getMilliseconds() / 60000;
    }

    /**
     * Отрезки смены, на которых копится потенциал: график минус интервал отсутствия.
     * Отсутствие на часть дня норму не уменьшает — те же часы просто набираются за
     * оставшееся время, то есть быстрее: при смене 08:00-16:30, потенциале 6ч и
     * отсутствии 12:00—16:30 очередные 30 минут плана набегают за 20 минут вместо 42,5.
     */
    function buildWorkSegments(workDay, absence) {
        const wholeShift = [{ start: workDay.start, end: workDay.end }];

        if (!absence) {
            return wholeShift;
        }

        const from = Math.max(workDay.start, absence.start);
        const to = Math.min(workDay.end, absence.end);

        // Отсутствие целиком вне смены (например, вечером) на график не влияет
        if (to <= from) {
            return wholeShift;
        }

        const segments = [];

        if (from > workDay.start) {
            segments.push({ start: workDay.start, end: from });
        }

        if (to < workDay.end) {
            segments.push({ start: to, end: workDay.end });
        }

        return segments;
    }

    function lastSegmentEnd(segments) {
        return segments.length ? segments[segments.length - 1].end : null;
    }

    /**
     * Рабочее время дня: границы смены, отрезки без отсутствия и их суммарная длина.
     */
    function resolveDayPlan(workDay, absence) {
        if (!workDay) {
            return null;
        }

        const segments = buildWorkSegments(workDay, absence);

        return {
            start: workDay.start,
            end: workDay.end,
            segments,
            workMinutes: segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
            absence,
        };
    }

    /**
     * Рабочие минуты, прошедшие к моменту nowMinutes: время отсутствия в них не входит.
     */
    function elapsedWorkMinutes(segments, nowMinutes) {
        let elapsed = 0;

        for (const segment of segments) {
            if (nowMinutes <= segment.start) {
                break;
            }

            elapsed += Math.min(segment.end, nowMinutes) - segment.start;
        }

        return elapsed;
    }

    /**
     * Обратное преобразование: время суток, когда будет отработано workMinutes рабочих минут.
     */
    function workMinutesToTimeOfDay(segments, workMinutes) {
        let left = workMinutes;

        for (const segment of segments) {
            const span = segment.end - segment.start;

            if (left <= span) {
                return segment.start + left;
            }

            left -= span;
        }

        return lastSegmentEnd(segments);
    }

    /**
     * Часы потенциала, накопленные к текущему моменту рабочего дня, округлённые вниз
     * до 30 минут плана. Итог всегда кратен получасу: 0, 30мин, 1ч, 1ч30мин...
     */
    function computeTodayHours(dayPlan, dailyPotential, now) {
        if (!dayPlan || !dailyPotential) {
            return 0;
        }

        const nowMinutes = toMinutesOfDay(now);

        if (nowMinutes >= dayPlan.end) {
            return dailyPotential;
        }

        // Смена целиком закрыта отсутствием: копить не на чем, норма доберётся в конце дня
        if (dayPlan.workMinutes <= 0) {
            return 0;
        }

        const elapsed = elapsedWorkMinutes(dayPlan.segments, nowMinutes);

        // Рабочее время кончилось раньше смены — отсутствие стоит в конце дня
        if (elapsed >= dayPlan.workMinutes) {
            return dailyPotential;
        }

        const accrued = dailyPotential * (elapsed / dayPlan.workMinutes);

        return Math.floor(accrued / PLAN_STEP_HOURS + FLOAT_EPSILON) * PLAN_STEP_HOURS;
    }

    /**
     * Время суток (в минутах), когда значение отметки изменится в следующий раз:
     * момент набора очередных 30 минут плана, а если их до конца рабочего времени уже
     * не набрать — сам его конец, где добирается остаток потенциала. Во время отсутствия
     * отметка стоит, поэтому шаг попадает уже за его границу.
     * null — до конца дня изменений нет.
     */
    function findNextPlanChange(dayPlan, dailyPotential, now) {
        if (!dayPlan || !dailyPotential) {
            return null;
        }

        const nowMinutes = toMinutesOfDay(now);

        if (nowMinutes < dayPlan.start) {
            return dayPlan.start;
        }

        const workEnd = lastSegmentEnd(dayPlan.segments) ?? dayPlan.end;

        if (nowMinutes >= workEnd) {
            return null;
        }

        if (dayPlan.workMinutes <= 0) {
            return dayPlan.end;
        }

        const elapsed = elapsedWorkMinutes(dayPlan.segments, nowMinutes);
        const accrued = dailyPotential * (elapsed / dayPlan.workMinutes);
        const nextStepHours = (Math.floor(accrued / PLAN_STEP_HOURS + FLOAT_EPSILON) + 1) * PLAN_STEP_HOURS;

        if (nextStepHours >= dailyPotential) {
            return workEnd;
        }

        return workMinutesToTimeOfDay(
            dayPlan.segments,
            (nextStepHours / dailyPotential) * dayPlan.workMinutes
        );
    }

    /**
     * Рабочее время на сегодня. null — копить нечего: выходной, отсутствие на весь день,
     * сегодняшнего дня нет в загруженном месяце или график сотрудника неизвестен.
     */
    function resolveTodayPlan(days, employeePlan, now) {
        const today = days.find((day) => day.key === toDayKey(now));

        if (!today || today.isDayOff || today.isFullAbsence) {
            return null;
        }

        return resolveDayPlan(employeePlan.workDay, today.absence);
    }

    /**
     * День входит в план с полной нормой: не выходной и без отсутствия на весь день.
     * День с отсутствием на часть дня в плане остаётся.
     */
    function isPlanDay(day) {
        return !day.isDayOff && !day.isFullAbsence;
    }

    /**
     * Часы, которые должны быть отмечены к текущему моменту: потенциал за каждый
     * прошедший рабочий день без отпуска плюс накопленная часть текущего дня.
     */
    function computeExpectedHours(days, employeePlan, todayPlan, now) {
        const todayKey = toDayKey(now);
        const elapsedPlanDays = days
            .filter((day) => isPlanDay(day) && day.key < todayKey)
            .length;

        return employeePlan.dailyPotential * elapsedPlanDays
            + computeTodayHours(todayPlan, employeePlan.dailyPotential, now);
    }

    /**
     * Минимум на конец месяца: потенциал за все дни плана, включая будущие. Отпуск, уже
     * внесённый в график, план месяца уменьшает. remainingDays — дни плана, на которые ещё
     * можно раскидать остаток: будущие и сегодняшний, пока не кончилась смена (график
     * неизвестен — сегодняшний считаем).
     */
    function resolveMonthPlan(days, employeePlan, now) {
        const todayKey = toDayKey(now);
        const nowMinutes = toMinutesOfDay(now);
        const planDays = days.filter(isPlanDay);
        const remainingDays = planDays.filter((day) => {
            if (day.key !== todayKey) {
                return day.key > todayKey;
            }

            const dayPlan = resolveDayPlan(employeePlan.workDay, day.absence);

            return !dayPlan || nowMinutes < dayPlan.end;
        }).length;

        return {
            hours: employeePlan.dailyPotential * planDays.length,
            planDays: planDays.length,
            remainingDays,
            dailyPotential: employeePlan.dailyPotential,
        };
    }

    function resolveState(expectedHours, factHours) {
        const deficit = expectedHours - factHours;

        if (deficit + EPSILON >= DANGER_THRESHOLD_HOURS) {
            return 'danger';
        }

        if (deficit + EPSILON >= WARNING_THRESHOLD_HOURS) {
            return 'warning';
        }

        return null;
    }

    function applyState(progressbar, state) {
        if (progressbar.getAttribute(STATE_ATTR) !== state) {
            if (state) {
                progressbar.setAttribute(STATE_ATTR, state);
            } else {
                progressbar.removeAttribute(STATE_ATTR);
            }
        }

        // Заливку ищем каждый раз заново: Vue пересоздаёт её при обновлении процента,
        // и инлайновый цвет вместе с ней теряется.
        const fill = progressbar.querySelector(PROGRESS_FILL_SELECTOR);

        if (!fill) {
            return;
        }

        if (!state) {
            fill.style.removeProperty('background-color');
            fill.style.removeProperty('border-color');
            return;
        }

        fill.style.setProperty('background-color', STATE_COLORS[state], 'important');
        fill.style.setProperty('border-color', STATE_COLORS[state], 'important');
    }

    function createMarker(attr, className) {
        const marker = document.createElement('div');
        marker.setAttribute(attr, 'true');
        marker.className = className;

        return marker;
    }

    /**
     * Сплошная отметка "план на сейчас" всегда идёт в DOM последней, чтобы при совпадении
     * с пунктиром плана на месяц (последний день, прошедший месяц) рисоваться поверх него.
     */
    function ensureMarker(progressRow, attr, className) {
        // Класс ставим и на уже размеченную строку: Vue может переписать её class
        progressRow.classList.add(HOST_CLASS);

        const existing = progressRow.querySelector(`[${attr}]`);

        if (existing) {
            return existing;
        }

        const marker = createMarker(attr, className);

        if (attr === MARKER_ATTR) {
            progressRow.appendChild(marker);
        } else {
            progressRow.insertBefore(marker, progressRow.querySelector(`[${MARKER_ATTR}]`));
        }

        return marker;
    }

    function positionMarker(marker, percent) {
        const left = `${Math.round(percent * 10000) / 10000}%`;

        if (marker.style.left !== left) {
            marker.style.left = left;
        }
    }

    /**
     * Цифра плана в строке значений — между фактом и общим планом, показывает то же, что и отметка.
     */
    function applyPlanValue(valuesRow, text) {
        const planLabelSpan = findPlanLabelSpan(valuesRow);

        if (!planLabelSpan) {
            return;
        }

        let planValue = valuesRow.querySelector(`[${PLAN_VALUE_ATTR}]`);

        if (!planValue) {
            planValue = document.createElement('span');
            planValue.setAttribute(PLAN_VALUE_ATTR, 'true');
            planValue.className = `${PLAN_VALUE_CLASS} text-body-2`;
            planLabelSpan.insertAdjacentElement('beforebegin', planValue);
        }

        if (planValue.textContent !== text) {
            planValue.textContent = text;
        }
    }

    /**
     * Текст цифры плана. Когда шкала уже жёлтая или красная, сразу пишем и отставание: "96ч (-9ч)".
     */
    function formatPlanValue(expectedHours, factHours, state) {
        const text = formatHours(expectedHours);

        return state ? `${text} (-${formatHours(expectedHours - factHours)})` : text;
    }

    function formatWorkDays(count) {
        const lastDigit = count % 10;
        const lastTwoDigits = count % 100;

        if (lastDigit === 1 && lastTwoDigits !== 11) {
            return `${count} рабочий день`;
        }

        if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
            return `${count} рабочих дня`;
        }

        return `${count} рабочих дней`;
    }

    function ceilToStep(value, step) {
        // запас на ошибку деления: 5,5ч / 5мин = 66,00000000000001, и без него вышло бы 67 шагов
        return Math.ceil(value / step - 1e-6) * step;
    }

    /**
     * На чём построен план на сейчас — последние строки попапа.
     */
    function describePlanBasis(planBasis) {
        if (planBasis.override) {
            return ['Задано вручную в настройках расширения'];
        }

        const notes = [
            `Потенциал ${formatHours(planBasis.dailyPotential)} в день за прошедшие рабочие дни`
            + ' и часть сегодняшней смены',
        ];

        // Отсутствие на часть дня подписываем: норма та же, но набирается быстрее, и без
        // пояснения ускорившаяся отметка выглядит как ошибка
        if (planBasis.absence) {
            const { start, end } = planBasis.absence;

            notes.push(
                `Сегодня отсутствие ${formatTimeOfDay(start)}—${formatTimeOfDay(end)},`
                + ' норма набирается за оставшееся время'
            );
        }

        return notes;
    }

    /**
     * Содержимое попапа: заголовок, строка статуса из кусков (кусок с tone красится в цвет
     * шкалы), необязательная строка темпа и пояснения мелким шрифтом.
     */
    function buildCurrentPlanHint(expectedHours, factHours, state, planBasis) {
        // Сравниваем в целых минутах — так же, как числа округляются в тексте
        const deviationMinutes = Math.round((factHours - expectedHours) * 60);
        const marked = `Отмечено ${formatHours(factHours)} · `;
        let status;

        if (deviationMinutes < 0) {
            const lag = { text: `отставание ${formatHours(-deviationMinutes / 60)}` };

            status = [{ text: marked }, state ? { ...lag, tone: state } : lag];
        } else if (deviationMinutes > 0) {
            status = [{ text: `${marked}опережение ${formatHours(deviationMinutes / 60)}` }];
        } else {
            status = [{ text: `${marked}по плану` }];
        }

        return {
            title: `План на сейчас: ${formatHours(expectedHours)}`,
            status,
            pace: null,
            notes: describePlanBasis(planBasis),
        };
    }

    function buildMonthPlanHint(monthPlan, factHours) {
        const leftMinutes = Math.round((monthPlan.hours - factHours) * 60);
        const marked = `Отмечено ${formatHours(factHours)} · `;
        const pace = leftMinutes > 0 && monthPlan.remainingDays > 0
            ? `≈ ${formatHours(ceilToStep(leftMinutes / 60 / monthPlan.remainingDays, PACE_STEP_HOURS))} в день,`
                + ` рабочих дней: ${monthPlan.remainingDays}`
            : null;

        return {
            title: `Минимум на конец месяца: ${formatHours(monthPlan.hours)}`,
            status: [{
                text: leftMinutes > 0
                    ? `${marked}осталось набрать ${formatHours(leftMinutes / 60)}`
                    : `${marked}план выполнен`,
            }],
            pace,
            notes: [
                `Потенциал ${formatHours(monthPlan.dailyPotential)} × ${formatWorkDays(monthPlan.planDays)}`
                + ' без выходных и отпусков',
            ],
        };
    }

    function removeMarkers(attr) {
        for (const marker of document.querySelectorAll(`[${attr}]`)) {
            const host = marker.parentElement;

            marker.remove();

            if (host && !host.querySelector(`[${MARKER_ATTR}], [${MONTH_MARKER_ATTR}]`)) {
                host.classList.remove(HOST_CLASS);
            }
        }
    }

    /**
     * Убирает всё, что относится к плану на сейчас: цифру, сплошную отметку и цвет заливки.
     */
    function clearCurrentPlanDecorations() {
        for (const planValue of document.querySelectorAll(`[${PLAN_VALUE_ATTR}]`)) {
            planValue.remove();
        }

        removeMarkers(MARKER_ATTR);

        for (const progressbar of document.querySelectorAll(`[${STATE_ATTR}]`)) {
            applyState(progressbar, null);
        }

        popupHints.current = null;
    }

    function clearMonthMarker() {
        removeMarkers(MONTH_MARKER_ATTR);
        popupHints.month = null;
    }

    function clearWorkloadDecorations() {
        clearCurrentPlanDecorations();
        clearMonthMarker();
        updateHoverPopup();
    }

    function toPlanPercent(hours, planHours) {
        return Math.min(100, Math.max(0, (hours / planHours) * 100));
    }

    /**
     * Пунктир минимального плана на конец месяца. В конце шкалы он совпал бы с общим планом
     * ("из 184ч") и ничего бы не сообщал, поэтому там его не рисуем.
     */
    function applyMonthMarker(progressRow, monthPlan, planHours, factHours) {
        if (
            !monthPlan
            || !Number.isFinite(monthPlan.hours)
            || monthPlan.hours <= EPSILON
            || monthPlan.hours >= planHours - EPSILON
        ) {
            clearMonthMarker();
            return;
        }

        const marker = ensureMarker(progressRow, MONTH_MARKER_ATTR, MONTH_MARKER_CLASS);

        positionMarker(marker, toPlanPercent(monthPlan.hours, planHours));
        syncMonthMarkerDashes(marker);
        popupHints.month = buildMonthPlanHint(monthPlan, factHours);
    }

    /**
     * Геометрия пунктира в физических пикселях. Штрихов берём столько, сколько их целиком
     * помещается в высоту отметки, — пунктир не выходит за концы сплошной отметки, — а остаток
     * делим сверху и снизу, округляя отступ до целого пикселя.
     */
    function computeMonthMarkerDashes(heightCss, ratio) {
        const dash = Math.max(1, Math.round(MONTH_MARKER_DASH_PX * ratio));
        const gap = Math.max(1, Math.round(MONTH_MARKER_GAP_PX * ratio));
        const height = Math.floor(heightCss * ratio + DEVICE_PIXEL_EPSILON);
        const count = Math.max(MONTH_MARKER_MIN_DASHES, Math.floor((height + gap) / (dash + gap)));
        const length = count * dash + (count - 1) * gap;

        return { dash, gap, count, offset: Math.max(0, Math.floor((height - length) / 2)) };
    }

    function toCssPixels(devicePixels, ratio) {
        return `${(devicePixels + DEVICE_PIXEL_EPSILON) / ratio}px`;
    }

    /**
     * Высота отметки задаётся строкой шкалы (плюс 5px сверху и снизу), поэтому пунктир
     * сверяем при каждом пересчёте. Скрытую строку измерить нельзя — штрихи тогда не трогаем.
     */
    function syncMonthMarkerDashes(marker) {
        const heightCss = marker.getBoundingClientRect().height;

        if (heightCss <= 0 && marker.children.length) {
            return;
        }

        const ratio = window.devicePixelRatio || 1;
        const { dash, gap, count, offset } = computeMonthMarkerDashes(heightCss, ratio);

        marker.style.setProperty('--pulse-plus-workload-dash', toCssPixels(dash, ratio));
        marker.style.setProperty('--pulse-plus-workload-dash-gap', toCssPixels(gap, ratio));
        marker.style.setProperty('padding-top', toCssPixels(offset, ratio));

        const targetCount = heightCss > 0 ? count : MONTH_MARKER_FALLBACK_DASHES;

        while (marker.children.length < targetCount) {
            const dash = document.createElement('span');
            dash.className = MONTH_MARKER_DASH_CLASS;
            marker.appendChild(dash);
        }

        while (marker.children.length > targetCount) {
            marker.lastElementChild.remove();
        }
    }

    /**
     * Масштаб страницы или переход окна на монитор с другим DPI меняют размер физического
     * пикселя, и пунктир надо пересчитать. Запрос привязан к текущему значению, поэтому после
     * каждого срабатывания подписываемся заново.
     */
    function watchDevicePixelRatio() {
        const query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);

        query.addEventListener('change', () => {
            for (const marker of document.querySelectorAll(`[${MONTH_MARKER_ATTR}]`)) {
                syncMonthMarkerDashes(marker);
            }

            watchDevicePixelRatio();
        }, { once: true });
    }

    /**
     * planBasis — на чём построен план на сейчас: { dailyPotential, absence } или { override: true }.
     * monthPlan — результат resolveMonthPlan; null, когда график месяца неизвестен
     * (часы отметки заданы вручную).
     */
    function applyWorkloadPlan(widget, expectedHours, planHours, factHours, planBasis, monthPlan = null) {
        applyMonthMarker(widget.progressRow, monthPlan, planHours, factHours);

        const percent = toPlanPercent(expectedHours, planHours);

        // В начале месяца, до первой смены, план на сейчас нулевой — пунктир при этом остаётся
        if (percent <= 0) {
            clearCurrentPlanDecorations();
            updateHoverPopup();
            return;
        }

        const state = resolveState(expectedHours, factHours);

        positionMarker(ensureMarker(widget.progressRow, MARKER_ATTR, MARKER_CLASS), percent);
        applyPlanValue(widget.valuesRow, formatPlanValue(expectedHours, factHours, state));
        applyState(widget.progressbar, state);
        popupHints.current = buildCurrentPlanHint(expectedHours, factHours, state, planBasis);

        // Открытый попап сразу показывает свежие цифры и едет за сдвинувшейся отметкой
        updateHoverPopup();
    }

    function formatTimeOfDay(minutes) {
        return `${pad2(Math.floor(minutes / 60))}:${pad2(Math.round(minutes % 60))}`;
    }

    function buildPlanBasis(employeePlan, todayPlan) {
        return {
            dailyPotential: employeePlan.dailyPotential,
            absence: todayPlan?.absence ?? null,
        };
    }

    /**
     * Считает и рисует отметку по данным сотрудника — одинаково и для кэша, и для свежего ответа.
     */
    function applyEmployeePlan(widget, days, employeePlan, planHours, factHours) {
        const now = new Date();
        const todayPlan = resolveTodayPlan(days, employeePlan, now);

        setPlanTickPlan(employeePlan, todayPlan);

        applyWorkloadPlan(
            widget,
            computeExpectedHours(days, employeePlan, todayPlan, now),
            planHours,
            factHours,
            buildPlanBasis(employeePlan, todayPlan),
            resolveMonthPlan(days, employeePlan, now)
        );
    }

    // Содержимое попапов пересобирается при каждом пересчёте отметок; null — элемента нет
    const popupHints = { current: null, month: null };
    let popupElement = null;
    let popupSignature = '';
    let popupPlacementKey = '';
    let lastPointer = null;
    let pointerFrame = 0;

    function readHoverRect(attr) {
        const element = document.querySelector(`[${attr}]`);

        if (!element) {
            return null;
        }

        const rect = element.getBoundingClientRect();

        return rect.width || rect.height ? rect : null;
    }

    function containsPoint(rect, x, y, padding) {
        return x >= rect.left - padding
            && x <= rect.right + padding
            && y >= rect.top - padding
            && y <= rect.bottom + padding;
    }

    /**
     * Что под курсором. Сама цифра важнее отметок, из двух отметок побеждает ближайшая к курсору
     * (при равенстве — сплошная, она рисуется сверху), и только потом — запас вокруг цифры.
     */
    function pickHoverTarget(x, y, { planValue, marker, monthMarker }) {
        if (planValue && containsPoint(planValue, x, y, 0)) {
            return { kind: 'current', anchor: planValue };
        }

        let nearest = null;

        for (const [kind, rect] of [['current', marker], ['month', monthMarker]]) {
            if (!rect) {
                continue;
            }

            const distance = Math.abs(x - (rect.left + rect.width / 2));
            const withinHeight = y >= rect.top - MARKER_HOVER_VERTICAL_PX
                && y <= rect.bottom + MARKER_HOVER_VERTICAL_PX;

            if (distance <= MARKER_HOVER_HALF_WIDTH_PX && withinHeight && (!nearest || distance < nearest.distance)) {
                nearest = { kind, anchor: rect, distance };
            }
        }

        if (nearest) {
            return { kind: nearest.kind, anchor: nearest.anchor };
        }

        if (planValue && containsPoint(planValue, x, y, PLAN_VALUE_HOVER_PADDING_PX)) {
            return { kind: 'current', anchor: planValue };
        }

        return null;
    }

    function getPopupElement() {
        // Приложение Pulse может перестроить body — тогда попап создаётся заново
        if (!popupElement?.isConnected) {
            popupElement = document.createElement('div');
            popupElement.className = POPUP_CLASS;
            popupElement.setAttribute('role', 'tooltip');
            popupSignature = '';
            popupPlacementKey = '';
            document.body.appendChild(popupElement);
        }

        return popupElement;
    }

    function createPopupLine(modifier, text = '') {
        const line = document.createElement('div');
        line.className = `${POPUP_CLASS}__${modifier}`;
        line.textContent = text;

        return line;
    }

    function renderPopupContent(popup, hint) {
        const status = createPopupLine('line');

        for (const segment of hint.status) {
            const part = document.createElement('span');
            part.textContent = segment.text;

            if (segment.tone) {
                part.className = `${POPUP_CLASS}__accent`;
                part.style.color = STATE_COLORS[segment.tone];
            }

            status.appendChild(part);
        }

        popup.replaceChildren(
            createPopupLine('title', hint.title),
            status,
            ...(hint.pace ? [createPopupLine('line', hint.pace)] : []),
            ...hint.notes.map((note) => createPopupLine('note', note))
        );
    }

    /**
     * Над элементом по центру; сверху не хватает места — снизу. От краёв окна не ближе 8px.
     */
    function placePopup(popup, anchor) {
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const key = [anchor.left, anchor.top, anchor.width, anchor.height, viewportWidth, viewportHeight].join('|');

        if (key === popupPlacementKey) {
            return;
        }

        popupPlacementKey = key;

        // Меряем в левом верхнем углу: у правого края окна ширина попапа ужалась бы
        popup.style.left = '0px';
        popup.style.top = '0px';

        const { width, height } = popup.getBoundingClientRect();
        const margin = POPUP_VIEWPORT_MARGIN_PX;
        let top = anchor.top - POPUP_GAP_PX - height;

        if (top < margin) {
            top = Math.min(anchor.bottom + POPUP_GAP_PX, viewportHeight - margin - height);
        }

        const left = anchor.left + anchor.width / 2 - width / 2;

        popup.style.left = `${Math.round(Math.min(Math.max(left, margin), viewportWidth - margin - width))}px`;
        popup.style.top = `${Math.round(Math.max(top, margin))}px`;
    }

    function hidePopup() {
        popupElement?.classList.remove(POPUP_VISIBLE_CLASS);
    }

    function updateHoverPopup() {
        const target = lastPointer && (popupHints.current || popupHints.month)
            ? pickHoverTarget(lastPointer.x, lastPointer.y, {
                planValue: readHoverRect(PLAN_VALUE_ATTR),
                marker: readHoverRect(MARKER_ATTR),
                monthMarker: readHoverRect(MONTH_MARKER_ATTR),
            })
            : null;
        const hint = target ? popupHints[target.kind] : null;

        if (!hint) {
            hidePopup();
            return;
        }

        const popup = getPopupElement();
        const signature = JSON.stringify(hint);

        // Перестраиваем только изменившийся попап: движение мыши не должно трогать DOM
        if (signature !== popupSignature) {
            renderPopupContent(popup, hint);
            popupSignature = signature;
            popupPlacementKey = '';
        }

        placePopup(popup, target.anchor);
        popup.classList.add(POPUP_VISIBLE_CLASS);
    }

    function scheduleHoverUpdate() {
        if (pointerFrame) {
            return;
        }

        pointerFrame = window.requestAnimationFrame(() => {
            pointerFrame = 0;
            updateHoverPopup();
        });
    }

    function handlePointerMove(event) {
        if (event.pointerType === 'touch') {
            return;
        }

        lastPointer = { x: event.clientX, y: event.clientY };

        if (popupHints.current || popupHints.month) {
            scheduleHoverUpdate();
        }
    }

    function forgetPointer() {
        lastPointer = null;
        hidePopup();
    }

    /**
     * При прокрутке и изменении окна элементы уезжают из-под курсора — проверяем наведение
     * заново: попап скроется или переедет вслед за элементом.
     */
    function startHoverPopup() {
        document.addEventListener('pointermove', handlePointerMove, { passive: true });
        document.documentElement.addEventListener('mouseleave', forgetPointer);
        window.addEventListener('blur', forgetPointer);
        window.addEventListener('scroll', scheduleHoverUpdate, { capture: true, passive: true });
        window.addEventListener('resize', scheduleHoverUpdate);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                forgetPointer();
            }
        });
    }

    let refreshToken = 0;
    let planOverrideHours = null;
    let planTickTimer = null;
    let planTickPlan = null;
    let planTickPlanKey = null;

    async function refreshWorkloadMarker() {
        if (!isMainPageRoute()) {
            clearWorkloadDecorations();
            return;
        }

        const widget = findWorkloadWidget();

        if (!widget) {
            clearWorkloadDecorations();
            return;
        }

        const { progressbar, progressRow, valuesRow, link } = widget;
        const { factHours, planHours } = readWorkloadValues(valuesRow, progressbar);

        if (!Number.isFinite(planHours) || planHours <= 0 || !Number.isFinite(factHours)) {
            return;
        }

        // Диагностика: часы отметки заданы вручную, данные из API не нужны
        if (planOverrideHours !== null) {
            applyWorkloadPlan(widget, planOverrideHours, planHours, factHours, { override: true });
            return;
        }

        const employeeId = readEmployeeIdFromLink(link);

        if (!employeeId) {
            console.warn('[Trick Plus] В ссылке трудозатрат нет исполнителя, отметку плана построить нельзя');
            return;
        }

        const month = readMonthFromLink(link) || {
            year: new Date().getFullYear(),
            month: new Date().getMonth(),
        };
        const cacheKey = `${employeeId}-${month.year}-${pad2(month.month + 1)}`;

        // До ответа сервера показываем отметку по последним известным данным
        if (!liveLoadedKeys.has(cacheKey)) {
            const cached = readPlanCache(cacheKey);

            if (cached) {
                applyEmployeePlan(widget, cached.days, cached.plan, planHours, factHours);
            }
        }

        const token = refreshToken + 1;
        refreshToken = token;

        let days;
        let employeePlan;

        try {
            [days, employeePlan] = await Promise.all([
                loadSchedule(month.year, month.month),
                loadEmployeePlan(employeeId, month.year, month.month),
            ]);
        } catch (error) {
            console.warn('[Trick Plus] Не удалось получить данные для отметки плана трудозатрат:', error);
            return;
        }

        liveLoadedKeys.add(cacheKey);
        writePlanCache(cacheKey, days, employeePlan);

        if (employeePlan.dailyPotential === null) {
            console.warn('[Trick Plus] У сотрудника не заполнен потенциал, отметка плана не построена');
            return;
        }

        if (token !== refreshToken || !progressRow.isConnected) {
            return;
        }

        applyEmployeePlan(widget, days, employeePlan, planHours, factHours);
    }

    const scheduleRefresh = debounce(() => {
        refreshWorkloadMarker();
    }, REFRESH_DEBOUNCE_MS);

    function isOwnNode(node) {
        return node instanceof Element
            && (
                node.hasAttribute(MARKER_ATTR)
                || node.hasAttribute(MONTH_MARKER_ATTR)
                || OWN_NODE_CLASSES.some((className) => node.classList.contains(className))
            );
    }

    function isRelevantMutation(mutation) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];

        if (!changedNodes.length) {
            return false;
        }

        if (mutation.target instanceof Element && mutation.target.closest(OWN_SUBTREE_SELECTOR)) {
            return false;
        }

        return !changedNodes.every(isOwnNode);
    }

    function startDomObserver() {
        const observer = new MutationObserver((mutations) => {
            if (!mutations.some(isRelevantMutation)) {
                return;
            }

            scheduleRefresh();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    /**
     * Следующий пересчёт — в ближайший шаг сетки, отсчитанной от начала рабочего дня
     * (08:00 -> 08:30 -> 09:00), либо в момент окончания смены, если он наступает раньше:
     * при графике до 16:40 добор до полного потенциала иначе ждал бы шага в 17:00.
     * Пока график сотрудника не загружен, сетка считается от полуночи, то есть :00 и :30.
     * Задержка считается от текущего времени заново на каждом тике, поэтому дрейфа нет,
     * а перевод часов или выход из сна исправляются на следующем шаге.
     */
    function scheduleNextPlanTick() {
        window.clearTimeout(planTickTimer);

        const now = new Date();
        const nextChange = planTickPlan
            ? findNextPlanChange(planTickPlan.dayPlan, planTickPlan.dailyPotential, now)
            : null;
        const delay = nextChange === null
            ? PLAN_IDLE_INTERVAL_MS
            // округляем: момент шага может быть дробным (42,5 минуты смены), а нижняя граница
            // страхует от горячего цикла, если момент почему-то оказался в прошлом
            : Math.max(
                PLAN_TICK_SAFETY_MS,
                Math.round((nextChange - toMinutesOfDay(now)) * 60 * 1000) + PLAN_TICK_SAFETY_MS
            );

        planTickTimer = window.setTimeout(() => {
            scheduleNextPlanTick();
            refreshWorkloadMarker();
        }, delay);
    }

    function planTickKey(dailyPotential, dayPlan) {
        const segments = dayPlan
            ? dayPlan.segments.map((segment) => `${segment.start}-${segment.end}`).join(',')
            : '';

        return `${dailyPotential ?? ''}|${dayPlan ? dayPlan.end : ''}|${segments}`;
    }

    /**
     * Потенциал и график приходят уже после первого тика, поэтому при их появлении
     * расписание тиков пересобираем. Так же — когда меняется рабочее время сегодняшнего
     * дня: отметили отсутствие, и шаги плана поехали на другие моменты.
     */
    function setPlanTickPlan(employeePlan, todayPlan) {
        const dailyPotential = employeePlan?.dailyPotential ?? null;
        const key = planTickKey(dailyPotential, todayPlan);

        if (planTickPlanKey === key) {
            return;
        }

        planTickPlanKey = key;
        planTickPlan = { dailyPotential, dayPlan: todayPlan };
        scheduleNextPlanTick();
    }

    function patchHistoryMethod(methodName) {
        const originalMethod = window.history[methodName];

        window.history[methodName] = function () {
            const previousUrl = window.location.href;
            const result = originalMethod.apply(this, arguments);

            if (window.location.href !== previousUrl) {
                window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
            }

            return result;
        };
    }

    function patchHistory() {
        if (window[HISTORY_PATCH_FLAG]) {
            return;
        }

        window[HISTORY_PATCH_FLAG] = true;
        patchHistoryMethod('pushState');
        patchHistoryMethod('replaceState');
    }

    function initWorkloadPlanMarker(settings) {
        planOverrideHours = toHours(settings?.[SETTING_PLAN_OVERRIDE_KEY]);

        if (planOverrideHours !== null) {
            console.info(
                `[Trick Plus] Отметка плана задана вручную: ${formatHours(planOverrideHours)}.`
                + ' Сбросить можно в настройках расширения (Диагностика).'
            );
        }

        patchHistory();
        window.addEventListener('popstate', scheduleRefresh);
        window.addEventListener('hashchange', scheduleRefresh);
        window.addEventListener(ROUTE_EVENT, scheduleRefresh);

        // Отметка двигается сама, без перезагрузки и без активности на странице
        scheduleNextPlanTick();
        document.addEventListener('visibilitychange', scheduleRefresh);

        watchDevicePixelRatio();
        startHoverPopup();
        startDomObserver();
        refreshWorkloadMarker();
    }

    function start() {
        getPulseSettings()
            .then((settings) => {
                if (!settings?.[SETTING_KEY]) {
                    return;
                }

                initWorkloadPlanMarker(settings);
            })
            .catch((error) => {
                console.warn('[Trick Plus] Настройки главной страницы не загружены:', error);
            });
    }

    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', start, { once: true });
        return;
    }

    start();
})();
