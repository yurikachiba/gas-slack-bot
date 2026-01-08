// ==========================================
// Usage Logger
// ==========================================
class UsageLogger {
    constructor(ssId) {
        this.ssId = ssId;
    }

    log(user, type, text, result) {
        try {
            const ss = SpreadsheetApp.openById(this.ssId);
            let sheet = ss.getSheetByName('Usage_Log');

            if (!sheet) {
                // setup.js で作成されるはずだが念のため
                sheet = ss.insertSheet('Usage_Log');
            }

            const typeLabel = this._getTypeLabel(type);

            let displayText = text;
            if (text.startsWith('Msg:')) {
                displayText = text.replace('Msg:', '[対象回答ID]:');
            }
            displayText = displayText.replace(/[\r\n]+/g, ' ').substring(0, 150);

            const now = new Date();
            sheet.appendRow([now, user, typeLabel, displayText, result]);

            // ランダムに書式メンテ
            if (Math.random() < 0.2 || sheet.getLastRow() < 20) {
                this._formatSheet(sheet);
            }

        } catch (e) {
            console.error("Log Failed:", e);
        }
    }

    _getTypeLabel(type) {
        const map = {
            'ANSWERED': '🤖 自動回答',
            'NO_DATA': '📉 資料なし',
            'ESCALATION': '🚨 有人対応',
            'SOLVED_REACTION': '✅ 解決 (Good)',
            'SOLVED_TEXT': '✅ 解決 (会話)',
            'BAD_FEEDBACK': '👎 低評価 (Bad)'
        };
        return map[type] || type;
    }

    _formatSheet(sheet) {
        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn();
        if (lastRow < 2) return;

        // 罫線やフォントの設定（setup.jsでもやるが維持のために再適用）
        const fullRange = sheet.getRange(1, 1, lastRow, lastCol);
        fullRange.setBorder(true, true, true, true, true, true, '#b7b7b7', SpreadsheetApp.BorderStyle.SOLID);
        fullRange.setFontFamily("Arial").setFontSize(10).setVerticalAlignment("middle");

        // 日付フォーマット
        sheet.getRange(2, 1, lastRow - 1, 1).setNumberFormat("yyyy/MM/dd HH:mm");
    }
}

// ==========================================
// Weekly Reporter
// ==========================================
class WeeklyReporter {
    constructor() {
        this.env = getEnv_();
        this.slack = new SlackService(this.env.SLACK_ACCESS_TOKEN);
        this.ssId = this.env.SS_ID;
        this.reportChannelId = this.env.REPORT_CHANNEL_ID || this.env.ADMIN_CHANNEL_ID;
    }

    send() {
        try {
            const ss = SpreadsheetApp.openById(this.ssId);
            const sheet = ss.getSheetByName('Usage_Log');
            if (!sheet) return;

            const rows = sheet.getDataRange().getValues();
            rows.shift(); // remove header

            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

            let totalInteractions = 0;
            let escalationCount = 0;
            let noDataCount = 0;
            let solvedCount = 0;
            let badCount = 0;
            let userSet = new Set();
            let topics = [];

            rows.forEach(row => {
                const ts = new Date(row[0]);
                if (ts >= oneWeekAgo) {
                    const type = String(row[2]);
                    const text = String(row[3]);
                    const user = String(row[1]);

                    if (type.includes('自動回答')) totalInteractions++;
                    if (type.includes('有人対応')) escalationCount++;
                    if (type.includes('資料なし')) noDataCount++;
                    if (type.includes('解決')) solvedCount++;
                    if (type.includes('低評価')) badCount++;

                    if (user && !user.includes('Reaction') && !user.includes('匿名')) {
                        userSet.add(user);
                    }

                    if ((type.includes('自動回答') || type.includes('資料なし')) && text.length > 2) {
                        if (!text.includes('[対象回答ID]')) {
                            topics.push(text);
                        }
                    }
                }
            });

            if (totalInteractions === 0 && solvedCount === 0) return;

            const effectiveSolved = Math.max(0, totalInteractions - escalationCount - badCount);
            const hoursSaved = (effectiveSolved * (CONFIG.SYSTEM.TIME_SAVED_PER_TICKET_MIN / 60)).toFixed(1);

            const topicCounts = {};
            topics.forEach(t => { topicCounts[t] = (topicCounts[t] || 0) + 1; });
            const sortedTopics = Object.entries(topicCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map((t, i) => `${i + 1}. ${t[0]}`);

            const report =
                `📊 *${CONFIG.SYSTEM.BOT_NAME} 週間活動レポート*\n` +
                `(期間: 直近7日間)\n\n` +
                `━━━━━━━━━━━━━━\n` +
                `■ *ハイライト*\n` +
                `💰 削減工数: *${hoursSaved}時間* 相当\n` +
                `🗣️ 対応件数: ${totalInteractions}件 (${userSet.size}ユーザー)\n` +
                `✅ 解決数(推測): ${effectiveSolved}件\n` +
                `👍 Good反応: ${solvedCount}件\n\n` +

                `■ *要注意エリア*\n` +
                `🚨 有人対応: ${escalationCount}件\n` +
                `👎 Bad反応: ${badCount}件\n` +
                `📉 資料不足: ${noDataCount}件\n\n` +

                `■ *よくある質問 (Top 3)*\n` +
                `\`\`\`\n${sortedTopics.join('\n') || '特になし'}\n\`\`\`\n` +
                `━━━━━━━━━━━━━━`;

            this.slack.postMessage(this.reportChannelId, report);

        } catch (e) {
            console.error("Reporting failed:", e);
        }
    }
}