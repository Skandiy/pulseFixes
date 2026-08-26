import { createPicker } from './picker.js';

/**
 * Держать в согласии с --stage-max в popup.css.
 * Потолок Chrome для popup — 600px; сюда же должны уместиться шапка (66), отступ снизу (16)
 * и плашка перезапуска (62), поэтому выше 440 поднимать нельзя.
 */
const STAGE_MAX_HEIGHT = 440;
const PAGE_TRANSITION_MS = 440;
const TOAST_MS = 2400;
const BUTTON_DONE_MS = 1700;

export function getPopupElements() {
    const elements = {
        app: document.querySelector('.app'),
        stage: document.getElementById('stage'),
        offState: document.getElementById('offState'),
        toast: document.getElementById('toast'),

        applyButton: document.getElementById('applyBtn'),
        reloadNotice: document.getElementById('reloadNotice'),

        enableFeatures: document.getElementById('enableFeatures'),
        infoButton: document.getElementById('infoBtn'),
        extName: document.getElementById('ext-name'),
        extVersion: document.getElementById('ext-version'),

        calendarSync: document.getElementById('calendarSync'),
        calendarSyncSettings: document.getElementById('calendarSyncSettings'),
        calendarSyncFrequency: document.getElementById('calendarSyncFrequency'),
        calendarSyncFrequencyValue: document.getElementById('calendarSyncFrequencyValue'),
        calendarSyncFrequencyMenu: document.getElementById('calendarSyncFrequencyMenu'),
        calendarSyncTimeRow: document.getElementById('calendarSyncTimeRow'),
        calendarSyncTime: document.getElementById('calendarSyncTime'),
        calendarScheduleHint: document.getElementById('calendarScheduleHint'),
        calendarAppleLink: document.getElementById('calendarAppleLink'),
        calendarGoogleLink: document.getElementById('calendarGoogleLink'),
        calendarOtherLink: document.getElementById('calendarOtherLink'),
        calendarCopyLink: document.getElementById('calendarCopyLink'),
        syncCalendarButton: document.getElementById('syncCalendar'),
        calendarError: document.getElementById('calendarError'),
        calendarErrorText: document.getElementById('calendarErrorText'),
        calendarResult: document.getElementById('calendarResult'),
        workloadPlanOverride: document.getElementById('workloadPlanOverride'),
        resetWorkloadPlanOverrideButton: document.getElementById('resetWorkloadPlanOverride'),
        pickerOptionTemplate: document.getElementById('pickerOptionTemplate'),

        settingsPages: Array.from(document.querySelectorAll('[data-settings-page]')),
        openPageButtons: Array.from(document.querySelectorAll('[data-open-page]')),
        backButtons: Array.from(document.querySelectorAll('[data-back-page]')),
        checkboxes: Array.from(document.querySelectorAll('.stage input[type="checkbox"]')),
        advancedBlocks: Array.from(document.querySelectorAll('[data-advanced]')),
    };

    indexStaggeredItems(elements);

    return elements;
}

/** Каждому блоку страницы — свой порядковый номер, из него CSS считает задержку появления. */
function indexStaggeredItems(elements) {
    elements.settingsPages.forEach((page) => {
        page.querySelectorAll('[data-stagger]').forEach((item, index) => {
            item.style.setProperty('--i', String(index));
        });
    });
}

export function renderManifestInfo(elements, manifest) {
    elements.extName.textContent = manifest.name;
    elements.extVersion.textContent = manifest.version;
}

export function applyCheckboxValues(checkboxes, values) {
    checkboxes.forEach((checkbox) => {
        if (Object.prototype.hasOwnProperty.call(values, checkbox.id)) {
            checkbox.checked = Boolean(values[checkbox.id]);
        }
    });
}

// --------------------------------------------------------------- высота сцены

/**
 * Во время перехода активны сразу две страницы. Текущей считаем входящую:
 * иначе клик по «назад» в середине анимации увёл бы нас с уже покидающей страницы.
 */
function getActivePage(elements) {
    return elements.settingsPages.find((page) => page.classList.contains('is-entering'))
        ?? elements.settingsPages.find((page) => page.classList.contains('is-active'))
        ?? null;
}

/** Разовое изменение без анимации: гасим transition, применяем, включаем обратно. */
function withoutTransition(element, mutate) {
    element.style.transition = 'none';
    mutate();
    // принудительный reflow, иначе браузер склеит оба стиля в один кадр и анимация «съест» скачок
    void element.offsetHeight;
    element.style.transition = '';
}

/**
 * Реальная высота содержимого страницы. Скрытую страницу измеряем «в тени»:
 * .is-measuring отрисовывает её невидимой, не трогая активную.
 *
 * Считаем по layout-метрикам (offsetTop/offsetHeight), а не по scrollHeight: последний
 * учитывает сдвиг transform у блоков, которые ещё не доиграли каскадное появление,
 * и высота сцены уезжала бы на эти лишние пиксели, а в конце скачком возвращалась назад.
 */
function measurePage(page) {
    const hidden = !page.classList.contains('is-active');

    if (hidden) {
        page.classList.add('is-measuring');
    }

    const pageStyle = window.getComputedStyle(page);
    let contentBottom = 0;

    for (const child of page.children) {
        if (child.offsetParent === null && child.offsetHeight === 0) {
            continue;
        }

        const childStyle = window.getComputedStyle(child);
        const bottom = child.offsetTop
            + child.offsetHeight
            + (Number.parseFloat(childStyle.marginBottom) || 0);

        if (bottom > contentBottom) {
            contentBottom = bottom;
        }
    }

    const height = contentBottom + (Number.parseFloat(pageStyle.paddingBottom) || 0);

    if (hidden) {
        page.classList.remove('is-measuring');
    }

    return Math.min(Math.ceil(height), STAGE_MAX_HEIGHT);
}

let releaseTimer = 0;

/**
 * Возвращает сцене авто-высоту: дальше её определяет активная страница в потоке.
 * Так высота всегда точна — не нужно ни округлять, ни доводить её вторым замером.
 */
function releaseStageHeight(elements) {
    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
    elements.stage.style.height = '';
}

/** Фиксирует текущую высоту в пикселях — от auto анимировать нельзя. */
function freezeStageHeight(elements) {
    const { stage } = elements;

    window.clearTimeout(releaseTimer);
    releaseTimer = 0;
    stage.style.height = `${stage.offsetHeight}px`;
    // принудительный reflow, иначе браузер склеит стартовое и конечное значения в один кадр
    void stage.offsetHeight;
}

function animateStageTo(elements, height) {
    const { stage } = elements;

    if (stage.style.height) {
        window.clearTimeout(releaseTimer);
    } else {
        freezeStageHeight(elements);
    }

    stage.style.height = `${height}px`;

    releaseTimer = window.setTimeout(() => {
        if (!stage.classList.contains('is-collapsed')) {
            releaseStageHeight(elements);
        }
    }, PAGE_TRANSITION_MS);
}

function syncStageHeight(elements, animate = true) {
    if (elements.stage.classList.contains('is-collapsed')) {
        return;
    }

    if (!animate) {
        releaseStageHeight(elements);
        return;
    }

    const activePage = getActivePage(elements);

    if (activePage) {
        animateStageTo(elements, measurePage(activePage));
    }
}

export function setSettingsVisibility(elements, isVisible, { animate = true } = {}) {
    elements.stage.classList.toggle('is-collapsed', !isVisible);
    // свёрнутый блок не должен ловить фокус и читаться скринридером
    elements.stage.inert = !isVisible;
    elements.offState.inert = isVisible;

    // Заглушка занимает место мгновенно — анимируется только её содержимое,
    // иначе Chrome тянет за высотой документа и само окно popup.
    elements.offState.classList.toggle('is-open', !isVisible);

    if (isVisible) {
        syncStageHeight(elements, animate);
        return;
    }

    if (!animate) {
        window.clearTimeout(releaseTimer);
        releaseTimer = 0;
        withoutTransition(elements.stage, () => {
            elements.stage.style.height = '0px';
        });
        return;
    }

    freezeStageHeight(elements);
    elements.stage.style.height = '0px';
}

export function setReloadNoticeVisibility(elements, isVisible) {
    elements.reloadNotice.classList.toggle('is-visible', isVisible);
    // схлопнутая плашка остаётся в DOM: убираем её кнопку из обхода по Tab
    elements.reloadNotice.inert = !isVisible;
}

export function setAdvancedVisibility(elements, isVisible, { animate = true } = {}) {
    elements.advancedBlocks.forEach((element) => {
        const wasHidden = element.hidden;
        element.hidden = !isVisible;

        if (isVisible && wasHidden && animate) {
            element.classList.remove('is-revealed');
            void element.offsetWidth;
            element.classList.add('is-revealed');
        }
    });

    syncStageHeight(elements, animate);
}

/** Ореол вокруг значка разгорается по мере приближения к разблокировке скрытых настроек. */
export function setUnlockProgress(elements, isWarming) {
    elements.infoButton.classList.toggle('is-warming', isWarming);
}

// ------------------------------------------------------------ смена страницы

const TRANSITION_CLASSES = [
    'is-moving',
    'is-entering',
    'is-leaving',
    'from-forward',
    'from-back',
    'to-forward',
    'to-back',
];

/** Новая страница всегда открывается сверху. Прокручивается тело, а не сама страница. */
function resetPageScroll(page) {
    const body = page.querySelector('.page-body');

    if (body) {
        body.scrollTop = 0;
    }
}

let transitionToken = 0;
let transitionTimer = 0;

function clearTransition(elements) {
    window.clearTimeout(transitionTimer);
    transitionTimer = 0;
    elements.settingsPages.forEach((page) => page.classList.remove(...TRANSITION_CLASSES));
}

export function showSettingsPage(elements, pageId, options = {}) {
    const { direction = 'forward', animate = true } = options;

    const nextPage = elements.settingsPages.find((page) => page.dataset.settingsPage === pageId);

    if (!nextPage) {
        return;
    }

    const currentPage = getActivePage(elements);

    if (currentPage === nextPage) {
        syncStageHeight(elements, animate);
        return;
    }

    clearTransition(elements);
    elements.settingsPages.forEach((page) => {
        if (page !== currentPage && page !== nextPage) {
            page.classList.remove('is-active');
        }
    });

    if (!animate) {
        currentPage?.classList.remove('is-active');
        nextPage.classList.add('is-active');
        resetPageScroll(nextPage);
        // syncStageHeight сам не тронет высоту, пока сцена свёрнута
        syncStageHeight(elements, false);
        return;
    }

    const token = (transitionToken += 1);
    // Пока страницы ещё в потоке, запоминаем высоту, от которой поедем
    freezeStageHeight(elements);
    const targetHeight = measurePage(nextPage);
    const enterFrom = direction === 'back' ? 'from-back' : 'from-forward';
    const leaveTo = direction === 'back' ? 'to-back' : 'to-forward';

    currentPage?.classList.add('is-moving', 'is-leaving');
    nextPage.classList.add('is-active', 'is-moving', 'is-entering', enterFrom);
    resetPageScroll(nextPage);
    // фиксируем стартовый кадр обеих страниц до того, как поедет высота сцены
    void nextPage.offsetHeight;

    animateStageTo(elements, targetHeight);

    window.requestAnimationFrame(() => {
        if (token !== transitionToken) {
            return;
        }

        nextPage.classList.remove(enterFrom);
        currentPage?.classList.add(leaveTo);
    });

    transitionTimer = window.setTimeout(() => {
        if (token !== transitionToken) {
            return;
        }

        currentPage?.classList.remove('is-active');
        clearTransition(elements);
        nextPage.classList.add('is-active');
        syncStageHeight(elements, false);
    }, PAGE_TRANSITION_MS);
}

// ------------------------------------------------------- состояния кнопки

const doneTimers = new WeakMap();

function clearDoneState(button) {
    window.clearTimeout(doneTimers.get(button));
    doneTimers.delete(button);
    button.classList.remove('is-done');
}

/**
 * Кнопка на время запроса показывает спиннер вместо надписи и перестаёт нажиматься.
 * disabled ставится здесь же: иначе повторный клик успел бы запустить второй запрос,
 * пока крутится первый.
 */
export function setButtonBusy(button, isBusy) {
    if (isBusy) {
        clearDoneState(button);
    }

    button.classList.toggle('is-busy', isBusy);
    button.disabled = isBusy;
    button.setAttribute('aria-busy', String(isBusy));
}

/** Короткая галочка после удачного запроса — подтверждение без отдельной плашки. */
export function flashButtonDone(button) {
    clearDoneState(button);
    // принудительный reflow, иначе снятый и возвращённый класс склеятся в один кадр
    // и анимация галочки не начнётся заново
    void button.offsetWidth;
    button.classList.add('is-done');

    doneTimers.set(button, window.setTimeout(() => {
        button.classList.remove('is-done');
        doneTimers.delete(button);
    }, BUTTON_DONE_MS));
}

/**
 * Раскрывает блок под кнопкой. Высоту ведёт CSS (grid-template-rows), поэтому
 * сцену пересчитывать не нужно: в покое она стоит на auto и растёт вслед за карточкой.
 */
export function setCollapseOpen(element, isOpen) {
    element.classList.toggle('is-open', isOpen);
    // схлопнутый блок остаётся в DOM: убираем его содержимое из обхода по Tab
    element.inert = !isOpen;
}

// -------------------------------------------------------- синхронизация календаря

let frequencyPicker = null;

/**
 * Периодичность выбирается своим списком, а не <select>: системный Chrome рисует
 * мимо палитры popup. О выборе он сообщает событием change на самой кнопке —
 * значение приезжает в event.detail.value.
 */
export function renderSyncFrequencies(elements, frequencies) {
    frequencyPicker ??= createPicker({
        trigger: elements.calendarSyncFrequency,
        valueElement: elements.calendarSyncFrequencyValue,
        menu: elements.calendarSyncFrequencyMenu,
        optionTemplate: elements.pickerOptionTemplate,
    });

    frequencyPicker.setOptions(frequencies);
}

export function setSyncFrequency(value) {
    frequencyPicker?.setValue(value);
}

/** Расписание и ссылки существуют только при включённой синхронизации. */
export function setCalendarSettingsOpen(elements, isOpen) {
    setCollapseOpen(elements.calendarSyncSettings, isOpen);
}

/** Без расписания время выгрузки не на что настраивать, поэтому строка убирается целиком. */
export function setCalendarTimeVisible(elements, isVisible) {
    elements.calendarSyncTimeRow.hidden = !isVisible;
}

export function setCalendarScheduleHint(elements, text) {
    elements.calendarScheduleHint.textContent = text;
}

/**
 * Ссылки на календарь. Раскладываются по кнопкам сразу, как только сервис ответил
 * хотя бы раз: подписка живёт по постоянному адресу, и ждать новой выгрузки незачем.
 *
 * Сам адрес нигде не показывается: набирать его руками не нужно ни в одном из
 * способов подписки, а «Копировать» кладёт его в буфер для всех остальных.
 */
export function renderCalendarLinks(elements, links) {
    const { subscribeUrl, fileUrl, appleUrl, googleUrl } = links ?? {};

    if (!subscribeUrl) {
        setCollapseOpen(elements.calendarResult, false);
        return;
    }

    setLinkTarget(elements.calendarOtherLink, subscribeUrl);

    // Свой адрес есть не у каждой кнопки — ту, для которой его нет, гасим,
    // а не оставляем «нажимаемой в никуда».
    setLinkTarget(elements.calendarAppleLink, appleUrl);
    setLinkTarget(elements.calendarGoogleLink, googleUrl);
    elements.calendarCopyLink.disabled = !fileUrl;

    setCollapseOpen(elements.calendarResult, true);
}

function setLinkTarget(link, url) {
    if (!url) {
        link.removeAttribute('href');
        link.setAttribute('aria-disabled', 'true');
        return;
    }

    link.href = url;
    link.removeAttribute('aria-disabled');

    /*
     * Вкладка нужна только обычным ссылкам: webcal:// уходит системному календарю, и
     * пустая вкладка после него ни к чему. Зато https без target увёл бы сам popup —
     * вместо страницы подписки пользователь получил бы её на месте настроек.
     */
    if (/^https?:/i.test(url)) {
        link.target = '_blank';
        link.rel = 'noreferrer';
    } else {
        link.removeAttribute('target');
        link.removeAttribute('rel');
    }
}

export function renderCalendarError(elements, message) {
    if (!message) {
        setCollapseOpen(elements.calendarError, false);
        return;
    }

    elements.calendarErrorText.textContent = message;
    setCollapseOpen(elements.calendarError, true);
}

// -------------------------------------------------------------------- тост

let toastTimer = 0;

export function showToast(elements, message, { error = false } = {}) {
    window.clearTimeout(toastTimer);

    elements.toast.textContent = message;
    elements.toast.classList.toggle('toast--error', error);
    elements.toast.classList.add('is-visible');

    toastTimer = window.setTimeout(() => {
        elements.toast.classList.remove('is-visible');
    }, TOAST_MS);
}
