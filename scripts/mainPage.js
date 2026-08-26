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
    const PLAN_VALUE_ATTR = 'data-pulse-plus-workload-plan';
    const STATE_ATTR = 'data-pulse-plus-workload-state';
    const MARKER_CLASS = 'pulse-plus-workload-marker';
    const PLAN_VALUE_CLASS = 'pulse-plus-workload-plan-value';
    const HOST_CLASS = 'pulse-plus-workload-progress-host';

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
     * Часы, которые должны быть отмечены к текущему моменту: потенциал за каждый
     * прошедший рабочий день без отпуска плюс накопленная часть текущего дня.
     * День с отсутствием на часть дня остаётся в плане с полной нормой.
     */
    function computeExpectedHours(days, employeePlan, todayPlan, now) {
        const todayKey = toDayKey(now);
        const elapsedPlanDays = days
            .filter((day) => !day.isDayOff && !day.isFullAbsence && day.key < todayKey)
            .length;

        return employeePlan.dailyPotential * elapsedPlanDays
            + computeTodayHours(todayPlan, employeePlan.dailyPotential, now);
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

    function applyMarker(progressRow, percent, title) {
        let marker = progressRow.querySelector(`[${MARKER_ATTR}]`);

        if (!marker) {
            marker = document.createElement('div');
            marker.setAttribute(MARKER_ATTR, 'true');
            marker.className = MARKER_CLASS;
            progressRow.appendChild(marker);
        }

        progressRow.classList.add(HOST_CLASS);

        const left = `${Math.round(percent * 10000) / 10000}%`;

        if (marker.style.left !== left) {
            marker.style.left = left;
        }

        if (marker.title !== title) {
            marker.title = title;
        }
    }

    /**
     * Цифра плана в строке значений — между фактом и общим планом, показывает то же, что и отметка.
     */
    function applyPlanValue(valuesRow, expectedHours, title) {
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

        const text = formatHours(expectedHours);

        if (planValue.textContent !== text) {
            planValue.textContent = text;
        }

        if (planValue.title !== title) {
            planValue.title = title;
        }
    }

    function clearWorkloadDecorations() {
        for (const planValue of document.querySelectorAll(`[${PLAN_VALUE_ATTR}]`)) {
            planValue.remove();
        }

        for (const marker of document.querySelectorAll(`[${MARKER_ATTR}]`)) {
            marker.parentElement?.classList.remove(HOST_CLASS);
            marker.remove();
        }

        for (const progressbar of document.querySelectorAll(`[${STATE_ATTR}]`)) {
            applyState(progressbar, null);
        }
    }

    function applyWorkloadPlan(widget, expectedHours, planHours, factHours, planNote) {
        const percent = Math.min(100, Math.max(0, (expectedHours / planHours) * 100));

        if (percent <= 0) {
            clearWorkloadDecorations();
            return;
        }

        const deficit = expectedHours - factHours;
        const planLabel = `По плану на сейчас: ${formatHours(expectedHours)} (${planNote})`;
        const title = deficit > EPSILON
            ? `${planLabel}. Отставание: ${formatHours(deficit)}`
            : planLabel;

        applyMarker(widget.progressRow, percent, title);
        applyPlanValue(widget.valuesRow, expectedHours, title);
        applyState(widget.progressbar, resolveState(expectedHours, factHours));
    }

    function formatTimeOfDay(minutes) {
        return `${pad2(Math.floor(minutes / 60))}:${pad2(Math.round(minutes % 60))}`;
    }

    /**
     * Пояснение к отметке. Отсутствие на часть дня подписываем: норма та же, но набирается
     * быстрее, и без подписи ускорившаяся отметка выглядит как ошибка.
     */
    function buildPlanNote(employeePlan, todayPlan) {
        const note = `потенциал ${formatHours(employeePlan.dailyPotential)}/день`;

        if (!todayPlan?.absence) {
            return note;
        }

        const { start, end } = todayPlan.absence;

        return `${note}, сегодня отсутствие ${formatTimeOfDay(start)}—${formatTimeOfDay(end)}`;
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
            buildPlanNote(employeePlan, todayPlan)
        );
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
            applyWorkloadPlan(widget, planOverrideHours, planHours, factHours, 'задано вручную');
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
            && (node.hasAttribute(MARKER_ATTR) || node.classList.contains(MARKER_CLASS));
    }

    function isRelevantMutation(mutation) {
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];

        if (!changedNodes.length) {
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
