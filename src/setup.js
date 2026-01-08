/**
 * 【導入者用】初回セットアップスクリプト
 * 1. Script Properties に `SS_ID` を設定してから実行してください。
 * 2. この関数を実行すると、シート生成・書式設定・トリガー設定が完了します。
 */
function setup() {
    const env = getEnv_(); // SS_IDの存在確認
    const ss = SpreadsheetApp.openById(env.SS_ID);

    console.log('🚀 Setup started...');

    // 1. シート作成 & 書式適用
    setupSheet_(ss, 'QA_Data', ['カテゴリ', '質問', '要点', '補足', 'URL']);
    setupSheet_(ss, 'Doc_Data', ['大分類', '中分類', 'タイトル', '要点', 'URL']);
    setupUsageLog_(ss); // Usage_Logは条件付き書式等があるため特別扱い

    // 2. トリガー設定 (既存を削除して再作成)
    resetTrigger_('patrolSlack', 5); // 5分ごと
    resetWeeklyTrigger_('sendWeeklyReport', ScriptApp.WeekDay.MONDAY, 9); // 月曜9時

    console.log('✅ Setup completed! Please configure other Script Properties.');
}

function setupSheet_(ss, name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
        sh = ss.insertSheet(name);
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.setFrozenRows(1);
        sh.getRange(1, 1, 1, headers.length).setBackground('#4c8bf5').setFontColor('#ffffff').setFontWeight('bold');
        sh.autoResizeColumns(1, headers.length);
        console.log(`Created sheet: ${name}`);
    }
}

function setupUsageLog_(ss) {
    let sh = ss.getSheetByName('Usage_Log');
    const headers = ['日時', 'ユーザー', '種類', '内容', '結果'];

    if (!sh) {
        sh = ss.insertSheet('Usage_Log');
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }

    sh.setFrozenRows(1);
    const headerRange = sh.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#4c8bf5').setFontColor('#ffffff').setFontWeight('bold').setHorizontalAlignment('center');

    // 列幅設定
    sh.setColumnWidth(1, 130); // 日時
    sh.setColumnWidth(2, 160); // ユーザー
    sh.setColumnWidth(3, 140); // 種類
    sh.setColumnWidth(4, 450); // 内容
    sh.setColumnWidth(5, 120); // 結果

    // 条件付き書式 (種類カラム)
    sh.clearConditionalFormatRules();
    const range = sh.getRange(2, 3, sh.getMaxRows() - 1, 1);
    const rules = [
        SpreadsheetApp.newConditionalFormatRule().whenTextContains("有人対応").setBackground("#EA4335").setFontColor("#FFFFFF").setBold(true).setRanges([range]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains("解決").setBackground("#E6F4EA").setFontColor("#137333").setRanges([range]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains("資料なし").setBackground("#FEF7E0").setFontColor("#B06000").setRanges([range]).build(),
        SpreadsheetApp.newConditionalFormatRule().whenTextContains("低評価").setBackground("#F1F3F4").setFontColor("#5F6368").setRanges([range]).build()
    ];
    sh.setConditionalFormatRules(rules);
    console.log('Configured sheet: Usage_Log');
}

function resetTrigger_(funcName, minutes) {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger(funcName).timeBased().everyMinutes(minutes).create();
    console.log(`Set trigger: ${funcName} (${minutes} min)`);
}

function resetWeeklyTrigger_(funcName, day, hour) {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger(funcName).timeBased().onWeekDay(day).atHour(hour).create();
    console.log(`Set trigger: ${funcName} (Weekly)`);
}