class BotApp {
    constructor() {
        this.env = getEnv_(); // 環境変数を取得
        this.props = PropertiesService.getScriptProperties();

        this.slack = new SlackService(this.env.SLACK_ACCESS_TOKEN);
        this.kb = new KnowledgeBase(this.env.SS_ID);
        this.ai = new AIEngine(this.env.GEMINI_API_KEY, this.env.GROQ_API_KEY);
        this.state = new StateManager(this.props);
        this.logger = new UsageLogger(this.env.SS_ID);
        this.userCache = {};
    }

    run() {
        const lock = LockService.getScriptLock();
        if (!lock.tryLock(CONFIG.SYSTEM.LOCK_TIMEOUT)) {
            console.warn("⚠️ Previous execution is still running. Skipping.");
            return;
        }

        try {
            console.log("🚀 Bot Patrol Started (Ver 9.9 Distributable)");
            const startTime = Date.now();
            const targets = this._getMonitoringTargets();

            let knowledge = [];
            try { knowledge = this.kb.fetchAll(); } catch (e) { console.error(`Knowledge Fetch Failed: ${e.message}`); }

            for (const target of targets) {
                if ((Date.now() - startTime) / 1000 > CONFIG.SYSTEM.EXEC_TIME_LIMIT) break;

                const messages = this.slack.fetchMessages(target.id, CONFIG.SYSTEM.FETCH_LIMIT);
                if (!messages || messages.length === 0) continue;

                const sortedMsgs = messages.reverse();
                let maxTsProcessed = this.state.getCursor(target.id);
                let newCursorTs = maxTsProcessed;

                for (const msg of sortedMsgs) {
                    // --- Reaction Check ---
                    if (msg.bot_id || msg.subtype) {
                        this._checkReactions(target, msg);
                        if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                        continue;
                    }

                    // --- Processed Check ---
                    if (this.state.isProcessed(target.id, msg.ts)) {
                        if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                        continue;
                    }

                    const msgTime = parseFloat(msg.ts);
                    const nowTs = startTime / 1000;
                    if ((nowTs - msgTime) > CONFIG.SYSTEM.IGNORE_OLDER_THAN_SEC) {
                        this.state.markAsProcessed(target.id, msg.ts);
                        if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                        continue;
                    }

                    // --- DM Processing ---
                    if (target.type === 'DM') {
                        const history = this._getConversationHistory(sortedMsgs, msg.ts);

                        // A. First Contact
                        if (history.length === 0) {
                            this.slack.addReaction(target.id, msg.ts, CONFIG.REACTION.THINKING);
                            const success = this._processMessage(target, msg, knowledge, []);
                            if (success) {
                                this.state.markAsProcessed(target.id, msg.ts);
                                this.state.save();
                                if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                                continue;
                            }
                        }

                        // B. Escalation Check (Botへの返信)
                        if (history.length > 0 && history[history.length - 1].role === 'model') {
                            // 1. 感謝なら解決
                            if (msg.text.match(/ありがとう|助かった|解決した|解決しました|解決です/)) {
                                this.slack.addReaction(target.id, msg.ts, 'heart');
                                this.slack.postMessage(target.id, CONFIG.MESSAGES.SOLVED_REPLY, msg.ts);

                                this.logger.log(this._resolveUserName(msg.user), 'SOLVED_TEXT', msg.text, 'User said thanks');
                                this.state.markAsProcessed(target.id, msg.ts);
                                if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                                continue;
                            }

                            // 2. それ以外は全てエスカレーション
                            console.log("🚨 Complaint/SOS detected.");
                            this._escalateToAdmin(target, msg, sortedMsgs);
                            this.state.markAsProcessed(target.id, msg.ts);
                            this.state.save();
                            if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                            continue;
                        }
                    }

                    // --- Generate Answer (Normal) ---
                    this.slack.addReaction(target.id, msg.ts, CONFIG.REACTION.THINKING);
                    const history = (target.type === 'DM') ? this._getConversationHistory(sortedMsgs, msg.ts) : [];
                    const success = this._processMessage(target, msg, knowledge, history);

                    if (success) {
                        this.state.markAsProcessed(target.id, msg.ts);
                        this.state.save();
                        if (parseFloat(msg.ts) > parseFloat(newCursorTs)) newCursorTs = msg.ts;
                    }

                    Utilities.sleep(1500);
                }

                if (target.type === 'DM') this.state.setCursor(target.id, newCursorTs);
                this.state.save();
                Utilities.sleep(200);
            }

            // --- Thread Monitoring ---
            const activeThreads = this.state.getActiveThreads();
            if (activeThreads.length > 0) {
                for (const th of activeThreads) {
                    if ((Date.now() - startTime) / 1000 > CONFIG.SYSTEM.EXEC_TIME_LIMIT) break;
                    const replies = this.slack.fetchThreadReplies(th.channelId, th.threadTs);
                    if (!replies || replies.length === 0) continue;

                    // リアクションチェック
                    for (let i = 0; i < replies.length; i++) {
                        const m = replies[i];
                        if (m.bot_id) {
                            const questionMsg = (i > 0) ? replies[i - 1] : null;
                            this._checkReactions({ id: th.channelId, type: 'PUBLIC' }, m, questionMsg);
                        }
                    }

                    const lastMsg = replies[replies.length - 1];
                    if (this.state.isProcessed(th.channelId, lastMsg.ts)) continue;

                    if (!lastMsg.bot_id && !lastMsg.subtype) {
                        const prevMsg = replies[replies.length - 2];
                        if (prevMsg && prevMsg.bot_id) {
                            // 1. 感謝なら解決
                            if (lastMsg.text.match(/ありがとう|助かった|解決した|解決しました|解決です/)) {
                                this.slack.addReaction(th.channelId, lastMsg.ts, 'heart');
                                this.slack.postMessage(th.channelId, CONFIG.MESSAGES.SOLVED_REPLY, lastMsg.ts);
                                this.state.markAsProcessed(th.channelId, lastMsg.ts);
                                continue;
                            }

                            // 2. それ以外はエスカレーション
                            const isDmTarget = this._getMonitoringTargets().some(t => t.id === th.channelId && t.type === 'DM');
                            const targetType = isDmTarget ? 'DM' : 'PUBLIC';
                            const target = { id: th.channelId, type: targetType };
                            this._escalateToAdmin(target, lastMsg, replies);
                            this.state.markAsProcessed(th.channelId, lastMsg.ts);
                            this.state.save();
                        }
                    }
                }
            }

            this.state.runGC();
            this.state.save();
        } catch (e) {
            console.error(`💀 Fatal Error: ${e.stack}`);
        } finally {
            lock.releaseLock();
        }
    }

    _resolveUserName(userId) {
        if (!userId) return "Unknown";
        if (this.userCache[userId]) return this.userCache[userId];
        const info = this.slack.fetchUserInfo(userId);
        let name = userId;
        if (info) {
            name = info.profile.display_name || info.real_name || info.name;
        }
        this.userCache[userId] = name;
        return name;
    }

    _checkReactions(target, botMsg, questionMsg) {
        if (!botMsg.reactions) return;
        if (this.env.MY_BOT_ID && botMsg.bot_id !== this.env.MY_BOT_ID) return;

        botMsg.reactions.forEach(r => {
            const userId = questionMsg ? questionMsg.user : null;
            const logUser = userId ? this._resolveUserName(userId) : "User(Reaction)";
            const logText = questionMsg ? questionMsg.text : `[Bot回答への反応]: ${botMsg.text.substring(0, 50)}...`;

            if (CONFIG.REACTION.GOOD.includes(r.name)) {
                const key = `${target.id}:${botMsg.ts}:GOOD`;
                if (!this.state.isProcessed(target.id, key)) {
                    this.logger.log(logUser, 'SOLVED_REACTION', logText, `Reaction: ${r.name}`);
                    this.state.markAsProcessed(target.id, key);
                }
            }
            if (CONFIG.REACTION.BAD.includes(r.name)) {
                const key = `${target.id}:${botMsg.ts}:BAD`;
                if (!this.state.isProcessed(target.id, key)) {
                    this.logger.log(logUser, 'BAD_FEEDBACK', logText, `Reaction: ${r.name}`);
                    this.state.markAsProcessed(target.id, key);
                }
            }
        });
    }

    _escalateToAdmin(target, triggerMsg, allMessages) {
        if (this.state.isEscalated(target.id, triggerMsg.ts)) return;
        this.slack.addReaction(target.id, triggerMsg.ts, CONFIG.REACTION.ESCALATE);
        this.logger.log(this._resolveUserName(triggerMsg.user), 'ESCALATION', triggerMsg.text, 'Admin Called');

        let transcript = "";
        const idx = allMessages.findIndex(m => m.ts === triggerMsg.ts);
        if (idx >= 0) {
            const startIdx = Math.max(0, idx - 3);
            const contextMsgs = allMessages.slice(startIdx, idx + 1);
            contextMsgs.forEach(m => {
                const icon = m.bot_id ? "🐱" : "👤";
                const name = m.bot_id ? CONFIG.SYSTEM.BOT_NAME : "User";
                const text = m.text.replace(CONFIG.MESSAGES.GUIDE_DM, '').replace(CONFIG.MESSAGES.GUIDE_PUBLIC, '').trim();
                transcript += `${icon} *${name}:*\n${text}\n\n`;
            });
        }

        const adminText =
            `🚨 *有人対応依頼* 🚨\n` +
            `依頼者: <@${triggerMsg.user}>\n` +
            `状況: 解決せず問い合わせが来ました。\n\n` +
            `📝 *会話ログ*\n` +
            `>>> ${transcript}` +
            `------------------\n` +
            `⚠️ <@${triggerMsg.user}> さんへ連絡してください。\n`;

        this.slack.postMessage(this.env.ADMIN_CHANNEL_ID, adminText);

        const replyText = (target.type === 'DM') ? CONFIG.MESSAGES.ESC_REPLY_DM : CONFIG.MESSAGES.ESC_REPLY_PUBLIC;
        const threadTs = triggerMsg.thread_ts || triggerMsg.ts;
        this.slack.postMessage(target.id, `<@${triggerMsg.user}>\n${replyText}`, threadTs);
        this.slack.addReaction(target.id, triggerMsg.ts, CONFIG.REACTION.DONE);
        this.state.markAsEscalated(target.id, triggerMsg.ts);
        this.state.save();
    }

    _getMonitoringTargets() {
        const targets = [];
        if (this.env.PUBLIC_CHANNEL_ID) targets.push({ id: this.env.PUBLIC_CHANNEL_ID, type: 'PUBLIC' });
        const dmIds = this.slack.fetchActiveDmChannels(CONFIG.SYSTEM.MAX_DM_MONITOR);
        dmIds.forEach(id => {
            if (!targets.some(t => t.id === id)) targets.push({ id: id, type: 'DM' });
        });
        return targets;
    }

    _getConversationHistory(allMessages, currentTs) {
        const history = [];
        let count = 0;
        for (let i = allMessages.length - 1; i >= 0; i--) {
            const m = allMessages[i];
            if (parseFloat(m.ts) < parseFloat(currentTs)) {
                if (!m.subtype) {
                    history.push({
                        role: m.bot_id ? 'model' : 'user',
                        text: m.text.replace(CONFIG.MESSAGES.GUIDE_DM, '').replace(CONFIG.MESSAGES.GUIDE_PUBLIC, '')
                    });
                    count++;
                }
            }
            if (count >= CONFIG.SYSTEM.MAX_HISTORY_TURNS * 2) break;
        }
        return history.reverse();
    }

    _processMessage(target, msg, knowledge, history) {
        const isDm = (target.type === 'DM');
        const isThreadReply = !!msg.thread_ts;

        try {
            const context = this.kb.buildContext(knowledge, msg.text);
            let replyText = "";

            const fallbackMsg =
                `手元の資料には情報がなかったよ💦\n` +
                `情報システム部までお問い合わせください。\n\n` +
                `以下のシステム関連QAサイトも併せて確認してみてね！\n` +
                `${this.env.FALLBACK_URL}`;

            if (!context && history.length === 0) {
                this.logger.log(this._resolveUserName(msg.user), 'NO_DATA', msg.text, 'Context Missing');
                const greeting = (!isDm && !isThreadReply) ? `こんにちは！${CONFIG.SYSTEM.BOT_NAME}だよ🐱\n\n` : "";
                replyText = greeting + fallbackMsg;
            } else {
                const needGreeting = (!isDm && !isThreadReply);
                replyText = this.ai.generateResponse(context, msg.text, isDm, history, needGreeting);
                this.logger.log(this._resolveUserName(msg.user), 'ANSWERED', msg.text, 'AI Generated');
            }

            const guide = isDm ? CONFIG.MESSAGES.GUIDE_DM : CONFIG.MESSAGES.GUIDE_PUBLIC;
            const mention = `<@${msg.user}>`;
            const formattedReply = `${mention}\n${Utils.formatText(replyText)}${guide}`;

            const threadTs = msg.thread_ts || msg.ts;
            const res = this.slack.postMessage(target.id, formattedReply, threadTs);

            if (res && res.ts) {
                const rootTs = msg.thread_ts || msg.ts;
                this.state.addActiveThread(target.id, rootTs);
                return true;
            }
        } catch (e) {
            console.error(`AI Generation or Slack Post Error: ${e.message}`);
            return false;
        }
        return false;
    }
}