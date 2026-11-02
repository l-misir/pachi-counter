// ============================================================
// パチンコ回転数カウンター GAS連携スクリプト（ハナハナカウンターの gas/Code.gs と同じ作り）
// 機能: 全行取得（getAll）/ 行の削除（delete）/ 1行追記（POST）
//
// 【デプロイ手順】
// 1. スプレッドシート → 拡張機能 → Apps Script
// 2. このコードを全て貼り付けて保存（TOKEN と KNOWN_SHEETS を書き換える）
// 3. デプロイ → 新しいデプロイ → ウェブアプリ
//    - 実行するユーザー: 自分
//    - アクセスできるユーザー: 全員
// 4. URL をコピーしてアプリの設定（管理画面）に貼り付け、トークンも同じ文字列を入れる
//
// 【更新時】デプロイを管理 → ✏️ → バージョン: 新バージョン → デプロイ（URL は変わらない）
//           これを忘れると古いコードが動き続ける
// ============================================================

const TOKEN = 'CHANGE_ME';  // ← アプリ設定のトークンと一致させる

// シート名＝機種名。アプリ側のシート名と1文字も違わないこと（全角・半角も）
const KNOWN_SHEETS = [
  // '機種名A',
  // '機種名B',
];

function doGet(e) {
  try {
    if (e.parameter.token !== TOKEN) return respond_({ error: 'unauthorized' });
    const action = e.parameter.action || 'getAll';

    // 全行取得。見出し行・空の行は飛ばす（2列目が空でなく、3列目が数値の行だけ）。
    // 列の並びを決めたら、この条件で見出しと空行だけが落ちるか確かめること
    // （ハナハナは A 列メモ・B 列日付・C 列総回転数で、2列目＝日付・3列目＝数値）
    if (action === 'getAll') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const result = [];
      KNOWN_SHEETS.forEach(name => {
        const sheet = ss.getSheetByName(name);
        if (!sheet) return;
        const values = sheet.getDataRange().getValues();
        if (values.length < 2) return;
        for (let i = 1; i < values.length; i++) {
          const row = values[i];
          if (!row[1] && row[1] !== 0) continue;
          if (typeof row[2] !== 'number' && isNaN(Number(row[2]))) continue;
          result.push({
            sheet: name,
            row: i + 1,
            // 日付のセルは文字列にして返す（アプリはこの形で日付を見分ける）
            values: row.map(v => v instanceof Date
              ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
              : v)
          });
        }
      });
      return respond_({ success: true, data: result });
    }

    // 行の削除（実戦履歴から消すとき）
    if (action === 'delete') {
      const sheetName = e.parameter.sheet;
      const rowNum = parseInt(e.parameter.row);
      if (!sheetName || !rowNum || rowNum < 2) return respond_({ error: 'invalid params' });
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) return respond_({ error: 'sheet not found' });
      if (rowNum > sheet.getLastRow()) return respond_({ error: 'row not found' });
      sheet.deleteRow(rowNum);
      return respond_({ success: true });
    }

    return respond_({ error: 'unknown action' });
  } catch (err) {
    return respond_({ error: err.message });
  }
}

// 1行追記。アプリは Content-Type: text/plain で JSON を送る（CORS のプリフライトを避けるため）
// payload: { token, sheetName, headers: [...見出し], rowData: [...1行] }
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.token !== TOKEN) return respond_({ error: 'unauthorized' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let sheet = ss.getSheetByName(payload.sheetName);
    if (!sheet) {
      // シートが無ければ、アプリが送った見出しで作る
      sheet = ss.insertSheet(payload.sheetName);
      if (payload.headers && payload.headers.length) {
        sheet.appendRow(payload.headers);
        sheet.setFrozenRows(1);
      }
    }
    sheet.appendRow(payload.rowData);
    return respond_({ success: true, sheet: payload.sheetName, row: sheet.getLastRow() });
  } catch (err) {
    return respond_({ error: err.message });
  }
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
