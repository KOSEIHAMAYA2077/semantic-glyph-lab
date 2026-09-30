# 現在地

開始: 2026-09-30 13:50 JST / 終了期限: 18:50 JST (09:50 UTC)
更新: 2026-09-30 15:01 JST。5時間の比較実験を継続中。

## 保全

既存ai-game-labのHEADは782c35d6d50b983355db73ccfbd2542585288474、現在もclean。変更していない。旧4173のサーバーも触らない。新しい公開repoはKOSEIHAMAYA2077/semantic-glyph-lab、branch feat/semantic-surface-prototypes。

## 動くもの

- 新しい画面4183、意味API4184、部品API4185、Shap-E生成API4186。既存4173は変更なし。
- MiniLM公式int8 ONNX、CPU推論。初回未見言い換え21/24、同じ問題の回帰22/24。未対応編集/否定も保守的に保持。
- 24手続き形状、Kenney CC0 OBJ、Shap-E 14比較GLB、TripoSR復元3GLBを同じ文字表面で表示。
- 生成GLBへの属性追記で元メッシュを保持し四角さ/ねじれを変更。
- Qwen3-4B-Instructの高水準部品合成: 7条件39要求を比較。座標だけの方式は形が崩れ、高水準部品の方式を採用。花瓶+木を実UI表示。
- 自由な英語からShap-Eを実HTTP生成。teapot約41秒、画面のtwo-handled vase41.610秒。物体の胴は成立、細部は失敗する。
- 三平面の文字投影と、4,096個の文字が面を歩く表示を切替可能。平面文字の曲率食い込みは制限として残す。
- 244単体/20ブラウザ/型検査/ビルド通過。意味19件/生成8件は各専用Python環境で通過。全serverを意味envで一括discoverするとCLIP不足になるので環境別に実行。
- atlas拡張のGPU領域不整合、遅れた生成の上書き、入力上限での切り捨てを修正。キーボード操作修正とオフライン規則171人工例の一致も確認済み。

## 保存済みの版

public repo https://github.com/KOSEIHAMAYA2077/semantic-glyph-lab 、draft PR1。
prototype-v0.1.0 / f76715c は公開済み。上の追加はprototype-v0.2.0として保存する。入力は非永続のまま。日本語→説明→Shap-Eも実UIで完走。

## 所有と次の実験

- root: 共通描画・UI・結合検証・公開。surface-02で統合記録。v0.2チェックポイントを作成。
- shape_geometry: experiments/translation-model/**、.local/translation-model*/**。公式Helsinki日英翻訳モデル303MBをCPUで比較。LLM説明で木/急須など誤訳したため。server/composition.pyとtranslation実験は解放済み。
- semantic_mesh_research: 新規server/image_pipeline.py、server/test_image_pipeline.py、experiments/text-image-live/**、.local/image-pipeline-runtime/**。画像経由を4187ローカルAPI化。既存text-image実験6件/素材/環境は解放済み、変更せず読取再利用。入力・画像・GLBを保存しない。
- text3d_research: experiments/advanced-mesh/**、.local/advanced-mesh*/**。公式TripoSGの画像→立体を独立評価予定、重み約7.95GB safetensors/MIT。公式はCUDA要求、Macは今回の未検証adapter。MPS小試験から。既存advection/オフライン規則は解放済み。
- rootの次: 4187と必要なら翻訳候補を統合。同じ人工花瓶でTripoSR/TripoSGを比較し、改善がない方式を無理に採らない。GPU推論は担当間で逐次調整。15:01時点はrootのShap-E生成が終了しGPU空き。

## 運転と継続

heartbeat 3d-5、20分ごと、18:50まで。旧automation3はPAUSED。新規caffeinateのPIDは.local/awake.jsonに保存（起動時47091、有限時間）。公開には含めない。APIや画面が停止していたら各READMEの手順でこのリポジトリだけを起動する。

終了20分前から新規の大型実験に着手せず、試遊版・結果・制限・再開方法をまとめ、heartbeatを停止し、自分が起動したcaffeinateだけ終了する。途中の停止指示は優先。
