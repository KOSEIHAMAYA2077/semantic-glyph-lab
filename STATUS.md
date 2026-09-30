# 現在地

開始: 2026-09-30 13:50 JST / 終了期限: 18:50 JST (09:50 UTC)
更新: 2026-09-30 15:48 JST。5時間の比較実験を継続中。

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
prototype-v0.1.0 / f76715c、prototype-v0.2.0 / bc1a8d4、prototype-v0.3.0 / bceba9f を公開済み。PR1もv0.3の結果へ更新した。入力は非永続のまま。日本語→説明→Shap-Eも実UIで完走。

## 所有と次の実験

- root: v0.3.0 / bceba9f を公開し、PR1の本文を更新。全6サービスはroot exec session18841がまとめて稼働。既存4173と旧repoは保全。新IAB tab11に生成済みじょうろと人工文27文字を表示、形の揺らぎ0.6を実操作確認。
- input-routing v1: 24例を固定して8Bを1回ずつ実測。形式成立3/24、事前の厳格な操作契約0/24、raw action一致10/24。球体1個の例は既定countを省略した形式上の不一致で、意味も全例失敗とは主張しない。未知名詞を花瓶・円錐へ寄せる、禁止と解除を混同する誤りがありUI接続を見送った。全rawは保全。
- shape_geometry: experiments/input-routing-v2/**、.local/input-routing-v2*/** を所有。カタログを見せずactionだけ判断し、newは既存説明prompt、editは差分だけを別段で抽出する。24例は回帰として再利用、新12例をpromptより先に固定。推奨samplingへも変更するので設計単独の効果とはしない。v1 README結果節だけ確定してfreezeする。
- semantic_mesh_research: experiments/input-routing-model/**、.local/input-routing-qwen14*/** を所有。公式14Bの約7.85GBを取得・hash/条件確認中。既存8B envはread-onlyで利用し、依存更新なし。比較はv1と同じ24例/prompt/greedyでモデル差だけを見る。GPU推論はまだ許可せず8B-v2の解放後に調整する。
- text3d_research: src/intent.test.ts と src/continuous.test.ts の2ファイルだけ所有。CPUモックで連続受付・世代競合・失敗保持・上限・再試行を検証。
- root: src/intent.ts、src/continuous.ts と experiments/continuous-input/PLAN.md を所有。未接続のクライアント契約・直列処理案。文章受理は即時、GPU処理は同時1件、生成中の追記は後で先に解釈し最新属性で採用する。ルータの成績を見て採用判断する。現在のmain/APIにはまだ変更していない。
- 次の区切り: v2の段階別成績と14B比較を踏まえ、連続入力を試験モードとして接続する価値を判断。未見名詞を似た既知形へ押し込む場合は接続しない。準備したCPUハーネスは不採用でも記録として残す。

## 運転と継続

heartbeat 3d-5、20分ごと、18:50まで。旧automation3はPAUSED。新規caffeinateのPIDは.local/awake.jsonに保存（起動時47091、有限時間）。公開には含めない。APIや画面が停止していたら各READMEの手順でこのリポジトリだけを起動する。

終了20分前から新規の大型実験に着手せず、試遊版・結果・制限・再開方法をまとめ、heartbeatを停止し、自分が起動したcaffeinateだけ終了する。途中の停止指示は優先。
