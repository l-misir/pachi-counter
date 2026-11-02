// ============================================================
// ハナハナカウンター（index.html）から抜き出した「スプレッドシート連携」。GAS は gas/Code.gs。
// 元の関数: SHEET_CONFIG / sheetColumns / sheetRowData / exportData / afterCopy / legacyCopy / saveGasConfig /
//          saveToSheet / openHistory / isDateLike / rowHasMemo / rowColumns / sheetRowBasics / machineDataFromRow /
//          hitsToText / textToHits
// 方針: シートには生データだけ。集計・推測は読み込み時に毎回計算。列の定義は sheetColumns の1か所
// ============================================================

// 機種 → シート名（GAS の KNOWN_SHEETS と1文字も違わないこと）
const SHEET_CONFIG = {
    // xxx: { sheetName: '機種名' },
};

// シートの列（1行目は空、2行目が見出し、3行目からデータ）。保存・TSV・読み込み・見出しはすべてここから作る。
// t は値の種類。読み書きはこの t で分ける（列の位置を数字で持たない）
function sheetColumns(m) {
    return [
        { h: 'メモ', t: 'memo' },              // A 列: アプリは空欄で保存、メモはシートで書く
        { h: '日付', t: 'date' },
        { h: '総回転数', t: 'total' },          // GAS は「2列目が空でなく、3列目が数値」の行だけ返す（この並びなら 2列目＝日付・3列目＝数値）
        // { h: '投資', t: 'cur', k: 'invest' },
        // ...
        { h: '当選履歴', t: 'hits' },          // 1回ごとの記録は1つのセルに文字列で
    ];
}

// 今の機種のシート1行分（sheetColumns の順）。TSV コピーとシート保存で共通
function sheetRowData() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
    const dat = getData(), m = data.machine;
    const n = (x) => Number(x) || 0;
    return sheetColumns(m).map(c => {
        switch (c.t) {
            case 'memo': return '';
            case 'date': return dateStr;
            case 'cur': return n(dat.cur[c.k]);
            case 'hits': return hitsToText(dat.hits);
            // case 'total': return …（設定推測などと同じ計算で）
            default: return '';
        }
    });
}

// 「データ保存」: クリップボードへ TSV コピー → GAS 設定済みならシートに保存するか確認
function exportData() {
    const txt = sheetRowData().join('\t');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(() => afterCopy(true)).catch(() => afterCopy(legacyCopy(txt)));
    } else {
        afterCopy(legacyCopy(txt));
    }
}
function afterCopy(copied) {
    const copyMsg = copied ? 'データをコピーしました。' : 'データのコピーに失敗しました。';
    if (!data.gasUrl) { alert(copyMsg); return; }
    if (confirm(copyMsg + '\nスプレッドシートに保存しますか？')) saveToSheet(() => alert('保存しました。'));
}
function legacyCopy(txt) {
    try {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) { return false; }
}

// 管理画面の GAS URL・トークン
function saveGasConfig() {
    data.gasUrl = document.getElementById('gas-url').value.trim();
    data.gasToken = document.getElementById('gas-token').value.trim();
    save(true);
}

// シートに1行追記（GAS の doPost）
function saveToSheet(onSuccess) {
    if (!data.gasUrl) { alert('GAS URLが設定されていません。'); return; }
    const cfg = SHEET_CONFIG[data.machine];
    if (!cfg) { alert('この機種はシート保存に未対応です。'); return; }
    const payload = {
        token: data.gasToken,
        sheetName: cfg.sheetName,
        headers: sheetColumns(data.machine).map(c => c.h), // 新しくシートを作るときの見出し
        rowData: sheetRowData()
    };
    // ボタンの文字を書き換えても、振動用ラベルは addHaptics の見張りが付け直す
    const btn = document.querySelector('.export-btn');
    if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }
    fetch(data.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS のプリフライト回避
        body: JSON.stringify(payload)
    })
    .then(r => r.json())
    .then(res => {
        if (res.success) { if (onSuccess) onSuccess(); }
        else if (res.error === 'unauthorized') alert('保存エラー: トークン不一致\n\n管理画面のトークンと GAS コードの TOKEN を一致させてください。');
        else alert('保存エラー: ' + (res.error || '不明'));
    })
    .catch(err => { alert('通信エラー: ' + err.message + '\n\nURL とネットワーク接続を確認してください。'); })
    .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'データ保存・画像出力'; } });
}

// 全行を読む（GAS の doGet getAll）。行は { sheet, row, values } で、values は GAS が日付を 'yyyy/MM/dd HH:mm' にしたもの
function openHistory() {
    if (!data.gasUrl) { alert('スプレッドシート連携が設定されていません。'); return; }
    const url = data.gasUrl + '?action=getAll&token=' + encodeURIComponent(data.gasToken);
    fetch(url)
    .then(r => r.json())
    .then(res => {
        if (!res.success) throw new Error(res.error === 'unauthorized' ? 'トークン不一致' : (res.error || '取得失敗'));
        window._historyRowsRaw = res.data; // 一覧・集計・復元はこの生データから毎回計算する
        // renderHistory();
    })
    .catch(err => { /* 一覧の場所に「読み込みエラー: …」を出す */ });
}

// 行の並びが変わっても読めるように、並びを行ごとに見分ける（ハナハナは A 列にメモを足したときに使った）。
// B 列が日付ならメモ列あり、そうでなければメモ列なし（A 列が日付）
function isDateLike(x) {
    return x instanceof Date || /^\s*\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(String(x == null ? '' : x));
}
function rowHasMemo(v) { return isDateLike(v[1]); }
function rowColumns(m, v) {
    const cols = sheetColumns(m);
    return rowHasMemo(v) ? cols : cols.slice(1);
}

// シートの1行から機種データを組み立てる（復元・集計用）。列は rowColumns の t で読む
function machineDataFromRow(m, v) {
    const dat = JSON.parse(JSON.stringify(SINGLE_DEFAULT));
    const num = (x) => Number(x) || 0;
    rowColumns(m, v).forEach((c, i) => {
        const x = v[i];
        if (c.t === 'cur') dat.cur[c.k] = num(x);
        else if (c.t === 'hits') dat.hits = textToHits(x);
    });
    return dat;
}

// 1回ごとの記録を1つのセルに: 古い順に「B120 R45[チェリー] B30[フリーズ・バイブ] R-」（種別・回転数〔未入力は -〕・初期値以外の情報を［］に「・」区切り）
// パチンコ用に中身は作り直すこと。読めない部分は飛ばし、大きすぎる数（壊れた値）も飛ばす
function hitsToText(hits) {
    return (Array.isArray(hits) ? [...hits].reverse() : []).map(h => {
        const tags = []; // 初期値以外の情報の名前
        return `${h.k === 'r' ? 'R' : 'B'}${h.g == null ? '-' : h.g}${tags.length ? `[${tags.join('・')}]` : ''}`;
    }).join(' ');
}
function textToHits(s) {
    const out = [];
    String(s == null ? '' : s).trim().split(/\s+/).forEach(tok => {
        const mt = tok.match(/^([BR])(\d+|-)(?:\[(.*)\])?$/);
        if (!mt) return;
        const g = mt[2] === '-' ? null : Number(mt[2]);
        if (g !== null && !Number.isSafeInteger(g)) return;
        const h = { g, k: mt[1] === 'R' ? 'r' : 'b' };
        // const labels = mt[3] ? mt[3].split('・') : [];  → 名前から値に戻す
        out.unshift(h); // 先頭が最新
    });
    return out;
}
