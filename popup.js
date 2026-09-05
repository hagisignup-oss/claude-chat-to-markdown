const btn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

function setStatus(text) {
  statusEl.textContent = text;
}

btn.addEventListener("click", async () => {
  btn.disabled = true;
  setStatus("会話を抽出中...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.startsWith("https://claude.ai/")) {
      setStatus("claude.aiのタブを開いた状態で使ってください");
      btn.disabled = false;
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_CONVERSATION",
      });
    } catch (err) {
      // content scriptがまだ注入されていない場合（拡張インストール直後など）は動的注入を試す
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      response = await chrome.tabs.sendMessage(tab.id, {
        type: "EXTRACT_CONVERSATION",
      });
    }

    if (!response || !response.markdown) {
      setStatus("会話が見つかりませんでした。ページを開き直して試して");
      btn.disabled = false;
      return;
    }

    const blob = new Blob([response.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url,
      filename: response.filename,
      saveAs: false,
    });

    setStatus("保存完了。ダウンロードフォルダ見て");
  } catch (err) {
    console.error(err);
    setStatus("エラー発生。DevToolsのコンソール確認して");
  } finally {
    btn.disabled = false;
  }
});
