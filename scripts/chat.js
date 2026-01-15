(() => {
    const iframe = document.createElement('iframe');
    iframe.src = "https://chat.sk-serv.ru:9443/stack/";

    const div = document.createElement('div');
    div.id = 'pulseFixesChat';
    div.style.maxWidth = "1800px"; // максимальная
    div.style.minWidth = "400px"; // минимальная
    div.style.width = (localStorage.getItem('PULSE_FIXES_CHAT_WIDTH') || 500) + "px";
    div.style.transform = "translateX("+div.style.width+")";
    div.append(iframe);

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

    document.querySelector('body').append(div);

    // === resize logic ===
    let isResizing = false;
    let opened = localStorage.getItem('PULSE_FIXES_CHAT_OPENED') === '1';
    let currentSize = div.style.width.replace(/\D/g, '');
    let timeout = null;
    let leftSide = localStorage.getItem('PULSE_FIXES_CHAT_LEFTSIDE') === '1';

    resizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isResizing = true;
        document.body.style.userSelect = "none";
        iframe.style.pointerEvents = "none";
        iframe.style.display = "none";
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
            localStorage.setItem('PULSE_FIXES_CHAT_WIDTH', currentSize)
            iframe.style.pointerEvents = "auto";
            iframe.style.display = "block";
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

    // Настраиваем наблюдатель
    const observer = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                // Проверяем все добавленные узлы
                mutation.addedNodes.forEach(node => {
                    try {
                        if (node.nodeType === 1 && node.matches('header')) {

                            // Блок найден, добавляем новый элемент
                            const referenceNode = [...document.querySelectorAll('header .v-toolbar__content > div > div > div:last-of-type')[0].querySelectorAll('.row > div')].at(-1)

                            const btn = document.querySelectorAll('header .v-toolbar__content > div > div > div:last-of-type')[0].querySelector('.row > div').cloneNode(true);

                            btn.querySelector('.v-icon').innerHTML = svg
                            btn.querySelector('button').title = 'Открыть чат'
                            btn.classList.add('ml-4')

                            btn.querySelector('button').addEventListener('click', toggleChat)

                            referenceNode.parentNode.append(btn);

                            // Останавливаем наблюдение, если блок добавлен
                            observer.disconnect();
                        }
                    }catch (e) {

                    }
                });
            }
        }
    });

    function toggleChat() {
        clearTimeout(timeout);
        if (opened) {
            div.style.transition = "transform 0.25s";
            div.style.transform = "translateX("+ (leftSide ? "-" : "") + currentSize+"px)";
            timeout = setTimeout(() => {
                div.style.transition = "transform  0s";
                iframe.style.display = "none";
            }, 250);
            div.classList.remove('pulseFixesChatOpened')
        } else {
            iframe.style.display = "block";
            div.style.transition = "transform  0.25s";
            div.style.transform = "translateX(0px)";
            timeout = setTimeout(() => {
                div.style.transition = "transform  0s";
            }, 250);
            div.classList.add('pulseFixesChatOpened')
        }
        opened = !opened;
        localStorage.setItem('PULSE_FIXES_CHAT_OPENED', opened ? '1' : '0')
    }

    function toggleLeftSide(val = false) {
        div.classList.toggle('leftSide', val);
        leftSide = val
        localStorage.setItem('PULSE_FIXES_CHAT_LEFTSIDE', val ? '1' : '0')
    }

    // Запускаем наблюдатель
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    opened = !opened
    toggleChat()
    toggleLeftSide(leftSide)
})()