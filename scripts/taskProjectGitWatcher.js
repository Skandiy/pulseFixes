(function () {
    const MESSAGE_TYPES = {
        WINDOW_EXECUTE_PAGE_REQUEST: 'WINDOW_EXECUTE_PAGE_REQUEST',
        WINDOW_EXECUTE_PAGE_REQUEST_RESULT: 'WINDOW_EXECUTE_PAGE_REQUEST_RESULT',
        WINDOW_EXECUTE_LOCAL_HTTP_REQUEST: 'WINDOW_EXECUTE_LOCAL_HTTP_REQUEST',
        WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT: 'WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT',
    };

    const TASK_PROJECT_FIELD_NAME = 'карточка-проект';
    const PROJECT_GIT_FIELD_NAME = 'git';
    const ROPENED_PATTERN = /(?:^|[?&#]|%26)ropened=(?:number\|)?(\d+)/i;
    const IDE_PLUGIN_PORT_START = 65333;
    const IDE_PLUGIN_PORT_END = 65343;
    const IDE_PLUGIN_ABOUT_PATH = '/about';
    const IDE_APP_PORT_START = 63342;
    const IDE_APP_PORT_END = 63352;
    const IDE_APP_ABOUT_PATH = '/api/about';
    const IDE_OPEN_OR_CLONE_PATH = '/project/open-or-clone';
    const IDE_REQUEST_TIMEOUT_MS = 1200;
    const TRICK_PLUGIN_URL = 'https://github.com/Skandiy/PulsePlugin?tab=readme-ov-file#trick--плагин-для-phpstorm';
    const TRANSLATE_TASK_BUTTON_SELECTOR = 'form .text-button[title="Перевести задачу"]';
    const TRANSLATE_TASK_BUTTON_SELECTOR_ASIDE = 'aside .v-navigation-drawer__content .IssuePage .stack-dialog__toolbar .text-button[title="Перевести задачу"]';
    const OPEN_IDE_BUTTON_ATTR = 'data-pulse-plus-open-ide';
    const OPEN_IDE_WRAPPER_ATTR = 'data-pulse-plus-open-ide-wrapper';
    const OPEN_IDE_MENU_ATTR = 'data-pulse-plus-open-ide-menu';
    const OPEN_IDE_SPINNER_ATTR = 'data-pulse-plus-open-ide-spinner';
    const OPEN_IDE_LABEL_ATTR = 'data-pulse-plus-open-ide-label';
    const OPEN_IDE_TOOLTIP_ATTR = 'data-pulse-plus-open-ide-tooltip';
    const OPEN_IDE_TOOLTIP_BRIDGE_ATTR = 'data-pulse-plus-open-ide-tooltip-bridge';
    const UI_STATE_LOADING = 'loading';
    const UI_STATE_READY = 'ready';
    const UI_STATE_DISABLED = 'disabled';
    const DISABLED_REASON_NO_GIT = 'noGit';
    const DISABLED_REASON_IDE_NOT_RUNNING = 'ideNotRunning';
    const DISABLED_REASON_TRICK_NOT_INSTALLED = 'trickNotInstalled';
    const DISABLED_REASON_UNKNOWN = 'unknown';

    let lastProcessedRouteKey = null;
    let currentRequestToken = 0;
    let cachedIdePorts = [];
    let preferredIdePort = null;
    let ideDiscoveryPromise = null;
    let cachedRunningIdePorts = [];
    let preferredRunningIdePort = null;
    let runningIdeDiscoveryPromise = null;
    let uiObserver = null;
    let uiObserverMode = null;
    let menuOutsideClickHandler = null;
    let currentMenuElement = null;
    let currentTooltipElement = null;
    let currentTooltipBridgeElement = null;
    let spinnerStyleInjected = false;
    let uiState = {
        mode: null,
        taskId: null,
        status: null,
        disabledReason: null,
        gitEntries: [],
        ides: [],
    };

    function safeDecode(value, attempts) {
        let decoded = value;

        for (let index = 0; index < attempts; index += 1) {
            try {
                const nextValue = decodeURIComponent(decoded);
                if (nextValue === decoded) {
                    break;
                }

                decoded = nextValue;
            } catch (_) {
                break;
            }
        }

        return decoded;
    }

    function extractTaskIdFromRopenedUrl(rawUrl) {
        const variants = [rawUrl];
        const decodedOnce = safeDecode(rawUrl, 1);
        const decodedTwice = safeDecode(rawUrl, 2);

        if (!variants.includes(decodedOnce)) {
            variants.push(decodedOnce);
        }

        if (!variants.includes(decodedTwice)) {
            variants.push(decodedTwice);
        }

        for (const variant of variants) {
            const match = variant.match(ROPENED_PATTERN);
            if (!match) {
                continue;
            }

            const taskId = Number.parseInt(match[1], 10);
            if (Number.isInteger(taskId) && taskId > 0) {
                return taskId;
            }
        }

        return null;
    }

    function extractProjectTaskRouteFromUrl(rawUrl) {
        const variants = [rawUrl];
        const decodedOnce = safeDecode(rawUrl, 1);
        const decodedTwice = safeDecode(rawUrl, 2);

        if (!variants.includes(decodedOnce)) {
            variants.push(decodedOnce);
        }

        if (!variants.includes(decodedTwice)) {
            variants.push(decodedTwice);
        }

        for (const variant of variants) {
            let pathname = '';

            try {
                pathname = new URL(variant, window.location.origin).pathname;
            } catch (_) {
                pathname = String(variant).split(/[?#]/, 1)[0];
            }

            const match = pathname.match(/\/pulse\/projects\/(\d+)\/issues\/(\d+)(?:\/|$)/i);
            if (!match) {
                continue;
            }

            const projectId = Number.parseInt(match[1], 10);
            const taskId = Number.parseInt(match[2], 10);

            if (Number.isInteger(projectId) && projectId > 0 && Number.isInteger(taskId) && taskId > 0) {
                return {
                    mode: 'projectIssue',
                    projectId,
                    taskId,
                    routeKey: `projectIssue:${projectId}:${taskId}`,
                };
            }
        }

        return null;
    }

    function extractTaskContextFromUrl(rawUrl) {
        const projectIssueRoute = extractProjectTaskRouteFromUrl(rawUrl);
        if (projectIssueRoute) {
            return projectIssueRoute;
        }

        const taskId = extractTaskIdFromRopenedUrl(rawUrl);
        if (!taskId) {
            return null;
        }

        return {
            mode: 'ropened',
            projectId: null,
            taskId,
            routeKey: `ropened:${taskId}`,
        };
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
                    console.warn(response?.error);
                    reject(new Error(response?.error || 'Page request failed'));
                    return;
                }

                resolve(response.data);
            }

            window.addEventListener('message', handleMessage);
            window.postMessage({
                type: MESSAGE_TYPES.WINDOW_EXECUTE_PAGE_REQUEST,
                id: requestId,
                payload: payload,
            }, '*');
        });
    }

    function executeLocalHttpRequest(payload) {
        return new Promise((resolve, reject) => {
            const requestId = `pulse-local-http-request-${Date.now()}-${Math.random().toString(36).slice(2)}`;

            function handleMessage(event) {
                if (event.source !== window) {
                    return;
                }

                if (event.data?.type !== MESSAGE_TYPES.WINDOW_EXECUTE_LOCAL_HTTP_REQUEST_RESULT) {
                    return;
                }

                if (event.data?.id !== requestId) {
                    return;
                }

                window.removeEventListener('message', handleMessage);

                const { response } = event.data;

                if (!response?.ok) {
                    reject(new Error(response?.error || 'Local HTTP request failed'));
                    return;
                }

                resolve(response.data);
            }

            window.addEventListener('message', handleMessage);
            window.postMessage({
                type: MESSAGE_TYPES.WINDOW_EXECUTE_LOCAL_HTTP_REQUEST,
                id: requestId,
                payload,
            }, '*');
        });
    }

    function getFirstTaskResult(response) {
        return response?.tasks?.[0]?.result || null;
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

    function normalizeRecordId(value) {
        const normalized = typeof value === 'number'
            ? value
            : Number.parseInt(String(value), 10);

        return Number.isInteger(normalized) && normalized > 0
            ? normalized
            : null;
    }

    function normalizeGitEntries(parsedGit) {
        if (!Array.isArray(parsedGit)) {
            return [];
        }

        return parsedGit
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                id: entry.id ?? null,
                name: typeof entry.name === 'string' ? entry.name.trim() : '',
                url: typeof entry.url === 'string' ? entry.url.trim() : '',
            }))
            .filter((entry) => entry.name && entry.url);
    }

    function normalizeIdeEntries(servers) {
        if (!Array.isArray(servers)) {
            return [];
        }

        const seenPorts = new Set();

        return servers
            .map((server) => {
                const port = normalizeRecordId(server?.about?.server?.port ?? server?.port);
                const productName = typeof server?.about?.ide?.productName === 'string'
                    ? server.about.ide.productName.trim()
                    : '';

                if (!port || !productName || seenPorts.has(port)) {
                    return null;
                }

                seenPorts.add(port);

                return {
                    productName,
                    port,
                };
            })
            .filter(Boolean);
    }

    function getRelativeProjectPath(gitUrl) {
        try {
            const parsedUrl = new URL(gitUrl);
            const segments = parsedUrl.pathname.split('/').filter(Boolean);
            return segments.length > 0 ? segments[segments.length - 1] : null;
        } catch (_) {
            const normalizedUrl = String(gitUrl).replace(/\/+$/, '');
            const segments = normalizedUrl.split('/').filter(Boolean);
            return segments.length > 0 ? segments[segments.length - 1] : null;
        }
    }

    function isValidIdeAboutResponse(payload, expectedPort) {
        const serverPort = normalizeRecordId(payload?.server?.port);

        return payload?.ok === true
            && typeof payload?.plugin?.id === 'string'
            && payload.plugin.id.length > 0
            && serverPort === expectedPort
            && serverPort >= IDE_PLUGIN_PORT_START
            && serverPort <= IDE_PLUGIN_PORT_END;
    }

    function isValidRunningIdeAboutResponse(payload) {
        return payload
            && typeof payload === 'object'
            && typeof payload.productName === 'string'
            && payload.productName.trim().length > 0
            && typeof payload.version === 'string'
            && payload.version.trim().length > 0;
    }

    function parseRunningIdeServerHeader(serverHeader) {
        if (typeof serverHeader !== 'string') {
            return null;
        }

        const normalizedHeader = serverHeader.trim();
        if (!normalizedHeader) {
            return null;
        }

        const match = normalizedHeader.match(/^(.+?)\s+(\d+(?:\.\d+)+)$/);
        if (!match) {
            return null;
        }

        const productName = match[1].trim();
        const version = match[2].trim();

        if (!productName || !version) {
            return null;
        }

        return {
            productName,
            version,
            serverHeader: normalizedHeader,
        };
    }

    function getPreferredIdeServer(servers) {
        if (!Array.isArray(servers) || servers.length === 0) {
            return null;
        }

        if (preferredIdePort) {
            const preferredServer = servers.find((server) => server.port === preferredIdePort);
            if (preferredServer) {
                return preferredServer;
            }
        }

        return servers[0];
    }

    function buildPortScanOrder(portStart, portEnd, preferredPort, cachedPorts) {
        const ports = [];
        const seenPorts = new Set();

        const appendPort = (port) => {
            if (!Number.isInteger(port) || port < portStart || port > portEnd || seenPorts.has(port)) {
                return;
            }

            seenPorts.add(port);
            ports.push(port);
        };

        appendPort(preferredPort);
        cachedPorts.forEach((port) => appendPort(port));

        for (let port = portStart; port <= portEnd; port += 1) {
            appendPort(port);
        }

        return ports;
    }

    async function fetchJsonFromLocalApi(port, path) {
        try {
            const response = await executeLocalHttpRequest({
                url: `http://127.0.0.1:${port}${path}`,
                method: 'GET',
                timeoutMs: IDE_REQUEST_TIMEOUT_MS,
                responseType: 'json',
            });

            if (!response.ok) {
                return null;
            }

            return response.body;
        } catch (_) {
            return null;
        }
    }

    async function fetchIdeAbout(port) {
        const payload = await fetchJsonFromLocalApi(port, IDE_PLUGIN_ABOUT_PATH);
        return isValidIdeAboutResponse(payload, port)
            ? payload
            : null;
    }

    async function fetchRunningIdeAbout(port) {
        try {
            const response = await executeLocalHttpRequest({
                url: `http://127.0.0.1:${port}${IDE_APP_ABOUT_PATH}`,
                method: 'GET',
                timeoutMs: IDE_REQUEST_TIMEOUT_MS,
                responseType: 'text',
            });

            const parsedServer = parseRunningIdeServerHeader(response.headers?.server);
            if (!parsedServer) {
                console.log('[Pulse Plus] IDE app API ответил без подходящего Server header:', {
                    port,
                    status: response.status,
                    server: response.headers?.server ?? null,
                });
                return null;
            }

            const payload = {
                ...parsedServer,
                status: response.status,
            };

            return isValidRunningIdeAboutResponse(payload)
                ? payload
                : null;
        } catch (_) {
            return null;
        }
    }

    async function postIdeCommand(port, payload) {
        try {
            const response = await executeLocalHttpRequest({
                url: `http://127.0.0.1:${port}${IDE_OPEN_OR_CLONE_PATH}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                timeoutMs: IDE_REQUEST_TIMEOUT_MS,
                responseType: 'text',
            });

            if (!response.ok) {
                return null;
            }

            const text = response.body;
            let data = null;

            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (_) {
                    data = text;
                }
            }

            return {
                status: response.status,
                data,
            };
        } catch (_) {
            return null;
        }
    }

    async function discoverIdePluginServer() {
        if (ideDiscoveryPromise) {
            return ideDiscoveryPromise;
        }

        ideDiscoveryPromise = (async () => {
            const portsToCheck = buildPortScanOrder(
                IDE_PLUGIN_PORT_START,
                IDE_PLUGIN_PORT_END,
                preferredIdePort,
                cachedIdePorts
            );

            console.log('[Pulse Plus] Проверяем IDE plugin server ports:', portsToCheck);

            const discoveryResults = await Promise.all(
                portsToCheck.map(async (port) => {
                    const aboutResponse = await fetchIdeAbout(port);
                    if (!aboutResponse) {
                        return null;
                    }

                    return {
                        port,
                        about: aboutResponse,
                    };
                })
            );

            const discoveredServers = discoveryResults.filter((server) => server !== null);

            discoveredServers.sort((left, right) => {
                if (left.port === preferredIdePort) {
                    return -1;
                }

                if (right.port === preferredIdePort) {
                    return 1;
                }

                return left.port - right.port;
            });

            cachedIdePorts = discoveredServers.map((server) => server.port);

            if (discoveredServers.length === 0) {
                preferredIdePort = null;
                cachedIdePorts = [];
                console.warn('[Pulse Plus] IDE plugin server не найден в диапазоне портов:', `${IDE_PLUGIN_PORT_START}-${IDE_PLUGIN_PORT_END}`);
                return null;
            }

            if (!cachedIdePorts.includes(preferredIdePort)) {
                preferredIdePort = cachedIdePorts[0];
            }

            const preferredServer = getPreferredIdeServer(discoveredServers);
            console.log('[Pulse Plus] Найдены IDE plugin server ports:', cachedIdePorts);

            return {
                servers: discoveredServers,
                preferredServer,
            };
        })();

        try {
            return await ideDiscoveryPromise;
        } finally {
            ideDiscoveryPromise = null;
        }
    }

    async function discoverRunningIdeServer() {
        if (runningIdeDiscoveryPromise) {
            return runningIdeDiscoveryPromise;
        }

        runningIdeDiscoveryPromise = (async () => {
            const portsToCheck = buildPortScanOrder(
                IDE_APP_PORT_START,
                IDE_APP_PORT_END,
                preferredRunningIdePort,
                cachedRunningIdePorts
            );

            console.log('[Pulse Plus] Проверяем IDE app ports:', portsToCheck);

            const discoveryResults = await Promise.all(
                portsToCheck.map(async (port) => {
                    const aboutResponse = await fetchRunningIdeAbout(port);
                    if (!aboutResponse) {
                        return null;
                    }

                    return {
                        port,
                        about: aboutResponse,
                    };
                })
            );

            const discoveredServers = discoveryResults.filter((server) => server !== null);

            discoveredServers.sort((left, right) => {
                if (left.port === preferredRunningIdePort) {
                    return -1;
                }

                if (right.port === preferredRunningIdePort) {
                    return 1;
                }

                return left.port - right.port;
            });

            cachedRunningIdePorts = discoveredServers.map((server) => server.port);

            if (discoveredServers.length === 0) {
                preferredRunningIdePort = null;
                cachedRunningIdePorts = [];
                console.warn('[Pulse Plus] IDE app API не найден в диапазоне портов:', `${IDE_APP_PORT_START}-${IDE_APP_PORT_END}`);
                return null;
            }

            if (!cachedRunningIdePorts.includes(preferredRunningIdePort)) {
                preferredRunningIdePort = cachedRunningIdePorts[0];
            }

            console.log('[Pulse Plus] Найдены IDE app ports:', cachedRunningIdePorts);

            return {
                servers: discoveredServers,
                preferredServer: discoveredServers[0] ?? null,
            };
        })();

        try {
            return await runningIdeDiscoveryPromise;
        } finally {
            runningIdeDiscoveryPromise = null;
        }
    }

    function isElementVisible(element) {
        if (!(element instanceof HTMLElement) || !element.isConnected) {
            return false;
        }

        if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('disabled')) {
            return false;
        }

        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }

        return element.getClientRects().length > 0;
    }

    function getTranslateTaskButton(mode) {
        const selector = mode === 'ropened'
            ? TRANSLATE_TASK_BUTTON_SELECTOR_ASIDE
            : TRANSLATE_TASK_BUTTON_SELECTOR;
        const buttons = Array.from(document.querySelectorAll(selector));

        return buttons.find((button) => {
            if (button.hasAttribute(OPEN_IDE_BUTTON_ATTR)) {
                return false;
            }

            const content = button.querySelector('.v-btn__content');
            if (!content || !content.textContent?.trim()) {
                return false;
            }

            return isElementVisible(button);
        }) ?? null;
    }

    function removeCurrentMenu() {
        if (menuOutsideClickHandler) {
            document.removeEventListener('click', menuOutsideClickHandler, true);
            menuOutsideClickHandler = null;
        }

        if (currentMenuElement) {
            currentMenuElement.remove();
            currentMenuElement = null;
        }
    }

    function removeCurrentTooltip() {
        if (currentTooltipBridgeElement) {
            currentTooltipBridgeElement.remove();
            currentTooltipBridgeElement = null;
        }

        if (currentTooltipElement) {
            currentTooltipElement.remove();
            currentTooltipElement = null;
        }
    }

    function disconnectUiObserver() {
        if (!uiObserver) {
            return;
        }

        uiObserver.disconnect();
        uiObserver = null;
        uiObserverMode = null;
    }

    function removeOpenIdeUi() {
        disconnectUiObserver();
        removeCurrentMenu();
        removeCurrentTooltip();
        const wrappers = document.querySelectorAll(`[${OPEN_IDE_WRAPPER_ATTR}="true"]`);

        wrappers.forEach((wrapper) => wrapper.remove());
    }

    function ensureUiObserver(mode) {
        if (uiObserver && uiObserverMode === mode) {
            return;
        }

        disconnectUiObserver();

        uiObserver = new MutationObserver(() => {
            const sourceButton = getTranslateTaskButton(mode);
            if (!sourceButton) {
                return;
            }

            disconnectUiObserver();
            ensureOpenIdeButton(sourceButton);
        });
        uiObserverMode = mode;

        uiObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function ensureSpinnerStyles() {
        if (spinnerStyleInjected) {
            return;
        }

        const style = document.createElement('style');
        style.textContent = `
            @keyframes pulsePlusButtonSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
        spinnerStyleInjected = true;
    }

    function startLoadingUiState(mode, taskId) {
        uiState = {
            mode,
            taskId,
            status: UI_STATE_LOADING,
            disabledReason: null,
            gitEntries: [],
            ides: [],
        };

        ensureOpenIdeButton();
    }

    function updateDisabledUiState(mode, taskId, disabledReason, gitEntries) {
        uiState = {
            mode,
            taskId,
            status: UI_STATE_DISABLED,
            disabledReason,
            gitEntries: Array.isArray(gitEntries) ? gitEntries : [],
            ides: [],
        };

        ensureOpenIdeButton();
    }

    function updateUiState(mode, taskId, gitEntries, ides) {
        uiState = {
            mode,
            taskId,
            status: UI_STATE_READY,
            disabledReason: null,
            gitEntries,
            ides,
        };

        ensureOpenIdeButton();
    }

    function resetUiState() {
        uiState = {
            mode: null,
            taskId: null,
            status: null,
            disabledReason: null,
            gitEntries: [],
            ides: [],
        };

        removeOpenIdeUi();
    }

    function createMenuItem(label) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.padding = '8px 12px';
        button.style.background = '#fff';
        button.style.border = '0';
        button.style.textAlign = 'left';
        button.style.cursor = 'pointer';
        button.style.font = 'inherit';
        button.style.color = '#1e1e1e';

        button.addEventListener('mouseenter', () => {
            button.style.background = '#f4f6f8';
        });

        button.addEventListener('mouseleave', () => {
            button.style.background = '#fff';
        });

        return button;
    }

    async function sendOpenProjectRequest(port, payload, allowRediscovery) {
        console.log('[Pulse Plus] Отправляем команду в IDE API port:', port);

        const result = await postIdeCommand(port, payload);
        if (result) {
            preferredIdePort = port;

            return {
                port,
                endpoint: IDE_OPEN_OR_CLONE_PATH,
                result,
            };
        }

        if (!allowRediscovery) {
            throw new Error('IDE API request failed');
        }

        console.warn('[Pulse Plus] Не удалось отправить команду в IDE API port, перепроверяем discovery:', port);
        const ideDiscovery = await discoverIdePluginServer();
        const selectedServer = ideDiscovery?.servers?.find((server) => server.port === port);

        if (!selectedServer) {
            throw new Error(`IDE plugin server is not available on port ${port} after rediscovery`);
        }

        return sendOpenProjectRequest(port, payload, false);
    }

    async function handleGitEntryClick(entry, ide) {
        const relativeProjectPath = getRelativeProjectPath(entry.url);

        if (!relativeProjectPath) {
            console.warn('[Pulse Plus] Не удалось сформировать relativeProjectPath для:', entry.url);
            return;
        }

        const payload = {
            gitUrl: entry.url,
            relativeProjectPath,
        };

        console.log('[Pulse Plus] IDE open payload:', payload);
        console.log('[Pulse Plus] Выбрана IDE:', ide);

        try {
            const response = await sendOpenProjectRequest(ide.port, payload, true);
            console.log('[Pulse Plus] IDE open response:', response);
        } catch (error) {
            console.error('[Pulse Plus] Не удалось отправить команду в IDE API:', error);
        }
    }

    function showDropdownMenu(button, wrapper, items) {
        removeCurrentMenu();
        const menu = document.createElement('div');
        menu.setAttribute(OPEN_IDE_MENU_ATTR, 'true');
        menu.style.position = 'absolute';
        menu.style.top = 'calc(100% + 6px)';
        menu.style.right = '0';
        menu.style.minWidth = '220px';
        menu.style.maxWidth = '320px';
        menu.style.background = '#fff';
        menu.style.border = '1px solid rgba(0, 0, 0, 0.12)';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
        menu.style.padding = '6px 0';
        menu.style.zIndex = '10000';

        items.forEach((item) => {
            const itemButton = createMenuItem(item.label);
            itemButton.addEventListener('click', item.onClick);
            menu.appendChild(itemButton);
        });

        wrapper.appendChild(menu);
        currentMenuElement = menu;
        button.setAttribute('aria-expanded', 'true');

        menuOutsideClickHandler = (event) => {
            if (wrapper.contains(event.target)) {
                return;
            }

            removeCurrentMenu();
            button.setAttribute('aria-expanded', 'false');
        };

        document.addEventListener('click', menuOutsideClickHandler, true);
    }

    function showIdeSelectionMenu(button, wrapper, entry) {
        console.log('[Pulse Plus] Открываем меню выбора IDE для git:', entry.url);

        const items = uiState.ides.map((ide) => ({
            label: `${ide.productName} (${ide.port})`,
            onClick: async (event) => {
                event.preventDefault();
                event.stopPropagation();
                removeCurrentMenu();
                button.setAttribute('aria-expanded', 'false');
                await handleGitEntryClick(entry, ide);
            },
        }));

        showDropdownMenu(button, wrapper, items);
    }

    function toggleOpenIdeMenu(button, wrapper) {
        removeCurrentTooltip();

        if (currentMenuElement) {
            removeCurrentMenu();

            if (button.getAttribute('aria-expanded') === 'true') {
                button.setAttribute('aria-expanded', 'false');
                return;
            }
        }

        console.log('[Pulse Plus] Открываем меню IDE links');

        const items = uiState.gitEntries.map((entry) => ({
            label: entry.name,
            onClick: async (event) => {
                event.preventDefault();
                event.stopPropagation();
                console.log('[Pulse Plus] Выбрана IDE ссылка:', entry.url);

                if (uiState.ides.length === 1) {
                    removeCurrentMenu();
                    button.setAttribute('aria-expanded', 'false');
                    await handleGitEntryClick(entry, uiState.ides[0]);
                    return;
                }

                showIdeSelectionMenu(button, wrapper, entry);
            },
        }));

        showDropdownMenu(button, wrapper, items);
    }

    function renderOpenIdeButtonContent(button, isLoading) {
        const content = button.querySelector('.v-btn__content');
        if (!content) {
            return;
        }

        let label = content.querySelector(`[${OPEN_IDE_LABEL_ATTR}="true"]`);
        if (!label) {
            content.textContent = '';
            label = document.createElement('span');
            label.setAttribute(OPEN_IDE_LABEL_ATTR, 'true');
            content.appendChild(label);
        }

        label.textContent = 'Открыть в IDE';

        const existingIcon = content.querySelector('.v-icon');
        if (existingIcon) {
            existingIcon.remove();
        }

        const existingSpinner = content.querySelector(`[${OPEN_IDE_SPINNER_ATTR}="true"]`);
        if (isLoading) {
            ensureSpinnerStyles();

            if (!existingSpinner) {
                const spinner = document.createElement('span');
                spinner.setAttribute(OPEN_IDE_SPINNER_ATTR, 'true');
                spinner.setAttribute('aria-hidden', 'true');
                spinner.style.display = 'inline-block';
                spinner.style.width = '14px';
                spinner.style.height = '14px';
                spinner.style.marginLeft = '8px';
                spinner.style.border = '2px solid currentColor';
                spinner.style.borderRightColor = 'transparent';
                spinner.style.borderRadius = '50%';
                spinner.style.animation = 'pulsePlusButtonSpin 0.8s linear infinite';
                content.appendChild(spinner);
            }
        } else if (existingSpinner) {
            existingSpinner.remove();
        }
    }

    function getDisabledTooltip() {
        if (uiState.status === UI_STATE_LOADING) {
            return '';
        }

        if (uiState.status !== UI_STATE_DISABLED) {
            return '';
        }

        if (uiState.disabledReason === DISABLED_REASON_NO_GIT) {
            return 'На проекте нет ссылок на git';
        }

        if (uiState.disabledReason === DISABLED_REASON_IDE_NOT_RUNNING) {
            return 'Нужно запустить IDE, чтобы открыть проект';
        }

        if (uiState.disabledReason === DISABLED_REASON_TRICK_NOT_INSTALLED) {
            return {
                prefix: 'Чтобы открыть проект в IDE нужно установить плагин ',
                linkText: 'Трик',
                linkHref: TRICK_PLUGIN_URL,
            };
        }

        return 'Кнопка недоступна';
    }

    function fillTooltipContent(tooltip, content) {
        tooltip.replaceChildren();

        if (typeof content === 'string') {
            tooltip.textContent = content;
            tooltip.style.pointerEvents = 'none';
            return;
        }

        const prefixNode = document.createTextNode(content?.prefix ?? '');
        tooltip.appendChild(prefixNode);

        if (content?.linkText && content?.linkHref) {
            const link = document.createElement('a');
            link.textContent = content.linkText;
            link.href = content.linkHref;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.color = '#93c5fd';
            link.style.textDecoration = 'underline';
            link.style.pointerEvents = 'auto';
            tooltip.appendChild(link);
        }

        tooltip.style.pointerEvents = 'auto';
    }

    function showDisabledTooltip(wrapper, text) {
        if (!text) {
            removeCurrentTooltip();
            return;
        }

        const wrapperWidth = Math.ceil(wrapper.getBoundingClientRect().width);
        const tooltipWidth = wrapperWidth * 1.5;
        const tooltipGap = 8;
        const bridgeHeight = 14;
        const bridgeWidth = Math.max(tooltipWidth + 32, 96);

        const existingTooltip = wrapper.querySelector(`[${OPEN_IDE_TOOLTIP_ATTR}="true"]`);
        const existingBridge = wrapper.querySelector(`[${OPEN_IDE_TOOLTIP_BRIDGE_ATTR}="true"]`);
        if (existingTooltip) {
            fillTooltipContent(existingTooltip, text);
            existingTooltip.style.width = `${tooltipWidth}px`;
            existingTooltip.style.minWidth = `${tooltipWidth}px`;
            existingTooltip.style.maxWidth = `${tooltipWidth}px`;
            existingTooltip.style.top = `calc(100% + ${tooltipGap}px)`;

            if (existingBridge) {
                existingBridge.style.top = '100%';
                existingBridge.style.left = '50%';
                existingBridge.style.transform = 'translateX(-50%)';
                existingBridge.style.width = `${bridgeWidth}px`;
                existingBridge.style.height = `${tooltipGap + bridgeHeight}px`;
            }

            currentTooltipBridgeElement = existingBridge ?? null;
            currentTooltipElement = existingTooltip;
            return;
        }

        removeCurrentTooltip();

        const bridge = document.createElement('div');
        bridge.setAttribute(OPEN_IDE_TOOLTIP_BRIDGE_ATTR, 'true');
        bridge.style.position = 'absolute';
        bridge.style.top = '100%';
        bridge.style.left = '50%';
        bridge.style.transform = 'translateX(-50%)';
        bridge.style.width = `${bridgeWidth}px`;
        bridge.style.height = `${tooltipGap + bridgeHeight}px`;
        bridge.style.background = 'transparent';
        bridge.style.pointerEvents = 'auto';
        bridge.style.zIndex = '10000';

        const tooltip = document.createElement('div');
        tooltip.setAttribute(OPEN_IDE_TOOLTIP_ATTR, 'true');
        tooltip.style.position = 'absolute';
        tooltip.style.top = `calc(100% + ${tooltipGap}px)`;
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translateX(-50%)';
        tooltip.style.width = `${tooltipWidth}px`;
        tooltip.style.minWidth = `${tooltipWidth}px`;
        tooltip.style.maxWidth = `${tooltipWidth}px`;
        tooltip.style.display = `block`;
        tooltip.style.padding = '8px 10px';
        tooltip.style.background = '#1f2937';
        tooltip.style.color = '#fff';
        tooltip.style.borderRadius = '6px';
        tooltip.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.18)';
        tooltip.style.fontSize = '12px';
        tooltip.style.lineHeight = '1.4';
        tooltip.style.whiteSpace = 'normal';
        tooltip.style.textAlign = 'center';
        tooltip.style.zIndex = '10001';
        fillTooltipContent(tooltip, text);

        wrapper.appendChild(bridge);
        wrapper.appendChild(tooltip);
        currentTooltipBridgeElement = bridge;
        currentTooltipElement = tooltip;
    }

    function applyButtonState(button, wrapper) {
        const isReady = uiState.status === UI_STATE_READY && uiState.gitEntries.length > 0 && uiState.ides.length > 0;
        const isLoading = uiState.status === UI_STATE_LOADING;
        const tooltip = getDisabledTooltip();

        renderOpenIdeButtonContent(button, isLoading);

        button.classList.toggle('v-btn--disabled', !isReady);

        if (isReady) {
            button.removeAttribute('disabled');
            button.removeAttribute('title');
            removeCurrentTooltip();
            button.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleOpenIdeMenu(button, wrapper);
            };
            return;
        }

        button.setAttribute('disabled', 'disabled');
        button.removeAttribute('title');
        button.onclick = null;

        if (tooltip && wrapper.matches(':hover')) {
            showDisabledTooltip(wrapper, tooltip);
            return;
        }

        if (!tooltip) {
            removeCurrentTooltip();
        }
    }

    function createOpenIdeButton(sourceButton) {
        const wrapper = document.createElement('span');
        wrapper.setAttribute(OPEN_IDE_WRAPPER_ATTR, 'true');
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-flex';

        wrapper.addEventListener('mouseenter', () => {
            const tooltip = getDisabledTooltip();
            if (!tooltip) {
                return;
            }

            showDisabledTooltip(wrapper, tooltip);
        });

        wrapper.addEventListener('mouseleave', () => {
            removeCurrentTooltip();
        });

        const button = sourceButton.cloneNode(true);
        button.setAttribute(OPEN_IDE_BUTTON_ATTR, 'true');
        button.setAttribute('title', 'Открыть в IDE');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.removeAttribute('data-cy');
        button.classList.remove('primary--text');
        button.classList.add('text-button', 'primary');
        applyButtonState(button, wrapper);

        wrapper.appendChild(button);
        return wrapper;
    }

    function ensureOpenIdeButton(preparedSourceButton) {
        if (!uiState.taskId || !uiState.mode || !uiState.status) {
            removeOpenIdeUi();
            return;
        }

        const sourceButton = preparedSourceButton ?? getTranslateTaskButton(uiState.mode);
        if (!sourceButton) {
            ensureUiObserver(uiState.mode);
            return;
        }

        disconnectUiObserver();

        const existingWrapper = document.querySelector(`[${OPEN_IDE_WRAPPER_ATTR}="true"]`);
        if (existingWrapper) {
            const existingButton = existingWrapper.querySelector(`[${OPEN_IDE_BUTTON_ATTR}="true"]`);
            if (existingButton) {
                applyButtonState(existingButton, existingWrapper);
            }
            return;
        }

        const wrapper = createOpenIdeButton(sourceButton);
        sourceButton.insertAdjacentElement('afterend', wrapper);
        console.log('[Pulse Plus] Кнопка "Открыть в IDE" добавлена');
    }

    async function fetchProjectIdByTask(taskId, requestToken) {
        const taskResponse = await executePageRequest({
            tasks: [
                {
                    objectName: 'Задачи',
                    methodName: 'получить',
                    params: {
                        номерЗаписи: taskId,
                    },
                },
            ],
        });

        if (requestToken !== currentRequestToken) {
            return null;
        }

        const taskResult = getFirstTaskResult(taskResponse);
        const projectId = normalizeRecordId(getFieldValue(taskResult, TASK_PROJECT_FIELD_NAME));

        if (!projectId) {
            console.warn('[Pulse Plus] Не найдено поле "карточка-проект" для задачи:', taskId, taskResult);
            return null;
        }

        return projectId;
    }

    async function fetchProjectGitEntries(projectId, requestToken) {
        console.log('[Pulse Plus] projectId:', projectId);

        const projectResponse = await executePageRequest({
            tasks: [
                {
                    objectName: 'Проекты',
                    methodName: 'получить',
                    params: {
                        номерЗаписи: projectId,
                    },
                },
            ],
        });

        if (requestToken !== currentRequestToken) {
            return null;
        }

        const projectResult = getFirstTaskResult(projectResponse);
        const gitRawValue = getFieldValue(projectResult, PROJECT_GIT_FIELD_NAME);

        if (typeof gitRawValue !== 'string' || !gitRawValue.trim()) {
            console.warn('[Pulse Plus] Поле "git" отсутствует или пустое для проекта:', projectId, projectResult);
            return [];
        }

        let parsedGit;

        try {
            parsedGit = JSON.parse(gitRawValue);
        } catch (error) {
            console.warn('[Pulse Plus] Не удалось распарсить поле "git" для проекта:', projectId, error);
            return [];
        }

        if (!Array.isArray(parsedGit)) {
            console.warn('[Pulse Plus] Поле "git" не является массивом для проекта:', projectId, parsedGit);
            return [];
        }

        console.log('[Pulse Plus] project git:', parsedGit);
        return normalizeGitEntries(parsedGit);
    }

    async function fetchTaskProjectGit(taskContext, requestToken) {
        const { mode, taskId } = taskContext;
        let projectId = taskContext.projectId;

        console.log('[Pulse Plus] Обрабатываем задачу:', taskContext);

        if (mode === 'ropened') {
            projectId = await fetchProjectIdByTask(taskId, requestToken);
            if (!projectId) {
                updateDisabledUiState(mode, taskId, DISABLED_REASON_UNKNOWN, []);
                return;
            }
        }

        const gitEntries = await fetchProjectGitEntries(projectId, requestToken);
        if (requestToken !== currentRequestToken) {
            return;
        }

        const hasGitEntries = gitEntries.length > 0;
        console.log('[Pulse Plus] Проверка 1/3: есть ли ссылки на git:', hasGitEntries);

        if (!hasGitEntries) {
            updateDisabledUiState(mode, taskId, DISABLED_REASON_NO_GIT, []);
            return;
        }

        const ideDiscovery = await discoverIdePluginServer();
        if (requestToken !== currentRequestToken) {
            return;
        }

        const isPluginApiRunning = Boolean(ideDiscovery);
        console.log('[Pulse Plus] Проверка 2/3: запущен ли API плагина:', isPluginApiRunning);

        const runningIdeDiscovery = await discoverRunningIdeServer();
        if (requestToken !== currentRequestToken) {
            return;
        }

        const isIdeRunning = Boolean(runningIdeDiscovery);
        console.log('[Pulse Plus] Проверка 3/3: запущена ли сама IDE:', isIdeRunning);

        if (!ideDiscovery) {
            const disabledReason = runningIdeDiscovery
                ? DISABLED_REASON_TRICK_NOT_INSTALLED
                : DISABLED_REASON_IDE_NOT_RUNNING;

            updateDisabledUiState(mode, taskId, disabledReason, gitEntries);
            return;
        }

        const ides = normalizeIdeEntries(ideDiscovery.servers);
        if (ides.length === 0) {
            const disabledReason = runningIdeDiscovery
                ? DISABLED_REASON_TRICK_NOT_INSTALLED
                : DISABLED_REASON_IDE_NOT_RUNNING;

            updateDisabledUiState(mode, taskId, disabledReason, gitEntries);
            return;
        }

        console.log('[Pulse Plus] Обнаруженные IDE:', ides);
        updateUiState(mode, taskId, gitEntries, ides);
    }

    function handleUrlChange() {
        const taskContext = extractTaskContextFromUrl(window.location.href);

        if (!taskContext) {
            lastProcessedRouteKey = null;
            currentRequestToken += 1;
            resetUiState();
            return;
        }

        if (taskContext.routeKey === lastProcessedRouteKey) {
            return;
        }

        lastProcessedRouteKey = taskContext.routeKey;
        currentRequestToken += 1;
        const requestToken = currentRequestToken;
        startLoadingUiState(taskContext.mode, taskContext.taskId);

        fetchTaskProjectGit(taskContext, requestToken)
            .catch((error) => {
                console.error('[Pulse Plus] Ошибка при обработке страницы задачи:', error);
                if (requestToken === currentRequestToken) {
                    resetUiState();
                }
            });
    }

    function patchHistoryMethod(methodName) {
        const originalMethod = window.history[methodName];

        window.history[methodName] = function () {
            const result = originalMethod.apply(this, arguments);
            queueMicrotask(handleUrlChange);
            return result;
        };
    }

    patchHistoryMethod('pushState');
    patchHistoryMethod('replaceState');
    window.addEventListener('popstate', handleUrlChange);
    handleUrlChange();
})();
