(() => {
    const _parse = JSON.parse;
    const _stringify = JSON.stringify;

    getPulseSettings()
        .then((settings) => {
            let customParse = function (arg) {
                let parsed = _parse(arg);

                if (settings.advancedSettings) {
                    // Выдача глобальных прав права
                    if (parsed.data && parsed.data.authentication && parsed.data.authentication.frontendPermissionsForActiveUser) {
                        parsed.data.authentication.frontendPermissionsForActiveUser.map((perm) => {
                            if (settings.perPulse) {
                                perm.option = "ALLOWED";
                            } else {
                                // Права на редактирование проекта
                                if (settings.perProject && perm.name === 'pulse/projects/:id') {
                                    perm.option = "ALLOWED";
                                }
                                // Права на ретроспективу сотрудников
                                if (perm.name === 'pulse/analytics/retrospective/employees.*') {
                                    perm.option = "ALLOWED";
                                }
                            }
                            return perm
                        });
                    }

                    // Дает права на проекте
                    if (settings.perProject && parsed.tasks && parsed.tasks[0] && parsed.tasks[0].result && parsed.tasks[0].result['поля'] && parsed.tasks[0].result['поля'].indexOf('праваредактирование') === 33) {
                        // const index = parsed.tasks[0].result['поля'].indexOf('праваредактирование') > 0;
                        parsed.tasks[0].result['записи'][0][33] = 1;
                    }

                    // Показывать все поля в задачах
                    if (settings.perTask && parsed.tasks && parsed.tasks[0] && parsed.tasks[0].result && parsed.tasks[0].result['поля'] && parsed.tasks[0].result['поля'].indexOf('показывать') >= 0) {
                        const indRead = parsed.tasks[0].result['поля'].indexOf('показывать');
                        const indWrite = parsed.tasks[0].result['поля'].indexOf('редактировать');

                        parsed.tasks[0].result['записи'].map((task) => {
                            if (task[12] !== 'Период выполнения работы') {
                                task[indRead] = 1;
                                task[indWrite] = 1;
                            }
                            return task
                        });
                    }

                    // Отредактировать даты отпуска
                    if (parsed.tasks && parsed.tasks[0] && parsed.tasks[0].result === 2) {
                        parsed.tasks[0].result = 1;
                    }
                }

                // Ловим уведомления и показываем push
                if (settings.pushNotificationsEnabled && !!parsed.id && parsed.payload && parsed.payload.data && parsed.payload.data.userMessages && parsed.payload.data.userMessages.messages) {
                    for (const message of parsed.payload.data.userMessages.messages) {
                        try {
                            showLocalNotification(message.payload.id, message.payload);
                        } catch (err) {
                            console.error(`Не удалось показать уведомление`);
                        }
                    }
                }

                return parsed;
            };
            let customStringify = function (arg, replacer, space) {

                // Получить ретроспективу по другому сотруднику.
                // P.S. в фильтрах все равно будет отображаться авторизованный пользователь, но данные будут по указанному
                // const userId = 1730;
                // const enable = false;
                //
                // if (arg?.tasks?.[0]?.objectName === 'Ретроспектива.Сотрудники' && enable) {
                //     // if (arg?.tasks?.[0]?.methodName == 'ПолучитьПраваНаРетроспективу') {
                //     //     arg.tasks[0].params['сотрудник'] = 180
                //     // }
                //
                //     if (arg?.tasks?.[0]?.methodName === 'ПолучитьЭффективность') {
                //         let tmp = _parse(arg.tasks[0].params['фильтр']['сотрудник'])
                //         tmp.value = userId
                //         arg.tasks[0].params['фильтр']['сотрудник'] = _stringify(tmp)
                //     }
                //
                //     if (arg?.tasks?.[0]?.methodName === 'ПолучитьТрудозатраты') {
                //         let tmp = _parse(arg.tasks[0].params['фильтр']['сотрудник'])
                //         tmp.value = userId
                //         arg.tasks[0].params['фильтр']['сотрудник'] = _stringify(tmp)
                //     }
                //
                //     if (arg?.tasks?.[0]?.methodName === '"ПолучитьАналитикуПоТрекерам"') {
                //         let tmp = _parse(arg.tasks[0].params['фильтр']['сотрудник'])
                //         tmp.value = userId
                //         arg.tasks[0].params['фильтр']['сотрудник'] = _stringify(tmp)
                //     }
                // }

                return _stringify(arg, replacer, space);
            };

            JSON.parse = customParse;
            JSON.stringify = customStringify;

        })
        .catch((err) => {
            console.error('Не удалось получить настройки:', err);
        });
})()
