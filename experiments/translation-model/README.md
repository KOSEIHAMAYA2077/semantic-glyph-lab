# 翻訳モデルを分ける比較

現在のQwenによる短い物体説明に誤訳があるため、日英翻訳専用モデルと、一段大きい言語モデルを独立に比較する場所。既存4BのAPIやプロンプトは維持し、比較後に8B専用APIを4188へ追加した。原稿ではなく、先に固定した人工文だけを使う。

## OPUS-MT: 今回は採用しない

[Helsinki-NLP/opus-mt-ja-en](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en) をCPUで実行した。モデルカードはApache-2.0を明記し、非商用限定の指定はない。固定revisionは `0770961a39ba6bd66305b149c3f4110bcafca2e6`。重み303,294,189 bytes、設定・tokenizer込み306,381,800 bytes、75,749,376 parameters。

同じ13文はQwen比較からの回帰例。別に[新しい名詞・関係の10文](fresh-plan.json)を、専用モデルの初回推論前に固定した。こちらは学習やプロンプト調整に使っていない。実験者による少数例の観察であり、一般的な翻訳性能の数値ではない。

| CPU / 4 threads / beam 6 | 件数 | 中央値 | 範囲 |
| --- | --- | --- | --- |
| 既存文の回帰比較 | 13 | 0.166秒 | 0.074〜0.226秒 |
| 新しい名詞・関係文 | 10 | 0.1645秒 | 0.124〜0.239秒 |

初期モデルロードは2.172秒。プロセスの最大RSSは約1.63GB（macOSの`ru_maxrss`、モデル以外も含む）。GPUは使わない。各文の処理時間はtokenize〜decodeで、HTTP時間やモデルロードを含めない。QwenのHTTP時間との比較にはこの違いがある。

| 調べた点 | 観察 |
| --- | --- |
| 木 | `tree` に直る。ただし鳥が枝から「育った」と関係を変える。 |
| 急須 | `bottle and an emergency` へ誤訳。Qwenの `tea set` より悪化。 |
| みかん | `chocolates` へ誤訳。 |
| 左右の取っ手 | `Hands one at a time` となり、部位と左右を失う。 |
| 漏斗と歯車 | `blue leak` と `wheel` になり、物体の意味を崩す。 |
| 鳥居 | `birdhouse` へ誤訳。 |
| 蓮の花の燭台 | 蓮と燭台の語義を失い、一般的な植物と台になる。 |
| 六角鉛筆・輪 | 六角形、鉛筆、輪を貫く関係は保持。 |
| 2本の枝・丸い鏡 | 個数、支える関係、根元のねじれを保持。 |
| 歯車ではなく穴8個の円盤 | 否定、円盤、個数、縁の穴を保持。 |
| きのこのランプ | 大枠の形と中に置く関係は保持。ひび割れは `broken` に広がる。 |

**速さは魅力だが、対象を別の物へ変える誤訳が多く、現行経路を置き換えない。** 23文すべて実CLIPの77 token以内（最大22）だったが、短さは意味の正確さを示さない。全応答は[run-01-cpu.jsonl](run-01-cpu.jsonl)、時間・設定は[run-01-cpu-runtime.json](run-01-cpu-runtime.json)、集計は[opus-summary.json](opus-summary.json)に保存。

このモデルは文章全体の翻訳器であり、物体を抽出するモデルではない。感情だけの文、指示語だけの文、本文中の別の指示もそのまま英訳する。これは専用翻訳として当然の動作だが、物体選択・対象不明時の中止・本文の命令を除く処理の代わりにはならない。翻訳文を実行する経路はない。

## 取得と読み込みの確認

主branchはPyTorchの`pytorch_model.bin`を配布しており、safetensorsは未マージの変換PRにあるだけだった。そのPRや第三者の変換へ依存せず、公式主branchを固定した。ファイルは[model-manifest.json](model-manifest.json)にある公式URLから取得し、LFSのSHA256、通常ファイルはGit blob SHA1とローカルSHA256を照合した。Pythonモデルコードを配布先から取得しない。config/tokenizerに`auto_map`がないことも確認。

`torch.load(..., weights_only=True, map_location="cpu")`を明示し、文字列キーとTensor値だけの辞書・有限値を検査する。モデルはPyPIのTransformersにある組み込み`MarianMTModel`で、オフライン・CPU限定。任意のcheckpointやコードを利用者から受け取らない。これは形式・出所を限定した確認であり、未知の不具合まで否定するものではない。

最初のstrict読み込みは、旧checkpointに`lm_head.weight`の共有aliasがないため停止した。失敗は[startup-failure-v1.json](startup-failure-v1.json)と変更前runnerに残した。現行の公式実装がこの出力層を`model.shared.weight`へ結び付けていること、入出力embeddingの値とストレージ共有が一致することを確認して、メモリ上でaliasだけを復元する。他の欠落はstrict読み込みで拒否し、元の重みファイルを変更しない。

さらに公式`MarianMTModel.from_pretrained`とも照合した。全259 state tensorsが完全一致し、木・急須・みかんの3文は出力も一致した。したがって、観察した語彙の失敗は独自alias補完だけで起きたものではない。[loader-verification-v2.json](loader-verification-v2.json)に結果を保存。

## 専用環境と再現

Python3.12.14、PyTorch2.14.0、Transformers5.17.0、SentencePiece0.2.2。初期venvのpip25.0.1にPyPIが報告する既知脆弱性があったため、その環境を削除せず、pip26.2.1を入れた `.local/translation-model-venv-v2` を独立に作った。推論ライブラリは同じ版。新しい環境の39パッケージを照会し、報告済み脆弱性0・照会失敗0だった。初期記録も保持し、未知の脆弱性がないとは主張しない。

既存のAPI環境やグローバルPythonは変更していない。元のモデル・初期env・失敗記録は残す。新しい実行にはv2環境を使う。

```sh
.local/translation-model-venv-v2/bin/python experiments/translation-model/evaluate.py --run a-new-run-name
```

同じrun名の結果は上書きしない。依存一覧は[requirements-lock-v2.txt](requirements-lock-v2.txt)、確認記録は[dependency-audit-v2.json](dependency-audit-v2.json)。読み込みは[公式Marian資料](https://huggingface.co/docs/transformers/model_doc/marian)にある構成を使う。

## Qwen8B: 名詞は一部改善、関係には退行もある

[公式Qwen3-8B-MLX-4bit](https://huggingface.co/Qwen/Qwen3-8B-MLX-4bit) を固定revision `383413e909f3bc5303ce195ebbdf0339c5a1a2a3` で取得。Apache-2.0、公式の事前4bit化safetensorsなので、大きなBF16のダウンロードやローカル変換は不要だった。重み4,351,884,216 bytes。正規のLFS SHA256を照合し、907個のtensor headerを読み出せること、config/tokenizerに`auto_map`がないことを確認。[qwen8-manifest.json](qwen8-manifest.json)が全取得ファイルの記録。

モデルだけを独立MLX環境へ読み、4Bと[全く同じ説明プロンプト](qwen-description-prompt.txt)、greedy decoding、`enable_thinking=False`、出力512 tokenまでで比較した。形式不正時は最大1回の再生成を許すが、実際には全例で不要だった。以前の13文を8Bで再利用し、新しい10文は4Bと8Bにそれぞれ初回で入力した。この10文はOPUS-MTの比較で実験者が既に見ているので、研究全体として未見の評価とは呼ばない。プロンプトには10文の回答を追加していない。

| 同じ説明プロンプト | 件数 | 中央値 | 範囲 |
| --- | --- | --- | --- |
| 4B / 前節の13文（以前のRun 02） | 13 | 0.812秒 | 0.596〜0.973秒 |
| 8B / 同じ13文 | 13 | 1.312秒 | 0.973〜2.030秒 |
| 4B / 新しい10文 | 10 | 0.815秒 | 0.778〜1.113秒 |
| 8B / 新しい10文 | 10 | 1.3125秒 | 1.182〜1.637秒 |

4BはローカルHTTP経由、8Bは同じ生成・検証規約の直接呼び出し。初期ロードは表から除く。8Bのload呼び出しは0.440秒、初回の文は2.030秒だった。モデルファイル検証直後のキャッシュがある条件であり、電源投入直後の起動時間ではない。8BのMLX allocator peakは約4.94GB、プロセス最大RSSは約4.71GB。この2つは異なる指標で、加算しない。

| 意味の違い | 4B | 8B |
| --- | --- | --- |
| 花瓶から木、その枝に鳥 | 木が `stem of wood` になる | `tree` と枝の鳥を保持。改善。 |
| 急須 | `tea set` | `teapot`。注ぎ口と取っ手も保持。改善。 |
| やかんの左右 | `pot`、左右は保持 | `kettle`、左右も保持。改善。 |
| ざらざらした巻き貝 | `spiral shells`、粗さを落とし店の背景を残す | `scallop`（ホタテ）へ誤訳。粗さは戻るが名詞が悪化、背景も残る。 |
| 皿のみかん2個、左だけ長い | 左側の指定を保持 | 長い方が左だという指定を落とす。退行。 |
| 根元でねじれた枝と鏡 | 根元のねじれが明確 | `supporting a round mirror at the base` となり、ねじれ位置が曖昧。 |
| 細長い剣 | `long` だけで細さを落とす | `narrow` だけで長さを明示しない。どちらも一部を落とす。 |
| 漏斗・歯車、鳥居・風車 | 名詞と関係を保持 | 名詞と関係を保持。 |
| 蓮の燭台、鉛筆と輪、穴8個の円盤 | 名詞・数・関係を概ね保持 | 同様に保持。 |
| 感情だけ／指示語だけ | 2件とも対象不明で422 | 2件とも対象不明で422。 |

8Bは残る21文をすべて規約に合うJSONで返し、成功文は実CLIPの77 token以内だった。ただし「JSON成立」「短い」「名詞が正しい」「位置関係が正しい」は別に評価する。新しい10文については4Bも良好で、8Bが一方的に優れる結果ではない。

**8Bは急須・木などの改善が有用な候補として残すが、全面的な正解化とは扱わない。** 比較時点では通常APIを変更せず、結果を確認してから後段の4188サービスを別に追加した。ここでモデル追加を止め、英文候補を見ながら、意味を失った箇所を確認できる使い方を優先する。8Bでも、未知の任意語を忠実な立体へ結び付ける保証は得られていない。

4BはInstruct-2507をローカルgroup64で4bit化、8Bは初代Qwen3系を公式group128で4bit化したもの。モデルの世代・調整・量子化も違うため、結果をパラメータ数だけの効果とは解釈しない。また、8B公式は非thinkingで温度0.7を推奨するが、今回は4Bとの比較条件を揃えるためgreedyに固定した。

結果は[qwen8-run-01.jsonl](qwen8-run-01.jsonl)、[4Bの新しい10文](qwen4b-fresh-01.jsonl)、[時間・memory](qwen8-run-01-runtime.json)、[集計](qwen-comparison-summary.json)、[CLIP検査](qwen-clip-check.json)に残した。既存の4B13文は前の`experiments/translation/run-02.jsonl`を参照する。入力とraw outputは人工例だけを保存している。

```sh
.local/translation-model-qwen8-venv/bin/python experiments/translation-model/evaluate_qwen8.py --run another-new-qwen8-run
```

GPU使用を他の重い実験と調整してから実行する。既存のモデル・出力を消す必要はない。独立環境の35依存について、PyPI照会では報告済み脆弱性0・照会失敗0。版・hash・確認範囲は`qwen8-requirements-lock.txt`、`qwen8-dependency-audit.json`、`qwen8-structure-check.json`を参照。推論はオフラインで、モデル固有Pythonコードを取得せず`trust_remote_code=False`に固定する。

## 比較後の8B説明専用API

```sh
.local/translation-model-qwen8-venv/bin/python server/description.py
```

`127.0.0.1:4188` にbindし、`POST /describe {"text":"..."}` と `GET /health` だけを提供する。成功時は `text_en / model / elapsedMs / attempts`。`/compose` は提供せず404を返す。4Bの4185と別のプロセス・環境・モデルを用い、既存の`composition.py`を変更せず、その説明生成・形式検証・ロック処理を再利用する。

起動前に全モデルファイルをmanifestと照合し、重みの公式SHA256、model/revision、凍結した説明promptのSHA256も固定値で確認する。比較時の同一promptとgreedyを維持。入力2000文字・本文16KiBまで、モデル出力は300文字のASCIIまで、生成は512 tokens・形式再生成は最大1回。同時要求は503、対象を特定できないときは422。Hostはlocalhostの該当port、ブラウザOriginは4183に限定する。プロンプトや結果をアクセスログやファイルへ保存しない。

実HTTPの人工例「注ぎ口と一つの取っ手が付いた急須。」は `a teapot with a spout and one handle` となり、処理1.414秒・HTTP全体1.423秒。`model` は `Qwen/Qwen3-8B-MLX-4bit`、healthのrevisionも固定値と一致した。[description-api-smoke.json](description-api-smoke.json) にこの人工例だけを保存。通常APIに保存機能はない。

```sh
.local/translation-model-qwen8-venv/bin/python server/test_description_service.py -v
```

6テスト通過。説明とhealthの識別、部品合成経路の非公開、入力・Host・Originの境界、同時要求と対象不明、model identityと取得ファイル名の拒否を確認した。これらは意味の誤訳を解消する検査ではない。8Bの失敗例は上表のとおり残る。
