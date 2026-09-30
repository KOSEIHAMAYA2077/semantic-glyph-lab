import * as THREE from 'three';
export interface Letter { text: string; ink: string; at: number; auto: boolean }
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export const graphemes = (text: string) => Array.from(segmenter.segment(text.normalize('NFC')), item => item.segment).filter(s => !/^\s+$/u.test(s));
export const MAX_LETTERS = 4096;
export class LetterField {
  letters: Letter[] = [{ text: '@', ink: '#ffffff', at: -100, auto: false }];
  canvas = document.createElement('canvas');
  texture = new THREE.CanvasTexture(this.canvas);
  grid = 8;
  revision = 0;
  private lastRefresh = -100;
  constructor() {
    this.texture.wrapS = this.texture.wrapT = THREE.RepeatWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.refresh(0, true);
  }
  add(text: string, time: number, ink?: string) {
    const chars = graphemes(text).slice(0, MAX_LETTERS - this.letters.length);
    for (const char of chars) this.letters.push({ text: char, ink: ink ?? '#ffffff', at: time, auto: !ink });
    this.revision++; this.refresh(time, true); return chars.length;
  }
  refresh(time: number, force = false) {
    if (!force && (time - this.lastRefresh < .3 || !this.letters.some(l => l.auto && this.lastRefresh < l.at + 8))) return;
    this.lastRefresh = time;
    this.grid = Math.max(8, 2 ** Math.ceil(Math.log2(Math.ceil(Math.sqrt(this.letters.length)))));
    const size = this.grid * 64;
    if (this.canvas.width !== size) {
      // WebGL2 texture storage has immutable dimensions. Keep the shared texture
      // object but release its allocation before uploading a larger atlas.
      this.texture.dispose(); this.canvas.width = size; this.canvas.height = size;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '44px "Hiragino Kaku Gothic ProN", "Yu Gothic", monospace';
    for (let i = 0; i < this.grid * this.grid; i++) {
      const l = this.letters[i % this.letters.length];
      if (l.auto) { const fade = Math.min(1, Math.max(0, (time - l.at) / 8)); const tint = Math.round(70 + fade * 185); ctx.fillStyle = `rgb(255,${tint},${tint})`; }
      else ctx.fillStyle = l.ink;
      ctx.fillText(l.text, (i % this.grid) * 64 + 32, Math.floor(i / this.grid) * 64 + 33, 55);
    }
    this.texture.needsUpdate = true;
  }
}
