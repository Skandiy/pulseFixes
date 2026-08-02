export function getPopupElements() {
    return {
        applyButton: document.getElementById('applyBtn'),
        calendarLink: document.getElementById('calendarIosLink'),
        enableFeatures: document.getElementById('enableFeatures'),
        extName: document.getElementById('ext-name'),
        extVersion: document.getElementById('ext-version'),
        infoButton: document.getElementById('infoBtn'),
        reloadNotice: document.getElementById('reloadNotice'),
        settingsBlock: document.getElementById('settings'),
        settingsRouter: document.querySelector('.settings-router'),
        settingsPages: Array.from(document.querySelectorAll('[data-settings-page]')),
        openPageButtons: Array.from(document.querySelectorAll('[data-open-page]')),
        backButtons: Array.from(document.querySelectorAll('[data-back-page]')),
        syncCalendarButton: document.getElementById('syncCalendar'),
        workloadPlanOverride: document.getElementById('workloadPlanOverride'),
        resetWorkloadPlanOverrideButton: document.getElementById('resetWorkloadPlanOverride'),
        checkboxes: Array.from(document.querySelectorAll('#settings input[type="checkbox"]')),
        advancedBlocks: Array.from(document.querySelectorAll('.advancedSettings')),
    };
}

export function renderManifestInfo(elements, manifest) {
    elements.extName.textContent = manifest.name;
    elements.extVersion.textContent = manifest.version;
}

export function setSettingsVisibility(elements, isVisible) {
    elements.settingsBlock.classList.toggle('show', isVisible);
}

export function setReloadNoticeVisibility(elements, isVisible) {
    elements.reloadNotice.classList.toggle('showReloadNotice', isVisible);
}

export function setAdvancedVisibility(elements, isVisible) {
    elements.advancedBlocks.forEach((element) => {
        element.classList.toggle('show', isVisible);
    });
    syncSettingsRouterHeight(elements);
    window.requestAnimationFrame(() => syncSettingsRouterHeight(elements));
}

let transitionId = 0;
let transitionTimer = 0;
const PAGE_TRANSITION_DURATION = 380;
const PAGE_HEIGHT_BUFFER = 2;

function clearPageTransitionState(elements) {
    window.clearTimeout(transitionTimer);
    transitionTimer = 0;
    elements.settingsRouter?.classList.remove('is-transitioning');
    elements.settingsPages.forEach((page) => {
        page.classList.remove(
            'transition-page',
            'page-incoming',
            'page-outgoing',
            'enter-forward',
            'enter-back',
            'exit-forward',
            'exit-back'
        );
    });
}

function measurePageHeight(page) {
    const wasActive = page.classList.contains('active');
    const previous = {
        display: page.style.display,
        position: page.style.position,
        visibility: page.style.visibility,
        pointerEvents: page.style.pointerEvents,
        transform: page.style.transform,
        opacity: page.style.opacity,
    };

    if (!wasActive) {
        page.style.display = 'flow-root';
        page.style.position = 'absolute';
        page.style.visibility = 'hidden';
        page.style.pointerEvents = 'none';
        page.style.transform = 'none';
        page.style.opacity = '1';
    }

    const pageRect = page.getBoundingClientRect();
    const contentHeight = Array.from(page.children).reduce((height, child) => {
        const childRect = child.getBoundingClientRect();
        const childStyle = window.getComputedStyle(child);
        const marginBottom = Number.parseFloat(childStyle.marginBottom) || 0;
        const bottom = childRect.bottom - pageRect.top + marginBottom;

        return Math.max(height, bottom);
    }, 0);
    const height = Math.ceil(Math.max(page.scrollHeight, pageRect.height, contentHeight)) + PAGE_HEIGHT_BUFFER;

    if (!wasActive) {
        page.style.display = previous.display;
        page.style.position = previous.position;
        page.style.visibility = previous.visibility;
        page.style.pointerEvents = previous.pointerEvents;
        page.style.transform = previous.transform;
        page.style.opacity = previous.opacity;
    }

    return height;
}

export function syncSettingsRouterHeight(elements) {
    const router = elements.settingsRouter;
    const activePage = elements.settingsPages.find((page) => page.classList.contains('active'));
    if (!router || !activePage) {
        return;
    }

    router.style.height = `${measurePageHeight(activePage)}px`;
}

export function showSettingsPage(elements, pageId, options = {}) {
    const { direction = 'forward', animate = true } = options;
    const router = elements.settingsRouter;
    const nextPage = elements.settingsPages.find((page) => page.dataset.settingsPage === pageId);
    if (!router || !nextPage) {
        return;
    }

    const currentPage = elements.settingsPages.find((page) => page.classList.contains('active'));
    if (currentPage === nextPage) {
        syncSettingsRouterHeight(elements);
        return;
    }

    clearPageTransitionState(elements);

    elements.settingsPages.forEach((page) => {
        if (page !== currentPage && page !== nextPage) {
            page.classList.remove('active');
        }
    });

    if (!animate) {
        currentPage?.classList.remove('active');
        nextPage.classList.add('active');
        syncSettingsRouterHeight(elements);
        return;
    }

    const id = transitionId + 1;
    transitionId = id;
    const fromHeight = currentPage ? measurePageHeight(currentPage) : 0;
    const toHeight = measurePageHeight(nextPage);

    router.classList.add('is-transitioning');
    router.style.height = `${fromHeight}px`;
    router.getBoundingClientRect();
    router.style.height = `${toHeight}px`;

    if (currentPage) {
        currentPage.classList.add('transition-page', 'page-outgoing');
    }

    nextPage.classList.add(
        'active',
        'transition-page',
        'page-incoming',
        direction === 'back' ? 'enter-back' : 'enter-forward'
    );
    nextPage.getBoundingClientRect();

    window.requestAnimationFrame(() => {
        if (transitionId !== id) {
            return;
        }

        nextPage.classList.remove('enter-forward', 'enter-back');
        if (currentPage) {
            currentPage.classList.add(direction === 'back' ? 'exit-back' : 'exit-forward');
        }
    });

    transitionTimer = window.setTimeout(() => {
        if (transitionId !== id) {
            return;
        }

        currentPage?.classList.remove('active');
        clearPageTransitionState(elements);
        nextPage.classList.add('active');
        syncSettingsRouterHeight(elements);
    }, PAGE_TRANSITION_DURATION);
}

export function applyCheckboxValues(checkboxes, values) {
    checkboxes.forEach((checkbox) => {
        if (Object.prototype.hasOwnProperty.call(values, checkbox.id)) {
            checkbox.checked = Boolean(values[checkbox.id]);
        }
    });
}
