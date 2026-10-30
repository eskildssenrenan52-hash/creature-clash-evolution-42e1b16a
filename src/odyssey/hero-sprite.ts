// Protagonista com sprites prontos (Kaetram e skins geradas por IA) + o herói em pixels.
// A personalização entra no próprio sprite: cores repintadas por quadro e chapéu/capa encaixados
// por direção e passo (ver hero-look.ts).
import type { ItemDef, Palette, WeaponKind } from "./data";
import { drawK, kImage, K_DIR, K_SHEETS } from "./kaetram";
import { drawChar, type CharExtras } from "./gfx";
import { analyzeSheet, drawAccessory, preloadAccessories, recolorSheet, viewOf, type FrameBox, type Recolor } from "./hero-look";

export interface HeroSkin { id: string; name: string; desc: string; sheet: string; minLevel: number; faceLeft?: boolean | undefined }
/** Skins geradas por IA: folhas 5×8 de 48 px (linhas 0-2 andar frente/lado/costas, 3 ataque de lado). */
const GEN: [string, string, string, number, boolean?][] = [
  ["hero", "Herói Ilustrado", "O aventureiro clássico, redesenhado.", 1],
  ["knight", "Cavaleiro", "Armadura polida e capa azul.", 2],
  ["archer", "Arqueira da Mata", "Capuz verde e passos leves.", 2],
  ["cat", "Gato Espadachim", "Pequeno, laranja e corajoso.", 1],
  ["mage", "Mago Azul", "Chapéu estrelado e cajado.", 3],
  ["witch", "Bruxa do Pântano", "Vassoura e risada abafada.", 4],
  ["druid", "Druida", "Fala com as árvores.", 4],
  ["pirate", "Pirata", "Tricórnio e sabre curvo.", 5],
  ["ninja", "Ninja", "Cachecol rubro, sombra rápida.", 6],
  ["samurai", "Samurai", "Honra e lâmina afiada.", 6],
  ["taekwondo", "Lutadora", "Faixa vermelha e chutes velozes.", 5],
  ["viking", "Viking", "Chifres, barba e machado.", 7],
  ["princess", "Princesa", "Coroa de rubis e lâmina fina.", 7, true],
  ["paladin", "Paladino Dourado", "Martelo sagrado e escudo.", 8],
  ["oldman", "Velho Mago", "Barba longa e olhar sábio.", 8, true],
  ["danbo", "Caixa Andante", "Papelão com coração.", 3],
  ["pumpkin", "Abóbora", "Cabeça de abóbora e foice.", 9],
  ["skeleton", "Esqueleto", "Ossos que rangem.", 9],
  ["wolf", "Lobisomem", "Uivo prateado.", 10],
  ["sea", "Tritão", "Escamas azuis e tridente.", 10],
  ["ice", "Golem de Gelo", "Feito do inverno eterno.", 11],
  ["mecha", "Mecha", "Lâmina de energia.", 12],
  ["vampire", "Vampiro", "Capa negra e caninos.", 12],
  ["necro", "Ceifador", "Foice e silêncio.", 13],
  ["demon", "Demônio", "Chamas e chifres.", 14],
  ["angel", "Anjo", "Asas brancas e luz.", 15],
];
/** Índice salvo em Look.kskin. Os 10 primeiros nunca mudam de posição (saves antigos). */
export const HERO_SKINS: HeroSkin[] = [
  { id: "base", name: "Aventureiro", desc: "O herói clássico do primeiro jogo.", sheet: "player/base", minLevel: 1 },
  { id: "danbo", name: "Danbo", desc: "Robô de papelão, firme e leal.", sheet: "player/skin/danbo", minLevel: 1 },
  { id: "danboblue", name: "Danbo Azul", desc: "Pintado com tinta do mar.", sheet: "player/skin/danboblue", minLevel: 2 },
  { id: "danbogreen", name: "Danbo Verde", desc: "Camuflado para a mata.", sheet: "player/skin/danbogreen", minLevel: 3 },
  { id: "danbored", name: "Danbo Rubro", desc: "Pronto para a forja.", sheet: "player/skin/danbored", minLevel: 4 },
  { id: "taekwondo", name: "Mestre Taekwondo", desc: "Faixa preta e dobok branco.", sheet: "player/skin/taekwondo", minLevel: 5 },
  { id: "oldman", name: "Velho Sábio", desc: "Barba longa, passos lentos, olhar atento.", sheet: "player/skin/oldmanskin", minLevel: 7 },
  { id: "skeleton", name: "Esqueleto", desc: "Voltou do Abismo e esqueceu de morrer.", sheet: "player/skin/skeletonskin", minLevel: 10 },
  { id: "darkskeleton", name: "Esqueleto Sombrio", desc: "Ossos tingidos pela Noite.", sheet: "player/skin/darkskeletonskin", minLevel: 15 },
  { id: "classic", name: "Herói em pixels", desc: "O visual personalizável original (pele, cabelo, roupa…).", sheet: "", minLevel: 1 },
  ...GEN.map(([id, name, desc, minLevel, faceLeft]) => ({ id: `gen-${id}`, name, desc, sheet: `gen:${id}`, minLevel, faceLeft })),
];
export const CLASSIC_SKIN = 9;
export const skinUnlocked = (i: number, level: number) => level >= (HERO_SKINS[i]?.minLevel ?? 1);

/** Folha de arma para cada tipo quando o item não tiver uma própria. */
const KIND_SPRITE: Record<WeaponKind, string> = { sword: "tinsword", spear: "bronzespear", bow: "woodenbow", staff: "naturestaff" };
export function weaponSheet(item: Pick<ItemDef, "sprite" | "weapon"> | undefined): string {
  const s = item?.sprite ?? KIND_SPRITE[item?.weapon ?? "sword"];
  return `player/weapon/${s}`;
}

const genCache = new Map<string, HTMLImageElement>();
function genImage(id: string): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  let img = genCache.get(id);
  if (!img) { img = new Image(); img.src = `/hero/${id}.png`; genCache.set(id, img); }
  return img.complete && img.naturalWidth ? img : null;
}

/** Escolhas do jogador que entram no próprio sprite. */
export interface HeroCustom { recolor: Recolor; hat: number; cape?: string | undefined }

interface FrameRef { img: HTMLImageElement; key: string; fw: number; fh: number; col: number; row: number; ou: number; ov: number; flip: boolean; faceRight: boolean }

/** Resolve qual quadro desenhar para cada skin, direção e passo. */
function frameFor(skin: HeroSkin, dir: number, moving: boolean, frameT: number, attack: number, time: number, bow: boolean): FrameRef | null {
  const d = K_DIR[dir] ?? "down", flip = dir === 1;
  if (skin.sheet.startsWith("gen:")) {
    const id = skin.sheet.slice(4), img = genImage(id); if (!img) return null;
    const side = dir === 1 || dir === 2;
    // A folha de lado olha para a direita (ou esquerda nas skins marcadas); espelha para a outra direção.
    const natRight = !skin.faceLeft, wantRight = dir === 2;
    let row = dir === 0 ? 0 : dir === 3 ? 2 : 1, col: number;
    if (attack > 0 && side) { row = 3; col = Math.min(4, Math.floor((1 - attack) * 5)); }
    else if (moving || attack > 0) col = 1 + (Math.floor(frameT) % 4);
    else col = Math.floor(time * 1.2) % 2 ? 0 : 0;
    return { img, key: skin.sheet, fw: 48, fh: 48, col, row, ou: 24, ov: 44, flip: side && natRight !== wantRight, faceRight: natRight };
  }
  const def = K_SHEETS[skin.sheet]; const img = kImage(skin.sheet); if (!def?.anims || !img) return null;
  const anim = attack > 0 ? `${bow ? "bow_" : ""}atk_${d}` : moving ? `walk_${d}` : `idle_${d}`;
  const a = def.anims[anim] ?? def.anims[anim.replace("bow_", "")] ?? def.anims["idle_down"]!;
  const fr = attack > 0 ? Math.min(3, Math.floor((1 - attack) * 4)) : moving ? frameT : time * 2.2;
  const col = ((Math.floor(fr) % a[0]) + a[0]) % a[0];
  const w = def.w ?? 32, h = def.h ?? 32;
  return { img, key: skin.sheet, fw: w, fh: h, col, row: a[1], ou: 8 - (def.ox ?? -16), ov: 32 - (def.oy ?? -16), flip, faceRight: true };
}

/**
 * Desenha o herói com sprites prontos. Retorna false quando a skin é a clássica
 * ou as imagens ainda não carregaram (quem chama usa drawHeroClassic).
 */
export function drawHero(c: CanvasRenderingContext2D, x: number, y: number, o: { skin: number; dir: number; moving: boolean; frameT: number; attack: number; weapon?: Pick<ItemDef, "sprite" | "weapon"> | null; time: number; alpha?: number; scale?: number; custom?: HeroCustom }): boolean {
  const skin = HERO_SKINS[o.skin] ?? HERO_SKINS[0]!;
  if (!skin.sheet) return false;
  preloadAccessories();
  const bow = o.weapon?.weapon === "bow";
  const f = frameFor(skin, o.dir, o.moving, o.frameT, o.attack, o.time, bow); if (!f) return false;
  const sc = o.scale ?? 1, a = o.alpha ?? 1;
  const cu = o.custom;
  const src = cu ? recolorSheet(f.img, f.key, f.fw, f.fh, cu.recolor) : f.img;
  const box: FrameBox | undefined = cu && (cu.hat || cu.cape) ? analyzeSheet(f.img, f.key, f.fw, f.fh)?.[f.row]?.[f.col] : undefined;
  const view = viewOf(o.dir), sway = Math.sin(o.time * 4 + o.frameT);
  // Arma Kaetram por baixo quando de costas (as skins geradas já trazem a própria arma).
  const kae = !skin.sheet.startsWith("gen:");
  const anim = o.attack > 0 ? `${bow ? "bow_" : ""}atk_${K_DIR[o.dir] ?? "down"}` : o.moving ? `walk_${K_DIR[o.dir] ?? "down"}` : `idle_${K_DIR[o.dir] ?? "down"}`;
  const wsheet = kae && o.weapon ? weaponSheet(o.weapon) : null;
  if (wsheet && o.dir === 3) drawK(c, wsheet, anim, f.col, x, y, false, a, sc);
  c.save();
  if (a < 1) c.globalAlpha *= a;
  c.translate(Math.round(x), Math.round(y)); c.scale(f.flip ? -sc : sc, sc); c.translate(-f.ou, -f.ov);
  if (box) drawAccessory(c, "back", box, view, f.faceRight, cu!.hat, cu!.cape, sway);
  c.drawImage(src, f.col * f.fw, f.row * f.fh, f.fw, f.fh, 0, 0, f.fw, f.fh);
  if (box) { drawAccessory(c, "front", box, view, f.faceRight, cu!.hat, cu!.cape, sway); drawAccessory(c, "hat", box, view, f.faceRight, cu!.hat, cu!.cape, sway); }
  c.restore();
  if (wsheet && o.dir !== 3) drawK(c, wsheet, anim, f.col, x, y, o.dir === 1, a, sc);
  return true;
}

/** Herói em pixels com chapéu e capa gerados por IA encaixados na cabeça desenhada por drawChar. */
export function drawHeroClassic(c: CanvasRenderingContext2D, x: number, y: number, pal: Palette, dir: number, frame: number, weapon: { kind: WeaponKind; color: string } | null, attack: number, ex: CharExtras, time: number) {
  preloadAccessories();
  const step = frame % 4 === 1 ? 1 : frame % 4 === 3 ? -1 : 0;
  const top = Math.round(y - 18) + 1 + (step ? 0 : 0);
  const box: FrameBox = { top, bottom: Math.round(y) - 1, cx: Math.round(x), headW: 10, headH: 8, empty: false };
  const view = viewOf(dir), faceRight = dir !== 1, sway = Math.sin(time * 4 + frame);
  const hat = ex.hat ?? 0, cape = ex.cape;
  drawAccessory(c, "back", box, view, faceRight, hat, cape, sway);
  drawChar(c, x, y, pal, dir, frame, weapon, attack, { ...ex, hat: 0, hatColor: "", cape: undefined });
  drawAccessory(c, "front", box, view, faceRight, hat, cape, sway);
  drawAccessory(c, "hat", box, view, faceRight, hat, cape, sway);
}
