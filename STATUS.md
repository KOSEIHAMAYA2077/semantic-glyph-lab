# 現在地

開始: 2026-09-30 13:50 JST / 終了期限: 18:50 JST (09:50 UTC)
更新: 2026-09-30 16:32 JST。5時間の比較実験を継続中。

## 保全と保存版

元の ai-game-lab は HEAD 782c35d6d50b983355db73ccfbd2542585288474 のまま、変更しない。旧4173にも触らない。
新repo: https://github.com/KOSEIHAMAYA2077/semantic-glyph-lab 、branch feat/semantic-surface-prototypes、draft PR1。
公開済み: prototype-v0.1.0 / f76715c、v0.2.0 / bc1a8d4、v0.3.0 / bceba9f。
入力振り分け研究は 2a5cb53（research-routing-v1）、追加比較は9c04e0cまでpush済み。
mainは初期docsのみなので、動くコードを案内する場合はbranch/tagへリンクする。

## 動くもの

- 4183画面、4184意味検索、4185部品合成、4186 Shap-E、4187画像経由、4188説明専用8B。
- 24手続き形状、CC0 OBJ、複数の生成/復元GLBを同じ文字表面へ。元の文字と色を保持。
- 日本語→8B説明→Shap-EまたはSDXL Turbo/U2NETP/TripoSRは実UIで確認済み。同じ日本語3例を両経路へ通す6生成も保存済み。
- 形の揺らぎと文字の動きは独立。通常textureと面上文字advectionを選べる。表示の数値/境界/GLB読込/IME/サイズ上限を検証済み。
- v0.3時点248単体・26ブラウザ・型検査/build通過。続くCPUハーネス67例と候補UI6ブラウザ、素材API12群が追加通過。v0.4の全単体449件と型検査/buildは通過。ブラウザ全38件の最終回帰も通過。

## 完了した追加研究

- 自動振り分け: 8B一段、8B二段、14B一段、4B Instructを固定人工例で比較。14Bは形式改善しても急須をkamabokoとする等が残る。二段では新対象を編集に寄せる。どれも通常UIへ採用せず、raw・固定計画・失敗を保存。
- 連続入力CPUハーネス: 即時原文保持、8件待機、古い世代の破棄、後から来た属性、再試行の67テスト。既定mainには未接続。
- 素材検索: 公式Poly Haven 521件メタデータをCPU検索。実3CC0素材（花瓶/じょうろ/剣）を取得し、原本保持、geometry-only GLB計751KBへ。3候補だけでは未所蔵の馬が正しいじょうろより高スコア。自動採用は撤回し、ユーザー選択UIを追加した。検索時に原文だけ追加、選択は文字を重複追加しない。
- 2D流体の表面投影: 128²速度・圧力投影・逆写像。GPU線形補間の累積誤差を明示4点補間で改善。60秒は約60fps/折返し0、300秒で文字が伸び、600秒で折返し358セル。連続無期限の流体とはしない。通常既定を維持し、実験optionと手動リセットを接続。

## 現在の所有と次の実験

- root: main.ts/scene.ts/API/launcher/docsを所有。素材API4189はexec session9677、旧6サービスはsession18841。全7ready。rootの最新IABはtab12（HMRで初期画面に戻る場合あり）。最終UI操作・出力比較・v0.4保存とPR更新を担当。
- shape_geometry: fluid UI6件通過、所有解放。渦の停止/再開・flow0・mode休止・atlas拡張・GLB/母体変形・非対応環境・流れリセットを確認。素材UI tests/retrieval.spec.tsは6/6完了、所有解放済み。
- semantic_mesh_research: read-onlyレビュー完了。research/setup-scope.mdを追加して所有解放。新規Macの重い経路の導入は未自動化/未一括検証と明記。src/retrieval.test.tsとsrc/local-attribute-edit.test.tsは所有解放済み。禁止文と色形容の境界を検証済み。
- text3d_research: src/writing-preview/** と experiments/writing-preview/** だけ所有。新独立入口でContinuousInputハーネスをUI接続する準備。利用者が『文章から形』『今の形を編集』『文字だけ』を明示選択し、各送信の選択を固定。モデルが自動振り分けする機能は使わない。文字は先に受理、生成中も次の入力を可能にし、mock検証を先行。実モデル呼出はrootの調整後1人工例のみ。
- fluid既存所有は解放済み。独立preview4190はPID65934/session59256で稼働。long-run-v1を含む全失敗/比較は保全。数値計測は終了、GPU生成は現在空き。

## 運転と終了

heartbeat 3d-5、20分ごと、18:50まで。旧automation3はPAUSED。自分のcaffeinate PID47091は.local/awake.json（有限時間）。
終了20分前から新しい大型実験を始めず、試遊入口・成果・制限・再開方法をまとめる。heartbeatをPAUSEDにし、自分のcaffeinateだけ終了。旧環境やファイルを削除しない。
公開対象はコード・許可された素材・人工例の結果のみ。重み/.local/参考本/ユーザー原稿/添付画像は公開しない。新service/previewだけを明確な所有で扱う。
