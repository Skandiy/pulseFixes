/**
 * Выпадающий список вместо <select>.
 *
 * Системный список Chrome рисует сам и мимо страницы: ни палитра popup, ни скругления
 * на него не действуют, и посреди тёмной карточки он выглядит чужим. Своя разметка эту
 * проблему снимает, но просто положить её в карточку нельзя — и сцена, и тело страницы
 * обрезают содержимое по своим границам. Поэтому список открывается в верхнем слое
 * (popover) и позиционируется от кнопки вручную.
 */

/** Зазор между кнопкой и списком. */
const MENU_GAP = 6;

/** Насколько близко список подпускается к краю окна popup. */
const VIEWPORT_MARGIN = 8;

/** Ниже этой высоты список бесполезен — лучше отдать её ему с прокруткой. */
const MENU_MIN_HEIGHT = 96;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * @param {object} parts
 * @param {HTMLElement} parts.trigger       кнопка, открывающая список
 * @param {HTMLElement} parts.valueElement  подпись выбранного значения внутри кнопки
 * @param {HTMLElement} parts.menu          сам список, элемент с атрибутом popover
 * @param {HTMLTemplateElement} parts.optionTemplate  разметка одного пункта
 *
 * О выборе сообщает событие change на кнопке: значение лежит в event.detail.value.
 */
export function createPicker({ trigger, valueElement, menu, optionTemplate }) {
    let options = [];
    let value = null;

    function optionElements() {
        return Array.from(menu.querySelectorAll('.picker-option'));
    }

    function findOption(optionValue) {
        return options.find((option) => option.value === optionValue) ?? null;
    }

    function buildOption({ value: optionValue, label }) {
        const element = optionTemplate.content.firstElementChild.cloneNode(true);

        element.dataset.value = optionValue;
        element.querySelector('.picker-option__label').textContent = label;

        return element;
    }

    function renderSelection() {
        valueElement.textContent = findOption(value)?.label ?? '';

        optionElements().forEach((element) => {
            element.setAttribute('aria-selected', String(element.dataset.value === value));
        });
    }

    function applyValue(nextValue) {
        value = findOption(nextValue) ? nextValue : null;
        renderSelection();
    }

    function isOpen() {
        return menu.matches(':popover-open');
    }

    // ------------------------------------------------------------ положение

    /**
     * Окно popup ровно по высоте содержимого, поэтому места под список может не
     * хватить ни снизу, ни сверху: выбираем сторону, где его больше, и отдаём ровно
     * столько, сколько есть — остаток список прокручивает.
     */
    function position() {
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;

        // Сначала снимаем прошлое ограничение: иначе высота меряется по нему, а не по содержимому
        menu.style.maxHeight = '';
        menu.style.minWidth = `${Math.round(rect.width)}px`;
        menu.style.maxWidth = `${viewportWidth - (VIEWPORT_MARGIN * 2)}px`;

        const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
        const spaceAbove = rect.top - MENU_GAP - VIEWPORT_MARGIN;
        const isAbove = menu.offsetHeight > spaceBelow && spaceAbove > spaceBelow;

        menu.classList.toggle('is-above', isAbove);
        menu.style.maxHeight = `${Math.max(isAbove ? spaceAbove : spaceBelow, MENU_MIN_HEIGHT)}px`;

        // offset*, а не getBoundingClientRect: у списка в этот момент ещё держится
        // стартовый scale появления, и прямоугольник вернул бы уменьшенный размер
        const { offsetWidth: width, offsetHeight: height } = menu;
        // Выравниваем по правому краю кнопки: слева в строке стоит её подпись
        const left = rect.right - width;
        const top = isAbove ? rect.top - MENU_GAP - height : rect.bottom + MENU_GAP;

        menu.style.left = `${clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - width))}px`;
        menu.style.top = `${clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - height))}px`;
    }

    // -------------------------------------------------------- открыть/закрыть

    /** Клик по подписи строки — это клик по кнопке: <label for> сам его перебросит. */
    function isTriggerTarget(target) {
        return trigger.contains(target) || target?.closest?.('label')?.control === trigger;
    }

    function onDocumentPointerDown(event) {
        if (menu.contains(event.target) || isTriggerTarget(event.target)) {
            return;
        }

        close();
    }

    /** Список приклеен к кнопке, а не к странице: при её прокрутке пересчитываем. */
    function onDocumentScroll(event) {
        if (menu.contains(event.target)) {
            return;
        }

        position();
    }

    function open() {
        if (isOpen()) {
            return;
        }

        menu.showPopover();
        // Считаем положение сразу за показом: обе правки уходят в один кадр,
        // и списка посреди окна никто не увидит
        position();

        trigger.setAttribute('aria-expanded', 'true');
        trigger.classList.add('is-open');

        const items = optionElements();

        (items.find((element) => element.dataset.value === value) ?? items[0])?.focus();

        document.addEventListener('pointerdown', onDocumentPointerDown, true);
        document.addEventListener('scroll', onDocumentScroll, true);
        window.addEventListener('resize', position);
    }

    function close() {
        if (!isOpen()) {
            return;
        }

        // Фокус проверяем до закрытия: hidePopover уводит его на body, и после
        // вызова уже не отличить «список закрыли с клавиатуры» от «кликнули мимо»
        const hadFocus = menu.contains(document.activeElement);

        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        document.removeEventListener('scroll', onDocumentScroll, true);
        window.removeEventListener('resize', position);

        menu.hidePopover();
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('is-open');

        if (hadFocus) {
            trigger.focus();
        }
    }

    function selectOption(element) {
        if (!element) {
            return;
        }

        const nextValue = element.dataset.value;

        close();

        if (!nextValue || nextValue === value) {
            return;
        }

        // Пункт отмечается сразу, до записи в хранилище: не сохранилось — вызывающий
        // код вернёт прежнее значение через setValue, как это делал <select>
        applyValue(nextValue);
        trigger.dispatchEvent(new CustomEvent('change', { detail: { value: nextValue } }));
    }

    // ----------------------------------------------------------- управление

    /** Стрелки не заворачиваются — как и в системном списке: выход за край упирается в край. */
    function focusOption(index) {
        const items = optionElements();

        if (!items.length) {
            return;
        }

        items[clamp(index, 0, items.length - 1)].focus();
    }

    function moveFocus(step) {
        const current = optionElements().indexOf(document.activeElement);

        // Список открывается с фокусом на выбранном пункте, так что «фокуса нет» бывает
        // только у пустого списка — там focusOption всё равно ничего не сделает
        focusOption(current < 0 ? 0 : current + step);
    }

    trigger.addEventListener('click', () => {
        if (isOpen()) {
            close();
            return;
        }

        open();
    });

    trigger.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }

        // Иначе стрелка прокрутит страницу под уже открытым списком
        event.preventDefault();
        open();
    });

    menu.addEventListener('click', (event) => {
        selectOption(event.target?.closest?.('.picker-option'));
    });

    menu.addEventListener('keydown', (event) => {
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                moveFocus(1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                moveFocus(-1);
                break;
            case 'Home':
                event.preventDefault();
                focusOption(0);
                break;
            case 'End':
                event.preventDefault();
                focusOption(optionElements().length - 1);
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                selectOption(document.activeElement?.closest?.('.picker-option'));
                break;
            case 'Escape':
            case 'Tab':
                event.preventDefault();
                close();
                break;
            default:
                break;
        }
    });

    return {
        setOptions(nextOptions) {
            options = [...nextOptions];
            menu.replaceChildren(...options.map(buildOption));
            renderSelection();
        },
        setValue: applyValue,
        getValue() {
            return value;
        },
        close,
    };
}
