"""Pack generated keyed sprite sheets into compact, transparent game atlases.
Usage: python3 scripts/prepare-biome-art.py /tmp/gen
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

src = Path(sys.argv[1])
out = Path('src/assets/atelier')
out.mkdir(parents=True, exist_ok=True)

def cut(im, cols, rows, col, row):
    w, h = im.size
    cell = im.crop((col*w//cols, row*h//rows, (col+1)*w//cols, (row+1)*h//rows)).convert('RGBA')
    a = np.array(cell)
    r,g,b = [a[:,:,i].astype(int) for i in range(3)]
    bg = (r-g > 65) & (b-g > 65) & (abs(r-b)<140)
    a[bg] = 0
    cell = Image.fromarray(a)
    box = cell.getbbox()
    return cell.crop(box) if box else cell

def fit(cell, w, h):
    cell.thumbnail((w,h), Image.Resampling.LANCZOS)
    a = np.array(cell)
    # Solid pixels, no magenta fringing or semi-transparent halos.
    a[:,:,3] = np.where(a[:,:,3]>150,255,0)
    fringe = (a[:,:,0].astype(int)-a[:,:,1]>70)&(a[:,:,2].astype(int)-a[:,:,1]>70)
    a[fringe] = 0
    return Image.fromarray(a)

atlas = Image.new('RGBA',(4*64,30*64))
for group in range(10):
    im = Image.open(src/f'b{group}.png')
    for row in range(3):
        for col in range(4):
            cell = fit(cut(im,4,3,col,row),60,60)
            atlas.alpha_composite(cell,(col*64+(64-cell.width)//2,(group*3+row)*64+62-cell.height))
atlas.save(out/'biomes.png',optimize=True)

im = Image.open(src/'hats.png')
atlas = Image.new('RGBA',(3*32,5*32))
for row in range(5):
    for col in range(3):
        cell = fit(cut(im,3,5,col,row),28,28)
        atlas.alpha_composite(cell,(col*32+(32-cell.width)//2,row*32+30-cell.height))
atlas.save(out/'hats.png',optimize=True)
im = Image.open(src/'capes.png')
atlas = Image.new('RGBA',(3*32,32))
for col in range(3):
    cell = fit(cut(im,3,1,col,0),28,28)
    atlas.alpha_composite(cell,(col*32+(32-cell.width)//2,30-cell.height))
atlas.save(out/'capes.png',optimize=True)
print('Packed 120 biome objects, 15 directional hats, 3 directional capes.')
