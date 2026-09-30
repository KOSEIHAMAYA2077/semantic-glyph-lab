export type ObjectId = 'sphere' | 'cube' | 'vase' | 'sword' | 'tree' | 'flower' | 'fish' | 'bird' | 'chair' | 'table' | 'mug' | 'bottle' | 'house' | 'tower' | 'ring' | 'star' | 'heart' | 'knot' | 'shell' | 'cone' | 'pyramid' | 'rock' | 'cloud' | 'mushroom';
export interface FormSpec {
  object: ObjectId;
  squareness: number; // 0..1
  elongation: number; // 0.5..2.5
  twist: number; // -1..1
  bend: number; // -1..1
  roughness: number; // 0..1
  count: number; // 1..8
}
export const DEFAULT_FORM: FormSpec = { object: 'sphere', squareness: 0, elongation: 1, twist: 0, bend: 0, roughness: 0, count: 1 };
export interface Interpretation {
  spec: FormSpec;
  source: 'explicit' | 'embedding' | 'composed' | 'unchanged';
  candidates: { object: ObjectId; score: number }[];
  ink?: string;
  elapsedMs: number;
  note?: string;
}
