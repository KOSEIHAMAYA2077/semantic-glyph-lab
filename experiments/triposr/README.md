# TripoSR: 画像から文字を載せるための面を得る実験

実施日: 2026-09-30。Apple M5 / 32GBで、公式の椅子・馬・ティーポット画像からGLBを生成した。**これは画像→3Dの実験であり、文章→画像→3Dを実装した結果ではない。** テキストの意味から任意画像を選ぶ機能や、画像生成モデルはこの実験に含めない。

結果と比較画像は [RESULTS.md](RESULTS.md)。共通ビューアへ渡せる3件は [public manifest](../../public/reconstructed/manifest.json) にある。元のアプリ・他実験の環境は変更していない。

## 出所・取得物

- [公式コード](https://github.com/VAST-AI-Research/TripoSR)、commit `107cefdc244c39106fa830359024f6a2f1c78871`。
- [公式モデル](https://huggingface.co/stabilityai/TripoSR)、revision `5b521936b01fbe1890f6f9baed0254ab6351c04a`。配布元はコードと学習済みモデルをMITとしている。[保存したLICENSE](UPSTREAM_LICENSE)
- [技術報告](https://arxiv.org/abs/2403.02151)。一枚の画像からfeed-forwardで3Dを復元する手法。公式のA100での速度と本実験のMacでの速度は別条件。
- 重み `model.ckpt`: **1,677,246,742 bytes**、SHA256 `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`。公式Hugging Face LFSのSHA256と一致。
- DINOの構造定義のみを [facebook/dino-vitb16](https://huggingface.co/facebook/dino-vitb16) から取得。別のDINO重みは不要で、TripoSRのcheckpointに画像encoderの重みが含まれる。
- 設定・model cardを含むモデル関連取得量は **1,677,250,671 bytes**。Python環境、公式ソース、サンプル画像はこの数値に含めない。[全ファイルの出所・サイズ・ハッシュ](model-manifest.json)

入力は公式repoの `examples/chair.png`、`horse.png`、`teapot.png`。repoのMIT文書は確認したが、各画像の制作経緯・個別の権利表示は別途確認できなかったため、入力画像は公開リポジトリへコピーせず、元のURLとハッシュを残した。出力GLBはこの入力に由来する比較用成果物として来歴を記録し、元画像の権利関係を独立に確認済みとは表示しない。

## 公式ソースからの変更点

公式ソースは `.local/triposr-source` に保持し、`git status`がcleanであることを確認した。互換処理は [mac_runner.py](mac_runner.py) に隔離した。

1. 公式 `run.py` はCUDAがない場合CPUへ固定するため、ネットワーク本体を直接呼び、`cpu` / `mps`を明示する。今回はfloat32。
2. `torchmcubes` のC++拡張を導入せず、CPUのscikit-image marching cubesへ置き換える小さなadapterを実験側に置いた。座標順序と面方向を人工球・非対称な楕円体で検証している。公式実装と同じ三角分割を保証するものではない。
3. `TSR.from_pretrained` の暗黙取得を使わず、ハッシュ確認した設定と重みをローカルから読む。`torch.load(..., weights_only=True)` と厳密なstate dict照合を使う。checkpoint形式はpickleベースだが、任意Pythonオブジェクトを許可して読む設定にはしない。
4. 公式設定はクラスを文字列からimportするため、6件の既知のクラス名に限定する。DINOの設定取得も、既に保存した特定ファイルへの参照へ限定する。`trust_remote_code`や遠隔スクリプト実行は使用しない。
5. 公式の古い依存一覧を一括導入せず、Python 3.12の専用環境で動いた版を固定した。主な差はPyTorch 2.14.0、Transformers 4.46.3、Pillow 12.2.0、trimesh 4.12.2。全体は [requirements-lock.txt](requirements-lock.txt)。Gradio、動画、テクスチャ焼き込み、xatlas、modernglは使用しない。

椅子と馬は公式の透過済みPNGを前景比率0.85へ調整し、灰色背景と合成した。ティーポットは灰色背景のRGBをそのまま使った。`rembg`は公式モジュールのimport依存として導入したが、背景除去の推論は呼ばず、その重みは取得していない。推論時は外向きsocket接続を例外にし、各runで接続試行が0回であることを記録した。

## 再実行

リポジトリのルートで実行する。新しい環境・ディレクトリだけを作り、既にあるソースや出力を削除しない。以下のcloneは対象ディレクトリがまだない場合だけ行う。

```sh
python3.12 -m venv .local/triposr-venv
.local/triposr-venv/bin/python -m pip install -r experiments/triposr/requirements-lock.txt
git clone https://github.com/VAST-AI-Research/TripoSR.git .local/triposr-source
git -C .local/triposr-source checkout 107cefdc244c39106fa830359024f6a2f1c78871
.local/triposr-venv/bin/python experiments/triposr/prepare.py
.local/triposr-venv/bin/python experiments/triposr/test_compat.py
.local/triposr-venv/bin/python experiments/triposr/mac_runner.py --device mps --resolution 128 --run mps128-repeat --samples chair horse teapot
```

CPUでは `--device cpu` とする。`--run`は毎回未使用名を指定する。既存runを上書きする指定は失敗する。入力候補は確認した3ファイルに限定している。

`prepare.py` は既存ファイルのハッシュが合わない場合に停止し、削除・再取得で上書きしない。ネットワークが途中で切れた場合も、不完全なファイルは証拠として残す。再取得するなら別の保存名と来歴を用意する。

`compare.py` は保存済みの `mps128-three` を読み、3方向の比較図と `mps128-y-up` の派生GLBを作る、今回専用の一回用スクリプト。元はZ-upなのでX軸へ−90度回転し、ビューアのY-upへ合わせる。形の修復・平滑化はしていない。既に同じ派生先があれば上書きせず停止する。

## この方式を次へつなげる条件

文章から適切な画像を得る部分は別に必要で、画像を検索・生成したときの対象一致、背景、視点、権利、外部送信条件を比較する。TripoSRの処理は今回の3例では軽かったが、一方向の画像にない背面を正確に復元した証拠ではない。まず許可された少数の画像を同じ面描画へ通し、文字を流しても物体として読めるかを確認する。
