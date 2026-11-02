// ============================================================
// ハナハナカウンター（index.html）から抜き出した「振動」と「タップの数え方」。
// iPhone の実機で何度も直して落ち着いた形なので、仕組みは変えずに使うこと（docs/HANDOFF.md「6.」）。
// 元の関数: hapticTapHtml / haptic / addHaptics / attachEvents / showTapDelta / startMachinePress ほか
// ============================================================

// ---------- 振動 ----------
// iOS Safari は navigator.vibrate 非対応なので、iOS 18 以降の「スイッチ型チェックボックスを切り替えると触覚フィードバックが出る」
// 挙動を使う（非公式）。プログラムからの label.click() は WebKit の修正で振動しなくなったため、透明な <label> をかぶせて
// 指のタップ（本物のユーザー操作）で直接スイッチを切り替える。振動はタップが click になったときだけ出る。

// メイン画面のセル用（セルの中の最後に入れる）
function hapticTapHtml() {
    return '<label class="haptic-tap" aria-hidden="true"><input type="checkbox" switch tabindex="-1"></label>';
}
// navigator.vibrate がある端末（Android など）
function haptic() {
    try {
        if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
    } catch (e) { /* 振動できない環境では何もしない */ }
}

// セル以外の「押すと何か起きるもの」（アイコン・タイトル・ボタン・タブ・テンキーなど）にも同じラベルを自動で付ける。
// 押した時の処理は要素の onclick のまま（ラベルの click がそのまま伝わる）。
// ラベルが中のスイッチへ送る2回目の click はラベルで止める（止めないと処理が2回動く）。
// 押した瞬間に自分を描き直す要素はラベルも消えるので、できれば中身だけ書き換える
const HAPTIC_TARGETS = [
    '.header-icon[onclick]', '#disp-machine', '.modal-title[onclick]', '#setting-modal .cell[onclick]', 'button',
    '.hist-filter-btn',
    // 新しいボタンを足したらここに入るか確認する
].join(', ');
const HAPTIC_LABEL_HTML = '<label class="haptic-tap" aria-hidden="true" onclick="if (event.target !== this) event.stopPropagation();"><input type="checkbox" switch tabindex="-1"></label>';
function addHaptic(el) {
    if (!el.querySelector(':scope > .haptic-tap')) el.insertAdjacentHTML('beforeend', HAPTIC_LABEL_HTML);
}
function addHaptics(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches(HAPTIC_TARGETS)) addHaptic(root);
    root.querySelectorAll(HAPTIC_TARGETS).forEach(addHaptic);
}
// ラベルを要素全体にかぶせるため、対象は position: relative（className を書き換える要素でも外れないよう、同じセレクタの CSS で）
document.head.insertAdjacentHTML('beforeend', `<style>${HAPTIC_TARGETS} { position: relative; }</style>`);
addHaptics(document.body);
// 描き直しで出てきた要素と、中身を書き換えた要素（ボタンの文字を「保存中...」にした等）に付け直す
new MutationObserver(ms => ms.forEach(m => {
    if (m.target.nodeType === 1 && m.target.matches(HAPTIC_TARGETS)) addHaptic(m.target);
    m.addedNodes.forEach(addHaptics);
})).observe(document.body, { childList: true, subtree: true });


// ---------- タップの数え方（メイン画面のセル） ----------
// セルの例: <div class="cell t-btn" data-key="spin" data-step="1"><div class="label">回転数</div><div class="value">0</div>${hapticTapHtml()}</div>
// タップ +1（水色）、長押し 300ms で赤くなり −1。指を 50px 動かしたらキャンセル。
// 加算は pointerup。iOS が pointerup の代わりに pointercancel を送ったり pointerup が届かなかったりすると
// 「振動したのに数えない」になるので、振動用ラベルの click でも数える（click 補完）。1回の押下で1回だけ。
// セルで押し始めていない click（「＜ベル＞」などの見出しを押したときに iOS のタップ位置補正で近くのセルに届く click）は打ち消す。

// 一番最近どのセルで押し始めたか（セル以外なら null）
let lastDownCell = null;
document.addEventListener('pointerdown', (e) => {
    lastDownCell = (e.target && e.target.closest) ? e.target.closest('#main-ui .cell.t-btn') : null;
}, true);

// タップの記録に残すセルの名前
function tapLogId(el) { return el.dataset.key || '?'; }

// applyCount(el, isMinus): 1回分の増減を実際に行い、実際の増減（下限で変わらなければ 0）を返す。
// セルの数値の表示もそこで書き換える（セルは作り直さない。作り直すと押している最中のセルと振動用ラベルが消える）
function attachEvents(applyCount) {
    document.querySelectorAll('#main-ui .cell.t-btn').forEach(el => {
        let sy, sx, isC, minusTimer, visualTimer;
        let pending = false;   // 押下中で、まだ数えていない
        let movedOut = false;  // 指を大きく動かしてキャンセルした押下（click が来ても数えない）
        let downAt = 0;        // 押し始めた時刻（click 補完時の長押し判定用）
        let log = null;        // 操作ログ（調査用）

        const handleStart = (y, x) => {
            // 前の押下のタイマー・色が残っていたら消す（click 補完で確定した押下のタイマーが次の押下を −1 にしないため）
            clearTimeout(visualTimer);
            clearTimeout(minusTimer);
            el.classList.remove('touch-active', 'minus-mode');
            sy = y; sx = x; isC = false;
            lastDownCell = el;
            pending = true; movedOut = false; downAt = Date.now();
            log = { t: new Date().toTimeString().slice(0, 8), id: tapLogId(el), ev: 'down', ms: 0, result: '' };
            pushTapLog(log);
            // 水色は 70ms 遅らせる（スクロール時の誤発光防止）
            visualTimer = setTimeout(() => { if (!isC) el.classList.add('touch-active'); }, 70);
            // 300ms で赤（マイナス）
            minusTimer = setTimeout(() => { if (!isC) el.classList.add('minus-mode'); }, 300);
        };

        const handleMove = (y, x) => {
            // 指が 50px 以上ズレたらスクロールとみなし、タイマーを止めて色も消す
            if (Math.abs(y - sy) > 50 || Math.abs(x - sx) > 50) {
                if (!movedOut && log) log.ev += ' move';
                isC = true;
                movedOut = true;
                clearTimeout(visualTimer);
                clearTimeout(minusTimer);
                el.classList.remove('touch-active', 'minus-mode');
            }
        };

        const handleEnd = () => {
            clearTimeout(visualTimer);
            clearTimeout(minusTimer);
            if (log) { log.ev += ' up'; log.ms = Date.now() - downAt; }
            if (isC || !pending) return; // キャンセル済み・数え済みなら終了
            applyTap(el.classList.contains('minus-mode'), '');
        };

        // 1回分の加算・減算。isMinus は長押し（300ms 以上）
        const applyTap = (isMinus, note) => {
            pending = false;
            clearTimeout(visualTimer);
            clearTimeout(minusTimer);
            haptic(); // Android 等（iPhone は振動用ラベルの click で振動）
            const delta = applyCount(el, isMinus);
            if (log) log.result = (delta !== 0 ? (delta > 0 ? '+' : '') + delta : (isMinus ? '変化なし(長押し・下限)' : '変化なし')) + note;
            renderTapLog();
            showTapDelta(el, delta); // ボタンの下に増減を出す（指で隠れても分かるように）
            // 超高速タップ（70ms 未満）でも「押した感」を出すフラッシュ
            if (!isMinus) {
                el.classList.add('touch-active');
                setTimeout(() => el.classList.remove('touch-active'), 100);
            } else {
                el.classList.remove('touch-active', 'minus-mode');
            }
        };

        const handleCancel = () => {
            // iOS の pointercancel。続けて click が来たら（＝振動したら）そこで数える
            if (log) { log.ev += ' cancel'; log.ms = Date.now() - downAt; }
            isC = true;
            clearTimeout(visualTimer);
            clearTimeout(minusTimer);
            el.classList.remove('touch-active', 'minus-mode');
        };

        // click（振動用ラベルの本物のタップ）: pointerup で数えていなければ、ここで数える。
        // ラベルの click と、ラベルが中のスイッチへ送る click の2回来る。判定はラベル（またはセル）の1回目だけで行い、
        // スイッチへの2回目は触らない（打ち消すとスイッチが切り替わらず振動しない）
        const handleClick = (e) => {
            if (e && e.target && e.target.tagName === 'INPUT') return;
            // 一番最近の押し始めがこのセルで、2秒以内のときだけ扱う。それ以外は枠外から回ってきた click なので打ち消す
            const touchedHere = lastDownCell === el && downAt > 0 && Date.now() - downAt < 2000;
            if (!touchedHere) {
                if (e) e.preventDefault();
                pushTapLog({ t: new Date().toTimeString().slice(0, 8), id: tapLogId(el), ev: 'click', ms: 0, result: '打ち消し(枠外のclick)' });
                renderTapLog();
                return;
            }
            const pressedMs = Date.now() - downAt;
            downAt = 0; // この押下の click は処理済み
            if (log && !/click/.test(log.ev)) {
                log.ev += ' click';
                if (!/up|cancel/.test(log.ev)) log.ms = pressedMs;
            }
            if (!pending || movedOut) { renderTapLog(); return; }
            applyTap(pressedMs >= 300, '(click補完)');
            el.classList.remove('touch-active', 'minus-mode');
        };

        // タッチはブラウザが指を置いた要素（振動用ラベル）へ自動でキャプチャするので、明示的なキャプチャはマウスだけ。
        // タッチでセルにキャプチャすると click の宛先がセルになり、振動用ラベルのスイッチが切り替わらない
        el.onpointerdown = (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (e.pointerType === 'mouse') el.setPointerCapture(e.pointerId);
            handleStart(e.clientY, e.clientX);
        };
        el.onpointermove = (e) => { handleMove(e.clientY, e.clientX); };
        el.onpointerup = (e) => {
            if (e.pointerType === 'mouse') el.releasePointerCapture(e.pointerId);
            handleEnd();
        };
        el.onpointercancel = () => { handleCancel(); };
        el.onclick = handleClick;
        el.oncontextmenu = (e) => e.preventDefault();
    });
}

// applyCount の例（ハナハナの applyTap の中身を簡単にしたもの）
// function applyCount(el, isMinus) {
//     const key = el.dataset.key;
//     const step = (isMinus ? -1 : 1) * Number(el.dataset.step || 1);
//     const d = getData();
//     const before = Number(d.cur[key]) || 0;
//     d.cur[key] = Math.max(0, before + step);      // 下限
//     el.querySelector('.value').textContent = d.cur[key];
//     save(true);                                   // 画面は作り直さない
//     return d.cur[key] - before;
// }
// renderMain() の最後で: if (data.mode === 'tap') attachEvents(applyCount);


// ---------- 操作ログ（直近20件、メモリのみ。管理画面の #tap-log に出す） ----------
// 「振動したのに数えない」などが起きたら、実機のスクリーンショットで原因を調べる
const tapLog = [];
function pushTapLog(entry) {
    tapLog.unshift(entry);
    if (tapLog.length > 20) tapLog.length = 20;
}
function renderTapLog() {
    const el = document.getElementById('tap-log');
    if (!el) return;
    el.textContent = tapLog.length === 0 ? '（まだありません）'
        : tapLog.map(e => `${e.t} ${e.id} [${e.ev}] ${e.ms}ms → ${e.result || '数えず'}`).join('\n');
}


// ---------- 押したボタンの下に増減を出す ----------
// 一定時間（1回転分の 4.1 秒）で消える。消える前に同じボタンを操作したら合計を出し直して時間をリセット
// （例: 2回タップで +2、タップ→長押しで ±0）。値は実際の増減
let tapDeltaMs = 4100;
const tapDeltas = {};   // ボタンごとの { sum, timer, el }
function showTapDelta(cell, delta, label = '') {
    const key = tapLogId(cell);
    const layer = document.getElementById('tap-delta-layer');
    if (!layer) return;
    let t = tapDeltas[key];
    if (!t) {
        const el = document.createElement('div');
        el.className = 'tap-delta';
        el.dataset.key = key;
        layer.appendChild(el);
        t = tapDeltas[key] = { sum: 0, timer: null, el };
    }
    t.sum += delta;
    t.el.textContent = label || (t.sum > 0 ? `+${t.sum}` : (t.sum < 0 ? `${t.sum}` : '±0'));
    t.el.className = 'tap-delta ' + (label ? 'mark' : (t.sum > 0 ? 'plus' : (t.sum < 0 ? 'minus' : 'zero')));
    const r = cell.getBoundingClientRect();
    t.el.style.left = (r.left + r.width / 2) + 'px'; // ボタンの真下（下の隙間）
    t.el.style.top = r.bottom + 'px';
    clearTimeout(t.timer);
    t.timer = setTimeout(() => { t.el.remove(); delete tapDeltas[key]; }, tapDeltaMs);
}
// 画面の向きが変わると位置がずれるので、出ている表示は消す
function clearTapDeltas() {
    Object.keys(tapDeltas).forEach(k => { clearTimeout(tapDeltas[k].timer); tapDeltas[k].el.remove(); delete tapDeltas[k]; });
}
window.addEventListener('resize', clearTapDeltas);


// ---------- 押すと画面を切り替える要素（ハナハナの機種名: タップで画面1・画面2、長押しでまとめて加算） ----------
// 指を離した瞬間（pointerup）に画面を描き直すと、iOS がそのタップを click にせず振動しない。
// そこで切替は click の時に行う。click が来なかったときは 0.4 秒後に予備で切り替える（振動はしない）。
// pointercancel の後でも押し始めから2秒以内の click なら切り替える。連打で前のタップの click がまだなら、次を押した時点で前の分を切り替える。
// HTML: <div id="disp-machine" onpointerdown="startMachinePress()" onpointerup="endMachinePress()"
//            onpointerleave="cancelMachinePress()" onpointercancel="cancelMachinePress()" onclick="machineTapDone()"
//            oncontextmenu="event.preventDefault();">…</div>
let machinePressTimer = null;
let machineTapTimer = null;
let machinePress = null; // 押している間〜切り替えるまで: { at: 押し始めた時刻, long: 長押しか, up: 離したか }

function startMachinePress() {
    // 前のタップ（離した後、まだ click も予備のタイマーも来ていない）の切替は先に済ませる
    if (machinePress && machinePress.up) machineTapDone();
    clearTimeout(machineTapTimer);
    const p = machinePress = { at: Date.now(), long: false };
    machinePressTimer = setTimeout(() => {
        p.long = true;
        onMachineLongPress(); // 長押しの処理（ハナハナはまとめて加算を開く。押している間に開くので振動はしない）
    }, 550);
}
function endMachinePress() {
    clearTimeout(machinePressTimer);
    if (!machinePress || machinePress.long) { machinePress = null; return; }
    machinePress.up = true;
    clearTimeout(machineTapTimer);
    machineTapTimer = setTimeout(machineTapDone, 400); // click が来なかったときの予備
}
function cancelMachinePress() {
    clearTimeout(machinePressTimer);
    if (machinePress && machinePress.long) machinePress = null;
}
function machineTapDone() {
    clearTimeout(machineTapTimer);
    const p = machinePress;
    machinePress = null;
    if (!p || p.long || (!p.up && Date.now() - p.at > 2000)) return;
    onMachineTap(); // タップの処理（ハナハナは画面1・画面2 の切替）
}
