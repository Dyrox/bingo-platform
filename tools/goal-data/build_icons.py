# Renders inventory-style icons for item ids from an extracted client jar.
# usage: build_icons.py <client_dir> <bingo_jar_dir> <ids.json> <out icons.json> [contact_sheet.png]
import json, os, sys, base64, io
from PIL import Image, ImageEnhance

C = sys.argv[1] + '/assets/minecraft/'
BJ = sys.argv[2]
MAP_IMAGES = BJ + '/yet-another-minecraft-bingo/images/'
S = 48  # block icon size

def load(p):
    try: return json.load(open(p))
    except FileNotFoundError: return None

def find_model(node):
    if isinstance(node, dict):
        if node.get('type') in ('minecraft:model', 'model') and 'model' in node:
            return node['model'], node.get('tints', [])
        if node.get('type') in ('minecraft:special', 'special') and 'base' in node:
            return node['base'], []
        for k in ('fallback', 'on_false', 'model', 'cases', 'entries', 'models'):
            if k in node:
                r = find_model(node[k])
                if r: return r
        for v in node.values():
            r = find_model(v)
            if r: return r
    elif isinstance(node, list):
        for v in node:
            r = find_model(v)
            if r: return r
    return None

def resolve(name):
    """Walk the parent chain, returning (merged textures, set of ancestor names)."""
    tex, chain = {}, []
    while name:
        name = name.replace('minecraft:', '')
        chain.append(name)
        m = load(C + 'models/' + name + '.json')
        if not m: break
        for k, v in m.get('textures', {}).items(): tex.setdefault(k, v)
        name = m.get('parent')
    def ref(v, depth=0):
        while isinstance(v, str) and v.startswith('#') and depth < 10:
            v = tex.get(v[1:]); depth += 1
        return v
    return {k: ref(v) for k, v in tex.items()}, chain

def tex_img(ref):
    if isinstance(ref, dict): ref = ref.get('sprite')
    if not isinstance(ref, str): return None
    p = C + 'textures/' + ref.replace('minecraft:', '') + '.png'
    if not os.path.exists(p): return None
    im = Image.open(p).convert('RGBA')
    w = im.width
    return im.crop((0, 0, w, w)) if im.height > w else im  # animated strips: first frame

def tint(im, rgb):
    r, g, b, a = im.split()
    f = lambda ch, c: ch.point(lambda x: x * c // 255)
    return Image.merge('RGBA', (f(r, rgb[0]), f(g, rgb[1]), f(b, rgb[2]), a))

def tint_rgb(t):
    ty = t.get('type', '').replace('minecraft:', '')
    if ty == 'grass': return (0x91, 0xBD, 0x59)
    if ty == 'foliage': return (0x77, 0xAB, 0x2F)
    v = t.get('value', t.get('default'))
    if isinstance(v, int):
        v &= 0xFFFFFF; return (v >> 16 & 255, v >> 8 & 255, v & 255)
    if isinstance(v, list): return tuple(int(x * 255) for x in v[:3])
    return None

def face(img, O, U, V):
    img = img.resize((16, 16), Image.NEAREST)
    a, b, c, d = U[0], V[0], U[1], V[1]
    det = a * d - b * c
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    # src = M^-1 (dst - O)
    data = (ia, ib, -(ia * O[0] + ib * O[1]), ic, id_, -(ic * O[0] + id_ * O[1]))
    return img.transform((S, S), Image.AFFINE, data, Image.NEAREST)

def cube(top, left, right):
    out = Image.new('RGBA', (S, S))
    u = S / 2 / 16; q = S / 4 / 16
    shade = lambda im, k: ImageEnhance.Brightness(im).enhance(k)
    out.alpha_composite(face(shade(left, .8), (0, S / 4), (u, q), (0, u)))
    out.alpha_composite(face(shade(right, .62), (S / 2, S / 2), (u, -q), (0, u)))
    out.alpha_composite(face(top, (0, S / 4), (u, -q), (u, q)))
    return out

FLAT_PARENTS = ('item/generated', 'item/handheld', 'builtin/generated', 'item/handheld_rod', 'item/handheld_mace')
# ids the mod still lists that 26.3 renamed
ALIAS = {'chain': 'iron_chain', 'scute': 'turtle_scute'}

def icon(iid):
    p = iid.replace('minecraft:', '')
    p = ALIAS.get(p, p)
    it = load(C + 'items/' + p + '.json')
    if not it: return None
    # chests, beds, heads, shields, banners… are drawn by code in-game; use the mod's own pre-rendered image
    if 'minecraft:special' in json.dumps(it) and os.path.exists(MAP_IMAGES + p + '.png'):
        return Image.open(MAP_IMAGES + p + '.png').convert('RGBA')
    fm = find_model(it['model'])
    if not fm: return None
    model, tints = fm
    tex, chain = resolve(model)
    if any(c in FLAT_PARENTS for c in chain) or ('layer0' in tex and not chain[-1].startswith('block')):
        out = None
        for n in range(5):
            im = tex_img(tex.get(f'layer{n}'))
            if im is None: break
            if n < len(tints) and (rgb := tint_rgb(tints[n])): im = tint(im, rgb)
            im = im.resize((16, 16), Image.NEAREST)
            out = im if out is None else Image.alpha_composite(out, im)
        return out
    if any('cross' in c for c in chain):
        im = tex_img(tex.get('cross') or tex.get('plant') or tex.get('particle'))
        return im and im.resize((16, 16), Image.NEAREST)
    pick = lambda *ks: next((im for k in ks if (im := tex_img(tex.get(k))) is not None), None)
    top = pick('top', 'end', 'up', 'all', 'texture', 'pattern', 'particle')
    side = pick('side', 'all', 'north', 'east', 'texture', 'pattern', 'particle')
    front = pick('front', 'south', 'side', 'all', 'texture', 'pattern', 'particle')
    if top is None or side is None: return None
    rgb = tints and tint_rgb(tints[0])
    if rgb:
        top = tint(top, rgb)
        if p != 'grass_block': side = tint(side, rgb); front = tint(front, rgb)
    return cube(top, front, side)

def uri(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

ids = json.load(open(sys.argv[3]))
out, miss = {}, []
for i in ids:
    try: im = icon(i)
    except Exception as e: im = None; print('ERR', i, e)
    if im is None: miss.append(i)
    else: out[i] = im
extra = {}
img_dir = BJ + '/data/yet-another-minecraft-bingo/yet-another-minecraft-bingo/images/'
for f in sorted(os.listdir(img_dir)):
    extra['img:' + f[:-4]] = Image.open(img_dir + f).convert('RGBA')
extra['deco:forbidden'] = Image.open(BJ + '/assets/minecraft/textures/gui/sprites/bingo/image_frame_forbidden.png').convert('RGBA')
json.dump({k: uri(v) for k, v in {**out, **extra}.items()}, open(sys.argv[4], 'w'), separators=(',', ':'))
print(len(out), 'icons; missing', len(miss), miss)
if len(sys.argv) > 5:
    keys = sorted(out); cols = 40
    sheet = Image.new('RGBA', (cols * 52, (len(keys) // cols + 1) * 52), (200, 200, 200, 255))
    for n, k in enumerate(keys):
        im = out[k].resize((48, 48), Image.NEAREST)
        sheet.alpha_composite(im, (n % cols * 52 + 2, n // cols * 52 + 2))
    sheet.save(sys.argv[5])
