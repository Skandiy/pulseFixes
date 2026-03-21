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
        syncCalendarButton: document.getElementById('syncCalendar'),
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
}

export function applyCheckboxValues(checkboxes, values) {
    checkboxes.forEach((checkbox) => {
        if (Object.prototype.hasOwnProperty.call(values, checkbox.id)) {
            checkbox.checked = Boolean(values[checkbox.id]);
        }
    });
}
