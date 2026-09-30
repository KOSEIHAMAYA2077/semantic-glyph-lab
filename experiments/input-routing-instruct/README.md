# 指示追従用4Bモデルによる同条件比較

語義・内容の確認は担当エージェントによる原出力の読解です。ユーザーや人間の参加者による評価は行っていません。JSON記録の `humanReview` 等のキー名は記録を保つためそのまま残しています。

2026-09-30。既に取得・変換していたQwen3-4B-Instruct-2507のローカル4bit版を、[最初の意図分類実験](../input-routing/README.md) と同じ24人工例・prompt・schema・greedy・最大384 tokensで一度だけ評価する。新しいAPIやUIへは接続しない。

## 同じ条件と、異なる条件

`evaluation-plan.json / prompt-v1.txt / schema.py / test_schema.py` はv1とバイト単位で一致する。seed17、thinkingなし、各例1回、形式不正の再試行や例別補正なし。16:00 JSTに [protocol-lock.json](protocol-lock.json) へhashを固定した。出力を受け取るまで正解や英語の翻訳例を追加していない。

モデルは [公式Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) の固定revision `cdbee75f17c01a7cc42f958dc650907174af0554`、Apache-2.0。元BF16を既存作業でMLX-LM0.31.3、affine4bit、group64、非量子化部分bfloat16へ変換したものを読み取り利用する。今回は再変換しない。

元のQwen3-8B/14Bの非thinking設定と、指示追従用Instruct-2507では、学習段階、規模、ネイティブの会話テンプレート、量子化groupなどが異なる。もし結果が変わっても、パラメータ数だけの効果、または一つの学習方法だけの効果とは断定しない。4Bには元からthinking分岐のないテンプレートを使用するが、呼び出しにはv1と同じ `enable_thinking=False` を渡す。

この24例は過去の実験で結果を見ている回帰問題であり、今回は新たな未見評価ではない。厳格な操作契約の一致、rawのaction一致、未知対象の意味保持を分けて観察する。

## 重みと変換記録の再確認

公式の固定revisionのメタデータに照会し、元モデル12ファイルの実サイズ・SHA256を検査した。LFSファイルは公式SHA256、通常ファイルは公式Git blob SHA1とも一致した。元safetensors3本を含む取得済みファイルの合計は8,060,915,998 bytes。

ローカル変換8ファイルも [既存の変換manifest](../composition/instruct-quantized-manifest.json) と全サイズ・hashが一致した。全体2,274,513,731 bytes、推論重み本体2,263,022,417 bytes。実configのaffine4bit/group64/bfloat16と記録された手順を照合し、元と変換後のconfig/tokenizerにremote code用の `auto_map` がないことを確認した。再変換による数値再現の確認はしていない。

新しい重みのダウンロード、変換、依存のインストールは0。調べた公式URL・元と変換後のhashは [model-verification.json](model-verification.json)。元ファイル・既存環境を変更せず、キャッシュを `.local/input-routing-instruct-cache` へ分ける。推論はoffline・IP接続拒否・remote code無効で、生成コードを実行しない。記録する入力と出力は人工例のみ。

## 実行

```sh
python3 -B experiments/input-routing-instruct/test_schema.py -v
.local/composition-venv/bin/python -B experiments/input-routing-instruct/evaluate.py --run another-run-name
```

CPU境界12テスト通過。入力・schema・数値・空target・状態遷移の規約はv1から変更していない。既存名の結果や凍結hashの不一致があれば停止する。

## 結果と採否

16:01 JSTに24例の一度の推論を完了。**自動振り分けには採用しない。** 指示追従用モデルへの変更でも契約違反と対象の取り違えが残り、既存の手動操作を置き換える根拠は得られなかった。既存UI・APIは変更していない。これ以上のモデル追加や追試はこの実験では行わない。

| 同じv1の24例・greedy | 元のQwen3-8B 4bit | Qwen3-4B-Instruct-2507 4bit |
| --- | ---: | ---: |
| JSONの構文成立 | 24/24 | 23/24 |
| 厳格schema成立 | 3/24 | 0/24 |
| 事前の操作契約と全項目一致 | 0/24 | 0/24 |
| rawのactionが期待と一致 | 10/24 | 13/24 |
| 未知7例を独立した英語targetとして返した数 | 0/7 | 0/7 |
| 1例の推論中央値 | 2.391秒 | 1.614秒 |

4Bで最初に見つかった形式違反は、edit/keepでのtarget再出力19件、既知formとobject_enの両方の指定4件、JSON構文不正1件。構文不正は値が欠けた出力で、384 tokensの上限に達したからと判断してはいない。受理した操作は0件だが、「意味のある部分が一つもなかった」という意味ではない。色だけの入力や抽象文のkeep、花瓶の縦長化、粗さ解除などは、rawのaction・属性自体が期待に近い。

### 原文との読解比較で確認した対象の意味

| 対象・関係 | rawで残った意味 | 受理できない点 |
| --- | --- | --- |
| 椅子の上の鳥 | `chair with a bird on it` と関係を保持。 | editにしてformをchairへ限定し、新しい複合物として扱わない。 |
| 開いた傘 | `opened umbrella` は対象を保持。 | 同時にformをshellへ置き換える。 |
| 漏斗 | 対象を記述せず、英語欄は文字列の `"null"`。 | coneを縦長にする編集へ落とす。 |
| 注ぎ口の長いじょうろ | `long vase with a spout` となる。 | じょうろを花瓶と捉え、全体を縦長にする。 |
| 急須 | 英語欄へ日本語の名詞をそのままコピー。 | 同時にformをmugとし、指定のない既定属性も並べる。 |
| 鎖状の三つの輪 | `three rings linked in a chain` と数・連結を保持。 | editとring/count3の指定では連結した新しい形にならない。 |
| 花瓶ではなく水差し | `water pitcher` と対象を保持。 | 同時にformをmugとする。 |

このほか、未知のじょうろを四角くする編集で、元の英語名を残しながらformへmugを追加した。形を保つべき「花瓶」という単独の名指しでは、現在のねじれ0.4を0へ変えた。四角くしないという禁止を四角さ0.2へ変更し、全体を大きくする未対応操作は縦長さへ代入した。冗長なキーだけを削除しても、これらの意味の問題は解消しない。

rawのaction一致13/24は8Bの10/24より多いものの、完全な契約に合う操作は一つもない。学習段階・量子化・会話テンプレートも異なり、この少数例で指示追従モデル一般、または4B一般の優劣を結論しない。

### 時間・メモリ・記録

推論は最小1.287秒、中央値1.614秒、最大2.444秒。24例の推論時間合計40.239秒。モデル読込呼び出しは0.456秒で、先に元モデルと変換後の重みを検査したキャッシュがある条件。推論時間に重みのhash検査・モデル読込・HTTPは含まない。

MLX allocator peak約3.02GB、プロセス最大RSS約2.67GB。二つは加算しない。PythonのIP接続拒否で観測した試行は0で、終了後に独立プロセスは停止した。実行に使った既存環境の読み取り確認は [environment-readback.json](environment-readback.json)。

全出力は [run-01.jsonl](run-01.jsonl)、条件・時刻・メモリは [run-01-runtime.json](run-01-runtime.json)、自動集計と未知対象7例の原文との読解比較は [summary-v1.json](summary-v1.json) に保存。prompt、評価文、期待値、モデル出力は修正していない。
