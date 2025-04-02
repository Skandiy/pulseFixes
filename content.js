// Функция для загрузки inject.js и внедрения в страницу
fetch(chrome.runtime.getURL("injected.js"))
    .then(response => response.text())
    .then(injectedScript => {
        script = document.createElement("script");
        script.setAttribute("id", "pulse-project-rules");
        script.setAttribute("type", "text/javascript");
        script.textContent = injectedScript;
        document.documentElement.appendChild(script);
    })
    .catch(error => {
        console.error("Ошибка при загрузке injected.js:", error);
    });
