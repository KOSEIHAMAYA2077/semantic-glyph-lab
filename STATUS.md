# 現在地

開始: 2026-09-30 13:50 JST / 終了期限: 18:50 JST (09:50 UTC)
更新: 2026-09-30 14:15 JST。5時間の比較実験を継続中。

## 保全

既存ai-game-labのHEADは782c35d6d50b983355db73ccfbd2542585288474、現在もclean。変更していない。旧4173のサーバーも触らない。新しい公開repoはKOSEIHAMAYA2077/semantic-glyph-lab、branch feat/semantic-surface-prototypes。

## 動くもの

- 新しい画面4183、意味API4184。24形状＋属性変形＋文字の面投影。
- MiniLM公式int8 ONNX、CPU推論。人工初回heldout言い換え21/24、ルール1/24。かな誤検出修正後の同問題回帰22/24。初回精度と混ぜない。
- Shap-E実推論MPS、5例、32steps、64³と128³。1例約40秒。形の細部には失敗。GLBと比較画像あり。
- Kenney CC0の木・花・きのこOBJも同じ文字表面に表示。
- 55単体＋9ブラウザ検証、型検査とビルド通過。実UIで表面を確認。Hostプロキシ接続不良を修正し、意味モデルを通る結合試験追加。

## 所有と次の実験

- root: src/main.ts、scene.ts、文字描画、UI、結合検証、公開。
- shape_geometry: experiments/composition/**、server/composition.py、server/composition-*.txt、.local/composition*。Qwen3-4B-MLX-4bit公式モデル2.15GB、4185で部品JSON合成を試験中。rootが次に描画接続する。
- semantic_mesh_research: research/language-to-shape.mdのみ。論文調査中。旧server/**所有は解放済み。
- text3d_research: src/advection/**、experiments/advection/**のみ。三角面上の文字移流の独立比較を実装中。Shap-E実験は14asset・外殻派生まで完了。
- 次: LLM部品合成の実表示と同じ人工例での比較。次に三平面投影の二重文字を減らす流れの比較。手数だけの機能追加を避ける。

## 運転と継続

heartbeat 3d-5、20分ごと、18:50まで。旧automation3はPAUSED。新規caffeinateのPIDは.local/awake.jsonに保存（起動時47091、有限時間）。公開には含めない。APIや画面が停止していたら各READMEの手順でこのリポジトリだけを起動する。

終了20分前から新規の大型実験に着手せず、試遊版・結果・制限・再開方法をまとめ、heartbeatを停止し、自分が起動したcaffeinateだけ終了する。途中の停止指示は優先。
