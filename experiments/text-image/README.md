# 文章 → 画像 → 立体

**Powered by Stability AI**

2026-09-30、Apple M5 / 32GB。人工英語の物体説明をローカルのSDXL Turboで画像にし、U2NETPで背景を除き、TripoSRで三角メッシュへ変換した。元のアプリ・既存の依存環境は変更していない。文字を這わせる描画は共通ビューアに任せ、ここではY-up GLBを渡す。

初回3例と剣の構図再試行1例、その後の背景処理2案の結果は [RESULTS.md](RESULTS.md)、読み込み用6件は [public manifest](../../public/text-image-models/manifest.json)。任意の日本語文章を万能に立体化した実験ではなく、短い英語の人工例を扱う比較である。

## 配布元と利用条件

取得・資料確認日: 2026-09-30。

| 段階 | 一次資料 | この実験 |
|---|---|---|
| 画像生成 | [SDXL Turbo公式モデル](https://huggingface.co/stabilityai/sdxl-turbo)、[ADD研究紹介](https://stability.ai/research/adversarial-diffusion-distillation) | 512×512、4 step、guidance scale 0、MPS fp16。追加学習なし |
| 実行 | [Diffusers Turbo手順](https://huggingface.co/docs/diffusers/main/en/using-diffusers/sdxl_turbo)、[公式MPS手順](https://huggingface.co/docs/diffusers/optimization/mps) | `StableDiffusionXLPipeline`を明示し、モデル側のPythonを取得・実行しない |
| 背景除去 | [U-2-Net原著者repo](https://github.com/xuebinqin/U-2-Net)、[rembg配布元](https://github.com/danielgatis/rembg) | 4.57MBのU2NETP ONNX、CPU推論。rembg既存環境を読取利用 |
| 単画像の立体化 | [TripoSR公式repo](https://github.com/VAST-AI-Research/TripoSR)、[技術報告](https://arxiv.org/abs/2403.02151) | [先行実験](../triposr/README.md)の固定済み公式モデルとMPS対応runnerを再利用。128³で面抽出 |
| 比較候補 | [SDXL base公式](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) | 未取得・未実行。少ないstepで比較を回せるTurboを先に選んだ。品質優劣は未測定 |

SDXL Turbo revisionは `71153311d3dbb46851df1931d3ca6e939de83304`。Hubのメタデータには `sai-nc-community` とあるが、このrevisionの実際の [LICENSE.md](https://huggingface.co/stabilityai/sdxl-turbo/blob/71153311d3dbb46851df1931d3ca6e939de83304/LICENSE.md) は2024-07-05版Stability AI Community Licenseである。研究・非商用評価を許可する条項に基づく実験。モデルを使う製品等の配布にはライセンス・NOTICE・帰属表示の条件があり、商用利用には登録や収入条件もある。重みをMITとして再配布しない。[ライセンス全文](SDXL_TURBO_LICENSE.md)と[NOTICE](NOTICE)を同梱した。

TripoSRのコードと重みは公式がMITと表示。U-2-Netの原著者repoはApache-2.0、rembgのrepoはMIT。ONNXはrembgの公式releaseから取得し、rembgに埋め込まれたMD5と一致した。重みは公開Gitへ含めない。生成画像・メッシュは人工的な比較成果物として来歴を残す。

## 取得と実行の分離

- SDXL Turboのfp16 safetensors 4点、設定・tokenizer・文書: **6,941,205,599 bytes**。[全出所・SHA256](model-manifest.json)
- U2NETP ONNX: **4,574,861 bytes**、SHA256 `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`。[記録](background-manifest.json)
- TripoSR重み等は先行実験の1,677,250,671 bytesを再利用し、二重取得していない。Python環境とcacheの容量は上記と別。
- 新しい画像生成環境は `.local/text-image-venv`。依存競合で失敗した構成と成功した構成を [SETUP_NOTES.md](SETUP_NOTES.md) に残した。
- モデル取得時だけ配布元へアクセスする。推論ではローカル専用設定と外向きsocket接続の遮断を使い、記録した全runの接続試行は0回。入力は事前に作成した人工例文だけ。ユーザー原稿は使用していない。
- 画像生成重みはsafetensorsのみ。`trust_remote_code`は使わず、pipelineの構成クラスを照合する。TripoSRのcheckpointは先行runner同様 `weights_only=True` と厳密なstate dict照合で読む。

## 再実行

repoのルートで実行する。既存環境があるときは再作成しない。TripoSR環境は [専用手順](../triposr/README.md) が前提。各run名は未使用のものにする。モデル準備も既存ハッシュ不一致では停止し、不完全なファイルを削除しない。

```sh
python3.12 -m venv .local/text-image-venv
.local/text-image-venv/bin/python -m pip install -r experiments/text-image/requirements-lock.txt
.local/text-image-venv/bin/python experiments/text-image/prepare.py
.local/triposr-venv/bin/python experiments/text-image/prepare_background.py
.local/text-image-venv/bin/python experiments/text-image/generate.py --run turbo4-repeat --steps 4
.local/triposr-venv/bin/python experiments/text-image/reconstruct.py --images turbo4-repeat --run mesh128-repeat --background u2netp
.local/triposr-venv/bin/python experiments/text-image/compare.py --run mesh128-repeat
```

保存済みのモデルmanifestを再生成する意図のない再実行では、準備スクリプトを省く。画像・GLB・比較図の既存出力は上書きしない。比較図を直す場合は `--output comparison-v2` のように別名を指定する。

出力GLBはraw Z-upとX軸−90°回転のY-upを両方残す。平滑化・穴埋め・部品除去は実施していない。`success`はファイルの生成成功であり、文章への適合判定ではない。公開manifestの `semanticAssessment` と目視記録を併せて読む。

追加した `--background none` はRGB画像をそのまま渡す。`--background white-border` は「全チャンネルが200より大きい・最大と最小の差が45未満」の領域のうち画像の外周に接続する部分だけを取り除き、残りを公式の前景比率0.85へ調整する。どちらも汎用の前景除去ではなく、比較用の選択肢。`prompts-sword-blue-v3.json` は単色物体を狙った追加の人工fixtureである。

```sh
.local/triposr-venv/bin/python experiments/text-image/verify.py --output verification-repeat
```

GLBの再読込、ハッシュ、頂点の有限性、面番号の範囲、rawからY-upへの変換が回転だけであることを確認する。実行済み6件は [verification-v1.json](verification-v1.json)。形が文章に合うことのテストとは分離している。
