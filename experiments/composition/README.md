# ローカル言語モデルによる部品合成

2026-09-30、Apple M5 / 32 GiB / macOS 26.5.1 で実測。

**採用候補は「既存の立体を部品として選ぶ」方式。小型LLMに原始図形から全座標を決めさせる方式は、JSONが正しくても形の意味が崩れた。** この実験は学習済みモデルの推論であり、独自モデルの訓練や新しいメッシュを生成する技術ではない。

## 何を比較したか

1. `box / sphere / cylinder / cone / torus` だけから座標・寸法・回転を生成。
2. 同じ文章・同じ描画規約でモデル、温度、座標例を変更。
3. 同じInstructモデルの元BF16を使い、4bit化が主な失敗原因か確認。
4. `sword / vase / chair / heart` など24個の手続き形状も部品として選べる方式へ変更。位置・倍率・変形属性を生成。

4番は語彙のある部品を組み合わせる。未知の物体でも部品で近似できる可能性はあるが、任意の語から常に正しい新規形状を生成できるわけではない。手書きの入力別完成レシピをLLM出力として提示していない。コード側で定義した形状カタログと座標規約、プロンプト内の作例は明示的な制約である。

## 実測

| Run | 条件 | JSON成立 | HTTP時間の中央値 | 目視結果 |
|---|---|---:|---:|---|
| 01 | 公式Qwen3-4B MLX 4bit、温度0.3 | 6/6 | 7.72秒 | 剣が円柱になる。同じ部品を同じ位置へ反復。採用しない。 |
| 02 | 同モデル、推奨域の温度0.7 | 6/6 | 6.07秒 | 反復が減る例はあるが、物体の意味は改善しない。 |
| 03 | Instruct-2507をローカル4bit化 | 6/6 | 5.49秒 | 数値は成立するが、物体の部位や位置が不正確。 |
| 04 | 座標の作例・接続の説明を追加 | 6/6 | 8.15秒 | 数値例の追加だけでは解決しない。 |
| 05 | 同じInstructの元BF16、最初の3例 | 3/3 | 18.46秒 | 剣・椅子・花瓶の形は依然不正確。量子化だけが原因とは考えにくい。 |
| 06 | 高水準の形状部品、比較文6例 | 5/6 | 4.11秒 | 剣やハートを認識できる。輪の位置、不要な変形、未登録の物体の分解に誤り。 |
| 07 | 高水準の形状部品、新しい組合せ6例 | 6/6 | 3.89秒 | 花瓶と木、輪と家は成立。接続・形容詞・部位数には課題。 |

全条件の数値は `summary.json`、各出力は `run-01.jsonl` ～ `run-07.jsonl` にある。入力は実験用の人工例のみ。APIの時間には検証と再生成を含み、モデル起動は含まない。最大出力3072 tokens、最大2回の生成。Run 02以降は起動時seed 17、temperature 0.7、top-p 0.8、top-k 20。Run 07はRun 06と同一プロセスで続けて実行したため、乱数状態も継続している。

Run 01の最初の3例は開発例、後半3例は初回の比較対象。**Run 02以降で同じ文を使った結果は再利用比較であり、未見評価ではない。** Run 07は `fresh-evaluation-plan.md` を先に保存してから一度実行した。学習・微調整はしていない。この少数例は一般的な性能を表すベンチマークではない。

Run 07の目視判定：

- 「花瓶から木」「輪の中に家」：意図を読み取れる。
- 「魚の左右に星の翼」：魚と二つの星はあるが、翼が離れている。
- 「キノコの傘を屋根にした塔」：塔とキノコを出すが、余分なキノコと浮いた配置になる。
- 「四角くねじれた貝」：貝とねじれは選ぶが、四角さを落とし、頼んでいない粗さを加えた。
- 「丸い頭・四角い胴体・腕・脚のロボット」：頭と胴体はあるが、脚がなく腕も埋もれる。失敗。

**JSON成立率と見た目の成功率は別物。** 高水準部品は見せる対象を制御しやすい一方、LLMによる座標計画はまだ安定しない。次の改善候補は、LLMには物体・個数・関係だけを選ばせ、「上」「中」「周囲」などの配置は検証可能な規則で計算すること。これは今回まだ実装・評価していない。

全条件をChromeで描画し、`run-XX-silhouettes.png` に保存した。比較用画面は `/experiments/composition/preview.html?run=run-07.jsonl`。ここでは形の可読性を調べるため単色で表示し、アプリ本体では同じ部品へ文字の表面描画を適用する。

## 実装とAPI

`server/composition.py` は `127.0.0.1:4185` にのみbindする。

```sh
.local/composition-venv/bin/python server/composition.py
```

現在の既定値は Instruct-2507 / local 4bit / `forms`。比較用に `--vocabulary primitives`、`--variant base`、`--model .local/composition-instruct-source` を指定できる。モデルやプロンプトを切り替える際は、同じポートの既存実験プロセスを確認してから切り替える。原本や重みファイルを削除する必要はない。

`POST /compose` は `{"text":"人工例文"}` を受け、次の形を返す。

```json
{"label":"...","parts":[{"kind":"vase","position":[0,0,0],"scale":[2,2,2],"rotation":[0,0,0],"deformation":{"squareness":1}}],"elapsedMs":3000,"model":"Qwen/Qwen3-4B-Instruct-2507","vocabulary":"forms","attempts":1,"peakMemoryBytes":3000000000}
```

上はAPI構造の例示で、実測結果ではない。出力は最大24部品。位置は各軸±5、倍率0.03〜4、回転±π。形状名・属性名を列挙で検証し、NaN・Infinity・boolean・未知のフィールド・コードを拒否する。`deformation`は既知の形状に限り、元の `FormSpec` と同じ属性範囲を使う。

高水準の形状は `createForm` 後に中心を揃え、最大寸法1へ正規化してから倍率・回転・移動を適用する。原始図形はbox辺1、sphere半径0.5、cylinder/cone半径0.5・高さ1・Y軸、torus大半径0.4・管半径0.1・XY平面。重複するkindは従来の原始図形規約を優先し、変形がある場合は高水準の形状を使う。

`GET /health` はモデル・revision・vocabularyを返す。APIは入力2000文字・body16KiBまで、同時推論1件、他の要求は503、schema不成立は422。Hostをlocalhostの該当ポートに限定し、Originは開発画面の4183だけ許可する。アクセスログは無効。推論時に入力・出力をファイル保存しない。評価スクリプトだけが、明示的に用意した人工例と結果を保存する。

境界・スキーマテスト：

```sh
.local/composition-venv/bin/python experiments/composition/test_schema.py -v
```

10テスト成功。これは安全境界と数値形式の確認であり、意味や形の正しさの証明ではない。

## モデル、容量、安全確認

- [公式Qwen3-4B-MLX-4bit](https://huggingface.co/Qwen/Qwen3-4B-MLX-4bit)：Apache-2.0、revision `52a5ab34fa604bc8af6d3ce0cac0cab10b7eb495`。取得2,153,298,402 bytes。
- [公式Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)：Apache-2.0、revision `cdbee75f17c01a7cc42f958dc650907174af0554`。取得8,060,915,998 bytes。
- Instructのローカル4bit変換は2,274,513,731 bytes。MLX-LM 0.31.3でaffine 4bit、group size 64、非量子化部分bfloat16。元の重みも保持した。
- [MLX-LM公式実装](https://github.com/ml-explore/mlx-lm)をPyPI wheelから専用venvへ導入。Python 3.12.14 / MLX 0.32.3。既存の環境を更新していない。依存版は `requirements-lock.txt`。
- 各モデルの全取得ファイルのサイズ・SHA-256は `model-manifest.json`、`instruct-model-manifest.json`、`instruct-quantized-manifest.json`。学習済み重みは `.local/` に置きGitへ含めない。
- 公式HTTPS配布から固定revisionのsafetensorsとtokenizerデータのみ取得。モデル固有Pythonをダウンロードしない。config/tokenizerに `auto_map` がないことを確認し、`trust_remote_code=False`、推論時offlineを指定。safetensorsとして読み出せることを確認した。生成されたPython/JavaScriptを実行する経路はない。
- `dependency-audit.json` に34依存のPyPI release metadata照会と実装コードのハッシュを保存。照会時に報告済み脆弱性は0件、照会失敗0件。**既知脆弱性DBと配布元の確認は、未知の脆弱性やマルウェアが存在しないことの保証ではない。**

高水準方式のMLX allocator peakは約3.02GB、BF16比較は約8.63GB。これはプロセス全体のRSSやMac全体のメモリ使用量ではない。Windowsや他のMacでの動作は未検証。
