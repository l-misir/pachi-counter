// ============================================================
// ハナハナカウンター（index.html）から抜き出した「保存」と「複数タブ対策」と「起動」。
// 元の関数: loadData / save / claimActiveTab / isActiveTab / markTabStale / checkActiveTab / startup
// ============================================================

const STORAGE_KEY = 'pachinko_v1_data'; // 形を大きく変えるときは版を上げ、loadData で古い形から移す

// 保存データの雛形。機種ごとの記録は data[機種] に持つ
const SINGLE_DEFAULT = {
    start: { /* 打ち始めの値 */ },
    cur: { /* 今の値 */ },
    hits: [],          // 大当たりごとの記録（先頭が最新）
};
const DEFAULTS = {
    machine: 'xxx',    // 選択中の機種
    mode: 'tap',       // 入力モード: 'tap' / 'input'
    gasUrl: '', gasToken: '',
    // xxx: JSON.parse(JSON.stringify(SINGLE_DEFAULT)),  機種ごと
};

// 読み込み。足りない項目は雛形で埋める（項目を増やしても古い保存データで壊れないように）。壊れていたら雛形から
function loadData() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = JSON.parse(JSON.stringify(DEFAULTS));
    Object.keys(DEFAULTS).forEach(k => { if (d[k] === undefined) d[k] = JSON.parse(JSON.stringify(DEFAULTS[k])); });
    // 機種ごとのデータも、足りない項目を雛形で埋める（ここで古い形からの移行も行う）
    return d;
}

let data = loadData();
function getData() { return data[data.machine]; }

// 保存は必ずここから（localStorage.setItem を直接呼ばない）。戻り値: 保存できたら true。
// skipRender: 入力欄の値を確定するときなど、画面を作り直さない（作り直すとフォーカスが外れる）
function save(skipRender = false) {
    // 古いタブからは保存しない（新しいタブのデータを上書きしないため）
    if (!isActiveTab()) { if (tabReady) markTabStale(); return false; }
    let ok = true;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        ok = false;
        console.error('save failed', e);
        if (!saveErrorShown) { saveErrorShown = true; alert('データを保存できませんでした（端末の空き容量やプライベートブラウズを確認してください）。'); }
    }
    if (!skipRender) renderMain();
    return ok;
}
let saveErrorShown = false;

// ============================================================
// 複数タブ対策: iOS ショートカットから URL で値を送ると Safari で新しいタブが開くので、
// 最後に開いたタブだけを「使えるタブ」にし、古いタブは保存を止めて閉じるよう案内する（#stale-tab）
// ============================================================
const TAB_KEY = 'pachinko_active_tab';
const MY_TAB_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let tabStale = false;
let tabReady = false; // 起動処理で使用権を取るまでは、古いタブの判定・表示をしない

function claimActiveTab() {
    try { localStorage.setItem(TAB_KEY, MY_TAB_ID); } catch (e) {}
}
function isActiveTab() {
    try {
        const id = localStorage.getItem(TAB_KEY);
        return !id || id === MY_TAB_ID;
    } catch (e) { return true; }
}
function markTabStale() {
    if (tabStale) return;
    tabStale = true;
    document.getElementById('stale-tab').classList.add('active');
}
function checkActiveTab() { if (tabReady && !isActiveTab()) markTabStale(); }
window.addEventListener('storage', (e) => { if (e.key === TAB_KEY) checkActiveTab(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkActiveTab(); });
window.addEventListener('pageshow', checkActiveTab);

// 起動: 使用権を取る → 保存データを読み直す（スクリプト読込〜起動の間に別タブが保存した分を失わない）→ 画面を出す
// → （URL で値が送られてきたら）確認ダイアログを出して適用
let started = false;
function startup() {
    if (started) return;
    started = true;
    claimActiveTab();
    data = loadData();
    tabReady = true;
    init(); // 画面を作る（renderMain など）
    setTimeout(() => {
        // URL のクエリで送られてきた値の適用（ハナハナの applyShortcutParams。送信日時 t で古い送信を無視し、
        // 上書き前に確認し、適用したら history.replaceState で URL から消す）
    }, 50);
}
// window.onload = () => startup();
