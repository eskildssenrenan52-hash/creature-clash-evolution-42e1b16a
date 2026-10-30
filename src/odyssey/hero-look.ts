// Personalização aplicada ao próprio sprite: cada quadro é analisado (topo da cabeça, centro, largura),
// pele/cabelo/olhos/roupa são repintados pixel a pixel numa cópia da folha, e chapéus/capas
// gerados por IA são encaixados por direção e por passo usando essa análise. Tudo em cache.
import hatsSrc from "@/assets/atelier/hats.png";
import capesSrc from "@/assets/atelier/capes.png";

export interface FrameBox { top: number; bottom: number; cx: number; headW: number; headH: number; empty: boolean }
export interface Recolor { skin?: string; hair?: string; eyes?: string; body?: string; legs?: string }

type Img = HTMLImageElement | HTMLCanvasElement;
const ready = (i: Img | null | undefined): i is Img => !!i && (i instanceof HTMLCanvasElement || (i.complete && i.naturalWidth > 0));

function pixels(img: Img): { d: Uint8ClampedArray; w: number; h: number } | null {
  if (typeof document === "undefined" || !ready(img)) return null;
  const w = img.width, h = img.height;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true }); if (!c) return null;
  c.drawImage(img, 0, 0);
  try { return { d: c.getImageData(0, 0, w, h).data, w, h }; } catch { return null; }
}

/** Analisa cada quadro (fw×fh) da folha: onde fica a cabeça em cada direção e passo. */
const boxCache = new Map<string, FrameBox[][]>();
export function analyzeSheet(img: Img, key: string, fw: number, fh: number): FrameBox[][] | null {
  const hit = boxCache.get(key); if (hit) return hit;
  const px = pixels(img); if (!px) return null;
  const cols = Math.floor(px.w / fw), rows = Math.floor(px.h / fh);
  const out: FrameBox[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: FrameBox[] = [];
    for (let k = 0; k < cols; k++) {
      let top = -1, bottom = -1;
      const rowW: number[] = [], rowC: number[] = [];
      for (let v = 0; v < fh; v++) {
        let n = 0, sx = 0, minU = fw, maxU = -1;
        for (let u = 0; u < fw; u++) {
          const a = px.d[((r * fh + v) * px.w + k * fw + u) * 4 + 3]!;
          if (a > 100) { n++; sx += u; if (u < minU) minU = u; if (u > maxU) maxU = u; }
        }
        rowW.push(n ? maxU - minU + 1 : 0); rowC.push(n ? sx / n : fw / 2);
        if (n >= 2) { if (top < 0) top = v; bottom = v; }
      }
      if (top < 0) { row.push({ top: fh / 2, bottom: fh / 2, cx: fw / 2, headW: 8, headH: 8, empty: true }); continue; }
      const H = Math.max(6, bottom - top + 1);
      const headH = Math.max(5, Math.round(H * 0.4));
      // Centro e largura da cabeça: mediana das linhas da metade superior da cabeça (ignora armas que atravessam).
      const ws: number[] = [], cs: number[] = [];
      for (let v = top + 1; v < top + headH * 0.75; v++) if (rowW[v]) { ws.push(rowW[v]!); cs.push(rowC[v]!); }
      ws.sort((a, b) => a - b); cs.sort((a, b) => a - b);
      const headW = Math.max(6, Math.min(H * 0.7, ws[Math.floor(ws.length / 2)] ?? 8));
      row.push({ top, bottom, cx: cs[Math.floor(cs.length / 2)] ?? fw / 2, headW, headH, empty: false });
    }
    out.push(row);
  }
  boxCache.set(key, out);
  return out;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function rgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const hh = h / 360; return [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255];
}
const hex = (c: string): [number, number, number] => { const n = parseInt(c.replace("#", "").slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const skinLike = (h: number, s: number, l: number) => h >= 6 && h <= 45 && s >= .18 && s <= .85 && l >= .42 && l <= .9;

const Cls = { None: 0, Skin: 1, Hair: 2, Eye: 3, Body: 4, Legs: 5 } as const;

/** Cópia da folha com pele, cabelo, olhos e roupa repintados quadro a quadro. */
const recolorCache = new Map<string, HTMLCanvasElement>();
export function recolorSheet(img: Img, key: string, fw: number, fh: number, rc: Recolor): Img {
  if (!rc.skin && !rc.hair && !rc.eyes && !rc.body && !rc.legs) return img;
  const ck = `${key}|${rc.skin}|${rc.hair}|${rc.eyes}|${rc.body}|${rc.legs}`;
  const hit = recolorCache.get(ck); if (hit) return hit;
  const boxes = analyzeSheet(img, key, fw, fh); const px = pixels(img);
  if (!boxes || !px || typeof document === "undefined") return img;
  const { d, w } = px;
  const cls = new Uint8Array(d.length / 4);
  const sumL = [0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0];
  const op = (i: number) => d[i * 4 + 3]! > 100;
  for (let r = 0; r < boxes.length; r++) for (let k = 0; k < boxes[r]!.length; k++) {
    const b = boxes[r]![k]!; if (b.empty) continue;
    const H = b.bottom - b.top + 1, headEnd = b.top + b.headH, faceA = b.top + b.headH * .4, faceB = b.top + b.headH * .95;
    const hairEnd = b.top + b.headH * .62, bodyEnd = b.top + H * .74;
    for (let v = 0; v < fh; v++) for (let u = 0; u < fw; u++) {
      const x = k * fw + u, y = r * fh + v, i = y * w + x;
      if (!op(i)) continue;
      const [h, s, l] = hsl(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
      const nearHead = Math.abs(u - b.cx) <= b.headW * .7;
      let c: number = Cls.None;
      if (v < headEnd && nearHead) {
        const inner = u > 0 && u < fw - 1 && op(i - 1) && op(i + 1) && op(i - w) && op(i + w);
        if (skinLike(h, s, l)) c = Cls.Skin;
        else if (inner && v >= faceA && v <= faceB && (l < .3 || (s > .45 && l < .6))) {
          // Olho: pixel escuro/saturado cercado de pele na faixa do rosto.
          const nb = [i - 1, i + 1, i - w, i + w, i - 2, i + 2].filter((j) => { const [hh, ss, ll] = hsl(d[j * 4]!, d[j * 4 + 1]!, d[j * 4 + 2]!); return skinLike(hh, ss, ll); }).length;
          c = nb >= 2 ? Cls.Eye : (v < hairEnd && l > .12 ? Cls.Hair : Cls.None);
        } else if (v < hairEnd && l > .12 && l < .95) c = Cls.Hair;
      } else if (v >= headEnd) {
        if (skinLike(h, s, l)) c = Cls.Skin;
        else if (l > .1 && l < .92 && (s > .12 || l > .25)) c = v < bodyEnd ? Cls.Body : Cls.Legs;
      }
      cls[i] = c; sumL[c]! += l; cnt[c]!++;
    }
  }
  const target: (string | undefined)[] = [undefined, rc.skin, rc.hair, rc.eyes, rc.body, rc.legs];
  const tgt = target.map((t) => t ? hsl(...hex(t)) : null);
  const mean = sumL.map((s, i) => cnt[i] ? s / cnt[i]! : .5);
  const out = new Uint8ClampedArray(d);
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i]!, t = tgt[c]; if (!c || !t) continue;
    const [, s, l] = hsl(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
    // Preserva o sombreado original: desloca a luminosidade em torno da média da região.
    const nl = Math.max(.04, Math.min(.96, t[2] + (l - mean[c]!) * (c === Cls.Eye ? .5 : 1)));
    const ns = c === Cls.Eye ? Math.max(t[1], .4) : t[1] * .75 + s * .25;
    const [R, G, B] = rgb(t[0], ns, nl);
    out[i * 4] = R; out[i * 4 + 1] = G; out[i * 4 + 2] = B;
  }
  const cv = document.createElement("canvas"); cv.width = w; cv.height = px.h;
  cv.getContext("2d")!.putImageData(new ImageData(out, w, px.h), 0, 0);
  if (recolorCache.size > 40) recolorCache.clear();
  recolorCache.set(ck, cv);
  return cv;
}

// ---------- Chapéus e capas gerados por IA ----------
let hatsImg: HTMLImageElement | null = null, capesImg: HTMLImageElement | null = null;
function atlas(which: "hats" | "capes") {
  if (typeof Image === "undefined") return null;
  if (which === "hats") { if (!hatsImg) { hatsImg = new Image(); hatsImg.src = hatsSrc; } return ready(hatsImg) ? hatsImg : null; }
  if (!capesImg) { capesImg = new Image(); capesImg.src = capesSrc; } return ready(capesImg) ? capesImg : null;
}
/** Pré-carrega a arte dos acessórios (chamado pela prévia e pelo jogo). */
export function preloadAccessories() { atlas("hats"); atlas("capes"); }

interface Piece { cv: HTMLCanvasElement; w: number; h: number }
const pieceCache = new Map<string, Piece | null>();
/** Recorta uma peça (célula 32px) pelo contorno; capas recebem a cor escolhida. */
function piece(which: "hats" | "capes", col: number, row: number, tint?: string): Piece | null {
  const k = `${which}|${col}|${row}|${tint ?? ""}`;
  if (pieceCache.has(k)) return pieceCache.get(k)!;
  const img = atlas(which); if (!img) return null;
  const px = pixels(img); if (!px) return null;
  let x0 = 32, y0 = 32, x1 = -1, y1 = -1;
  for (let v = 0; v < 32; v++) for (let u = 0; u < 32; u++) if (px.d[((row * 32 + v) * px.w + col * 32 + u) * 4 + 3]! > 100) { x0 = Math.min(x0, u); y0 = Math.min(y0, v); x1 = Math.max(x1, u); y1 = Math.max(y1, v); }
  if (x1 < 0) { pieceCache.set(k, null); return null; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!;
  c.drawImage(img, col * 32 + x0, row * 32 + y0, w, h, 0, 0, w, h);
  if (tint) { c.globalCompositeOperation = "multiply"; c.fillStyle = tint; c.fillRect(0, 0, w, h); c.globalCompositeOperation = "destination-in"; c.drawImage(img, col * 32 + x0, row * 32 + y0, w, h, 0, 0, w, h); }
  const p = { cv, w, h }; pieceCache.set(k, p); return p;
}

/** Proporções de cada chapéu: largura relativa à cabeça e quanto desce sobre ela (0 = em cima, 1 = cobre tudo). */
export const HAT_FIT: Record<number, { w: number; sink: number }> = {
  1: { w: 1.45, sink: .95 }, // capuz
  2: { w: 1.9, sink: .42 },  // chapéu de mago
  3: { w: 1.05, sink: .18 }, // coroa
  4: { w: 1.25, sink: .45 }, // bandana
  5: { w: 1.35, sink: .9 },  // elmo
};

/** Vista do acessório: 0 frente, 1 lado, 2 costas. */
export const viewOf = (dir: number) => (dir === 0 ? 0 : dir === 3 ? 2 : 1);

/**
 * Desenha a capa (camada "back" atrás do corpo; "front" por cima quando de costas) ou o chapéu ("hat")
 * em coordenadas do quadro. `faceRight` indica para onde o quadro olha nas vistas de lado.
 */
export function drawAccessory(c: CanvasRenderingContext2D, layer: "back" | "front" | "hat", b: FrameBox, view: number, faceRight: boolean, hat: number, cape: string | undefined, sway: number) {
  if (b.empty) return;
  if (layer === "hat") {
    if (!hat) return;
    const fit = HAT_FIT[hat]; const p = piece("hats", view, hat - 1); if (!fit || !p) return;
    const sc = (b.headW * fit.w) / p.w, w = p.w * sc, h = p.h * sc;
    const bottom = b.top + b.headH * fit.sink;
    // A arte de lado olha para a esquerda: espelha quando o quadro olha para a direita.
    blit(c, p.cv, b.cx - w / 2 + (view === 1 ? (faceRight ? 1 : -1) * b.headW * .06 : 0), bottom - h, w, h, view === 1 && faceRight);
    return;
  }
  if (!cape) return;
  const behind = view !== 2;
  if ((layer === "back") !== behind) return;
  const p = piece("capes", view, 0, cape); if (!p) return;
  const H = b.bottom - b.top + 1;
  const targetH = H * (view === 2 ? .66 : .62);
  const sc = targetH / p.h, w = p.w * sc * (view === 1 ? 1 : 1 + sway * .03), h = targetH;
  const shoulder = b.top + b.headH * .88;
  const shift = view === 1 ? (faceRight ? -1 : 1) * b.headW * .35 : 0;
  // A capa de lado esvoaça para a esquerda: espelha quando o quadro olha para a esquerda.
  blit(c, p.cv, b.cx - w / 2 + shift, shoulder, w, h, view === 1 && !faceRight);
}
function blit(c: CanvasRenderingContext2D, cv: HTMLCanvasElement, x: number, y: number, w: number, h: number, mirror: boolean) {
  if (!mirror) { c.drawImage(cv, x, y, w, h); return; }
  c.save(); c.translate(x + w, y); c.scale(-1, 1); c.drawImage(cv, 0, 0, w, h); c.restore();
}
