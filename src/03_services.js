// ==========================================
// AIEngine
// ==========================================
class AIEngine {
    constructor(geminiKey, groqKey) {
        this.geminiKey = geminiKey;
        this.groqKey = groqKey;
    }
    generateResponse(context, query, isDm, history = [], needGreeting = false) {
        if (!this.geminiKey) return "システムエラーだよ: APIキー設定を確認してね。";
        const geminiRes = this._callGemini(context, query, isDm, history, needGreeting);
        if (geminiRes) return geminiRes;
        if (!this.groqKey) return "システムエラーだよ: バックアップAPIキーが未設定だよ。";
        const groqRes = this._callGroq(context, query, isDm, needGreeting);
        return groqRes || "ごめんね。うまく答えられなかったよ💦";
    }

    _buildSystemPrompt(isDm, context, needGreeting) {
        const greetingInstruction = needGreeting
            ? `回答の冒頭は必ず「こんにちは！${CONFIG.SYSTEM.BOT_NAME}だよ🐱」から始めること。`
            : `定型的な挨拶は省略し、すぐに本題に入るようにしてね。`;

        return `
あなたは${CONFIG.SYSTEM.BOT_NAME}です。
社内のヘルプデスク担当として、以下のルールを**厳守**して回答してください。

【キャラクター設定】
・一人称: 「ボク」
・口調: 親しみやすいタメ口（友達のような話し方）
・語尾: 「〜だよ」「〜してね」「〜かな？」「〜だね」

【重要：あなたの権限と禁止事項】
1. **あなたは「システム管理者」ではありません。「案内係」です。**
   - 「ボクが管理者です」「権限を付与します」といった発言は**絶対に禁止**です。
   - サーバー設定の変更、パスワードリセット、アクセス権付与などの実作業は**不可能**です。

2. **ハルシネーション（嘘）の完全禁止**
   - **コンテキスト（社内資料）に含まれない情報は「存在しない」ものとして扱ってください。**
   - 資料にない「ドメイン名」「手順」「トラブルシューティング」を勝手に創作することを**固く禁じます**。

【回答作成のフロー】
1. コンテキスト（社内資料）を読みます。
2. ユーザーの質問に対する「明確な答え」が資料にあるか確認します。
3. **もし資料に答えがない、または確信が持てない場合は、決して推測で回答せず、以下の定型メッセージを出力してください。**
   
   『手元の資料には情報がなかったよ💦
   情報システム部までお問い合わせください。』

【挨拶】
${greetingInstruction}

【社内情報 (唯一の情報源)】
${context || '（該当資料なし）'}
`;
    }
    _callGemini(context, query, isDm, history, needGreeting) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.API.GEMINI_MODEL}:generateContent?key=${this.geminiKey}`;
        const promptParts = [{ text: this._buildSystemPrompt(isDm, context, needGreeting) }];
        history.forEach(h => {
            promptParts.push({ text: (h.role === 'user' ? "User: " : "Model: ") + h.text });
        });
        promptParts.push({ text: "Current User Question: " + query });
        const payload = { contents: [{ parts: promptParts }], generationConfig: { temperature: 0.0 } };
        const result = Utils.fetchJson('POST', url, payload);
        return result?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
    _callGroq(context, query, isDm, needGreeting) {
        const url = "https://api.groq.com/openai/v1/chat/completions";
        const payload = {
            model: CONFIG.API.GROQ_MODEL,
            messages: [
                { role: "system", content: this._buildSystemPrompt(isDm, context, needGreeting) },
                { role: "user", content: query }
            ],
            temperature: 0.0
        };
        const headers = { "Authorization": "Bearer " + this.groqKey };
        const result = Utils.fetchJson('POST', url, payload, headers);
        return result?.choices?.[0]?.message?.content || null;
    }
}

// ==========================================
// KnowledgeBase
// ==========================================
class KnowledgeBase {
    constructor(ssId) { this.ssId = ssId; }
    fetchAll() {
        let attempt = 0;
        while (attempt < 3) {
            try { return this._tryFetch(); }
            catch (e) { attempt++; Utilities.sleep(2000 * attempt); }
        }
        return [];
    }
    _tryFetch() {
        const ss = SpreadsheetApp.openById(this.ssId);
        const data = [];
        const readSheet = (name, parser) => {
            const sheet = ss.getSheetByName(name);
            if (!sheet) return;
            const rows = sheet.getDataRange().getValues();
            rows.forEach((row, i) => { if (i > 0) parser(row, data); });
        };
        readSheet('QA_Data', (row, list) => {
            if (row[1]) list.push({ type: 'QA', category: row[0], question: row[1], answer_point: row[2], answer_action: '', answer_note: row[3], url: row[4], tags: row[0] || '' });
        });
        readSheet('Doc_Data', (row, list) => {
            if (row[2]) list.push({ type: 'Doc', category: `${row[0]} > ${row[1]}`, question: row[2], answer_point: row[3], answer_action: '', answer_note: '', url: row[4], tags: row[0] || '' });
        });
        return data;
    }
    buildContext(knowledge, query) {
        const normalize = (s) => String(s).toLowerCase().replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
        const nQuery = normalize(query);
        const rawKeywords = nQuery.match(/[a-z0-9+]{1,}|[ァ-ヴー]{2,}|[一-龠々]{2,}|[ぁ-ん]{2,}/g) || [];
        const keywords = [...new Set(rawKeywords)].filter(k => !CONFIG.STOP_WORDS.includes(k));
        if (keywords.length === 0) return null;

        let candidates = [];
        knowledge.forEach(item => {
            let score = 0;
            const nQ = normalize(item.question);
            const nTags = normalize(item.tags);
            const nCat = normalize(item.category);
            const nAns = normalize(item.answer_point + item.answer_action);

            keywords.forEach(k => {
                if (nQ.includes(k)) score += 20;
                if (nTags.includes(k)) score += 15;
                if (nCat.includes(k)) score += 50;
                if (nAns.includes(k)) score += 5;
            });
            if (/^\d{6}/.test(item.question)) score += 10;
            if (score > 0) candidates.push({ item, score });
        });
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.score - a.score);

        const topItems = candidates.slice(0, CONFIG.SYSTEM.MAX_CONTEXT_ITEMS);
        let contextText = "";
        let totalChars = 0;
        const seenUrls = new Set();
        for (const cand of topItems) {
            const i = cand.item;
            if (i.url && seenUrls.has(i.url)) continue;
            if (i.url) seenUrls.add(i.url);
            let block = i.url ? `・[${i.question}](${i.url})\n` : `・${i.question}\n`;
            if (i.answer_point) block += `  - 要点: ${i.answer_point}\n`;
            if (i.answer_action) block += `  - 手順: ${i.answer_action}\n`;
            if (i.answer_note) block += `  - 補足: ${i.answer_note}\n`;
            block += "\n";
            if (totalChars + block.length > CONFIG.SYSTEM.MAX_TOTAL_CHARS) break;
            contextText += block;
            totalChars += block.length;
        }
        return contextText.trim() || null;
    }
}

// ==========================================
// SlackService
// ==========================================
class SlackService {
    constructor(token) {
        this.token = token;
        this.headers = { "Authorization": "Bearer " + token };
    }
    fetchActiveDmChannels(limit) {
        const data = Utils.fetchJson('GET', `https://slack.com/api/users.conversations?types=im&limit=${limit}`, null, this.headers);
        return data?.ok ? data.channels.map(c => c.id) : [];
    }
    fetchMessages(channelId, limit) {
        const data = Utils.fetchJson('GET', `https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`, null, this.headers);
        return data?.ok ? data.messages : [];
    }
    fetchThreadReplies(channelId, threadTs) {
        const data = Utils.fetchJson('GET', `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=10`, null, this.headers);
        return data?.ok ? data.messages : [];
    }
    fetchUserInfo(userId) {
        const data = Utils.fetchJson('GET', `https://slack.com/api/users.info?user=${userId}`, null, this.headers);
        return data?.ok ? data.user : null;
    }
    postMessage(channelId, text, threadTs = null) {
        const payload = { channel: channelId, text: text, mrkdwn: true, username: CONFIG.SYSTEM.BOT_NAME };
        if (threadTs) payload.thread_ts = threadTs;
        const data = Utils.fetchJson('POST', "https://slack.com/api/chat.postMessage", payload, this.headers);
        return data?.ok ? data.message : null;
    }
    addReaction(channelId, timestamp, name) {
        Utils.fetchJson('POST', "https://slack.com/api/reactions.add", { channel: channelId, timestamp: timestamp, name: name }, this.headers);
    }
}

// ==========================================
// StateManager
// ==========================================
class StateManager {
    constructor(props) {
        this.props = props;
        this.processedKeys = JSON.parse(props.getProperty('PROCESSED_KEYS') || '{}');
        this.escalatedKeys = JSON.parse(props.getProperty('ESCALATED_KEYS') || '{}');
        this.dmCursors = JSON.parse(props.getProperty('DM_CURSORS') || '{}');
        this.activeThreads = JSON.parse(props.getProperty('ACTIVE_THREADS') || '[]');
    }
    getCursor(channelId) { return (this.dmCursors[channelId]?.ts) || (Math.floor(Date.now() / 1000) - 600).toString(); }
    setCursor(channelId, ts) { this.dmCursors[channelId] = { ts: ts, lastAccess: Date.now() }; }
    isProcessed(channelId, ts) { return !!this.processedKeys[`${channelId}:${ts}`]; }
    markAsProcessed(channelId, ts) { this.processedKeys[`${channelId}:${ts}`] = Date.now(); }
    isEscalated(channelId, ts) { return !!this.escalatedKeys[`${channelId}:${ts}`]; }
    markAsEscalated(channelId, ts) { this.escalatedKeys[`${channelId}:${ts}`] = Date.now(); }
    getActiveThreads() { return this.activeThreads; }
    addActiveThread(channelId, threadTs) {
        const exists = this.activeThreads.find(t => t.channelId === channelId && t.threadTs === threadTs);
        if (exists) { exists.lastAccess = Date.now(); }
        else {
            this.activeThreads.push({ channelId, threadTs, lastAccess: Date.now() });
            if (this.activeThreads.length > CONFIG.SYSTEM.MAX_THREAD_MONITOR) this.activeThreads.shift();
        }
    }
    runGC() {
        const threshold = Date.now() - (CONFIG.SYSTEM.RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const limitKeys = (obj, limit) => {
            const keys = Object.keys(obj);
            if (keys.length > limit) {
                keys.sort((a, b) => obj[a] - obj[b]);
                const toDelete = keys.slice(0, keys.length - limit);
                toDelete.forEach(k => delete obj[k]);
            }
        };
        const clean = (obj) => Object.keys(obj).forEach(k => { if (obj[k] < threshold) delete obj[k]; });
        clean(this.processedKeys); clean(this.escalatedKeys); clean(this.dmCursors);
        limitKeys(this.processedKeys, CONFIG.SYSTEM.MAX_MEMORY_KEYS);
        limitKeys(this.escalatedKeys, CONFIG.SYSTEM.MAX_MEMORY_KEYS);
        this.activeThreads = this.activeThreads.filter(t => t.lastAccess > (Date.now() - (2 * 24 * 60 * 60 * 1000)));
    }
    save() {
        this.props.setProperty('PROCESSED_KEYS', JSON.stringify(this.processedKeys));
        this.props.setProperty('ESCALATED_KEYS', JSON.stringify(this.escalatedKeys));
        this.props.setProperty('DM_CURSORS', JSON.stringify(this.dmCursors));
        this.props.setProperty('ACTIVE_THREADS', JSON.stringify(this.activeThreads));
    }
}