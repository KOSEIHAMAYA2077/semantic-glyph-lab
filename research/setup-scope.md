# 再開と新しい環境への導入

確認日: 2026-09-30。実測環境は Apple M5 / 32 GiB / macOS 26.5.1 / Python 3.12.14。

**このMacで取得済みの環境を再開する手順と、新しいcloneからモデルを用意する手順は別です。** フロントエンドと意味APIには導入手順があります。その他のGPU・MLX経路は個別の取得・依存・実測記録があり、このMacでは動作確認していますが、全経路を新しいMacへ一括導入する仕組みや、その通し検証はまだありません。Windowsでの動作も未検証です。

この文書は確認済みの入口と不足を整理したものです。参照スクリプトを新たに実行したり、新環境への導入を検証した記録ではありません。

## このMacで再開する

このリポジトリのルートで、状態の確認だけを行う場合:

```sh
python3 tools/run-lab.py --check
```

取得済みのサービスと画面を起動する場合:

```sh
python3 tools/run-lab.py
```

[run-lab.py](../tools/run-lab.py) は環境をインストールせず、存在する専用環境を利用します。未導入の任意サービスはスキップします。使用中のポートはサービスの識別を確認して再利用し、別サービスなら停止せずエラーにします。Ctrl+Cで終了するのは、その実行が起動した子プロセスだけです。元のアプリの4173には触れません。

試遊画面は <http://127.0.0.1:4183/>。取得済み環境が欠けている場合、このコマンドだけでは生成機能を復元できません。

## 新しいcloneに含まれるもの

- フロントエンド、APIのコード、依存の版を記録したファイル、人工例・結果・モデルの出所記録。
- 配布条件を確認して公開した素材と、人工例から生成した比較用のGLB。取得済みのPoly Haven 3素材も含まれます。
- 学習済み重み、専用Python環境、上流コードのローカルcheckout、キャッシュは含まれません。これらの保存先 `.local/` はGitの対象外です。`node_modules/` も含まれません。

公開リポジトリのコードを使う場合は、試作コードを含むタグまたは `feat/semantic-surface-prototypes` ブランチを選びます。初期の `main` には説明文しかないため、READMEとソースがあることを確認してください。版の入口は[ルートREADME](../README.md)と[STATUS](../STATUS.md)を参照してください。

## 新しい環境での最小構成

### 表示・明示語・取得済みGLBの比較

Node.jsを用意し、リポジトリのルートで既存の[README](../README.md)にある手順を実行します。

```sh
npm ci --ignore-scripts
npm run dev
```

<http://127.0.0.1:4183/> を開きます。モデルAPIがなくても明示した物体名の基準表示と、同梱GLBの読み込みを試せます。この構成だけでは、言い換えの意味検索や新しいメッシュの生成は動きません。

### 24形の意味検索と、取得済み3素材の候補検索

意味APIは [server/README.md](../server/README.md) の「Setup and run」に従います。新規専用環境、[依存lock](../server/requirements.lock.txt)、[固定モデル取得](../server/fetch_model.py)、4184のAPI起動まで記載されています。モデルのrevision・サイズ・SHA256は[取得記録](../experiments/semantics/model-manifest.json)にあります。実測したのは上記Mac環境であり、他環境への移植確認とは分けて扱います。

取得済み素材を文章との近さで並べる4189のAPIは、同じ意味モデルと環境を使います。準備後、別のターミナルで起動できます。

```sh
.local/semantics-venv/bin/python server/retrieval.py
```

この検索対象は[公開manifest](../public/retrieval-models/manifest.json)にある **花瓶・じょうろ・剣の3件** です。対応するgeometry-only GLBも同じディレクトリに含まれます。実行時にPoly Havenの521件カタログを取得する必要はありません。候補を表示して利用者が選ぶ方式であり、所蔵していない物体が見つかったとは扱いません。現行の意味モデルは入力の末尾128トークンまでを使うため、長い文章全体を理解するものではありません。

## その他の経路を導入するときの参照先

下表は個別の確認済み資料への入口です。**lockfile・取得スクリプトがあることと、新しいcloneで全手順がそのまま完走することは同じではありません。** 各モデルを別環境へ用意する作業はまだ必要です。未検証のインストール手順をここで補完せず、どこまで記録があるかを示します。

| 経路・サービス | 実測済み構成の資料 | 新しい環境で残る準備 |
|---|---|---|
| 部品合成・4185 | [実験とAPI](../experiments/composition/README.md)、[依存lock](../experiments/composition/requirements-lock.txt)、[Instruct取得処理](../experiments/composition/prepare_instruct.py)、[公式revisionと取得物](../experiments/composition/instruct-model-manifest.json)、[ローカル4bit変換記録](../experiments/composition/instruct-quantized-manifest.json) | 専用MLX環境、公式Instruct重み、そのローカル4bit版が必要。取得・変換・APIまでを新しいMacで一括再検証していない。 |
| 日本語から英語の物体説明・4188 | [8Bの比較とAPI](../experiments/translation-model/README.md)、[依存lock](../experiments/translation-model/qwen8-requirements-lock.txt)、[公式8B取得処理](../experiments/translation-model/prepare_qwen8.py)、[revision・全取得物](../experiments/translation-model/qwen8-manifest.json) | 8B専用MLX環境と公式4bit重みが必要。説明APIは立体そのものを生成しない。 |
| 英語から直接メッシュ・4186 | [Shap-Eの構成と固定コードcommit](../experiments/shap-e/README.md)、[依存freeze](../experiments/shap-e/requirements.freeze.txt)、[重み取得](../experiments/shap-e/fetch_models.py)、[URL・サイズ・SHA256](../experiments/shap-e/downloads.json)、[API起動](../experiments/generation/README.md) | 専用環境、固定したShap-E・CLIP公式ソース、重みが必要。freezeは実験時の記録であり、一括導入の動作保証ではない。生成APIはMPSを前提とする。 |
| 英語→画像→メッシュ・4187 | [画像生成の導入記録](../experiments/text-image/README.md)、[依存lock](../experiments/text-image/requirements-lock.txt)、[SDXL取得](../experiments/text-image/prepare.py)、[revision・全取得物](../experiments/text-image/model-manifest.json)、[背景除去取得](../experiments/text-image/prepare_background.py)、[API起動と制限](../experiments/text-image-live/README.md) | 画像生成とTripoSRの2専用環境・各重みを用意する。APIは子プロセスで環境を分けるため、片方だけの導入では動かない。 |
| 画像からメッシュ・TripoSR | [ソースcheckoutを含む個別手順](../experiments/triposr/README.md)、[依存lock](../experiments/triposr/requirements-lock.txt)、[重み取得](../experiments/triposr/prepare.py)、[コードcommit・モデルrevision・取得物](../experiments/triposr/model-manifest.json) | 公式ソース、専用環境、重みが必要。Mac用互換処理を使う研究runnerであり、公式手順と同一実装とは主張しない。 |

通常UIの日本語生成は「4188の説明API」と「4186または4187の生成API」を組み合わせます。片方だけが起動していても、その経路は完了しません。CPU意味検索とMLX/MPS生成の依存を一つの既存環境へ混ぜて更新する手順は用意していません。

取得スクリプトの一部は、当日の来歴を残す一回用の処理です。例えば8B取得処理は `qwen8-manifest.json` を排他的に作成し、Instruct取得処理も既存manifestがあれば停止します。公開cloneには既にその記録があるため、これらをそのまま再実行して新規導入が完了するとは案内していません。既存記録を削除して回避せず、別の取得記録の出力先を設けるなどの導入整備が残っています。

## 521件の素材検索を再計算したい場合

これは上記の3素材APIとは別の研究実験です。[素材検索README](../experiments/asset-retrieval/README.md)と[取得条件](../experiments/asset-retrieval/TERMS.md)に従い、公式APIからモデル一覧と選定素材のファイル情報を取得する必要があります。元のAPIメタデータは公開Gitに含めていません。

[retrieve.py](../experiments/asset-retrieval/retrieve.py) は保存済みカタログのSHAを[当日の記録](../experiments/asset-retrieval/catalogue-record.json)と照合します。[acquire_models.py](../experiments/asset-retrieval/acquire_models.py) はカタログと各素材の `*-files.json` が既にあることを前提とします。その初回取得までを行う公開用の一括スクリプトは未整備です。公式一覧は後日変わり得るため、新しく取得した一覧の実験は当日の固定521件の厳密再現とは区別し、新しい記録を残す必要があります。

既に公開されている3素材を画面へ読み込むだけなら、この研究用カタログ・原本テクスチャ・再変換処理は不要です。[元モデルと派生物の出所記録](../experiments/asset-retrieval/source-manifest.json)は公開しています。

## 費用・ライセンス・保存の範囲

今回の取得と端末内推論に有料APIは使っていません。ただし「無料で取得できる」と「用途を問わず無条件に再配布できる」は別です。モデルや素材の条件は各READMEとmanifestを参照してください。特にSDXL Turboは[固定revisionのライセンス全文](../experiments/text-image/SDXL_TURBO_LICENSE.md)と[NOTICE](../experiments/text-image/NOTICE)を伴う研究・非商用評価であり、コードのMITライセンスを重みへ適用していません。**Powered by Stability AI**。Poly Havenの取得済み3素材はCC0ですが、サイト本文や元APIカタログまでCC0として公開していません。

モデル取得時は配布元へのネットワーク接続が必要です。取得後の通常の推論APIは端末内で動き、入力本文・生成画像・生成GLBを自動保存しません。画面の明示的な画像保存操作と、人工例を保存する研究用スクリプトは別です。通常画面の入力履歴はメモリ内にあり、再読み込みすると消えます。
