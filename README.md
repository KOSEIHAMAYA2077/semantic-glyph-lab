# Semantic Glyph Lab

文章から関連する立体を選ぶ・作ることで、蓄積した言葉をその表面に流す研究試作。[文字のかたち](https://github.com/KOSEIHAMAYA2077/ai-game-lab)から独立した別版です。

![文字が覆う球体](experiments/surface-01/screens/sphere.png)

## 試す

Node.jsを用意し、`npm ci --ignore-scripts`、`npm run dev`。ブラウザで http://127.0.0.1:4183 を開く。意味モデルの準備・起動は[server/README.md](server/README.md)。未起動でも明示した物体名による基準表示は使えます。

Enterで入力を開き、文章を入れてEnter。ドラッグで回転、スクロールで距離。比較から生成した形・無料素材・密度・流れを選べます。

- `花瓶` → `四角くねじれた`：花瓶を維持し、属性を変える。
- `腰を下ろして休めるもの`：ローカル意味モデルが椅子を選ぶ。
- `白い剣` → `赤い球体`：先に入れた文字の色を残す。

意味検索は24種からの選択で、未知の形を生成しているわけではありません。比較欄のShap-Eモデルは、このMacで実際に生成した5人工例の形です。操作中の文章は端末内で処理し、保存・外部送信しません。再読み込みで入力は戻ります。

## 記録

- [目的と制約](BRIEF.md) / [進捗](STATUS.md)
- [共通の文字表面表示](experiments/surface-01/RESULTS.md)
- [意味検索・ルールの評価](experiments/semantics/REPORT.md)
- [Shap-E生成・失敗・抽出解像度の比較](experiments/shap-e/RESULTS.md)
- [既存3D素材の出所](research/mesh-assets.md)

検証: `npm test`、`npm run build`。ブラウザ検証は意味API起動後 `npm run test:e2e`。このMacではChromeを利用。詳しい設定はplaywright.config.ts。

モデル重み・個人原稿は公開Gitへ含めません。モデルや素材の出所・ライセンス・取得ハッシュは各実験のmanifestへ記録しています。研究試作であり、任意の文章が常に期待どおりに立体化するとは主張していません。
