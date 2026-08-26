(() => {
    const THEME_STORAGE_KEY = 'trickPlus.theme';
    const DASHBOARD_SET_PROPERTY_PATCHED = '__trickPlusDashboardSetPropertyPatched';

    function isSettingEnabled(settings, key) {
        return settings?.[key] !== false;
    }

    function patchDashboardStyleSetProperty() {
        const styleProto = CSSStyleDeclaration.prototype;
        if (styleProto[DASHBOARD_SET_PROPERTY_PATCHED]) {
            return;
        }

        const origSetProperty = styleProto.setProperty;
        Object.defineProperty(styleProto, DASHBOARD_SET_PROPERTY_PATCHED, {
            value: true,
            configurable: true
        });

        styleProto.setProperty = function(name, value, priority) {
            if (name === '--stack-dashboard_h') {
                if (this.cssText == '--stack-dashboard_y: 7; --stack-dashboard_h: 13; --stack-dashboard_x: 10; --stack-dashboard_w: 3; --stack-dashboard_min-w: 441.5px; --stack-dashboard_min-h: 613px;') {
                    value = '11';
                }

                if (this.cssText == '--stack-dashboard_y: 7; --stack-dashboard_h: 11; --stack-dashboard_x: 10; --stack-dashboard_w: 3; --stack-dashboard_min-w: 441.5px; --stack-dashboard_min-h: 613px;') {
                    value = '11';
                }
            }

            return origSetProperty.call(this, name, value, priority);
        };
    }

    if (document.readyState === 'complete') {
        _();
    } else {
        window.addEventListener('load', _);
    }

    function _ () {
        function registerHeaderButton(definition) {
            if (window.TrickPlusHeaderButtons) {
                window.TrickPlusHeaderButtons.register(definition);
                return;
            }

            window.addEventListener('TrickPlusHeaderButtonsReady', () => {
                window.TrickPlusHeaderButtons?.register(definition);
            }, { once: true });
        }

        function addThemeBtn() {
            const svg = '<svg id="_Слой_1" class="v-icon__svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12,2C6.48,2,2,6.48,2,12s4.48,10,10,10,10-4.48,10-10S17.52,2,12,2Zm0,16.98c-3.85,0-6.98-3.12-6.98-6.98s3.12-6.98,6.98-6.98,6.98,3.12,6.98,6.98-3.12,6.98-6.98,6.98Z"/><path d="M12,6.04v11.93c3.29,0,5.96-2.67,5.96-5.96s-2.67-5.96-5.96-5.96Z"/></svg>';

            registerHeaderButton({
                id: 'theme',
                title: 'Сменить тему оформления',
                icon: svg,
                placement: 'before-user-menu-previous',
                onClick: themeChange
            });
        }

        function themeChange() {
            if (theme === 'light') {
                theme = 'dark';
                localStorage.setItem(THEME_STORAGE_KEY, theme);
            } else {
                theme = 'light';
                localStorage.setItem(THEME_STORAGE_KEY, theme);
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

        let theme = localStorage.getItem(THEME_STORAGE_KEY);

        if (!theme) {
            theme = 'light'
        }

        getPulseSettings()
            .then((settings) => {
                if (isSettingEnabled(settings, 'diagnosticCssSetPropertyPatch')) {
                    patchDashboardStyleSetProperty();
                }

                if (!!settings.changeTheme) {
                    addThemeBtn()
                    themeSet()
                }
            })
    }
})()
