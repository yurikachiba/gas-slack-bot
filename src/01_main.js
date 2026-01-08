/**
 * 時間主導トリガーで実行されるメイン関数 (5分ごと推奨)
 */
function patrolSlack() {
    const app = new BotApp();
    app.run();
}

/**
 * 週次レポート送信関数 (月曜朝推奨)
 */
function sendWeeklyReport() {
    const reporter = new WeeklyReporter();
    reporter.send();
}