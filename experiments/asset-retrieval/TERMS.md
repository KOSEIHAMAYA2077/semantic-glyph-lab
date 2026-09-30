# 配布物とAPIの条件

確認日: 2026-09-30。Powered by [Poly Haven](https://polyhaven.com/) — independent experiment, not endorsed by Poly Haven.

[公式ライセンス](https://polyhaven.com/license) は3D素材をCC0とし、加工・再配布を認めている。公式サイトの文章、プレビュー画像、ロゴまでCC0という意味ではない。この実験ではサイトの画像を再配布せず、モデル自身から比較画像を描画する。

[API規約](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) は無料の商用・非商用利用とデータを使うソフトウェアを認める。API呼び出しには固有のUser-Agentを付け、APIを使って内容を提示する場合は出所を表示する。公式APIコードのAGPLと、取得する3D素材のCC0は別のもの。APIの実装コードはコピー・実行しない。

APIメタデータ全体をCC0とは断定しない。元の一覧JSONはGit対象外のローカルフォルダに保管し、公開するのは素材ID・元ページURL・取得hash・自分で作った評価と描画結果を中心とする。数件の素材名と作者名は出所確認用に記録する。

APIの [公式仕様](https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml) に従い、モデル一覧と選んだ最大3素材のファイル一覧だけを取得する。APIキーは不要。本文や日本語の検索語は外へ送らず、取得した英語メタデータと日本語の人工例を端末内で比較する。サービスへの高頻度アクセスやサイトHTMLの自動収集は行わない。
