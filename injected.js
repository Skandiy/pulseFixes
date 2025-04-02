(function () {
    const _parse = JSON.parse;

    let customParse = function (arg) {
        let parsed = _parse(arg);

        // Выдача глобальных прав права
        if (parsed.data && parsed.data.authentication && parsed.data.authentication.frontendPermissionsForActiveUser) {
            console.log("PULSE FIXES")
            parsed.data.authentication.frontendPermissionsForActiveUser.map((perm) => {
                console.log(perm)
                // Права на редактирование проекта
                if (perm.name == 'pulse/projects/:id') {
                    perm.option = "ALLOWED";
                }
                // Права на ретроспективу сотрудников
                if (perm.name == 'pulse/analytics/retrospective/employees.*') {
                    perm.option = "ALLOWED";
                }
                console.log(perm)
                return perm
            });
        }

        // Дает права на проекте
        if (parsed.tasks && parsed.tasks[0] && parsed.tasks[0].result && parsed.tasks[0].result['поля'] && parsed.tasks[0].result['поля'].indexOf('праваредактирование') == 33) {
            // const index = parsed.tasks[0].result['поля'].indexOf('праваредактирование') > 0;
            parsed.tasks[0].result['записи'][0][33] = 1;
        }

        // Показывать все поля в задачах
        if (parsed.tasks && parsed.tasks[0] && parsed.tasks[0].result && parsed.tasks[0].result['поля'] && parsed.tasks[0].result['поля'].indexOf('показывать') >= 0) {
            const indRead = parsed.tasks[0].result['поля'].indexOf('показывать');
            const indWrite = parsed.tasks[0].result['поля'].indexOf('редактировать');

            parsed.tasks[0].result['записи'].map((task) => {
                task[indRead] = 1;
                task[indWrite] = 1;
                return task
            });
        }

        return parsed;
    };

    JSON.parse = customParse;

    // Свой календарь
    window.addEventListener('load', function () {
        const _ = () => {
            document.querySelectorAll('.day-btn').forEach(elem => {
                elem.parentElement.parentElement.parentElement.parentElement.querySelectorAll('.d-flex div').forEach(elem => {
                    elem.classList.remove('ml-4')
                })

                // строка недели
                elem.parentElement.parentElement.classList.remove('mt-2')

                // элемент дня
                elem.parentElement.style.height = '34px'
                elem.parentElement.classList.remove('ml-4')
                elem.parentElement.style.display = 'flex'
                elem.parentElement.style.justifyContent = 'center'

                // кнопка дня
                elem.style.width = '30px'
                elem.style.height = '30px'
                elem.style.margin = '2px 0 0 0'
                elem.style.display = 'flex'
                elem.style.justifyContent = 'center'

                const pointWrapper = elem.querySelector('div')
                const point = pointWrapper.querySelector('div')

                pointWrapper.style.bottom = '-2px';
                if (elem.classList.contains('primary')) {
                    pointWrapper.style.right = '-2px';
                }

                if (point) {
                    point.style.background = 'var(--v-primary-lighten2)';
                    point.style.width = '12px';
                    point.style.height = '12px';
                    point.style.border = '2px solid #fff';
                    point.style.marginRight = '0';
                }
            })
        }

        const mutationObserver = new MutationObserver(function(mutations) {
            mutations.forEach(mutation => {
                if (mutation.target.classList.contains('fill-background')) {
                    _()
                }
            })

            if (mutations.length == 70 || mutations.length == 71) {
                _()
            }
        });

        // Функция, которая выполняется, когда элемент найден
        function runWhenElementAppears() {
            _()

            // Запускаем наблюдение за изменениями в корневом HTML-элементе страницы
            mutationObserver.observe(document.querySelector('.stack-calendar'), {
                attributes: true,
                childList: true,
                subtree: true,
            });
        }

        // Настраиваем MutationObserver для отслеживания изменений в DOM
        const observer = new MutationObserver((mutationsList) => {
            for (let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    // Находим все элементы с классом 'stack-calendar'
                    const elements = document.querySelectorAll('.stack-calendar');
                    elements.forEach((element) => {
                        // Проверяем, был ли элемент уже обработан
                        if (!element.hasAttribute('data-observed')) {
                            element.setAttribute('data-observed', 'true'); // Помечаем элемент как обработанный
                            runWhenElementAppears();
                        }
                    });
                }
            }
        });

        // Начинаем наблюдение за добавлением элементов в DOM
        observer.observe(document.body, { childList: true, subtree: true });



        // Функция для замены классов и стилей на странице
        function init() {
            replaceThemeClass();
            replaceThemeClass2();
            replaceWhiteStyle();
            replaceStyleFilter();
            styleModal();
            commentStyle();
            imageClose();
            // главный фон
            document.querySelector('.stack-app').style.setProperty('background-color', '#1e1e1e', 'important');

            document.documentElement.style.setProperty('--v-base-1-base', '#1e1e1e', 'important'); // #ffffff
            document.documentElement.style.setProperty('--v-base-2-base', '#313132', 'important'); // #f6f7f9
            document.documentElement.style.setProperty('--v-base-3-base', '#4c4d4f', 'important'); // #f3f5f9
            document.documentElement.style.setProperty('--v-base-4-base', '#121212', 'important'); // #ebeff5

            // скролл
            document.documentElement.style.setProperty('--v-base-5-base', '#7f8288', 'important'); // #dce2ea
            document.documentElement.style.setProperty('--v-base-9-base', '#2e3a47', 'important'); // #687a93

            document.documentElement.style.setProperty('--v-ty-secondary-base', '#a0a9b9', 'important'); // #525e74
            document.documentElement.style.setProperty('--v-ty-caption-base', '#a0a9b9', 'important'); // #8a92a0
            document.documentElement.style.setProperty('--v-ty-primary-base', '#e0e0e0', 'important'); // #030724
            document.querySelector('.app-toolbar').style.setProperty('box-shadow', '0 0 32px #494b4f3d', 'important'); // 0 0 32px #687a933d
        }

        function replaceThemeClass() {
            // повторить для уведомлений
            document.querySelectorAll('.theme--light').forEach(el => {
                el.classList.replace('theme--light', 'theme--dark');
            })
        }

        function replaceThemeClass2() {
            document.querySelectorAll('.base-4').forEach(el => {
                el.classList.replace('base-4', 'base-3');
            })
        }

        function replaceWhiteStyle() {
            // повторить для уведомлений
            document.querySelectorAll('.white').forEach(el => {
                // el.classList.remove('white')
                el.style.setProperty('background-color', '#1e1e1e', 'important');
            })
        }

        function replaceStyleFilter() {
            // повторить для уведомлений
            document.querySelectorAll('.base-1--text').forEach(el => {
                // el.classList.remove('white')
                el.style.setProperty('color', '#e0e0e0', 'important');
                el.style.setProperty('caret-color', '#e0e0e0', 'important');
            })
        }

        function styleModal() {
            document.querySelectorAll('.v-overlay__scrim').forEach(el => {
                el.style.setProperty('background-color', 'rgb(67, 67, 67)', 'important')
            })
        }

        function imageClose() {
            const v = document.querySelectorAll('.stack-image-viewer')[0]
            if (v)
                v.addEventListener('click', () => {
                    v.querySelector('button').click();
                })
        }

        function commentStyle() {
            // комментарий
            document.querySelectorAll('.StackMarkdown .editor-preview').forEach(el => {
                el.style.setProperty('background-color', '#1e1e1e', 'important');
            })
            document.querySelectorAll('.StackMarkdown .CodeMirror').forEach(el => {
                el.style.setProperty('background', '#1e1e1e', 'important');
                el.style.setProperty('color', '#9e9e9e', 'important');
            })
            document.querySelectorAll('.StackMarkdown .editor-preview').forEach(el => {
                el.style.setProperty('background', '#1e1e1e', 'important');
            })
            document.querySelectorAll('.StackMarkdown .editor-preview pre').forEach(el => {
                el.style.setProperty('background', '#313132', 'important');
            })
            document.querySelectorAll('.StackMarkdown .cm-s-easymde .cm-comment').forEach(el => {
                el.style.setProperty('background', '#ffffff1f', 'important');
            })
        }

        function initThemeApp() {
            // Настраиваем наблюдатель для отслеживания добавления новых элементов
            const observer2 = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) { // Проверка, что это элемент, а не текстовый узел
                                try {
                                    init();
                                } catch (e) {
                                    console.log(e)
                                }
                            }
                        });
                    }

                    // Отслеживаем изменения классов у существующих элементов
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const target = mutation.target;

                        // Заменяем "theme--light" на "theme--dark"
                        if (target.classList.contains('theme--light')) {
                            target.classList.replace('theme--light', 'theme--dark');
                        }

                        // Устанавливаем background-color для "white"
                        if (target.classList.contains('white')) {
                            target.style.setProperty('background-color', '#1e1e1e', 'important');
                        }
                    }
                }
            });

            // Запускаем наблюдатель
            observer2.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });

            init()
        }

        /**
         * Функция для добавления нового элемента в блок сразу после его появления на странице.
         */
        function addThemeBtn(newElementHTML) {

            // let selector = document.querySelectorAll('header .v-toolbar__content > div > div > div:last-of-type')[0]
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

        let theme = localStorage.getItem('PulsePlus_Theme');

        if (!theme) {
            theme = 'light'
        }

        addThemeBtn()

        function themeChange() {
            if (theme === 'light') {
                theme = 'dark';
                localStorage.setItem('PulsePlus_Theme', theme);
                initThemeApp()
            } else {
                theme = 'light';
                localStorage.setItem('PulsePlus_Theme', theme);
                window.location.reload()
            }
        }

        if (theme === 'dark') {
            initThemeApp()
        }
    })
})();