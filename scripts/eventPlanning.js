(function () {
    const EXTENSION_PAGE_PATH = '/pulse/pplus/event-planning';
    const OWNER_CALENDAR_PATH = '/pulse/owner/calendar';
    const MENU_ITEM_ATTR = 'data-pulse-plus-event-planning-menu-item';
    const CALENDAR_BUTTON_ATTR = 'data-pulse-plus-event-planning-calendar-button';
    const CALENDAR_BUTTON_BOUND_ATTR = 'data-pulse-plus-event-planning-calendar-button-bound';
    const CALENDAR_NATIVE_BUTTON_BOUND_ATTR = 'data-pulse-plus-event-planning-calendar-native-button-bound';
    const CALENDAR_ACTIVE_CLASSES_ATTR = 'data-pulse-plus-event-planning-calendar-active-classes';
    const CALENDAR_ACTIVE_BACKUP_ATTR = 'data-pulse-plus-event-planning-calendar-was-active';
    const CALENDAR_ROOT_ATTR = 'data-pulse-plus-event-planning-calendar-root';
    const ROOT_ATTR = 'data-pulse-plus-event-planning-root';
    const HIDDEN_ATTR = 'data-pulse-plus-event-planning-hidden';
    const ACTIVE_BACKUP_ATTR = 'data-pulse-plus-event-planning-was-active';
    const SIDEBAR_STYLE_BACKUP_ATTR = 'data-pulse-plus-event-planning-sidebar-style';
    const SIDEBAR_SLID_ATTR = 'data-pulse-plus-event-planning-sidebar-slid';
    const MAIN_STYLE_BACKUP_ATTR = 'data-pulse-plus-event-planning-main-style';
    const RIPPLE_STYLE_ID = 'pulse-plus-event-planning-menu-ripple-style';
    const ROUTE_EVENT = 'trick-plus:event-planning-route-change';
    const HISTORY_PATCH_FLAG = '__TRICK_PLUS_EVENT_PLANNING_HISTORY_PATCHED__';
    const LAYOUT_TRANSITION_MS = 180;
    const CALENDAR_EMBEDDED_CONTAINER_SELECTOR = 'main div .fill-viewport-height';
    const CALENDAR_SHELL_SELECTOR = 'main div .fill-viewport-height div div div';
    const CALENDAR_WRAPPER_SELECTOR = `${CALENDAR_SHELL_SELECTOR} .stack-calendar-container .calendar-wrapper`;
    const CALENDAR_CONTROLS_BUTTON_SELECTOR = `${CALENDAR_SHELL_SELECTOR} .stack-calendar-container > div > button`;
    const CALENDAR_CONTROLS_SPAN_SELECTOR = `${CALENDAR_SHELL_SELECTOR} .stack-calendar-container div span`;
    const CALENDAR_SCHEDULE_HASH = 'schedule';
    const CALENDAR_TEXT_ICON_PATH = 'M19,3H18V1H16V3H8V1H6V3H5C3.89,3 3,3.89 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V5C21,3.89 20.1,3 19,3M19,19H5V9H19V19M19,7H5V5H19V7M7,11H17V13H7V11M7,15H14V17H7V15Z';
    const DEFAULT_CALENDAR_ACTIVE_CLASSES = ['v-item--active', 'v-btn--active'];

    let bundlePromise = null;
    let mounted = false;
    let mountedMode = null;
    let calendarEmbeddedActive = false;
    let calendarEmbeddedRoot = null;
    let calendarEmbeddedMountPending = false;
    let calendarEmbeddedMountInProgress = false;
    let calendarNativeHashSuppressed = false;
    let calendarNativeClickSuppressed = false;
    let pageStateApplied = false;
    let stalePageStateChecked = false;
    let tabsSliderFrame = 0;
    let tabsSliderAfterLayoutTimers = [];
    let extensionBaseUrl = resolveExtensionBaseUrl();

    function debounce(fn, delay = 100) {
        let timer = 0;
        return function (...args) {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function nodeMatchesOrContains(node, selector) {
        if (!(node instanceof Element)) {
            return false;
        }

        return node.matches(selector) || Boolean(node.querySelector(selector));
    }

    function mutationTouchesHeader(mutation) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest?.('header')) {
            return true;
        }

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.some((node) => nodeMatchesOrContains(node, 'header'));
    }

    function mutationTouchesEventPlanningShell(mutation) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest?.(`[${ROOT_ATTR}="true"]`)) {
            return false;
        }

        if (target?.closest?.('main.v-main, .v-main__wrap, [role="main"]')) {
            return true;
        }

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.some((node) => (
            nodeMatchesOrContains(node, `[${ROOT_ATTR}="true"]`)
            || nodeMatchesOrContains(node, 'main.v-main, .v-main__wrap, [role="main"]')
            || nodeMatchesOrContains(node, 'nav.sidebar-navigation')
        ));
    }

    function mutationTouchesCalendarToggle(mutation) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target?.closest?.('.v-btn-toggle--borderless')) {
            return true;
        }

        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        return changedNodes.some((node) => nodeMatchesOrContains(node, '.v-btn-toggle--borderless'));
    }

    function resolveExtensionBaseUrl() {
        const currentScript = document.currentScript;
        if (currentScript && currentScript.src) {
            return new URL('../', currentScript.src).href;
        }

        const script = Array.from(document.querySelectorAll('script[src]'))
            .find((item) => item.src.includes('/scripts/eventPlanning.js'));
        return script ? new URL('../', script.src).href : '';
    }

    function extensionUrl(path) {
        return new URL(path, extensionBaseUrl).href;
    }

    function getPageSettings() {
        const settings = window.PULSE_EXTENSION_SETTINGS;
        if (typeof settings === 'string') {
            try {
                return JSON.parse(settings);
            } catch (error) {
                return {};
            }
        }

        return settings && typeof settings === 'object' ? settings : {};
    }

    function isDiagnosticSettingEnabled(key) {
        return getPageSettings()[key] !== false;
    }

    function ensureMenuRippleStyle() {
        if (document.getElementById(RIPPLE_STYLE_ID)) {
            return;
        }

        const style = document.createElement('style');
        style.id = RIPPLE_STYLE_ID;
        style.textContent = `
            [${MENU_ITEM_ATTR}="true"] {
                position: relative;
                overflow: hidden;
            }

            [${MENU_ITEM_ATTR}="true"]::before {
                transition: opacity 220ms cubic-bezier(0.4, 0, 0.2, 1) !important;
            }

            [${MENU_ITEM_ATTR}="true"].v-tab--active::before,
            [${MENU_ITEM_ATTR}="true"].v-tab--active:hover::before,
            [${MENU_ITEM_ATTR}="true"].v-tab--active:focus::before {
                opacity: 0 !important;
            }

            [${MENU_ITEM_ATTR}="true"] .pulse-plus-menu-ripple {
                position: absolute;
                border-radius: 50%;
                background: currentColor;
                opacity: 0.18;
                pointer-events: none;
                transform: scale(0);
                animation: pulse-plus-menu-ripple 520ms ease-out;
            }

            @keyframes pulse-plus-menu-ripple {
                to {
                    opacity: 0;
                    transform: scale(1);
                }
            }
        `;
        document.head.appendChild(style);
    }

    function runMenuItemRipple(event) {
        if (event.pointerType !== 'touch' && event.button !== 0) {
            return;
        }

        const item = event.currentTarget;
        if (!(item instanceof HTMLElement)) {
            return;
        }

        ensureMenuRippleStyle();
        const rect = item.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * 2;
        const ripple = document.createElement('span');
        ripple.className = 'pulse-plus-menu-ripple';
        ripple.style.width = `${size}px`;
        ripple.style.height = `${size}px`;
        ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
        item.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    }

    function isEventPlanningRoute() {
        return window.location.pathname === EXTENSION_PAGE_PATH;
    }

    function isOwnerCalendarRoute() {
        return window.location.pathname === OWNER_CALENDAR_PATH;
    }

    function getOwnerCalendarHashName() {
        return window.location.hash.replace(/^#/, '').split('?')[0];
    }

    function isOwnerCalendarScheduleHash() {
        return isOwnerCalendarRoute() && getOwnerCalendarHashName() === CALENDAR_SCHEDULE_HASH;
    }

    function setOwnerCalendarHash(value) {
        if (!isOwnerCalendarRoute()) {
            return;
        }

        if (getOwnerCalendarHashName() === value) {
            return;
        }

        const nextHash = `#${value}`;
        if (window.location.hash === nextHash) {
            return;
        }

        const previousUrl = window.location.href;
        window.history.replaceState(window.history.state, '', nextHash);
        const event = typeof HashChangeEvent === 'function'
            ? new HashChangeEvent('hashchange', { oldURL: previousUrl, newURL: window.location.href })
            : new Event('hashchange');
        window.dispatchEvent(event);
    }

    function restoreOwnerCalendarHash(hash) {
        if (!isOwnerCalendarRoute() || !hash || window.location.hash === hash) {
            return;
        }

        window.history.replaceState(window.history.state, '', hash);
    }

    function openEventPlanningPage() {
        if (!isEventPlanningRoute()) {
            window.history.pushState({}, '', EXTENSION_PAGE_PATH);
            return;
        }

        window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
    }

    function findMenuContainer() {
        const selectors = [
            'header .v-tabs [role="tablist"] .v-slide-group__content',
            'header .v-tabs .v-slide-group__content',
            'header [role="navigation"] [role="tablist"]',
            'header [role="navigation"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element instanceof HTMLElement) {
                return element;
            }
        }

        return null;
    }

    function removeEventPlanningMenuItem() {
        const menu = findMenuContainer();
        if (!menu) {
            document.querySelectorAll(`[${MENU_ITEM_ATTR}="true"]`).forEach((item) => item.remove());
            return;
        }

        const items = Array.from(menu.querySelectorAll(`[${MENU_ITEM_ATTR}="true"]`));
        if (!items.length) {
            return;
        }

        const tabs = Array.from(menu.querySelectorAll('a.v-tab'))
            .filter((tab) => !items.includes(tab));
        restoreBackedUpActiveTab(tabs);
        updateTabsPointerEvents(tabs, null);
        cancelTabsSliderSync();
        items.forEach((item) => item.remove());
    }

    function ensureMenuItem() {
        removeEventPlanningMenuItem();
    }

    function findTabsSlider(menu) {
        const roots = [
            menu,
            menu.closest('.v-tabs'),
            menu.closest('.v-tabs-bar'),
            menu.parentElement
        ];

        for (const root of roots) {
            const slider = root?.querySelector?.('.v-tabs-slider-wrapper');
            if (slider instanceof HTMLElement) {
                return slider;
            }
        }

        return null;
    }

    function positionTabsSlider(menu, tab) {
        const slider = findTabsSlider(menu);
        if (!slider || !tab.isConnected) {
            return;
        }

        const parent = slider.offsetParent instanceof HTMLElement ? slider.offsetParent : menu;
        const parentRect = parent.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        if (parentRect.width <= 0 || tabRect.width <= 0) {
            return;
        }

        const left = tabRect.left - parentRect.left + parent.scrollLeft;
        const nextLeft = `${Math.round(left)}px`;
        const nextWidth = `${Math.round(tabRect.width)}px`;

        slider.style.visibility = '';
        slider.style.opacity = '1';
        if (slider.style.left !== nextLeft) {
            slider.style.left = nextLeft;
        }
        if (slider.style.width !== nextWidth) {
            slider.style.width = nextWidth;
        }
    }

    function cancelTabsSliderSync() {
        if (tabsSliderFrame) {
            window.cancelAnimationFrame(tabsSliderFrame);
            tabsSliderFrame = 0;
        }
        if (tabsSliderAfterLayoutTimers.length) {
            tabsSliderAfterLayoutTimers.forEach((timer) => window.clearTimeout(timer));
            tabsSliderAfterLayoutTimers = [];
        }
    }

    function syncTabsSlider(menu, tab) {
        if (!(tab instanceof HTMLElement)) {
            return;
        }

        cancelTabsSliderSync();
        const schedule = (framesLeft) => {
            tabsSliderFrame = window.requestAnimationFrame(() => {
                if (!isEventPlanningRoute()) {
                    tabsSliderFrame = 0;
                    return;
                }

                if (framesLeft > 1) {
                    schedule(framesLeft - 1);
                    return;
                }

                tabsSliderFrame = 0;
                positionTabsSlider(menu, tab);
            });
        };

        schedule(2);
    }

    function syncActiveMenuSlider(options = {}) {
        const { refreshState = false, immediate = false } = options;
        if (!isEventPlanningRoute()) {
            return;
        }

        const menu = findMenuContainer();
        const item = menu?.querySelector?.(`[${MENU_ITEM_ATTR}="true"]`);
        if (menu instanceof HTMLElement && item instanceof HTMLElement) {
            if (refreshState) {
                updateMenuActiveState({ syncSlider: false, preserveScheduledSlider: true });
            }
            if (immediate) {
                positionTabsSlider(menu, item);
            } else {
                syncTabsSlider(menu, item);
            }
        }
    }

    function syncActiveMenuSliderAfterLayout() {
        cancelTabsSliderSync();
        [0, 80, LAYOUT_TRANSITION_MS, LAYOUT_TRANSITION_MS + 160, 640].forEach((delay) => {
            const timer = window.setTimeout(() => {
                tabsSliderAfterLayoutTimers = tabsSliderAfterLayoutTimers.filter((item) => item !== timer);
                syncActiveMenuSlider({ refreshState: true, immediate: true });
            }, delay);
            tabsSliderAfterLayoutTimers.push(timer);
        });
    }

    function updateTabsPointerEvents(tabs, activeTab) {
        for (const tab of tabs) {
            if (!(tab instanceof HTMLElement)) {
                continue;
            }

            if (tab === activeTab) {
                tab.style.pointerEvents = 'none';
            } else if (tab.style.pointerEvents === 'none') {
                tab.style.pointerEvents = '';
            }
        }
    }

    function findActiveTab(tabs) {
        return tabs.find((tab) => (
            tab.classList.contains('v-tab--active')
            || tab.getAttribute('aria-current')
            || tab.getAttribute('aria-selected') === 'true'
        ));
    }

    function restoreBackedUpActiveTab(tabs) {
        const backedUpTabs = tabs.filter((tab) => tab.getAttribute(ACTIVE_BACKUP_ATTR) === 'true');
        if (!backedUpTabs.length) {
            return;
        }

        for (const tab of backedUpTabs) {
            tab.removeAttribute(ACTIVE_BACKUP_ATTR);
            if (tab.style.pointerEvents === 'none') {
                tab.style.pointerEvents = '';
            }
        }

        if (findActiveTab(tabs)) {
            return;
        }

        const fallbackTab = backedUpTabs[0];
        fallbackTab.classList.add('v-tab--active', 'primary--text');
        fallbackTab.classList.remove('ty-primary--text');
        fallbackTab.setAttribute('aria-selected', 'true');
    }

    function updateMenuActiveState(options = {}) {
        const { syncSlider = true, preserveScheduledSlider = false } = options;
        const menu = findMenuContainer();
        if (!menu) {
            return;
        }

        const item = menu.querySelector(`[${MENU_ITEM_ATTR}="true"]`);
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const active = isEventPlanningRoute();
        const otherTabs = Array.from(menu.querySelectorAll('a.v-tab'))
            .filter((tab) => tab !== item);
        const allTabs = [...otherTabs, item];

        if (active) {
            for (const tab of otherTabs) {
                if (
                    tab.classList.contains('v-tab--active')
                    || tab.classList.contains('primary--text')
                    || tab.getAttribute('aria-current')
                    || tab.getAttribute('aria-selected') === 'true'
                ) {
                    tab.setAttribute(ACTIVE_BACKUP_ATTR, 'true');
                    tab.classList.remove('v-tab--active', 'primary--text');
                    tab.classList.add('ty-primary--text');
                    tab.removeAttribute('aria-current');
                    tab.removeAttribute('aria-selected');
                }
            }
        } else {
            restoreBackedUpActiveTab(otherTabs);
        }

        item.classList.toggle('v-tab--active', active);
        item.classList.toggle('primary--text', active);
        item.classList.toggle('ty-primary--text', !active);
        if (active) {
            item.setAttribute('aria-current', 'page');
            item.setAttribute('aria-selected', 'true');
        } else {
            item.removeAttribute('aria-current');
            item.removeAttribute('aria-selected');
            cancelTabsSliderSync();
            if (item.style.pointerEvents === 'none') {
                item.style.pointerEvents = '';
            }
        }

        if (active) {
            updateTabsPointerEvents(allTabs, item);
            if (syncSlider) {
                syncTabsSlider(menu, item);
            } else if (!preserveScheduledSlider) {
                cancelTabsSliderSync();
            }
        }
    }

    function getDirectCalendarToggleButtons(toggle) {
        return Array.from(toggle.children)
            .filter((item) => item instanceof HTMLButtonElement && item.classList.contains('v-btn'));
    }

    function getDirectCalendarNativeToggleButtons(toggle) {
        return getDirectCalendarToggleButtons(toggle)
            .filter((button) => button.getAttribute(CALENDAR_BUTTON_ATTR) !== 'true');
    }

    function findCalendarViewToggle() {
        const toggles = Array.from(document.querySelectorAll('.v-btn-toggle--borderless'))
            .filter((item) => item instanceof HTMLElement);

        for (const toggle of toggles) {
            const buttons = getDirectCalendarNativeToggleButtons(toggle);
            if (
                buttons.length >= 3
                && buttons.some((button) => button.title === 'Календарь' || button.value === 'common')
            ) {
                return toggle;
            }
        }

        return null;
    }

    function collectActiveClassNames(element) {
        const classNames = Array.from(element.classList)
            .filter((className) => className.endsWith('--active'));
        return classNames.length ? classNames : DEFAULT_CALENDAR_ACTIVE_CLASSES;
    }

    function getCalendarActiveClassNames(button) {
        const stored = button.getAttribute(CALENDAR_ACTIVE_CLASSES_ATTR);
        if (!stored) {
            return DEFAULT_CALENDAR_ACTIVE_CLASSES;
        }

        const classNames = stored.split(/\s+/).filter(Boolean);
        return classNames.length ? classNames : DEFAULT_CALENDAR_ACTIVE_CLASSES;
    }

    function hasCalendarActiveState(button) {
        return Array.from(button.classList).some((className) => className.endsWith('--active'))
            || button.getAttribute('aria-pressed') === 'true'
            || button.getAttribute('aria-selected') === 'true';
    }

    function removeCalendarActiveState(element) {
        const elements = [element, ...element.querySelectorAll('[class]')];
        for (const item of elements) {
            Array.from(item.classList)
                .filter((className) => className.endsWith('--active'))
                .forEach((className) => item.classList.remove(className));
        }

        if (element instanceof HTMLElement) {
            element.removeAttribute('aria-current');
            element.removeAttribute('aria-selected');
            element.setAttribute('aria-pressed', 'false');
        }
    }

    function addCalendarActiveState(button) {
        getCalendarActiveClassNames(button).forEach((className) => button.classList.add(className));
        button.setAttribute('aria-pressed', 'true');
    }

    function replaceCalendarScheduleButtonIcon(button) {
        const path = button.querySelector('svg path');
        if (path instanceof SVGPathElement) {
            path.setAttribute('d', CALENDAR_TEXT_ICON_PATH);
        }
    }

    function handleCalendarScheduleButtonClick(event) {
        event.preventDefault();
        event.stopPropagation();

        const button = event.currentTarget;
        setOwnerCalendarHash(CALENDAR_SCHEDULE_HASH);
        mountCalendarEmbeddedEventPlanningPage(button instanceof HTMLButtonElement ? button : null);
    }

    function bindCalendarScheduleButton(button) {
        if (button.getAttribute(CALENDAR_BUTTON_BOUND_ATTR) === 'true') {
            return;
        }

        button.setAttribute(CALENDAR_BUTTON_BOUND_ATTR, 'true');
        button.addEventListener('click', handleCalendarScheduleButtonClick);
    }

    function handleCalendarNativeButtonClick(event) {
        if (calendarNativeClickSuppressed) {
            return;
        }

        if (!calendarEmbeddedActive && mountedMode !== 'calendar') {
            return;
        }

        const button = event.currentTarget;
        if (button instanceof HTMLButtonElement && shouldForceFirstCalendarNativeButtonRender(button)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            forceFirstCalendarNativeButtonRender(button);
            return;
        }

        unmountCalendarEmbeddedEventPlanningPage();
    }

    function bindCalendarNativeButtons(toggle, scheduleButton) {
        getDirectCalendarToggleButtons(toggle).forEach((button) => {
            if (button === scheduleButton || button.getAttribute(CALENDAR_NATIVE_BUTTON_BOUND_ATTR) === 'true') {
                return;
            }

            button.setAttribute(CALENDAR_NATIVE_BUTTON_BOUND_ATTR, 'true');
            button.addEventListener('click', handleCalendarNativeButtonClick, true);
        });
    }

    function createCalendarScheduleButton(toggle) {
        const buttons = getDirectCalendarNativeToggleButtons(toggle);
        const activeButton = buttons.find(hasCalendarActiveState) ?? buttons[0];
        if (!activeButton) {
            return null;
        }

        const button = activeButton.cloneNode(true);
        if (!(button instanceof HTMLButtonElement)) {
            return null;
        }

        button.setAttribute(CALENDAR_BUTTON_ATTR, 'true');
        button.setAttribute(CALENDAR_ACTIVE_CLASSES_ATTR, collectActiveClassNames(activeButton).join(' '));
        button.value = CALENDAR_SCHEDULE_HASH;
        button.setAttribute('value', CALENDAR_SCHEDULE_HASH);
        button.type = 'button';
        button.title = 'График';
        button.setAttribute('aria-label', 'График');
        button.removeAttribute('disabled');
        button.removeAttribute('aria-disabled');
        button.tabIndex = 0;
        removeCalendarActiveState(button);
        replaceCalendarScheduleButtonIcon(button);
        bindCalendarScheduleButton(button);
        toggle.appendChild(button);
        return button;
    }

    function ensureCalendarScheduleButton() {
        if (!isOwnerCalendarRoute()) {
            unmountCalendarEmbeddedEventPlanningPage({ restoreButtonState: false });
            removeCalendarScheduleButton();
            return;
        }

        const toggle = findCalendarViewToggle();
        if (!toggle) {
            return;
        }

        let button = toggle.querySelector(`[${CALENDAR_BUTTON_ATTR}="true"]`);
        if (!(button instanceof HTMLButtonElement)) {
            button = createCalendarScheduleButton(toggle);
        }

        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        button.title = 'График';
        button.setAttribute('aria-label', 'График');
        replaceCalendarScheduleButtonIcon(button);
        bindCalendarScheduleButton(button);
        bindCalendarNativeButtons(toggle, button);
        updateCalendarScheduleButtonActiveState(calendarEmbeddedActive, button);

        if (
            isOwnerCalendarScheduleHash()
            && (!calendarEmbeddedActive || mountedMode !== 'calendar' || !calendarEmbeddedRoot?.isConnected)
            && !calendarEmbeddedMountPending
        ) {
            calendarEmbeddedMountPending = true;
            window.requestAnimationFrame(() => {
                calendarEmbeddedMountPending = false;
                mountCalendarEmbeddedEventPlanningPage(button);
            });
        }
    }

    function updateCalendarScheduleButtonActiveState(active, scheduleButton) {
        const button = scheduleButton ?? document.querySelector(`[${CALENDAR_BUTTON_ATTR}="true"]`);
        if (!(button instanceof HTMLButtonElement)) {
            return;
        }

        const toggle = button.closest('.v-btn-toggle--borderless');
        if (!(toggle instanceof HTMLElement)) {
            return;
        }

        const buttons = getDirectCalendarToggleButtons(toggle);
        const otherButtons = buttons.filter((item) => item !== button);

        if (active) {
            for (const item of otherButtons) {
                if (hasCalendarActiveState(item)) {
                    item.setAttribute(CALENDAR_ACTIVE_BACKUP_ATTR, 'true');
                    removeCalendarActiveState(item);
                }
            }
            addCalendarActiveState(button);
            return;
        }

        removeCalendarActiveState(button);
        if (!otherButtons.some(hasCalendarActiveState)) {
            const previousActive = otherButtons.find((item) => item.getAttribute(CALENDAR_ACTIVE_BACKUP_ATTR) === 'true');
            if (previousActive) {
                getCalendarActiveClassNames(button).forEach((className) => previousActive.classList.add(className));
                previousActive.setAttribute('aria-pressed', 'true');
            }
        }

        for (const item of otherButtons) {
            item.removeAttribute(CALENDAR_ACTIVE_BACKUP_ATTR);
        }
    }

    function removeCalendarScheduleButton() {
        document.querySelectorAll(`[${CALENDAR_BUTTON_ATTR}="true"]`).forEach((button) => {
            if (button instanceof HTMLButtonElement) {
                updateCalendarScheduleButtonActiveState(false, button);
            }
            button.remove();
        });
    }

    function getCalendarNativeButtons(toggle, scheduleButton = null) {
        return getDirectCalendarNativeToggleButtons(toggle)
            .filter((button) => button !== scheduleButton);
    }

    function getCalendarScheduleButton(toggle) {
        const button = toggle?.querySelector?.(`[${CALENDAR_BUTTON_ATTR}="true"]`);
        return button instanceof HTMLButtonElement ? button : null;
    }

    function shouldForceFirstCalendarNativeButtonRender(button) {
        const toggle = button.closest('.v-btn-toggle--borderless');
        if (!(toggle instanceof HTMLElement)) {
            return false;
        }

        return getCalendarNativeButtons(toggle, getCalendarScheduleButton(toggle))[0] === button;
    }

    function waitCalendarNativeRenderTick() {
        return new Promise((resolve) => {
            window.requestAnimationFrame(() => {
                window.setTimeout(resolve, 0);
            });
        });
    }

    async function forceFirstCalendarNativeButtonRender(firstButton) {
        const initialToggle = firstButton.closest('.v-btn-toggle--borderless');
        if (!(initialToggle instanceof HTMLElement)) {
            unmountCalendarEmbeddedEventPlanningPage();
            return;
        }

        unmountCalendarEmbeddedEventPlanningPage();

        calendarNativeClickSuppressed = true;
        try {
            const initialNativeButtons = getCalendarNativeButtons(initialToggle, getCalendarScheduleButton(initialToggle));
            const alternateButton = initialNativeButtons.find((button) => button !== firstButton);
            if (alternateButton instanceof HTMLButtonElement) {
                alternateButton.click();
                await waitCalendarNativeRenderTick();
            }

            const nextToggle = findCalendarViewToggle() ?? initialToggle;
            const nextFirstButton = getCalendarNativeButtons(nextToggle, getCalendarScheduleButton(nextToggle))[0];
            if (nextFirstButton instanceof HTMLButtonElement) {
                nextFirstButton.click();
            } else {
                firstButton.click();
            }
        } finally {
            window.setTimeout(() => {
                calendarNativeClickSuppressed = false;
            }, 0);
        }
    }

    function triggerFirstCalendarNativeButton(scheduleButton) {
        const toggle = scheduleButton?.closest?.('.v-btn-toggle--borderless') ?? findCalendarViewToggle();
        if (!(toggle instanceof HTMLElement)) {
            return;
        }

        const firstButton = getCalendarNativeButtons(toggle, scheduleButton)[0];
        if (!(firstButton instanceof HTMLButtonElement)) {
            return;
        }

        calendarNativeClickSuppressed = true;
        try {
            firstButton.click();
        } finally {
            window.setTimeout(() => {
                calendarNativeClickSuppressed = false;
            }, 0);
        }
    }

    function findCalendarEmbeddedContainer() {
        const element = document.querySelector(CALENDAR_EMBEDDED_CONTAINER_SELECTOR);
        return element instanceof HTMLElement ? element : null;
    }

    function findCalendarWrapper() {
        const element = document.querySelector(CALENDAR_WRAPPER_SELECTOR);
        return element instanceof HTMLElement ? element : null;
    }

    function findCalendarShellForWrapper(wrapper) {
        const shell = document.querySelector(CALENDAR_SHELL_SELECTOR);
        return shell instanceof HTMLElement && shell.contains(wrapper) ? shell : null;
    }

    function findCalendarStackContainer(wrapper) {
        const container = wrapper.closest('.stack-calendar-container');
        return container instanceof HTMLElement ? container : null;
    }

    function findCalendarShell() {
        const shell = document.querySelector(CALENDAR_SHELL_SELECTOR);
        return shell instanceof HTMLElement ? shell : null;
    }

    function waitForCalendarWrapper(timeout = 1800) {
        return new Promise((resolve) => {
            const startedAt = performance.now();

            const check = () => {
                const wrapper = findCalendarWrapper();
                if (wrapper || performance.now() - startedAt >= timeout) {
                    resolve(wrapper);
                    return;
                }

                window.setTimeout(check, 50);
            };

            check();
        });
    }

    function removeCalendarEmbeddedElementIfSafe(selector, protectedElement) {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement) || element === protectedElement || element.contains(protectedElement)) {
            return;
        }

        element.remove();
    }

    function prepareCalendarEmbeddedControls(controlsRoot, protectedElement) {
        const scoped = controlsRoot instanceof HTMLElement;
        const controlButtons = scoped
            ? Array.from(controlsRoot.querySelectorAll(':scope > div > button'))
            : Array.from(document.querySelectorAll(CALENDAR_CONTROLS_BUTTON_SELECTOR));

        controlButtons
            .filter((button) => (
                button instanceof HTMLElement
                && button !== protectedElement
                && !button.contains(protectedElement)
                && !button.closest(`[${CALENDAR_ROOT_ATTR}="true"]`)
                && !button.closest('.v-btn-toggle--borderless')
                && button.getAttribute(CALENDAR_BUTTON_ATTR) !== 'true'
            ))
            .slice(0, 3)
            .forEach((button) => button.remove());

        const span = Array.from(controlsRoot.querySelectorAll(scoped ? ':scope > div span' : CALENDAR_CONTROLS_SPAN_SELECTOR))
            .find((item) => (
                item instanceof HTMLElement
                && item !== protectedElement
                && !item.contains(protectedElement)
                && !item.closest(`[${CALENDAR_ROOT_ATTR}="true"]`)
                && !item.closest('button')
            ));
        if (span instanceof HTMLElement && span !== protectedElement && !span.contains(protectedElement)) {
            span.textContent = 'График';
        }
    }

    function prepareCalendarForEmbeddedGraph(wrapper) {
        removeCalendarEmbeddedElementIfSafe(CALENDAR_SHELL_SELECTOR, wrapper);
        prepareCalendarEmbeddedControls(findCalendarStackContainer(wrapper) ?? document, wrapper);
    }

    function cleanupCalendarNativeContent(root) {
        const wrapper = findCalendarWrapper();
        if (wrapper instanceof HTMLElement && wrapper !== root && !wrapper.contains(root)) {
            prepareCalendarForEmbeddedGraph(wrapper);
            const shell = findCalendarShellForWrapper(wrapper);
            const removalTarget = shell && !shell.contains(root) && !shell.querySelector('.v-btn-toggle--borderless')
                ? shell
                : wrapper;
            if (removalTarget !== root && !removalTarget.contains(root)) {
                removalTarget.remove();
            }
            return;
        }

        const stackContainer = root.closest('.stack-calendar-container');
        if (stackContainer instanceof HTMLElement) {
            prepareCalendarEmbeddedControls(stackContainer, root);
        }

        const shell = findCalendarShell();
        if (
            shell instanceof HTMLElement
            && shell !== root
            && !shell.contains(root)
            && !shell.querySelector('.v-btn-toggle--borderless')
        ) {
            shell.remove();
        }
    }

    function scheduleCalendarNativeCleanup(root) {
        [0, 40, 120, 320, 800].forEach((delay) => {
            window.setTimeout(() => {
                if (!isOwnerCalendarRoute() || !calendarEmbeddedActive || !root.isConnected) {
                    return;
                }
                cleanupCalendarNativeContent(root);
            }, delay);
        });
    }

    function unmountMountedEventPlanningApp() {
        if (mounted && window.TrickPlusEventPlanning) {
            window.TrickPlusEventPlanning.unmount();
        }

        mounted = false;
        mountedMode = null;
    }

    function createCalendarEmbeddedRoot(container) {
        if (calendarEmbeddedRoot && !calendarEmbeddedRoot.isConnected && mountedMode === 'calendar') {
            unmountMountedEventPlanningApp();
            calendarEmbeddedRoot = null;
        }

        const existingRoot = document.querySelector(`[${CALENDAR_ROOT_ATTR}="true"]`);
        if (existingRoot instanceof HTMLElement) {
            calendarEmbeddedRoot = existingRoot;
            const stackContainer = existingRoot.closest('.stack-calendar-container');
            if (stackContainer instanceof HTMLElement) {
                prepareCalendarEmbeddedControls(stackContainer, existingRoot);
            }
            return existingRoot;
        }

        const root = document.createElement('div');
        root.setAttribute(CALENDAR_ROOT_ATTR, 'true');
        root.id = 'pulse-plus-event-planning-calendar-root';
        root.className = 'pulse-plus-event-planning-host pulse-plus-event-planning-host--calendar';
        const wrapper = findCalendarWrapper();
        if (wrapper instanceof HTMLElement) {
            prepareCalendarForEmbeddedGraph(wrapper);
            wrapper.replaceWith(root);
        } else {
            const shell = findCalendarShell();
            if (shell && !shell.querySelector('.v-btn-toggle--borderless')) {
                shell.replaceWith(root);
            } else {
                container.appendChild(root);
            }
        }
        calendarEmbeddedRoot = root;
        return root;
    }

    async function mountCalendarEmbeddedEventPlanningPage(scheduleButton) {
        if (!isOwnerCalendarRoute()) {
            return;
        }

        if (calendarEmbeddedActive && mountedMode === 'calendar' && calendarEmbeddedRoot?.isConnected) {
            updateCalendarScheduleButtonActiveState(true, scheduleButton instanceof HTMLButtonElement ? scheduleButton : null);
            return;
        }

        if (calendarEmbeddedMountInProgress) {
            return;
        }
        calendarEmbeddedMountInProgress = true;

        let root = null;
        try {
            const container = findCalendarEmbeddedContainer();
            if (!container) {
                console.warn('[Trick Plus] Calendar content container for event planning was not found');
                return;
            }

            const scheduleHash = isOwnerCalendarScheduleHash() ? window.location.hash : `#${CALENDAR_SCHEDULE_HASH}`;
            calendarEmbeddedActive = true;
            calendarNativeHashSuppressed = true;
            const assetsPromise = ensureAssets();
            triggerFirstCalendarNativeButton(scheduleButton);
            await waitCalendarNativeRenderTick();
            restoreOwnerCalendarHash(scheduleHash);
            if (!findCalendarWrapper()) {
                await waitForCalendarWrapper(900);
            }
            if (!isOwnerCalendarRoute() || !calendarEmbeddedActive) {
                return;
            }
            root = createCalendarEmbeddedRoot(container);
            scheduleCalendarNativeCleanup(root);
            restoreOwnerCalendarHash(scheduleHash);
            calendarNativeHashSuppressed = false;

            await assetsPromise;
            if (!isOwnerCalendarRoute() || !calendarEmbeddedActive || !window.TrickPlusEventPlanning) {
                return;
            }
            if (!root.isConnected) {
                root = createCalendarEmbeddedRoot(container);
                scheduleCalendarNativeCleanup(root);
            }

            if (scheduleButton instanceof HTMLButtonElement && scheduleButton.isConnected) {
                updateCalendarScheduleButtonActiveState(true, scheduleButton);
            } else {
                updateCalendarScheduleButtonActiveState(true);
            }

            if (mounted && mountedMode === 'calendar' && calendarEmbeddedRoot === root && root.isConnected) {
                return;
            }

            if (mounted) {
                unmountMountedEventPlanningApp();
            }

            root.textContent = '';
            window.TrickPlusEventPlanning.mount(root);
            mounted = true;
            mountedMode = 'calendar';
            calendarEmbeddedRoot = root;
            scheduleCalendarNativeCleanup(root);
        } catch (error) {
            console.error('[Trick Plus] Embedded event planning page failed to mount:', error);
            if (root instanceof HTMLElement) {
                root.textContent = 'Не удалось загрузить график. Выполните сборку расширения.';
            }
        } finally {
            calendarNativeHashSuppressed = false;
            calendarEmbeddedMountInProgress = false;
        }
    }

    function unmountCalendarEmbeddedEventPlanningPage(options = {}) {
        const { restoreButtonState = true } = options;

        if (mountedMode === 'calendar') {
            unmountMountedEventPlanningApp();
        }

        calendarEmbeddedActive = false;
        document.querySelectorAll(`[${CALENDAR_ROOT_ATTR}="true"]`).forEach((element) => element.remove());
        calendarEmbeddedRoot = null;

        if (restoreButtonState) {
            updateCalendarScheduleButtonActiveState(false);
        }
    }

    function findMainWrap() {
        const selectors = [
            'main.v-main > .v-main__wrap',
            'main .v-main__wrap',
            'main',
            '[role="main"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element instanceof HTMLElement) {
                return element;
            }
        }

        return null;
    }

    function shouldKeepVisible(element) {
        return element.hasAttribute(ROOT_ATTR)
            || element.matches('nav.sidebar-navigation')
            || element.matches('nav.v-navigation-drawer--right')
            || element.classList.contains('StackMessagesDrawer');
    }

    function hideOriginalContent(container) {
        Array.from(container.children).forEach((child) => {
            if (!(child instanceof HTMLElement) || shouldKeepVisible(child)) {
                return;
            }

            if (!child.hasAttribute(HIDDEN_ATTR)) {
                child.setAttribute(HIDDEN_ATTR, child.style.display || '');
                child.style.display = 'none';
            }
        });
    }

    function backupInlineStyle(element, attrName) {
        if (!element.hasAttribute(attrName)) {
            element.setAttribute(attrName, element.getAttribute('style') || '');
        }
    }

    function restoreInlineStyle(element, attrName) {
        const previousStyle = element.getAttribute(attrName);
        if (previousStyle === null) {
            return;
        }

        if (previousStyle) {
            element.setAttribute('style', previousStyle);
        } else {
            element.removeAttribute('style');
        }
        element.removeAttribute(attrName);
    }

    function findMainElement(container) {
        const closestMain = container.closest('main.v-main');
        if (closestMain instanceof HTMLElement) {
            return closestMain;
        }

        const main = document.querySelector('main.v-main');
        return main instanceof HTMLElement ? main : null;
    }

    function appendTransition(currentTransition, transition) {
        if (!currentTransition) {
            return transition;
        }
        return currentTransition.includes(transition) ? currentTransition : `${currentTransition}, ${transition}`;
    }

    function prepareSidebarNavigation(sidebar) {
        backupInlineStyle(sidebar, SIDEBAR_STYLE_BACKUP_ATTR);
        sidebar.setAttribute(SIDEBAR_SLID_ATTR, 'true');
        sidebar.style.transition = `transform ${LAYOUT_TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        sidebar.style.willChange = 'transform';
        sidebar.style.pointerEvents = 'none';
    }

    function slideSidebarNavigation(sidebar) {
        if (sidebar.getAttribute(SIDEBAR_SLID_ATTR) === 'true') {
            sidebar.style.transform = 'translateX(-100%)';
        }
    }

    function prepareMainContent(container) {
        const main = findMainElement(container);
        if (!main) {
            return null;
        }

        backupInlineStyle(main, MAIN_STYLE_BACKUP_ATTR);
        main.style.transition = appendTransition(main.style.transition, `padding-left ${LAYOUT_TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`);
        main.style.willChange = 'padding-left';
        return main;
    }

    function applyEventPlanningLayout(container) {
        const sidebars = Array.from(container.querySelectorAll(':scope > nav.sidebar-navigation'))
            .filter((sidebar) => sidebar instanceof HTMLElement);
        sidebars.forEach(prepareSidebarNavigation);
        const main = prepareMainContent(container);
        if (main?.hasAttribute(MAIN_STYLE_BACKUP_ATTR)) {
            main.style.paddingLeft = '0px';
        }

        window.requestAnimationFrame(() => {
            if (!isEventPlanningRoute()) {
                return;
            }
            sidebars.forEach(slideSidebarNavigation);
        });
    }

    function restoreEventPlanningLayout() {
        document.querySelectorAll(`[${SIDEBAR_SLID_ATTR}="true"]`).forEach((sidebar) => {
            if (!(sidebar instanceof HTMLElement)) {
                return;
            }
            sidebar.removeAttribute(SIDEBAR_SLID_ATTR);
            restoreInlineStyle(sidebar, SIDEBAR_STYLE_BACKUP_ATTR);
        });

        document.querySelectorAll(`[${MAIN_STYLE_BACKUP_ATTR}]`).forEach((main) => {
            if (main instanceof HTMLElement) {
                restoreInlineStyle(main, MAIN_STYLE_BACKUP_ATTR);
            }
        });
    }

    function restoreOriginalContent() {
        document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((element) => {
            if (!(element instanceof HTMLElement)) {
                return;
            }
            const previousDisplay = element.getAttribute(HIDDEN_ATTR) || '';
            element.style.display = previousDisplay;
            element.removeAttribute(HIDDEN_ATTR);
        });
    }

    function hasEventPlanningPageState() {
        if (
            (mounted && mountedMode === 'route')
            || pageStateApplied
            || document.body.classList.contains('pulse-plus-event-planning-active')
        ) {
            return true;
        }

        if (stalePageStateChecked) {
            return false;
        }

        stalePageStateChecked = true;
        return Boolean(document.querySelector(`[${ROOT_ATTR}], [${HIDDEN_ATTR}], [${SIDEBAR_SLID_ATTR}], [${MAIN_STYLE_BACKUP_ATTR}]`));
    }

    function ensureAssets() {
        if (window.TrickPlusEventPlanning) {
            return Promise.resolve();
        }

        if (bundlePromise) {
            return bundlePromise;
        }

        bundlePromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = extensionUrl('assets/event-planning.js');
            script.setAttribute('data-pulse-plus-event-planning-bundle', 'true');
            script.onload = () => {
                if (window.TrickPlusEventPlanning) {
                    resolve();
                    return;
                }
                reject(new Error('Event planning bundle did not register mount API'));
            };
            script.onerror = () => reject(new Error('Event planning bundle is not built or not accessible'));
            document.documentElement.appendChild(script);
        });

        return bundlePromise;
    }

    function createRoot(container) {
        let root = container.querySelector(`[${ROOT_ATTR}="true"]`);
        if (root instanceof HTMLElement) {
            return root;
        }

        root = document.createElement('div');
        root.setAttribute(ROOT_ATTR, 'true');
        root.id = 'pulse-plus-event-planning-root';
        root.className = 'pulse-plus-event-planning-host';
        root.textContent = 'Загрузка планирования мероприятий...';

        const sidebar = container.querySelector(':scope > nav.sidebar-navigation');
        if (sidebar?.nextSibling) {
            container.insertBefore(root, sidebar.nextSibling);
        } else {
            container.appendChild(root);
        }

        return root;
    }

    function mountEventPlanningPage() {
        if (mountedMode === 'calendar') {
            unmountCalendarEmbeddedEventPlanningPage({ restoreButtonState: false });
        }

        const container = findMainWrap();
        if (!container) {
            console.warn('[Trick Plus] Content container for event planning was not found');
            return;
        }

        hideOriginalContent(container);
        applyEventPlanningLayout(container);
        document.body.classList.add('pulse-plus-event-planning-active');
        pageStateApplied = true;
        stalePageStateChecked = true;
        const root = createRoot(container);

        ensureAssets()
            .then(() => {
                if (!isEventPlanningRoute() || !window.TrickPlusEventPlanning) {
                    return;
                }
                if (!mounted) {
                    root.textContent = '';
                    window.TrickPlusEventPlanning.mount(root);
                    mounted = true;
                    mountedMode = 'route';
                }
            })
            .catch((error) => {
                console.error('[Trick Plus] Event planning page failed to mount:', error);
                root.textContent = 'Не удалось загрузить страницу планирования мероприятий. Выполните сборку расширения.';
            });
    }

    function unmountEventPlanningPage() {
        if (!hasEventPlanningPageState()) {
            return;
        }

        if (mountedMode === 'route') {
            unmountMountedEventPlanningApp();
        }
        pageStateApplied = false;
        stalePageStateChecked = true;
        document.querySelectorAll(`[${ROOT_ATTR}="true"]`).forEach((element) => element.remove());
        document.body.classList.remove('pulse-plus-event-planning-active');
        restoreEventPlanningLayout();
        restoreOriginalContent();
    }

    function activateEventPlanningRoute() {
        ensureMenuItem();
        mountEventPlanningPage();
    }

    function preloadEventPlanningAssets() {
        if (!isOwnerCalendarRoute() && !isEventPlanningRoute()) {
            return;
        }

        void ensureAssets().catch((error) => {
            console.error('[Trick Plus] Event planning bundle preload failed:', error);
        });
    }

    function handleRouteChange() {
        preloadEventPlanningAssets();
        if (isEventPlanningRoute()) {
            activateEventPlanningRoute();
            return;
        }

        ensureMenuItem();
        unmountEventPlanningPage();
        ensureCalendarScheduleButton();
        if (calendarNativeHashSuppressed && isOwnerCalendarRoute()) {
            return;
        }
        if (isOwnerCalendarRoute() && !isOwnerCalendarScheduleHash() && (calendarEmbeddedActive || mountedMode === 'calendar')) {
            unmountCalendarEmbeddedEventPlanningPage();
        }
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

    function startDomObserver() {
        let hasRelevantMutation = false;
        const flushRelevantMutations = debounce(() => {
            if (!hasRelevantMutation && !isEventPlanningRoute()) {
                return;
            }

            hasRelevantMutation = false;
            if (isEventPlanningRoute()) {
                activateEventPlanningRoute();
            } else {
                ensureMenuItem();
                ensureCalendarScheduleButton();
            }
        }, 120);

        const observer = new MutationObserver((mutations) => {
            const calendarToggleChanged = isOwnerCalendarRoute()
                && mutations.some(mutationTouchesCalendarToggle);

            if (calendarToggleChanged) {
                ensureCalendarScheduleButton();
            }

            const needsDebouncedHandling = isEventPlanningRoute()
                ? mutations.some((mutation) => (
                    mutationTouchesHeader(mutation)
                    || mutationTouchesEventPlanningShell(mutation)
                ))
                : mutations.some(mutationTouchesHeader);

            if (!needsDebouncedHandling) {
                return;
            }

            hasRelevantMutation = true;
            flushRelevantMutations();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    patchHistory();
    preloadEventPlanningAssets();
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener(ROUTE_EVENT, handleRouteChange);
    if (isDiagnosticSettingEnabled('diagnosticEventPlanningObserver')) {
        startDomObserver();
    }
    handleRouteChange();
})();
