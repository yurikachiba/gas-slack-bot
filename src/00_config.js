/**
 * 固定設定（配布しても安全なもの）
 */
const CONFIG = {
    SYSTEM: {
        BOT_NAME: '情シスの番猫シスにゃん',
        FETCH_LIMIT: 20,
        MAX_CONTEXT_ITEMS: 15,
        MAX_HISTORY_TURNS: 2,
        MAX_TOTAL_CHARS: 15000,
        MAX_DM_MONITOR: 50,
        MAX_THREAD_MONITOR: 5,
        RETENTION_DAYS: 30,

        LOCK_TIMEOUT: 10000,
        EXEC_TIME_LIMIT: 280,
        MAX_MEMORY_KEYS: 200,
        IGNORE_OLDER_THAN_SEC: 600,

        // ROI算出用: 1件あたりの削減時間(分)
        TIME_SAVED_PER_TICKET_MIN: 15
    },

    API: {
        GEMINI_MODEL: 'gemini-1.5-flash',
        GROQ_MODEL: 'llama-3.1-8b-instant'
    },

    // デフォルトのフォールバックURL（プロパティ未設定時に使用）
    FALLBACK_URL_DEFAULT: 'https://example.com/manual',

    STOP_WORDS: [
        'です', 'ます', 'ください', 'お願いします', 'について', '方法', 'こと', 'もの',
        'さん', 'さま', '私', '僕', '俺', '弊社', '社内',
        'http', 'https', 'com', 'jp', 'www', '教えて', '知りたい', 'どうすれば'
    ],

    REACTION: {
        ESCALATE: 'sos',
        DONE: 'white_check_mark',
        THINKING: 'eyes',
        GOOD: ['+1', 'thumbsup', 'good', 'ok_hand', 'heart'],
        BAD: ['-1', 'thumbsdown', 'bad', 'ng']
    },

    MESSAGES: {
        GUIDE_DM: "\n\n━━━━━━━━━━━━━━\n(役に立ったらリアクション「👍」を押してね！\n解決しなかったらそのまま返信してね💌)",
        GUIDE_PUBLIC: "\n\n━━━━━━━━━━━━━━\n(役に立ったらリアクション「👍」を押してね！\n解決しなかったらスレッドに返信してね📢)",

        ESC_REPLY_PUBLIC: "わかったよ！担当者に連絡したよ📢\n担当者からメールで連絡するから、少し待っててね。",
        ESC_REPLY_DM: "わかったよ！会話の履歴を担当者に送ったよ💌\n担当者からメールで連絡するから、少し待っててね。",

        SOLVED_REPLY: "解決してよかった！また頼ってね～！😸"
    }
};

/**
 * 環境変数（Script Properties）をまとめて読むヘルパー
 * ※ここにあるKeyをプロパティ設定画面で入力してもらう
 */
function getEnv_() {
    const p = PropertiesService.getScriptProperties();
    const get = (k, required = true) => {
        const v = p.getProperty(k);
        if (required && !v) throw new Error(`Missing Script Property: ${k}`);
        return v || '';
    };

    return {
        SS_ID: get('SS_ID'),
        SLACK_ACCESS_TOKEN: get('SLACK_ACCESS_TOKEN'),

        // 必須ではない（空でもOK）
        GEMINI_API_KEY: get('GEMINI_API_KEY', false),
        GROQ_API_KEY: get('GROQ_API_KEY', false),

        PUBLIC_CHANNEL_ID: get('PUBLIC_CHANNEL_ID', false), // 監視するパブリックch
        ADMIN_CHANNEL_ID: get('ADMIN_CHANNEL_ID'),          // エスカレーション先
        REPORT_CHANNEL_ID: get('REPORT_CHANNEL_ID', false), // レポート送付先（なければAdminへ）

        MY_BOT_ID: get('MY_BOT_ID', false),                 // 自分のBotID（リアクション除外用）
        FALLBACK_URL: get('FALLBACK_URL', false) || CONFIG.FALLBACK_URL_DEFAULT
    };
}