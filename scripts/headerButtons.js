(function () {
    const REGISTRY_KEY = '__PULSE_PLUS_HEADER_BUTTONS__';
    const BUTTON_ATTR = 'data-pulse-plus-header-button';
    const PATCHED_ATTR = '__pulsePlusHeaderButtonsPatched';
    const HEADER_SELECTOR = 'header';
    const HEADER_SEGMENT_SELECTOR = '.v-toolbar__content > div > div > div:last-of-type';
    const ROW_SELECTOR = '.row';

    if (window[REGISTRY_KEY]) {
        window.PulsePlusHeaderButtons = window[REGISTRY_KEY];
        window.dispatchEvent(new CustomEvent('PulsePlusHeaderButtonsReady'));
        return;
    }

    const definitions = new Map();
    let ensureFrame = 0;

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

    function isSettingEnabled(key) {
        return getPageSettings()[key] !== false;
    }

    function isElement(node) {
        return node instanceof Element;
    }

    function collectHeaders(root) {
        const headers = [];
        if (isElement(root) && root.matches(HEADER_SELECTOR)) {
            headers.push(root);
        }

        if (typeof root?.querySelectorAll === 'function') {
            root.querySelectorAll(HEADER_SELECTOR).forEach((header) => headers.push(header));
        }

        return headers;
    }

    function findHeaderSegment(header) {
        return header.querySelector(HEADER_SEGMENT_SELECTOR);
    }

    function findHeaderRow(header) {
        const segment = findHeaderSegment(header);
        const row = segment?.querySelector?.(ROW_SELECTOR);
        return row instanceof HTMLElement ? row : null;
    }

    function findSourceItem(row) {
        const children = Array.from(row.children)
            .filter((child) => child instanceof HTMLElement);

        return children.find((child) => (
            !child.hasAttribute(BUTTON_ATTR)
            && child.querySelector('button')
            && child.querySelector('.v-icon, svg')
        )) ?? null;
    }

    function findDirectItemContaining(row, element) {
        return Array.from(row.children)
            .find((child) => child instanceof HTMLElement && child.contains(element)) ?? null;
    }

    function findUserMenuItem(row) {
        const button = row.querySelector('button[title="Меню пользователя"]');
        return button instanceof HTMLElement ? findDirectItemContaining(row, button) : null;
    }

    function setIcon(wrapper, svg) {
        const icon = wrapper.querySelector('.v-icon');
        if (icon instanceof HTMLElement) {
            icon.innerHTML = svg;
            return;
        }

        const content = wrapper.querySelector('.v-btn__content');
        if (content instanceof HTMLElement) {
            content.innerHTML = `<span aria-hidden="true" class="notranslate v-icon theme--light">${svg}</span>`;
        }
    }

    function prepareButton(wrapper, definition) {
        wrapper.setAttribute(BUTTON_ATTR, definition.id);
        wrapper.removeAttribute('id');
        wrapper.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));

        if (definition.wrapperClass) {
            wrapper.classList.add(...definition.wrapperClass.split(/\s+/).filter(Boolean));
        }

        if (definition.icon) {
            setIcon(wrapper, definition.icon);
        }

        const button = wrapper.querySelector('button');
        if (button instanceof HTMLButtonElement) {
            button.type = 'button';
            button.title = definition.title;
            button.setAttribute('aria-label', definition.title);
            button.removeAttribute('disabled');
            button.removeAttribute('aria-disabled');
            button.onclick = null;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                definition.onClick?.(event);
            });
        }

        definition.prepare?.(wrapper, button instanceof HTMLButtonElement ? button : null);
        return wrapper;
    }

    function createButton(row, definition) {
        const source = definition.getSourceItem?.(row) ?? findSourceItem(row);
        if (!(source instanceof HTMLElement)) {
            return null;
        }

        return prepareButton(source.cloneNode(true), definition);
    }

    function getInsertionAnchor(row, definition) {
        if (typeof definition.getAnchor === 'function') {
            return definition.getAnchor(row);
        }

        if (definition.placement === 'before-user-menu-previous') {
            const userMenuItem = findUserMenuItem(row);
            return userMenuItem?.previousElementSibling ?? userMenuItem ?? null;
        }

        if (definition.placement === 'before-user-menu') {
            return findUserMenuItem(row);
        }

        return null;
    }

    function insertButton(row, button, definition) {
        const anchor = getInsertionAnchor(row, definition);
        if (anchor instanceof Element && anchor.parentElement === row && anchor !== button) {
            if (button.parentElement !== row || button.nextElementSibling !== anchor) {
                row.insertBefore(button, anchor);
            }
            return;
        }

        if (button.parentElement !== row || button.nextElementSibling) {
            row.appendChild(button);
        }
    }

    function ensureButton(row, definition) {
        const existing = row.querySelector(`:scope > [${BUTTON_ATTR}="${definition.id}"]`)
            ?? Array.from(row.children).find((child) => (
                child instanceof HTMLElement
                && !child.hasAttribute(BUTTON_ATTR)
                && child.querySelector('button')?.title === definition.title
            ));
        if (existing instanceof HTMLElement) {
            if (!existing.hasAttribute(BUTTON_ATTR)) {
                prepareButton(existing, definition);
            }

            const button = existing.querySelector('button');
            if (button instanceof HTMLButtonElement) {
                button.title = definition.title;
                button.setAttribute('aria-label', definition.title);
            }
            definition.prepare?.(existing, button instanceof HTMLButtonElement ? button : null);
            insertButton(row, existing, definition);
            return;
        }

        const button = createButton(row, definition);
        if (button) {
            insertButton(row, button, definition);
        }
    }

    function ensureHeader(header) {
        const row = findHeaderRow(header);
        if (!row) {
            return;
        }

        definitions.forEach((definition) => ensureButton(row, definition));
    }

    function ensureAll() {
        document.querySelectorAll(HEADER_SELECTOR).forEach((header) => ensureHeader(header));
    }

    function scheduleEnsureAll() {
        if (ensureFrame) {
            return;
        }

        ensureFrame = window.requestAnimationFrame(() => {
            ensureFrame = 0;
            ensureAll();
        });
    }

    function prepareNodeBeforeInsert(node) {
        collectHeaders(node).forEach((header) => ensureHeader(header));
        return node;
    }

    function patchInsertionMethod(proto, methodName, prepareIndex) {
        if (!proto || proto[`${PATCHED_ATTR}_${methodName}`]) {
            return;
        }

        const original = proto[methodName];
        if (typeof original !== 'function') {
            return;
        }

        Object.defineProperty(proto, `${PATCHED_ATTR}_${methodName}`, {
            value: true,
            configurable: true
        });

        proto[methodName] = function (...args) {
            const node = args[prepareIndex];
            if (node instanceof Node) {
                prepareNodeBeforeInsert(node);
            }

            return original.apply(this, args);
        };
    }

    function patchMultiNodeMethod(proto, methodName) {
        if (!proto || proto[`${PATCHED_ATTR}_${methodName}`]) {
            return;
        }

        const original = proto[methodName];
        if (typeof original !== 'function') {
            return;
        }

        Object.defineProperty(proto, `${PATCHED_ATTR}_${methodName}`, {
            value: true,
            configurable: true
        });

        proto[methodName] = function (...args) {
            args.forEach((node) => {
                if (node instanceof Node) {
                    prepareNodeBeforeInsert(node);
                }
            });

            return original.apply(this, args);
        };
    }

    function register(definition) {
        if (!definition?.id || typeof definition.onClick !== 'function') {
            return;
        }

        definitions.set(definition.id, definition);
        scheduleEnsureAll();
    }

    if (isSettingEnabled('diagnosticHeaderDomPatch')) {
        patchInsertionMethod(Node.prototype, 'appendChild', 0);
        patchInsertionMethod(Node.prototype, 'insertBefore', 0);
        patchInsertionMethod(Node.prototype, 'replaceChild', 0);
        patchMultiNodeMethod(Element.prototype, 'append');
        patchMultiNodeMethod(Element.prototype, 'prepend');
    }

    const api = {
        register,
        ensureAll,
        buttonAttribute: BUTTON_ATTR
    };

    window[REGISTRY_KEY] = api;
    window.PulsePlusHeaderButtons = api;

    window.dispatchEvent(new CustomEvent('PulsePlusHeaderButtonsReady'));
})();
