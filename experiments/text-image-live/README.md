# 自由な物体説明から画像を経由するローカルAPI

**Powered by Stability AI**

2026-09-30。既存の [画像経由の比較実験](../text-image/README.md) を読み取り利用する独立サービス。新しい重みを取得せず、既存環境の依存も変更しない。SDXL TurboとTripoSRの環境が異なるため、毎要求それぞれのPythonで子プロセスを順に起動し、PNGとGLBをパイプで渡す。モデルを常駐させる方式ではない。

人工文の花瓶を実HTTP生成し、冷起動する2workerを含め **29.808秒** だった。花瓶の胴と首はできたが、指定外の装飾と平たい背面が残る。[実測・比較図・限界](RESULTS.md)

## 起動

リポジトリのルートで実行する。

```sh
.local/text-image-venv/bin/python -B server/image_pipeline.py --port 4187 --timeout 120
```

`127.0.0.1:4187` のみに待受する。Hostはこのポートのlocalhost/127.0.0.1、Originは `http://127.0.0.1:4183` / `http://localhost:4183` と、ブラウザ外のOriginなしリクエストだけを許可する。

- `GET /health`: 状態、実行中か、モデル経路、入力上限、保存しない項目を返す。readyはAPIの受付状態で、各要求の全重みハッシュ検査はworker内で行う。
- `POST /generate`: `{"text":"a simple ceramic vase"}`。成功時はY-upの `model/gltf-binary` を返す。
- 入力は1〜300 ASCII文字の英語説明。固定の灰色背景・画角指定を後ろに加え、両方のCLIP tokenizerで77 token以内か確認する。超えた文章は切り捨てず400で拒否する。
- 同時1件。実行中の追加要求は待ち行列へ入れず503。2段階を合わせた上限時間は120秒で、時間切れではこのサービスが所有するworkerだけを止め504を返す。
- 空/極小/ほぼ全域の前景マスクや、非有限座標・極小体積・不正な面などは422。これは形が文章に合うことの保証ではない。前景除去の誤りはまだ残る。

レスポンスの `X-Generation-Ms` は2つのPython起動、全モデルのハッシュ確認、ロード、画像生成、背景除去、立体化、GLB化を含む総時間。`X-Image-Ms` は画像の推論とPNG化、`X-Reconstruction-Ms` は立体推論からGLB検査まで。`X-Image-Stage-Ms` は前半workerの冷起動込み。ほかに `X-CLIP-Tokens`、`X-Generation-Seed`、`X-Mesh-Faces` を返す。HTTPクライアントから見た待ち時間は別途測る。

## 保存と外部通信

要求本文・生成画像・マスク・潜在変数・GLBをファイルへ保存しない。アクセスログとモデルの標準出力・エラー出力も出さない。終了したworkerのメモリはプロセスごと解放する。モデル由来のキャッシュだけ `.local/image-pipeline-runtime` に分ける。Pythonバイトコード生成を止め、元の実験や環境への書込みを避ける。

推論workerはネットワーク接続を禁止し、Hugging Faceのoffline/local-only設定を使う。重みと設定は元の実験manifestに対して再検査する。SDXLはsafetensors、TripoSRは `weights_only=True`。使うクラスは固定のallowlistに限定し、任意Pythonコード生成や `trust_remote_code` を使わない。

SDXL Turboの利用条件、ライセンス原文、NOTICE、取得サイズ・SHA256は [既存の来歴](../text-image/README.md) にある。サービス追加による重み取得量は0 bytes。無料の研究・非商用評価として試している。画像生成物や入力モデルを、このrepoのコードライセンスで再ライセンスする扱いにはしない。

## 検証

```sh
.local/text-image-venv/bin/python -B -m unittest discover -s server -p test_image_pipeline.py -v
.local/triposr-venv/bin/python -B experiments/text-image-live/smoke_http.py --run vase-http-v1
```

CPU境界試験11件を通過。文字・CLIP上限、Host/Origin、Content-Type、バイナリ応答、空/極小マスク、同時実行、2worker全体のタイムアウト、無関係なプロセスを停止しないことを確認した。モデルの品質試験とは別である。

smoke clientは固定した人工文1件だけを送る。HTTP待ち時間とGLB構造の数値、3方向の比較PNGを実験記録へ保存する。サービスは保存せず、この検証clientもGLB本体・中間画像は保存しない。既存run名での実行は拒否する。
