import json, glob, os, sys, re
S = sys.argv[1]
B = S + '/jar/data/yet-another-minecraft-bingo/yet-another-minecraft-bingo/'
L = lambda p: json.load(open(p, encoding='utf-8'))
mc = L(S + '/server/mc/assets/minecraft/lang/en_us.json')
zmc = L(sys.argv[3])
ben, bzh = {}, {}
for d in ['assets', 'data']:
    ben.update(L(f'{S}/jar/{d}/yet-another-minecraft-bingo/lang/en_us.json'))
    p = f'{S}/jar/{d}/yet-another-minecraft-bingo/lang/zh_cn.json'
    if os.path.exists(p): bzh.update(L(p))

def item_name(i, mc=mc):
    if i.startswith('#'):
        if mc is zmc: return '任意唱片' if i.endswith('music_discs') else None
        n = i.split(':')[-1].replace('_', ' ').title()
        return 'Any ' + n.rstrip('s')
    ns, p = i.split(':')
    for k in (f'item.{ns}.{p}', f'block.{ns}.{p}'):
        if k in mc:
            extra = mc.get(k + '.desc') or mc.get(k + '.new')
            return f'{mc[k]} ({extra})' if extra and ('disc' in p or 'template' in p or 'sherd' in p or 'pattern' in p) else mc[k]
    return None if mc is zmc else p.replace('_', ' ').title()

def ent(sn, lang): return lang.get('entity.minecraft.' + sn.split(':')[1], sn)

def rng(v):
    if isinstance(v, dict):
        if 'min' in v: return f"{v['min']}–{v['max']}"
        v = v.get('values', v)
    if isinstance(v, list): return '/'.join(map(str, v))
    return str(v)

def fill(s, mn):
    return s.replace('%min%', mn).replace('%s', mn) if mn else s

def objective(oid):
    ns, path = oid.split(':')
    p = B + 'objectives/' + path + '.json'
    return L(p) if os.path.exists(p) else None

def challenge(oid):
    o = objective(oid) or {}
    t = o.get('type')
    disp = o.get('display', {})
    mn = rng(o['min']) if 'min' in o else (rng(o['count']) if 'count' in o else None)
    nm = disp.get('name')
    key = 'bingo.objective.' + oid.split(':')[1].replace('/', '.')
    en = zh = None
    if nm:
        en = fill(ben.get(nm.get('translate'), nm.get('fallback', '')), mn)
        zh = bzh.get(nm.get('translate'))
        zh = fill(zh, mn) if zh else None
    elif key in ben:
        en = fill(ben[key], mn); zh = fill(bzh[key], mn) if key in bzh else None
    if not en:
        if t == 'item':
            en = f"Collect {mn} {item_name(o['item'])}"
            zh = f"收集 {mn} 个{item_name(o['item'], zmc)}"
        elif t == 'inverse':
            en = 'Never get ' + item_name(o['objective'])
            zh = bzh['bingo.objective.inverse'].replace('%s', item_name(o['objective'], zmc))
        elif t == 'stats':
            st, sn = o['statType'].split(':')[1], o['statName']
            if st == 'killed': en, zh = 'Kill ' + ent(sn, mc), '杀死' + ent(sn, zmc)
            elif st == 'killed_by': en, zh = 'Killed by ' + ent(sn, mc), '被' + ent(sn, zmc) + '杀死'
            elif st == 'broken': en, zh = 'Break a ' + item_name(sn), '用坏' + item_name(sn, zmc)
            else:
                k = 'stat.minecraft.' + sn.split(':')[1]
                en, zh = mc.get(k, sn), zmc.get(k)
                if mn: en += f' ×{mn}'; zh = zh and zh + f' ×{mn}'
        else:
            en = path_title(oid)
    kind = {'item': 'collect', 'inverse': 'never', 'stats': 'stat', 'all_of': 'all', 'one_of': 'any'}.get(t, t or '?')
    return en, zh, kind

# advancements the mod lists that have no vanilla translation
CUSTOM_ZH = {
    'husbandry/bred_all_animals': '繁殖所有动物',
    'husbandry/obtain_netherite_hoe': '获得下界合金锄',
    'husbandry/break_diamond_hoe': '用坏钻石锄',
    'adventure/read_power_of_chiseled_bookshelf': '读取雕纹书架的能量',
}

ADV_ICON = {
    'husbandry/bred_all_animals': 'minecraft:wheat',
    'husbandry/obtain_netherite_hoe': 'minecraft:netherite_hoe',
    'husbandry/break_diamond_hoe': 'minecraft:diamond_hoe',
    'adventure/read_power_of_chiseled_bookshelf': 'minecraft:chiseled_bookshelf',
    'nether/use_lodestone': 'minecraft:lodestone',
}

def expand_tag(tag, seen=None):
    seen = seen or set()
    if tag in seen: return []
    seen.add(tag)
    ns, p = tag[1:].split(':')
    f = f'{S}/server/mc/data/{ns}/tags/item/{p}.json'
    if not os.path.exists(f):
        # 26.3 dropped minecraft:music_discs; c:music_discs comes from Fabric API, which isn't in these jars
        if p == 'music_discs':
            return sorted('minecraft:' + k[:-5] for k in os.listdir(f'{S}/client/assets/minecraft/items') if k.startswith('music_disc_'))
        return []
    out = []
    for v in L(f)['values']:
        v = v['id'] if isinstance(v, dict) else v
        out += expand_tag(v, seen) if v.startswith('#') else [v]
    return out

def icon_spec(oid):
    """How the mod's HUD draws this goal: (style, item ids, custom image, forbidden)."""
    o = objective(oid) if ':' in oid and not oid.startswith(('#', 'minecraft:')) else None
    if not o: return None, [], None, False
    img = o.get('display', {}).get('image')
    # Draftout supplies composed pictures even for all_of/one_of goals.
    if img: return None, [], img.split(':')[1], o.get('type') == 'inverse'
    if o.get('type') in ('all_of', 'one_of'):
        subs = []
        for x in o['objectives']:
            if isinstance(x, dict): subs.append(x.get('item'))
            elif x.startswith('#'): subs += expand_tag(x)
            else: subs.append(icon_of(x))
        subs = [x for x in subs if x]
        if len(subs) > 1:
            return ('one' if o['type'] == 'one_of' else 'all'), subs[:3 if o['type'] == 'one_of' else 4], None, False
    return None, [], img and img.split(':')[1], o.get('type') == 'inverse'

def icon_of(oid, depth=0):
    """Item id to draw for a goal or objective reference."""
    if depth > 4: return None
    if oid.startswith('#'): return 'minecraft:music_disc_cat' if oid.endswith('music_discs') else None
    if oid.startswith('minecraft:'): return oid
    o = objective(oid)
    if not o: return None
    d = o.get('display', {})
    if d.get('item'): return d['item']
    if o.get('item'): return o['item']
    if o.get('objective'): return icon_of(o['objective'], depth + 1)
    if o.get('statType'):
        st, sn = o['statType'].split(':')[1], o['statName']
        return sn.replace(':', ':', 1) + '_spawn_egg' if st in ('killed', 'killed_by') else sn
    for x in o.get('objectives', []):
        if (r := icon_of(x, depth + 1)): return r
    return None

def path_title(i): return i.split('/')[-1].replace('_', ' ').title()

out = []
# simplified mode swaps single items for 'any X' groups; its plain items are already in items.tierlist
for cat, f in [('item', 'items'), ('advancement', 'advancements'), ('challenge', 'challenge'), ('item', 'simplified'), ('challenge', 'draftout')]:
    if not os.path.exists(B + f'tierlists/{f}.tierlist.json'): continue
    d = L(B + f'tierlists/{f}.tierlist.json')
    gid = {}
    for n, g in enumerate(d.get('groups', [])):
        for i in g: gid[i] = n
    for t in 'SABCD':
        for i in d[t]:
            if f == 'simplified' and (i.startswith('minecraft:') or any(x['id'] == i for x in out)): continue
            if f == 'simplified' and any(x['c'] == 'item' and x['t'] == t and x['n'] == ben.get(f'bingo.objective.{i.split(":")[1].replace("/", ".")}') for x in out): continue
            e = {'c': cat, 't': t, 'id': i}
            if f == 'draftout':
                e['draft'] = 1
                # Collection objectives still appear under the guide's item filter.
                if (objective(i) or {}).get('type') == 'item': e['c'] = 'item'
            if f == 'simplified': e['sm'] = 1
            if cat == 'item':
                if i.startswith('yet-another-minecraft-bingo:'):
                    o = objective(i); k = o['display']['name']['translate']
                    e['n'] = ben.get(k, o['display']['name']['fallback']); e['z'] = bzh.get(k)
                else:
                    e['n'] = item_name(i); e['z'] = item_name(i, zmc)
            elif cat == 'advancement':
                ns, p = i.split(':'); k = 'advancements.' + p.replace('/', '.')
                e['n'] = mc.get(k + '.title', path_title(i)); e['d'] = mc.get(k + '.description')
                e['z'] = zmc.get(k + '.title'); e['zd'] = zmc.get(k + '.description')
                e['z'] = e['z'] or CUSTOM_ZH.get(p)
                adv = L(f'{S}/server/mc/data/minecraft/advancement/{p}.json') if os.path.exists(f'{S}/server/mc/data/minecraft/advancement/{p}.json') else {}
                e['i'] = adv.get('display', {}).get('icon', {}).get('id') or ADV_ICON.get(p)
                e['k'] = p.split('/')[0]
            else:
                e['n'], e['z'], e['k'] = challenge(i)
            if cat != 'advancement':
                e['i'] = icon_of(i)
                st, subs, img, forbid = icon_spec(i)
                if i.startswith('#') and len(subs := expand_tag(i)) > 1: st, subs = 'one', subs[:3]
                if st: e['s'], e['ii'] = st, subs
                if img: e['img'] = img
                if forbid: e['x'] = 1
            if i in gid:
                e['g'] = f'{f[0]}{gid[i]}'
            if i.startswith('#') and any(x['c'] == cat and x['n'] == e['n'] and x['t'] == t for x in out): continue
            out.append({k: v for k, v in e.items() if v is not None})
# tag every item goal that the simplified board can draw with its tier (st) and group (sg) on that board
sd = L(B + 'tierlists/simplified.tierlist.json')
sgid = {i: n for n, g in enumerate(sd.get('groups', [])) for i in g}
for t in 'SABCD':
    for i in sd[t]:
        name = ben.get(f'bingo.objective.{i.split(":")[1].replace("/", ".")}')
        e = next((x for x in out if x['c'] == 'item' and x['id'] == i), None) \
            or next((x for x in out if x['c'] == 'item' and x['t'] == t and name and x['n'] == name), None)
        if not e: print('simplified goal missing:', i); continue
        e['st'] = t
        if i in sgid: e['sg'] = f's{sgid[i]}'
print('simplified goals:', sum('st' in e for e in out))
json.dump(sorted({e['i'] for e in out if e.get('i')} | {x for e in out for x in e.get('ii', [])}), open(sys.argv[2] + '.ids', 'w'))
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print(len(out), Counter((e['c'], e['t']) for e in out))
for e in out:
    if e['c'] != 'item': print(e)
