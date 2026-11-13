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

# --- block models drawn from their elements, the way the game draws them in an inventory slot ---------
# Each element is a box (from/to in 1/16 block) whose faces map a uv rectangle of a texture. The item is
# posed by the model's display.gui transform (rotation in degrees, XYZ order; translation in 1/16; scale)
# and seen from +z with an orthographic camera: 1 block = S px. Faces turned away are skipped, the rest
# painted far to near, with Minecraft's per-direction shading.

import math

SHADE = {'up': 1.0, 'down': .5, 'north': .8, 'south': .8, 'east': .6, 'west': .6}

def chain_models(name):
    """The model and its ancestors, nearest first."""
    out = []
    while name:
        name = name.replace('minecraft:', '')
        m = load(C + 'models/' + name + '.json')
        if not m: break
        out.append(m)
        name = m.get('parent')
    return out

def first(models, key):
    return next((m[key] for m in models if key in m), None)

def rot(axis, deg, p):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a); x, y, z = p
    if axis == 'x': return (x, y * c - z * s, y * s + z * c)
    if axis == 'y': return (x * c + z * s, y, -x * s + z * c)
    return (x * c - y * s, x * s + y * c, z)

def face_corners(d, f, t):
    """Points at the texture's top-left, top-right and bottom-left for a face, per Minecraft's uv layout."""
    (x0, y0, z0), (x1, y1, z1) = f, t
    return {
        'up':    ((x0, y1, z0), (x1, y1, z0), (x0, y1, z1)),
        'down':  ((x0, y0, z1), (x1, y0, z1), (x0, y0, z0)),
        'north': ((x1, y1, z0), (x0, y1, z0), (x1, y0, z0)),
        'south': ((x0, y1, z1), (x1, y1, z1), (x0, y0, z1)),
        'west':  ((x0, y1, z0), (x0, y1, z1), (x0, y0, z0)),
        'east':  ((x1, y1, z1), (x1, y1, z0), (x1, y0, z1)),
    }[d]

def auto_uv(d, f, t):
    (x0, y0, z0), (x1, y1, z1) = f, t
    return {'up': (x0, z0, x1, z1), 'down': (x0, 16 - z1, x1, 16 - z0), 'north': (16 - x1, 16 - y1, 16 - x0, 16 - y0),
            'south': (x0, 16 - y1, x1, 16 - y0), 'west': (z0, 16 - y1, z1, 16 - y0), 'east': (16 - z1, 16 - y1, 16 - z0, 16 - y0)}[d]

NORMAL = {'up': (0, 1, 0), 'down': (0, -1, 0), 'north': (0, 0, -1), 'south': (0, 0, 1), 'west': (-1, 0, 0), 'east': (1, 0, 0)}

def render_models(parts):
    """parts: [(model name, tints, translation in blocks)]. Returns an S×S image, or None without elements."""
    first_chain = chain_models(parts[0][0])
    gui = next((m['display']['gui'] for m in first_chain if 'gui' in m.get('display', {})), {'rotation': [30, 225, 0], 'translation': [0, 0, 0], 'scale': [.625] * 3})
    rx, ry, rz = gui.get('rotation', [0, 0, 0]); tr = gui.get('translation', [0, 0, 0]); sc = gui.get('scale', [1, 1, 1])

    def pose(p):  # p in 1/16 block → (screen x, screen y, depth)
        v = tuple((p[i] / 16 - .5) * sc[i] for i in range(3))
        v = rot('x', rx, rot('y', ry, rot('z', rz, v)))
        v = tuple(v[i] + tr[i] / 16 for i in range(3))
        return (S / 2 + v[0] * S, S / 2 - v[1] * S, v[2])

    def turn(n):
        return rot('x', rx, rot('y', ry, rot('z', rz, n)))

    faces = []
    for model, tints, move in parts:
        models = chain_models(model)
        elements = first(models, 'elements')
        if not elements: continue
        tex, _ = resolve(model)
        off = tuple(m * 16 for m in move)
        for el in elements:
            f, t = el['from'], el['to']
            r = el.get('rotation')
            def place(p, r=r, off=off):
                if r and r.get('angle'):
                    o = r['origin']; q = tuple(p[i] - o[i] for i in range(3))
                    q = rot(r['axis'], r['angle'], q)
                    p = tuple(q[i] + o[i] for i in range(3))
                return tuple(p[i] + off[i] for i in range(3))
            for d, fc in el.get('faces', {}).items():
                n = NORMAL[d]
                if r and r.get('angle'): n = rot(r['axis'], r['angle'], n)
                if turn(n)[2] <= 1e-6: continue  # facing away from the camera
                ref = fc.get('texture', '')
                img = tex_img(tex.get(ref[1:]) if ref.startswith('#') else ref)
                if img is None: continue
                if 'tintindex' in fc and tints and (rgb := tint_rgb(tints[min(fc['tintindex'], len(tints) - 1)])): img = tint(img, rgb)
                u0, v0, u1, v1 = fc.get('uv') or auto_uv(d, f, t)
                k = img.width / 16
                crop = img.crop((round(min(u0, u1) * k), round(min(v0, v1) * k), round(max(u0, u1) * k) or 1, round(max(v0, v1) * k) or 1))
                if crop.width == 0 or crop.height == 0: continue
                if u0 > u1: crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
                if v0 > v1: crop = crop.transpose(Image.FLIP_TOP_BOTTOM)
                if fc.get('rotation'): crop = crop.rotate(-fc['rotation'], expand=True)
                crop = ImageEnhance.Brightness(crop).enhance(SHADE[d])
                tl, trc, bl = (pose(place(p)) for p in face_corners(d, f, t))
                depth = (tl[2] + trc[2] + bl[2]) / 3
                faces.append((depth, crop, tl, trc, bl))
    if not faces: return None
    out = Image.new('RGBA', (S, S))
    for depth, crop, tl, trc, bl in sorted(faces, key=lambda x: x[0]):
        w, h = crop.size
        U = ((trc[0] - tl[0]) / w, (trc[1] - tl[1]) / w)
        V = ((bl[0] - tl[0]) / h, (bl[1] - tl[1]) / h)
        det = U[0] * V[1] - V[0] * U[1]
        if abs(det) < 1e-9: continue
        ia, ib, ic, id_ = V[1] / det, -V[0] / det, -U[1] / det, U[0] / det
        data = (ia, ib, -(ia * tl[0] + ib * tl[1]), ic, id_, -(ic * tl[0] + id_ * tl[1]))
        out.alpha_composite(crop.transform((S, S), Image.AFFINE, data, Image.NEAREST))
    return out

def model_parts(node, move=(0, 0, 0)):
    """[(model, tints, translation)] for an item model; composites (beds) give several."""
    if isinstance(node, dict):
        ty = node.get('type', '').replace('minecraft:', '')
        if ty == 'composite':
            out = []
            for sub in node.get('models', []):
                m = sub.get('transformation', {}).get('translation', [0, 0, 0]) if isinstance(sub, dict) else [0, 0, 0]
                out += model_parts(sub, tuple(move[i] + m[i] for i in range(3)))
            return out
        if ty == 'model' and 'model' in node:
            return [(node['model'], node.get('tints', []), move)]
    fm = find_model(node)
    return [(fm[0], fm[1], move)] if fm else []

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
    if first(chain_models(model), 'elements'):
        im = render_models(model_parts(it['model']))
        if im is not None: return im
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
for root, dirs, files in os.walk(img_dir):
    dirs.sort()
    for f in sorted(files):
        if not f.endswith('.png'): continue
        path = os.path.join(root, f)
        key = os.path.relpath(path, img_dir).replace(os.sep, '/')[:-4]
        extra['img:' + key] = Image.open(path).convert('RGBA')
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
