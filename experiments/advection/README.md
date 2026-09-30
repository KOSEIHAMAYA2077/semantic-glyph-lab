# 面上移流の独立比較

開発サーバーで次を開く。

- 初期案: `http://127.0.0.1:4183/src/advection/preview.html`
- 流れ関数: `http://127.0.0.1:4183/src/advection/preview.html?flow=stream`
- 生成花瓶から開始: `http://127.0.0.1:4183/src/advection/preview.html?shape=generated&flow=stream`

4形状、停止・再開、文字サイズ、黒い本体の一時表示、ドラッグ回転を比較できる。ここは測定用画面で、共通アプリの操作や描画を変更しない。

結果・採否・制限は [RESULTS.md](./RESULTS.md)。ソースは `src/advection/`、元のモデルは `public/generated/` を読み取り利用。新規依存・学習モデル・外部入力送信は追加していない。

```sh
npx tsc --noEmit
npx vitest run src/advection
node experiments/advection/capture.mjs another-run-name stream
```

記録先の既存ディレクトリを上書きしない。同じスクリプトの再実行は別の出力名にする。`probe.mjs`、`compare-stream.mjs`、`check-adapter.mjs`は比較時に使用した専用脚本で、再実行には各出力名を新しくする。

共通画面へ組み込む場合は `AdvectionLayer` を任意選択肢として使う。形状は静的な閉メッシュを前提とし、形を変更したらレイヤを再生成する。板が曲面から浮くこと、全文同時表示の粒子数上限は引き続き説明が必要。
