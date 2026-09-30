# 現在地

開始: 2026-09-30 13:50 JST / 終了期限: 18:50 JST (09:50 UTC)
更新: 2026-09-30 15:34 JST。5時間の比較実験を継続中。

## 保全

既存ai-game-labのHEADは782c35d6d50b983355db73ccfbd2542585288474、現在もclean。変更していない。旧4173のサーバーも触らない。新しい公開repoはKOSEIHAMAYA2077/semantic-glyph-lab、branch feat/semantic-surface-prototypes。

## 動くもの

- 新しい画面4183、意味API4184、部品API4185、Shap-E生成API4186、画像経由API4187、説明専用8B API4188。既存4173は変更なし。
- MiniLM公式int8 ONNX、CPU推論。初回未見言い換え21/24、同じ問題の回帰22/24。未対応編集/否定も保守的に保持。
- 24手続き形状、Kenney CC0 OBJ、Shap-E 14比較GLB、TripoSR復元3GLBを同じ文字表面で表示。
- 生成GLBへの属性追記で元メッシュを保持し四角さ/ねじれを変更。
- Qwen3-4B-Instructの高水準部品合成: 7条件39要求を比較。座標だけの方式は形が崩れ、高水準部品の方式を採用。花瓶+木を実UI表示。
- 自由な英語からShap-Eを実HTTP生成。teapot約41秒、画面のtwo-handled vase41.610秒。物体の胴は成立、細部は失敗する。
- 三平面の文字投影と、4,096個の文字が面を歩く表示を切替可能。平面文字の曲率食い込みは制限として残す。
- 248単体/型検査/ビルド通過。26ブラウザ最終通過。意味19件/部品10件/説明9件/生成8件/画像11件/8B API6件は各専用Python環境で通過。全serverを意味envで一括discoverするとCLIP不足になるので環境別に実行。
- atlas拡張のGPU領域不整合、遅れた生成の上書き、入力上限での切り捨てを修正。キーボード操作修正とオフライン規則171人工例の一致も確認済み。

## 保存済みの版

public repo https://github.com/KOSEIHAMAYA2077/semantic-glyph-lab 、draft PR1。
prototype-v0.1.0 / f76715c、prototype-v0.2.0 / bc1a8d4 は公開済み。v0.3.0の統合を保存する段階。入力は非永続のまま。日本語→説明→Shap-Eも実UIで完走。

## 所有と次の実験

- root: v0.3の共通描画、4187/4188、6比較形状の選択を統合済み。再起動コマンドで全6サービスを新規起動→Ctrl+Cで所有分だけ停止→再起動を実確認。現在root exec session18841がまとめて稼働。既存4173は200/旧Git clean。
- semantic_mesh_research: 3人工文×2生成の6メッシュ比較を完了、所有解放。画像経由はじょうろの部位を保ち、Shap-Eは傘の薄い面が良い。6PNGと全文結果はexperiments/end-to-end、選択用manifestはpublic/end-to-end-models。
- shape_geometry: 新規 experiments/input-routing/**、.local/input-routing*/** だけ所有。『新しい物体 / 現在形の属性編集 / 形は保持』を8Bの制約付きJSONで分ける実験。20〜24人工例を先に固定し、未見名詞を近い既知形へ誤誘導しないか確認。API/画面へはまだ接続しない。既存translation-model/description APIは完了・解放。
- text3d_research: bodyMotionの低ポリ中心沈み修正と9画面/馬の性能確認完了・解放。TripoSGの公開採用は見送った。詳細・出力は.localだけ、公開は判断READMEのみ。
- 次の区切り: v0.3をGitHubへ保存し、input-routingの成績から連続入力の試作へ接続する価値を判断する。画面は26ブラウザ最終検証と、生成じょうろの実操作を確認。GPU推論はinput-routing担当に渡し、rootはMLを使わない。

## 運転と継続

heartbeat 3d-5、20分ごと、18:50まで。旧automation3はPAUSED。新規caffeinateのPIDは.local/awake.jsonに保存（起動時47091、有限時間）。公開には含めない。APIや画面が停止していたら各READMEの手順でこのリポジトリだけを起動する。

終了20分前から新規の大型実験に着手せず、試遊版・結果・制限・再開方法をまとめ、heartbeatを停止し、自分が起動したcaffeinateだけ終了する。途中の停止指示は優先。
