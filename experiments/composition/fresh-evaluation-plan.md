# Fresh composition check (registered before run-07)

The first six prompts in `evaluate.py` were used in model/prompt comparisons. They are development or reused comparison cases, not an untouched test after iteration. The following six cases were selected before viewing their outputs and will be run once on the selected forms configuration. They are not included in the system prompt or its worked example. No model training or finetuning is performed.

Assess **schema validity separately from visible meaning**. A collection of finite boxes that cannot be recognized as the requested object is a failed visual result even when JSON validates.

| New description | Check before viewing |
|---|---|
| 花瓶から大きな木が生えている | Vase and tree; tree rises out of the vase rather than sitting wholly inside it. |
| 大きな輪の内側に小さな家が浮いている | Larger ring and smaller house placed in its opening. |
| 魚の左右に星形の翼がある | Fish and two stars on opposite sides, visibly attached or close. |
| キノコの傘を屋根にした細長い塔 | Tall tower and mushroom cap above it; an intersecting full mushroom is an acknowledged approximation. |
| 四角くねじれた貝 | Shell kind retained with both squareness and twist attributes. |
| 丸い頭と四角い胴体、左右の腕と二本の脚をもつロボット | A non-catalog object assembled as head, torso, two arms and two legs with appropriate relative locations. |

For each result: record model/revision, vocabulary, prompt version, part count, local inference time, retry count and rendered silhouette. Human review uses `recognizable`, `partial` or `failed`; this small convenience set is not a general benchmark, blind evaluation, or a measure of arbitrary-language coverage.
