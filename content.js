/**
 * content.js
 *
 * claude.aiの会話画面DOMから発言を抽出してMarkdownに変換する。
 *
 * 注意：claude.aiのDOM構造（class名・data属性）は予告なく変わる。
 * ここでは現時点で確認できている一般的なパターンをいくつか試す
 * フォールバック構成にしてある。もし将来「会話が見つかりません」と
 * 出るようになったら、DevToolsで実際の要素を見てセレクタを直すこと。
 *
 * 長い会話は仮想スクロール（画面に見えている範囲だけがDOMに
 * マウントされる）で描画されているため、開いた瞬間に見えている
 * ターンだけを一度スキャンしても全件は取れない。そのため
 * collectAllTurnBlocks() でスクロールコンテナを一番上まで少しずつ
 * 動かしながら、見えたターンをその都度蓄積していく。
 *
 * 【2026-08 不具合修正メモ】
 * 「長い会話だと一部しかDLできない」不具合の原因は2つ複合していた。
 *
 * 1. セレクタが完全に陳腐化していた。
 *    `[data-testid="conversation-turn"]` と `.font-claude-message` は
 *    現行DOMにはもう存在しない（`[data-testid="transcript-row"]` と
 *    `data-perf-row="human"/"assistant"` に置き換わっている）。
 *    そのためTURN_SELECTORSのフォールバック候補
 *    `div[data-test-render-count]`（本来は別用途の内部ラッパー）が
 *    誤って採用されてしまい、仮想リストの入れ替わりと噛み合わず
 *    ターンの取りこぼし・重複が発生していた。
 *
 * 2. スクロール後の待機時間が固定250msで、長い会話・Markdownが
 *    重いターンでは描画が間に合わないことがあった。間に合わない間に
 *    次のスクロールに進んでしまい、一瞬しかDOMに存在しなかった
 *    ターンを一度もキャプチャできないまま通り過ぎるケースがあった。
 *
 * 対応：
 * - TURN_SELECTORSの最優先候補を `[data-testid="transcript-row"]` に更新。
 * - ロール判定は `data-perf-row` 属性（"human" / "assistant"）を最優先で見る。
 * - 各ターンには `data-index`（無ければ `data-rs-index`）という
 *   会話全体での絶対位置番号が振られているので、これを一意キー・
 *   並び順に使う（旧DOMのみで得られるピクセル位置バケットはフォールバック）。
 * - 固定sleepではなく、可視ターンの構成（data-indexの並び）が
 *   一定時間変化しなくなるまで待つ waitForRowsSettled() に変更。
 * - アクセシビリティ用に発言全文を複製している `.sr-only` 見出し
 *   （例："Claudeが返答しました: ..."）をMarkdown変換時にスキップし、
 *   本文が二重に出力されるのを防止。
 */

// 1つの会話ターン（ユーザー or Claudeの発言）を判定するためのセレクタ候補
// 優先順：現行DOM → 旧DOM互換のフォールバック
const TURN_SELECTORS = [
  '[data-testid="transcript-row"]', // 現行（2026-08時点）：1ターン=1メッセージ
  '[data-testid="conversation-turn"]', // 旧DOM互換フォールバック
];

const USER_MARK_SELECTORS = [
  '[data-testid="user-message"]',
];

const ASSISTANT_MARK_SELECTORS = [
  '[data-testid="assistant-message"]',
  '.font-claude-response', // 現行のClaude発言コンテナ
  '.font-claude-message', // 旧DOM互換フォールバック
];

// Markdown変換時に無視する要素。
// .sr-only はアクセシビリティ用に本文全文を複製した非表示見出し
// （例：<h2 class="sr-only">Claudeが返答しました: 本文...</h2>）で、
// そのまま拾うと本文が二重に出力される。
const IGNORE_SELECTORS = [".sr-only", "button"];

function queryFirst(root, selectors) {
  for (const sel of selectors) {
    const found = root.querySelectorAll(sel);
    if (found.length > 0) return found;
  }
  return null;
}

function shouldIgnoreElement(el) {
  return IGNORE_SELECTORS.some((sel) => el.matches(sel));
}

/**
 * 要素をMarkdown文字列に再帰変換する。
 * pre/code はフェンス付きコードブロックとして保持する。
 */
function elementToMarkdown(el) {
  const parts = [];

  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (shouldIgnoreElement(node)) return;

      const tag = node.tagName.toLowerCase();

      if (tag === "pre") {
        const codeEl = node.querySelector("code") || node;
        let lang = "";
        const langClass = Array.from(codeEl.classList || []).find((c) =>
          c.startsWith("language-")
        );
        if (langClass) lang = langClass.replace("language-", "");
        const codeText = codeEl.innerText.replace(/\n$/, "");
        parts.push("```" + lang + "\n" + codeText + "\n```");
      } else if (tag === "ul" || tag === "ol") {
        const items = Array.from(node.children).map((li, i) => {
          const prefix = tag === "ol" ? `${i + 1}. ` : "- ";
          return prefix + li.innerText.trim();
        });
        parts.push(items.join("\n"));
      } else if (tag === "br") {
        // 改行はブロック単位の分割で表現するのでスキップ
      } else if (tag === "img") {
        const alt = node.getAttribute("alt") || "image";
        const src = node.getAttribute("src") || "";
        parts.push(`![${alt}](${src})`);
      } else {
        const inner = elementToMarkdown(node);
        if (inner.trim()) parts.push(inner.trim());
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
  });

  return parts.join("\n\n");
}

/**
 * roleに対応するマーカー要素をturnEl内から探す。
 * セレクタ候補は優先順に試し、最初にヒットしたものだけを採用する
 * （例えば data-testid="assistant-message" の中に .font-claude-message が
 * 入れ子で存在する場合に、同じメッセージを二重に拾わないため）。
 */
function getRoleMarkElements(turnEl, selectors) {
  for (const sel of selectors) {
    const found = turnEl.querySelectorAll(sel);
    if (found.length > 0) return Array.from(found);
  }
  return [];
}

/**
 * turnEl自体のロールを data-perf-row 属性から判定する。
 * 現行DOMでは1つのturnEl（transcript-row）が必ずどちらか一方の
 * ロールに対応しており、この属性が最も信頼できる判定材料になる。
 */
function detectRoleFromAttribute(turnEl) {
  const perfRow = turnEl.getAttribute && turnEl.getAttribute("data-perf-row");
  if (perfRow === "human") return "user";
  if (perfRow === "assistant") return "assistant";
  return null;
}

/**
 * 1つのturn要素から、含まれるメッセージを { role, el } の配列として取り出す。
 *
 * 現行DOMではturn要素(transcript-row)は必ずどちらか一方の役割だけを
 * 含み、data-perf-row属性で判定できる。この属性が取れない場合は
 * 旧DOM互換のロジック（マーカー要素探索→aria-label推測）にフォールバックする。
 *
 * 旧ロジックの補足：
 * かつては「turn要素は必ずどちらか一方の役割だけを含む」という前提で
 * ユーザー用セレクタを先にチェックし、見つかった時点で"user"を確定させていた。
 * しかしこの前提が崩れている場合（1つのturn内にユーザー発言とClaudeの返信の
 * 両方のマーカーが存在する等）、Claude側の内容には永久に到達できなくなる。
 * そのためユーザー用・Claude用のマーカーを独立に探し、両方見つかれば
 * 両方ともブロックとして扱う。
 */
function extractMessageMarks(turnEl) {
  const attrRole = detectRoleFromAttribute(turnEl);
  if (attrRole) {
    return [{ role: attrRole, el: turnEl }];
  }

  const userEls = getRoleMarkElements(turnEl, USER_MARK_SELECTORS);
  const assistantEls = getRoleMarkElements(turnEl, ASSISTANT_MARK_SELECTORS);

  const marks = [];
  userEls.forEach((el) => marks.push({ role: "user", el }));
  assistantEls.forEach((el) => marks.push({ role: "assistant", el }));

  if (marks.length === 0) {
    // フォールバック：マーカーが見つからない場合はaria-labelなどから推測
    const label = (turnEl.getAttribute("aria-label") || "").toLowerCase();
    if (label.includes("user") || label.includes("human")) {
      marks.push({ role: "user", el: turnEl });
    } else if (label.includes("claude") || label.includes("assistant")) {
      marks.push({ role: "assistant", el: turnEl });
    }
  }

  return marks;
}

/**
 * turnElの会話全体での絶対位置番号を返す（0始まり）。
 * 取得できない場合はnull（旧DOM互換のピクセル位置バケットにフォールバックする）。
 */
function getTurnIndex(turnEl) {
  const raw =
    (turnEl.getAttribute && turnEl.getAttribute("data-index")) ??
    (turnEl.getAttribute && turnEl.getAttribute("data-rs-index"));
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * turnEl を含むスクロール可能な祖先要素を探す。
 * class名に依存せず、実際にoverflowしている要素をたどって見つける。
 */
function findScrollContainer(turnEl) {
  let node = turnEl.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const canScrollY = style.overflowY === "auto" || style.overflowY === "scroll";
    if (canScrollY && node.scrollHeight > node.clientHeight + 10) {
      return node;
    }
    node = node.parentElement;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * turnEl の、スクロールコンテナ内での縦位置（コンテンツ先頭からのオフセット）を返す。
 * data-indexが取れない旧DOM向けのフォールバックにのみ使う。
 */
function getOffsetInContainer(el, container) {
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return container.scrollTop + (elRect.top - containerRect.top);
}

/**
 * 現在DOMに見えているターンの「構成」を表す文字列シグネチャを作る。
 * data-index（無ければ要素の並び順そのもの）を連結しただけの軽い比較用。
 */
function currentRowsSignature() {
  const rows = queryFirst(document, TURN_SELECTORS);
  if (!rows) return "";
  return Array.from(rows)
    .map((r) => {
      const idx = getTurnIndex(r);
      return idx !== null ? `i${idx}` : "?";
    })
    .join(",");
}

/**
 * スクロール後、見えているターンの構成が安定するまで待つ。
 * 固定sleepだと、長い会話・重いMarkdownで描画が間に合わず
 * ターンを取りこぼすことがあったため、実際の描画完了を確認しながら待つ。
 */
async function waitForRowsSettled(maxWaitMs = 1500, checkIntervalMs = 80) {
  let lastSignature = null;
  let stableTicks = 0;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    const signature = currentRowsSignature();
    if (signature === lastSignature) {
      stableTicks++;
      if (stableTicks >= 2) return; // 2回連続で同じ構成なら描画完了とみなす
    } else {
      stableTicks = 0;
      lastSignature = signature;
    }
    await sleep(checkIntervalMs);
  }
  // maxWaitMsに達しても安定しなかった場合はそのまま進む（無限待ち防止）
}

/**
 * ページ最上部までスクロールしながら、見えているターンを蓄積して収集する。
 * 仮想スクロールで一度に全ターンがDOMに存在しない前提で、
 * 少しずつ上にスクロール→描画完了待ち→見えている分をキャプチャ、を繰り返す。
 */
async function collectAllTurnBlocks() {
  const initialTurns = queryFirst(document, TURN_SELECTORS);
  if (!initialTurns || initialTurns.length === 0) return [];

  const scrollContainer = findScrollContainer(initialTurns[0]);
  const originalScrollTop = scrollContainer.scrollTop;

  const collected = new Map(); // key -> { role, md, pos }

  function captureVisible() {
    const currentTurns = queryFirst(document, TURN_SELECTORS);
    if (!currentTurns) return;

    currentTurns.forEach((turnEl) => {
      const marks = extractMessageMarks(turnEl);
      const turnIndex = getTurnIndex(turnEl);

      marks.forEach(({ role, el }, subIndex) => {
        const md = elementToMarkdown(el).trim();
        if (!md) return;

        let key, pos;
        if (turnIndex !== null) {
          // data-indexがある場合は会話内の絶対位置なのでそのまま使う。
          // 1つのturnElに複数マークが乗る旧DOM互換ケースのみ枝番を付ける。
          key = `idx::${turnIndex}::${subIndex}`;
          pos = turnIndex * 1000 + subIndex;
        } else {
          // 旧DOM向けフォールバック：位置はturnElではなく実際のメッセージ要素(el)基準にする。
          const pxPos = getOffsetInContainer(el, scrollContainer);
          // 数px程度の測定ゆらぎは同一ターンとみなしてまとめる
          const bucket = Math.round(pxPos / 8);
          key = `${role}::${bucket}`;
          pos = pxPos;
        }

        if (!collected.has(key)) {
          collected.set(key, { role, md, pos });
        }
      });
    });
  }

  const MAX_IDLE_TICKS = 5; // 一番上に着いてからこの回数分「変化なし」が続いたら終了
  const MAX_ITERATIONS = 2000; // 無限ループ防止の安全弁
  const SETTLE_WAIT_MS = 1500; // 1スクロール後、描画安定を待つ最大時間
  const TOP_RECHECK_WAIT_MS = 400; // 最上部到達後、遅延読み込みを確認する待機時間

  captureVisible();

  let idleTicks = 0;
  let lastScrollHeight = scrollContainer.scrollHeight;

  for (let i = 0; i < MAX_ITERATIONS && idleTicks < MAX_IDLE_TICKS; i++) {
    if (scrollContainer.scrollTop <= 2) {
      // 最上部にいる。遅延読み込みでさらに古い発言が増えないか少し待って確認する。
      await sleep(TOP_RECHECK_WAIT_MS);
      captureVisible();

      if (scrollContainer.scrollTop <= 2 && scrollContainer.scrollHeight === lastScrollHeight) {
        idleTicks++;
      } else {
        idleTicks = 0;
      }
    } else {
      idleTicks = 0;
      const step = Math.max(200, scrollContainer.clientHeight * 0.8);
      scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - step);
      await waitForRowsSettled(SETTLE_WAIT_MS);
      captureVisible();
    }

    lastScrollHeight = scrollContainer.scrollHeight;
  }

  // 元のスクロール位置に戻す（ユーザーの閲覧位置を変えたままにしない）
  scrollContainer.scrollTop = originalScrollTop;

  return Array.from(collected.values()).sort((a, b) => a.pos - b.pos);
}

async function extractConversation() {
  const turnBlocks = await collectAllTurnBlocks();
  if (turnBlocks.length === 0) return null;

  const blocks = turnBlocks.map(({ role, md }) => {
    const heading = role === "user" ? "## User" : "## Claude";
    return `${heading}\n\n${md}`;
  });

  return blocks.join("\n\n---\n\n");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function buildFilename() {
  const d = new Date();
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
    d.getDate()
  )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `claude-chat-${ts}.md`;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "EXTRACT_CONVERSATION") {
    extractConversation()
      .then((body) => {
        if (!body) {
          sendResponse({ markdown: null });
          return;
        }

        const title = document.title.replace(" - Claude", "").trim() || "Claude Conversation";
        const exportedAt = new Date().toLocaleString("ja-JP");
        const header = `# ${title}\n\n_Exported: ${exportedAt}_\n\n---\n\n`;

        sendResponse({
          markdown: header + body,
          filename: buildFilename(),
        });
      })
      .catch((err) => {
        console.error("[claude-md-saver] extraction failed:", err);
        sendResponse({ markdown: null });
      });
    return true; // sendResponseを非同期で呼ぶためチャンネルを開いたままにする
  }
});
