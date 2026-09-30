# 入力意図ルータの14Bモデル比較

2026-09-30。Qwen3-8Bの初回実験と同じ人工24例・prompt・採点規約を使い、公式Qwen3-14Bの差を調べる独立実験。既存のアプリ、API、環境は変更しない。取得と実行は分け、GPUの利用枠が空くまで推論しない。

## 比較の意味

[8Bのv1](../input-routing/README.md) は厳格な操作契約0/24、schema成立3/24、raw action一致10/24だった。20件で `edit / keep` にもtargetを再出力した一方、未知名詞の置換や禁止と解除の取り違えもあった。単に大きなモデルへ替えれば解決するとは仮定しない。

この実験では元の24例・system prompt・schema・greedy温度0・thinkingなし・最大384 tokens・seed17・1例1回を維持する。形式の再試行、例ごとの辞書修正、失敗後の期待値変更はしない。モデルが出したコードは実行しない。未知の英語targetが対象と関係を保つかは、機械的な形式判定と分けて担当エージェントが出力を読んで確認する。ユーザーや外部の人間による独立評価ではない。

すでに8Bの結果を読んだ24例を再利用するため、これは**モデル間比較・回帰であり、新しい未見評価ではない**。元のpromptとschemaの設計改善は別のv2実験に分け、この比較には混ぜない。公式の非thinking推奨温度0.7とは異なるが、8Bに合わせたgreedy条件を14Bだけ変更しない。

## 公式配布物

- 配布元: [Qwen/Qwen3-14B-MLX-4bit](https://huggingface.co/Qwen/Qwen3-14B-MLX-4bit)
- 固定revision: [`ba63a5141812f9870287df53341123a71ba41433`](https://huggingface.co/Qwen/Qwen3-14B-MLX-4bit/tree/ba63a5141812f9870287df53341123a71ba41433)
- ライセンス: [Apache-2.0](https://huggingface.co/Qwen/Qwen3-14B-MLX-4bit/blob/ba63a5141812f9870287df53341123a71ba41433/LICENSE)
- 公称14.8B parameters。配布物はgroup size128の4bit MLX safetensors、2分割。元のBF16重みを取得して量子化し直す作業は行わない。
- 重み合計7,846,402,136 bytes。README・LICENSE・設定・tokenizerを含む必要10ファイルは7,862,396,465 bytes。Git用の `.gitattributes` は取得しない。

| ファイル | bytes | 公式LFS SHA256 |
| --- | ---: | --- |
| model-00001-of-00002.safetensors | 5,360,593,224 | f2f502ca7604ad6789b124bf9cd7a192fda5a60e6f52b1fe521c3aa4dad598ce |
| model-00002-of-00002.safetensors | 2,485,808,912 | d3758e05e08bcfb5fcd1b76d74758366355c80464398702051ce0388045e898e |

[acquire.py](acquire.py) は固定revisionの許可した10ファイルだけを取得する。LFSファイルは公式SHA256、その他は公式Git blob IDとサイズを検査し、全ファイルのSHA256を [model-manifest.json](model-manifest.json) に記録する。重みはGit対象外の `.local/input-routing-qwen14-model` に置く。既存ファイルの上書き・削除はしない。失敗した取得も残す。

## 実行するコードと環境

モデル配布にPythonファイルはなく、config/tokenizerにも `auto_map` はない。既存の専用 `.local/translation-model-qwen8-venv` を読み取り再利用する。パッケージの追加・更新は行わず、バイトコードも書かない。

MLX0.32.3、mlx-lm0.31.3、mlx-metal0.32.3、Transformers5.17.0。公式cardのmlx-lm最低0.25.2を満たす。組込みの [MLX-LM Qwen3実装](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/models/qwen3.py) を使用し、`trust_remote_code=False` とする。依存版と実行コードのhashは [environment.json](environment.json)。

実推論はモデルファイルの再検査後に開始する。offline設定とPythonのIP接続拒否を併用し、キャッシュは専用 `.local/input-routing-qwen14-cache` へ分ける。入力とraw出力を保存する対象は人工24例だけ。通常の4188サービスを呼ばず、ユーザーの文章を読み取る機能もない。

重み約7.85GBと短い文脈なら32GB Macで単独実行できる見込みだが、ロード・ピークメモリ・所要時間は実測するまで未確認。他の8Bモデルや画像生成との同時推論は比較条件に含めない。

## 固定と再現

元のprompt・評価JSON・schemaはバイト単位で複製し、元runnerも [v1-evaluate-reference.py](v1-evaluate-reference.py) として保存する。比較runnerはモデルの場所・重み照合・記録先だけを変え、推論と採点の処理は維持する。条件と全hashを `protocol-lock.json` に保存してから初回推論へ進む。同名結果があれば停止する。

```sh
# 取得は一度だけ。ファイルが既にあると停止する。
python3 -B experiments/input-routing-model/acquire.py

# ファイル・固定条件の検証のみ。MLXをimportせず推論しない。
.local/translation-model-qwen8-venv/bin/python -B experiments/input-routing-model/evaluate.py --verify-only

# GPU利用枠の調整後だけ実行する。
.local/translation-model-qwen8-venv/bin/python -B experiments/input-routing-model/evaluate.py --run run-01
```

最終結果はschema成立、厳格な操作契約、raw action、未知名詞と否定の個別所見を分けて示す。少数の条件固定例から一般的な日本語能力や成功率は主張しない。

比較は完了し、結果を [RESULTS.md](RESULTS.md) に保存した。14Bはschema23/24・事前の機械的契約16/24へ改善したが、語義の誤りとnew/editの誤分類が残る。通常画面への自動採用は見送る。

## 取得と実行前確認

15:54 JSTまでに必要10ファイルの取得と検証が完了。両safetensorsの公式LFS SHA256、全ファイルのサイズ・SHA256、非LFSファイルのGit blob IDが一致した。ヘッダをCPUで読み、1,007個のtensorと公式indexの対応も確認。packした重みはU32、補助値・非量子化部分はBF16であり、配布物全体をBF16重みとして扱うものではない。

8Bと14Bの `tokenizer.json`、`tokenizer_config.json`、`merges.txt`、`vocab.json` はバイト単位で一致した。chat templateの差をモデル規模の差へ混ぜていない。記録は [tokenizer-comparison.json](tokenizer-comparison.json)、[safetensors-validation.json](safetensors-validation.json)、[preflight.json](preflight.json)。既存専用環境は更新せず、モデルPythonコードも取得していない。
