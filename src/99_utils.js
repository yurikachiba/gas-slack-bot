class Utils {
    static formatText(text) {
        let fixed = text
            .replace(/^\s*[\*\-]\s/gm, '・')
            .replace(/\*\*(.*?)\*\*/g, '*$1*')
            .replace(/\[([^\]]+)\]\s?\((https?:\/\/[^\s\)]+)\)/g, '<$2|$1>')
            .replace(/([^\n]+?)[\s　]+(https?:\/\/[^\s<>]+)$/gm, '<$2|$1>')
            .replace(/(?<!<)(https?:\/\/[^\s<>\|]+)(?![^<]*>)/g, '<$1>');
        return fixed;
    }
    static fetchJson(method, url, payload, customHeaders = {}) {
        const options = { method: method, contentType: "application/json", headers: customHeaders, muteHttpExceptions: true };
        if (payload) options.payload = JSON.stringify(payload);
        let attempt = 0;
        while (attempt <= 2) {
            try {
                const res = UrlFetchApp.fetch(url, options);
                if (res.getResponseCode() === 200) return JSON.parse(res.getContentText());
                Utilities.sleep(1000);
            } catch (e) { console.warn("Fetch Retrying...", e); Utilities.sleep(1000); }
            attempt++;
        }
        return null;
    }
}