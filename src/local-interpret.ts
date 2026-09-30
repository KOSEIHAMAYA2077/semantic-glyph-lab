import { type FormSpec, type Interpretation, type ObjectId } from './types';
// Offline baseline only. The learned semantic experiment uses the local API.
const words: [ObjectId, RegExp][] = [
 ['sphere',/球体|球|丸い|ボール|sphere|ball/i],['cube',/立方体|箱|キューブ|cube|box/i],['vase',/花瓶|壺|つぼ|vase/i],['sword',/剣|刀|ソード|sword/i],
 ['tree',/樹木|木|森林|tree/i],['flower',/花|flower/i],['fish',/魚|fish/i],['bird',/鳥|bird/i],['chair',/椅子|いす|chair/i],['table',/机|テーブル|table/i],['mug',/マグ|コップ|カップ|mug|cup/i],['bottle',/瓶|ボトル|bottle/i],['house',/家|住宅|house/i],['tower',/塔|タワー|tower/i],['ring',/円環|輪|リング|ring|torus/i],['star',/星|star/i],['heart',/ハート|heart/i],['knot',/結び目|knot/i],['shell',/貝|shell/i],['cone',/円錐|cone/i],['pyramid',/ピラミッド|四角錐|pyramid/i],['rock',/岩|石|rock/i],['cloud',/雲|cloud/i],['mushroom',/きのこ|キノコ|mushroom/i],
];
export function localInterpret(text: string, previous: FormSpec): Interpretation {
  const found = words.find(([, re]) => re.test(text));
  const spec = { ...previous, ...(found ? { object: found[0] } : {}) };
  let modified = false;
  const set = (key: 'squareness' | 'elongation' | 'twist' | 'bend' | 'roughness', value: number) => { spec[key] = value; modified = true; };
  if (/四角|角張|角ば|square|angular/i.test(text)) set('squareness', 1);
  if (/丸み|丸く|round/i.test(text)) set('squareness', 0);
  if (/細長|長い|長く|long|tall/i.test(text)) set('elongation', 1.8);
  if (/平た|平べった|flat/i.test(text)) set('elongation', .55);
  if (/ねじ|捻|twist/i.test(text)) set('twist', .7);
  if (/曲が|曲げ|bend/i.test(text)) set('bend', .55);
  if (/ざら|ごつ|凸凹|rough/i.test(text)) set('roughness', .5);
  if (/元に|普通の|通常の|reset/i.test(text)) { Object.assign(spec, { squareness: 0, elongation: 1, twist: 0, bend: 0, roughness: 0, count: 1 }); modified = true; }
  const count = text.normalize('NFKC').match(/([1-8])\s*(?:個|本|つ|枚)/); if (count) { spec.count = Number(count[1]); modified = true; }
  const colors: [RegExp,string][] = [[/赤|red/i,'#ff5e62'],[/青|blue/i,'#65a3ff'],[/黄色|yellow/i,'#ffe88c'],[/緑|green/i,'#80e6ae'],[/紫|purple/i,'#b695ff'],[/白|white/i,'#ffffff']];
  return { spec, source: found ? 'explicit' : modified ? 'composed' : 'unchanged', candidates: found ? [{ object: found[0], score: 1 }] : [], ink: colors.find(([re]) => re.test(text))?.[1], elapsedMs: 0, note: '明示語による基準。学習モデルの推定ではありません。' };
}
