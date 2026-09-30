import { type FormSpec, type Interpretation, type ObjectId } from './types';
import source from './rule-data.json?raw';

// Exported from server/catalog.py + server/interpreter.py. No semantic inference.
// Regenerate with server/export-rule-fixtures.py and run parity tests after changes.
interface RuleData {
  defaultForm: FormSpec;
  objects: { id: ObjectId; patterns: string[] }[];
  attributes: { pattern: string; key: Exclude<keyof FormSpec, 'object'>; value: number }[];
  colors: { pattern: string; ink: string }[];
  countPattern: string;
}
const rules = JSON.parse(source) as RuleData;
const negation = String.raw`\s*(?:ではなく|ではない|じゃない|以外|でなく|を除く)`;
const editWords = String.raw`大き(?:い|く)|小さ(?:い|く)|太(?:い|く)|厚(?:い|く)|薄(?:い|く)|幅を|bigger|larger|smaller|thicker|thinner`;
const limits: [Exclude<keyof FormSpec, 'object'>, number, number][] = [['squareness',0,1],['elongation',.5,2.5],['twist',-1,1],['bend',-1,1],['roughness',0,1],['count',1,8]];
const matches = (text: string, pattern: string) => Array.from(text.matchAll(new RegExp(pattern, 'gi')));
const end = (match: RegExpMatchArray) => match.index! + match[0].length;

function boundedPrevious(previous: FormSpec): FormSpec {
  const form = { ...rules.defaultForm };
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return form;
  if (rules.objects.some(object => object.id === previous.object)) form.object = previous.object;
  for (const [key, low, high] of limits) {
    const number = previous[key];
    if (typeof number === 'number' && Number.isFinite(number)) form[key] = Math.max(low, Math.min(high, number));
  }
  // Python round uses ties-to-even. In normal application state count is integral.
  const floor = Math.floor(form.count), fraction = form.count - floor;
  form.count = fraction === .5 ? floor + floor % 2 : Math.round(form.count);
  return form;
}

function explicitObject(text: string): ObjectId | undefined {
  const hits = rules.objects.flatMap(object => object.patterns.flatMap(pattern => matches(text, pattern).map(match => ({ start: match.index!, end: end(match), object: object.id }))));
  const eligible = hits.filter(hit => !hits.some(other => other.start <= hit.start && other.end >= hit.end && other.end - other.start > hit.end - hit.start))
    .filter(hit => !new RegExp(`^${negation}`).test(text.slice(hit.end)));
  eligible.sort((a, b) => b.start - a.start || (b.end - b.start) - (a.end - a.start));
  return eligible[0]?.object;
}

function attributes(text: string) {
  const choices = new Map<Exclude<keyof FormSpec, 'object'>, { start: number; end: number; value: number }>();
  const spans: [number, number][] = [], changes: Partial<Omit<FormSpec, 'object'>> = {};
  for (const rule of rules.attributes) for (const match of matches(text, rule.pattern)) {
    const candidate = { start: match.index!, end: end(match), value: rule.value }, existing = choices.get(rule.key);
    if (!existing || (candidate.start <= existing.start && candidate.end >= existing.end) || candidate.start >= existing.end) choices.set(rule.key, candidate);
    spans.push([candidate.start, candidate.end]);
  }
  for (const [key, candidate] of choices) changes[key] = candidate.value;
  for (const match of matches(text, rules.countPattern)) {
    const number = /^[0-9]+$/.test(match[1]) ? Number(match[1]) : '〇一二三四五六七八九十'.indexOf(match[1]);
    changes.count = Math.max(1, Math.min(8, number)); spans.push([match.index!, end(match)]);
  }
  let ink: string | undefined, inkPosition = -1;
  for (const rule of rules.colors) for (const match of matches(text, rule.pattern)) {
    if (match.index! >= inkPosition) { ink = rule.ink; inkPosition = match.index!; }
    spans.push([match.index!, end(match)]);
  }
  for (const match of matches(text, '#[0-9a-f]{6}(?![0-9a-f])')) { ink = match[0]; inkPosition = match.index!; spans.push([match.index!, end(match)]); }
  const characters = text.split(''); // Regex indices and masking both use UTF-16.
  for (const [start, finish] of spans) for (let i = start; i < finish; i++) characters[i] = ' ';
  const residual = characters.join('').replace(/もっと|少し|とても|かなり|この|これ|それ|形|感じ|にして|して|する|ください|くれ|欲しい|ほしい|色|に|を|で|と|の|な|please|make|it|more/g, '')
    .replace(/[\s。、,.!！?？:：;；「」『』\[\]()（）\-]+/g, '');
  return { changes, ink, residual };
}

export function localInterpret(text: string, previous: FormSpec): Interpretation {
  if (typeof text !== 'string' || Array.from(text).length > 4000) throw new Error('text must be a string of at most 4000 characters');
  const normalized = text.normalize('NFKC').trim().toLowerCase();
  let spec = boundedPrevious(previous);
  const { changes, ink, residual } = attributes(normalized), noun = explicitObject(normalized);
  const candidates: Interpretation['candidates'] = [];
  let source: Interpretation['source'] = 'unchanged', note: string | undefined;
  const negatedNoun = rules.objects.some(object => object.patterns.some(pattern => new RegExp(pattern + negation).test(normalized)));
  const unsupportedEdit = new RegExp(editWords).test(normalized) && !residual.replace(new RegExp(editWords + '|だけ|ちょっと|やや|もの|slightly|abit', 'g'), '');
  if (noun) {
    if (noun !== spec.object) spec = { ...rules.defaultForm, object: noun };
    source = 'explicit'; candidates.push({ object: noun, score: 1 });
  } else if (negatedNoun || unsupportedEdit) note = '否定または未対応の変形を含むため、現在の形を保ちました。';
  Object.assign(spec, changes);
  if (Object.keys(changes).length) source = 'composed';
  return { spec, source, candidates, objectSelected: Boolean(noun), elapsedMs: 0, ...(ink ? { ink } : {}), ...(note ? { note } : {}) };
}
