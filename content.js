(async () => {
    try {
        const { bootstrapContent } = await import(chrome.runtime.getURL('src/content-main.js'));
        await bootstrapContent();
    } catch (error) {
        console.error('Content bootstrap failed:', error);
    }
})();
