# Claude Chat to Markdown

[claude.ai](https://claude.ai/) の会話を、ポップアップの「保存」ボタン1つでMarkdown形式にしてダウンロードできるChrome拡張機能（Manifest V3）です。

## 機能

- claude.aiの会話画面で拡張機能アイコンをクリックし、「会話を保存」ボタンを押すだけ
- 会話全体（ユーザーの発言・Claudeの返信の両方）を `## User` / `## Claude` の見出し付きMarkdownに変換してダウンロード
- コードブロック（言語指定付き）、箇条書き、画像なども可能な範囲でMarkdownとして保持
- 長い会話でも、画面の一番上までスクロールしながら仮想スクロールで隠れているメッセージを自動的に読み込んで収集するため、取りこぼしが起きにくい設計

## 対応サイト

現時点ではclaude.aiのみに対応したMVPです（ChatGPT等の他サイトには非対応）。

## インストール方法（開発者モードでの読み込み）

Chromeウェブストアには公開していないため、「デベロッパーモード」で手動読み込みする形でインストールします。

1. このリポジトリをダウンロードします。
   - 右上の「Code」→「Download ZIP」でダウンロードするか、
   - [Releases](../../releases) から配布用のzipをダウンロードして展開してください。
2. Chromeで `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」のトグルをONにします。
4. 「パッケージ化されていない拡張機能を読み込む」（Load unpacked）をクリックします。
5. 展開したフォルダ（`manifest.json` があるフォルダ）を選択します。
6. 拡張機能一覧に「Claude Chat to Markdown」が追加されれば完了です。

## 使い方

1. [claude.ai](https://claude.ai/) で保存したい会話を開きます。
2. ツールバーの拡張機能アイコン（パズルピースアイコン→ピン留めすると表示されます）から本拡張機能を開きます。
3. 「会話を保存」ボタンをクリックします。
4. 少し待つと、`claude-chat-YYYYMMDD-HHMMSS.md` という名前でMarkdownファイルがダウンロードされます。

## 既知の制限

- claude.aiのDOM構造（class名・data属性）は予告なく変更されることがあります。ある日突然「会話が見つかりません」と表示されるようになった場合、DevToolsで実際のHTML構造を確認し、`content.js` 内のセレクタ（`TURN_SELECTORS` など）を更新する必要があります。
- 非常に長い会話では、最上部までスクロールして全メッセージを収集する都合上、保存完了までに数秒〜数十秒かかることがあります。処理中はポップアップを閉じずにお待ちください。
- claude.ai以外のサイト（ChatGPTなど）には対応していません。

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `manifest.json` | Manifest V3の設定ファイル。claude.aiのみに `host_permissions` を付与 |
| `popup.html` / `popup.js` | 「会話を保存」ボタン1つのポップアップUI。content scriptに抽出を依頼し、結果をダウンロード |
| `content.js` | claude.aiの会話画面DOMから発言を抽出し、Markdownに変換する本体ロジック |

## ライセンス

[MIT License](./LICENSE)
