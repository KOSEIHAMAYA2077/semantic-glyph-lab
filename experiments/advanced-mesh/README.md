# 追加の画像→3D候補を採用しなかった理由

2026-09-30。TripoSRより細部が出る可能性を調べ、TripoSGを独立したローカル比較の候補とした。公式実装の推奨環境はCUDAであり、Macでの公式対応を保証するものではない。

[公式TripoSGリポジトリのトップLICENSE](https://github.com/VAST-AI-Research/TripoSG/blob/fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c/LICENSE)と[公式モデルカード](https://huggingface.co/VAST-AI/TripoSG/blob/2c1c516d22d58db486a058d98d31bb6177344e06/README.md)はMITを表示している。一方、[transformer実装の冒頭](https://github.com/VAST-AI-Research/TripoSG/blob/fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c/triposg/models/transformers/triposg_transformer.py#L1-L92)には、HunyuanDiT由来部分へ2024年Tencent Hunyuan Community Licenseが適用されると明記され、地域と出力に関する制約を含む。

トップレベルのMIT表記だけで全体の配布条件が確定したとは判断せず、この実装・重み・生成物の公開試遊版への採用を見送った。個別ファイルの条件との関係は未解決であり、地域を問わず公開できると保証しない。

Hunyuan3D-2miniも候補に含めたが、[公式ライセンス](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE)に地域および出力配布の条件があるため、今回の公開資産には選択しなかった。

ローカル比較用の取得物、実行記録、生成メッシュ、画像、派生コードはGit公開対象から除外し、既存ファイルを削除せず保持する。この公開ディレクトリには採用判断と一次資料へのリンクだけを残す。
