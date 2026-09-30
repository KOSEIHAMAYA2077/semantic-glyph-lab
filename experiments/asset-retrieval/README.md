# 文章からCC0素材を探し、文字の面へ渡す

2026-09-30。Powered by [Poly Haven](https://polyhaven.com/)。公式APIのモデル一覧を取得し、日本語の人工文と英語の素材説明を端末内で比較した。生成AIによる形の生成ではなく、**既存の形の検索**である。

521素材のメタデータ543,024 bytesを一度取得。検索前・一覧取得前に [10人工例](protocol.json) を固定し、既存の多言語MiniLM int8 ONNXをCPUだけで実行した。素材名だけと、素材名＋公式説明文の2条件を比較した。日本語辞書や例別の言い換えを追加していない。

花瓶、じょうろ、剣系の素材が検索でき、3点を公式glTFから取得した。原本15ファイル・5,196,368 bytesを `.local/asset-retrieval-originals` へそのまま保管し、文字表示用のgeometry-only GLBを別に作った。派生3点は計751,416 bytes。各ファイルの公式MD5・SHA256・出所は [source-manifest.json](source-manifest.json)。全モデルはY-upで、元の形や位置を修復・再生成していない。

| 派生GLB | 三角形 | 表示で確認したこと |
| --- | ---: | --- |
| [陶器の花瓶](../../public/retrieval-models/ceramic_vase_03-geometry.glb) | 11,136 | 四角い胴と上の口、内外の文字面。 |
| [じょうろ](../../public/retrieval-models/watering_can_metal_01-geometry.glb) | 11,837 | 胴、持ち手、長い注ぎ口が同じ物体として読める。 |
| [サーベル](../../public/retrieval-models/wooden_handle_saber-geometry.glb) | 4,031 | 細長い刃と柄。入力した「ねじれ」は素材にはない。 |

同じSurfaceSceneを使い、灰色と文字面の各3方向をSwiftShaderのCPU描画で確認。GPU推論は使わず、ページエラー・WebGLエラー・外部通信は0だった。[比較画像と所見](RESULTS.md) を参照。

## 採用範囲

**取得済み素材の候補を提示する用途には使える。自由な文から無条件で自動選択する用途には、この結果だけで採用しない。** たとえば傘がない一覧でも、検索は別の素材を返す。普通の剣に「ねじれた」という語が一致したかのように扱うこともしない。

画面へ渡せる [公開manifest](../../public/retrieval-models/manifest.json) は3点だけを含む。`id / name / description / path / source / license` を持ち、descriptionはこの実験で新しく書いた短い事実説明。公式の一覧や文章を丸ごと公開していない。残り518素材が読み込めるとは表示しない。

3点だけの検索も、同じ10例を再利用した診断として [別記録](downloaded-results.json) に残した。未所蔵の馬の彫刻が花瓶0.487686となり、正しいじょうろ0.442570より高くなる。差分スコアも同様で、単一の閾値や1位と2位の差だけでは不在判定を保証できない。

## 条件と再配布

3D素材はCC0。APIは別規約で、固有User-Agentと出所表示を付けて少数回利用した。公式サイトのプレビュー画像や全文は取得・転載せず、比較画像は取得モデルから独自に描画した。詳細は [TERMS.md](TERMS.md)。原本・モデル重み・一覧の生JSONはGit対象外。公開は小さな派生GLB、出所、人工例、独自の評価・画像・実験コードのみ。

使用したMiniLMと既存環境は読み取り専用で再利用し、依存の追加・更新はない。形の読込・別GLBへの保存は既存TripoSR専用環境のtrimeshでCPU実行した。Blenderやモデル配布側のコードをインストール・実行していない。

## 再実行

```sh
# 取得済みの固定メタデータをCPUで検索。結果がある場合は上書きせず停止する。
.local/semantics-venv/bin/python -B experiments/asset-retrieval/retrieve.py

# 選定済み3素材の1K glTFと全依存を取得。原本があれば停止する。
python3 -B experiments/asset-retrieval/acquire_models.py

# 原本を保持した別GLBの作成。派生があれば停止する。
.local/triposr-venv/bin/python -B experiments/asset-retrieval/convert_models.py

# 4183の既存開発サーバー経由でCPU描画。
node experiments/asset-retrieval/capture.mjs another-views-name
```

元一覧を再取得すると内容が変わり得る。`catalogue-record.json` のSHAと一致する保存データが今回の再現条件。APIへの再取得そのものはコード実行と切り離し、同じ結果を保証しない。

## 通常UIで試す

[3候補を選ぶ画面・起動・検証](ui-v1/README.md)。通常UIは公開済み3GLBだけを検索するため、研究用521件の生メタデータは不要。文章は4,000文字まで受け付けるが、埋込に使うのは末尾128トークン。全文理解でも、任意対象の自動生成でもない。
