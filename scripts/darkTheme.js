(() => {
    if (document.readyState === 'complete') {
        _();
    } else {
        window.addEventListener('load', _);
    }

    function _ () {
        /**
         * Функция для добавления нового элемента в блок сразу после его появления на странице.
         */
        function addThemeBtn(newElementHTML) {
            let selector = 'header'

            const svg = '<svg id="_Слой_1" class="v-icon__svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10,10-4.48,10-10S17.52,2,12,2Zm0,16.98c-3.85,0-6.98-3.12-6.98-6.98s3.12-6.98,6.98-6.98,6.98,3.12,6.98,6.98-3.12,6.98-6.98,6.98Z"/><path d="M12,6.04v11.93c3.29,0,5.96-2.67,5.96-5.96s-2.67-5.96-5.96-5.96Z"/></svg>';

            // Настраиваем наблюдатель
            const observer = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        // Проверяем все добавленные узлы
                        mutation.addedNodes.forEach(node => {
                            try {
                                if (node.nodeType === 1 && node.matches(selector)) {

                                    // Блок найден, добавляем новый элемент
                                    const referenceNode = [...document.querySelectorAll('header .v-toolbar__content > div > div > div:last-of-type')[0].querySelectorAll('.row > div')].at(-3)

                                    const btn = document.querySelectorAll('header .v-toolbar__content > div > div > div:last-of-type')[0].querySelector('.row > div').cloneNode(true);

                                    btn.querySelector('.v-icon').innerHTML = svg
                                    btn.querySelector('button').title = 'Сменить тему оформления'

                                    btn.querySelector('button').addEventListener('click', themeChange)

                                    referenceNode.parentNode.insertBefore(btn, referenceNode.nextSibling);

                                    // Останавливаем наблюдение, если блок добавлен
                                    observer.disconnect();
                                }
                            }catch (e) {

                            }
                        });
                    }
                }
            });

            // Запускаем наблюдатель
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        function themeChange() {
            if (theme === 'light') {
                theme = 'dark';
                localStorage.setItem('PulsePlus_Theme', theme);
            } else {
                theme = 'light';
                localStorage.setItem('PulsePlus_Theme', theme);
            }
            themeSet()
        }

        function themeSet() {
            if (theme === 'light') {
                document.body.classList.toggle('pulse-fixed-dark-theme', false)
            } else {
                document.body.classList.toggle('pulse-fixed-dark-theme', true)
            }
        }

        let theme = localStorage.getItem('PulsePlus_Theme');

        if (!theme) {
            theme = 'light'
        }

        getPulseSettings()
            .then((settings) => {
                if (!!settings.changeTheme) {
                    addThemeBtn()
                    themeSet()
                }
            })
    }
})()