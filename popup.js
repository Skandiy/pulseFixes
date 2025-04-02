const load = function () {
    const perProject = document.querySelector("#perProject");
    const perPulse = document.querySelector("#perPulse");
    /*  */
    perProject.addEventListener("click", function () {
        console.log('perProject')
        chrome.storage.local.set({perProject: perProject.checked})
    });
    perPulse.addEventListener("click", function () {
        console.log('perPulse')
        chrome.storage.local.set({perPulse: perProject.checked})
    });
    /*  */
    window.removeEventListener("load", load, false);

    chrome.storage.local.get(null, (stored) => {
        Object.keys(stored).forEach((key) => {
            try {
                document.querySelector('#'+key).checked = stored[key];
            } catch (e) {
                console.error(e)
            }
        })
    })
};

window.addEventListener("load", load, false);