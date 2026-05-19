const ngrok = require('ngrok');
(async function() {
    try {
        console.log("Starting ngrok...");
        await ngrok.kill();
        const url = await ngrok.connect({ addr: 3000, name: 'test-tunnel' });
        console.log("URL:", url);
    } catch (err) {
        console.error("Error:", err);
    }
})();
