(() => {
    const CHAT_TAB_STORAGE_KEY = 'trickPlus.chat.tab';
    const CHAT_WIDTH_STORAGE_KEY = 'trickPlus.chat.width';
    const CHAT_OPENED_STORAGE_KEY = 'trickPlus.chat.opened';
    const CHAT_LEFT_SIDE_STORAGE_KEY = 'trickPlus.chat.leftSide';

    // === Источники ===
    const TABS = {
        chat: "https://chat.sk-serv.ru/stack/",
        hippo: "https://hippo.stack-it.ru/",
    };

    let activeTab = TABS[localStorage.getItem(CHAT_TAB_STORAGE_KEY)] ? localStorage.getItem(CHAT_TAB_STORAGE_KEY) : 'chat';

    // Оба фрейма грузятся сразу, чтобы при первом переключении контент был уже готов
    const iframeChat = document.createElement('iframe');
    iframeChat.src = TABS.chat;

    const iframeHippo = document.createElement('iframe');
    iframeHippo.src = TABS.hippo;

    const iframes = { chat: iframeChat, hippo: iframeHippo };

    const div = document.createElement('div');
    div.id = 'pulseFixesChat';
    div.style.maxWidth = "1800px"; // максимальная
    div.style.minWidth = "400px"; // минимальная
    div.style.width = (localStorage.getItem(CHAT_WIDTH_STORAGE_KEY) || 500) + "px";
    div.style.transform = "translateX("+div.style.width+")";
    div.append(iframeChat, iframeHippo);

    // Хэндл для ресайза — по сути сам бордер
    const resizerHover = document.createElement("div");
    resizerHover.id = "pulseFixesChat-resizerHover";
    div.append(resizerHover);

    const resizer = document.createElement("div");
    resizer.id = "pulseFixesChat-resizer";
    resizerHover.append(resizer);

    const reboundWrapper = document.createElement("div");
    reboundWrapper.id = "pulseFixesChat-reboundWrapper";
    resizerHover.append(reboundWrapper);

    const rebound = document.createElement("div");
    rebound.id = "pulseFixesChat-rebound";
    rebound.innerHTML = "/<br />\\";
    reboundWrapper.append(rebound);

    // === Переключатель фреймов — встроен в полосу ресайза, проявляется при наведении ===
    const switcher = document.createElement('div');
    switcher.id = 'pulseFixesChat-switcher';

    const switcherButtons = {};
    for (const tab of Object.keys(TABS)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.tab = tab;
        button.textContent = tab === 'chat' ? 'MatterMost' : 'Hippo';
        button.addEventListener('click', () => switchTab(tab));
        switcher.append(button);
        switcherButtons[tab] = button;
    }
    resizerHover.append(switcher);

    document.querySelector('body').append(div);

    // === Переключатель встаёт напротив курсора при входе на полосу, огибая центральную «стрелочку» ===
    const REBOUND_HALF = 48; // половина недоступной зоны вокруг центра (блок со стрелочкой)
    function positionSwitcher(clientY) {
        const rect = resizerHover.getBoundingClientRect();
        const stripHeight = rect.height;
        const center = stripHeight / 2;
        const swH = switcher.offsetHeight;
        const cursorRel = clientY - rect.top;

        let top = cursorRel - swH / 2; // центрируем на курсоре
        // не заходим в центральную зону: остаёмся в той половине, где курсор
        if (cursorRel < center) {
            top = Math.min(top, center - REBOUND_HALF - swH);
        } else {
            top = Math.max(top, center + REBOUND_HALF);
        }
        top = Math.max(0, Math.min(top, stripHeight - swH));
        switcher.style.top = top + "px";
    }
    // Позиция задаётся один раз при входе курсора на полосу; пока курсор над полосой
    // или её дочерними элементами (включая сам переключатель) — блок не перемещается
    resizerHover.addEventListener("mouseenter", (e) => {
        positionSwitcher(e.clientY);
    });

    // === resize logic ===
    let isResizing = false;
    let opened = localStorage.getItem(CHAT_OPENED_STORAGE_KEY) === '1';
    let currentSize = div.style.width.replace(/\D/g, '');
    let timeout = null;
    let leftSide = localStorage.getItem(CHAT_LEFT_SIDE_STORAGE_KEY) === '1';

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;
        document.body.style.userSelect = "none";
        div.classList.add('pulseFixesChatResizing');
        document.body.style.pointerEvents = "none";
        if (leftSide) {
            rebound.setAttribute('style', 'right: 20px !important');
        } else {
            rebound.setAttribute('style', 'left: 20px !important');
        }
        document.addEventListener("mousemove", moving);
    });

    rebound.addEventListener("click", (e) => {
        e.preventDefault();
        if (opened) {
            toggleLeftSide(!leftSide);
        } else {
            toggleChat()
        }
    });

    const moving = (e) => {
        if (!isResizing) return;

        let newWidth;

        if (leftSide) {
            newWidth = e.clientX;
        } else {
            newWidth = window.innerWidth - e.clientX;
        }

        if (
            newWidth >= parseInt(div.style.minWidth) &&
            newWidth <= parseInt(div.style.maxWidth)
        ) {
            div.style.width = newWidth + "px";
        }
    }

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.userSelect = "";
            currentSize = div.style.width.replace(/\D/g, '')
            localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, currentSize)
            div.classList.remove('pulseFixesChatResizing');
            document.body.style.pointerEvents = "auto";
            rebound.removeAttribute('style');
            document.removeEventListener("mousemove", moving);
        }
    });

    // === ResizeObserver для отслеживания изменений размера div ===
    // const resizeObserver = new ResizeObserver(entries => {
    //     for (const entry of entries) {
    //         const { width } = entry.contentRect;
    //     }
    // });
    // resizeObserver.observe(div);

    const svg = '<svg aria-hidden="true" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" class="v-icon__svg"><path d="M20,2A2,2 0 0,1 22,4V16A2,2 0 0,1 20,18H6L2,22V4C2,2.89 2.9,2 4,2H20M4,4V17.17L5.17,16H20V4H4M6,7H18V9H6V7M6,11H15V13H6V11Z"></path></svg>'

    function registerHeaderButton(definition) {
        if (window.TrickPlusHeaderButtons) {
            window.TrickPlusHeaderButtons.register(definition);
            return;
        }

        window.addEventListener('TrickPlusHeaderButtonsReady', () => {
            window.TrickPlusHeaderButtons?.register(definition);
        }, { once: true });
    }

    function addChatBtn() {
        registerHeaderButton({
            id: 'chat',
            title: 'Открыть чат',
            icon: svg,
            wrapperClass: 'ml-4',
            placement: 'append',
            onClick: toggleChat
        });
    }

    function switchTab(tab) {
        if (!TABS[tab]) return;

        activeTab = tab;
        localStorage.setItem(CHAT_TAB_STORAGE_KEY, tab);

        // Оба фрейма всегда на странице — переключение через прозрачность (кроссфейд)
        for (const key of Object.keys(iframes)) {
            iframes[key].classList.toggle('active', key === tab);
            switcherButtons[key].classList.toggle('active', key === tab);
        }
    }

    function toggleChat() {
        clearTimeout(timeout);
        if (opened) {
            div.style.transition = "transform 0.25s";
            div.style.transform = "translateX("+ (leftSide ? "-" : "") + currentSize+"px)";
            timeout = setTimeout(() => {
                div.style.transition = "transform  0s";
            }, 250);
            div.classList.remove('pulseFixesChatOpened')
        } else {
            div.style.transition = "transform  0.25s";
            div.style.transform = "translateX(0px)";
            timeout = setTimeout(() => {
                div.style.transition = "transform  0s";
            }, 250);
            div.classList.add('pulseFixesChatOpened')
        }
        opened = !opened;
        localStorage.setItem(CHAT_OPENED_STORAGE_KEY, opened ? '1' : '0')
    }

    function toggleLeftSide(val = false) {
        div.classList.toggle('leftSide', val);
        leftSide = val
        localStorage.setItem(CHAT_LEFT_SIDE_STORAGE_KEY, val ? '1' : '0')
    }

    addChatBtn();
    switchTab(activeTab)
    opened = !opened
    toggleChat()
    toggleLeftSide(leftSide)
})()
