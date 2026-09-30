# 同一の日本語から2つの生成経路を比べる

**Powered by Stability AI**

実施日: 2026-09-30。人工例は「小さな帆船」「開いた傘」「長い注ぎ口が付いたじょうろ」の3件。推論前に [protocol.json](protocol.json) を固定し、[SHA256と固定時刻](protocol-lock.json) を記録した。

**実行と比較は完了。** [6件の結果・灰色と文字面の比較](RESULTS.md)、[画面用manifest](../../public/end-to-end-models/manifest.json)。run内の元manifestを保持し、目視判定を付けた版は `manifest-assessed.json` として分けた。

各例で4188の `/describe` を1回だけ呼び、返った英語を手で直さず、同じ文字列を4186 Shap-Eと4187 SDXL Turbo→TripoSRへ各1回送る。合計6生成を順番に実施する。訳が違う、形が崩れる、APIが失敗する場合も残し、当たりが出るまで再試行しない。

## 測るもの

物体全体の読み取り、要求した部品と接続、薄い面、裏側、穴の残り方、文字を面へ載せたときの被覆を分ける。各形を共通 `SurfaceScene` で最大辺2.6へ正規化し、灰色3方向と文字面の同じ3方向を並べる。密度15、白文字、同じ人工文、時刻12秒、母体の揺れなしを固定する。「小さい」は絶対的な基準物がないため評価不能とする。

記録する待ち時間は日本語の説明化、生成APIのHTTP待ち時間、APIが返す各段階時間、それらの合計。Shap-Eはモデルが常駐し、画像経由は毎回workerを起動するため、同じ条件に揃えたモデル速度の比較ではない。seed番号は双方20260930だが、異なるモデル間の同じ乱数を意味しない。

入力は人工例のみ。API自体は入力・生成物を保存せず、この実験clientが生成GLBを `public/end-to-end-models/<run>` へ保存する。参照本・参考画像・ユーザーの原稿は含まない。形の修復・平滑化・部品削除をせず、生の応答を保持する。

## 実行

GPUの利用時間を他の実験と調整し、4188・4186・4187が利用可能なことを確認してから実行する。

```sh
.local/triposr-venv/bin/python -B experiments/end-to-end/run.py --run paired-v1
node experiments/end-to-end/capture.mjs paired-v1
```

2行目はローカル4183のViteとGoogle Chromeを使う。既存アプリのsrc/serverは変更せず、実験専用HTMLから共通描画を読み込む。既存run名では新規作成を拒否する。途中の結果はresults.jsonとrun内の公開manifestへ残り、失敗を上書きして再生成しない。

既存研究との利用条件は [Shap-E来歴](../shap-e/README.md)、[SDXL TurboとTripoSR来歴](../text-image/README.md)。配布元は [OpenAI Shap-E](https://github.com/openai/shap-e)、[Stability AI SDXL Turbo](https://huggingface.co/stabilityai/sdxl-turbo)、[TripoSR公式](https://github.com/VAST-AI-Research/TripoSR)。Shap-E/TripoSRは公式MIT、SDXL Turboは固定revisionの [Stability AI Community License](https://huggingface.co/stabilityai/sdxl-turbo/blob/71153311d3dbb46851df1931d3ca6e939de83304/LICENSE.md)。既存の重みを読むだけで、新たな取得はない。公開manifestの各生成物にも出所と利用条件のリンクを付ける。

これは3例×1seedの探索的な比較である。一般的な成功率や万能な日本語理解の根拠にはしない。訳文の誤りと、英語からの形生成の誤りを分離して判断する。
