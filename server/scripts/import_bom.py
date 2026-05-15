# -*- coding: utf-8 -*-
"""
Re-import BOM:
- product_category 含 'Delivery' = 外卖 channel,其他 = 堂食
- 单品 BOM:同 product_name 的堂食+外卖行合并去重(同 material 取 max qty)
- 物料 channel 推断:
    raw 食材 → NULL
    包材/酱料:
      只在外卖出现 → takeout
      只在堂食出现 → dinein
      两者都出现 → NULL (通用)
"""
import csv, sqlite3, re
from collections import OrderedDict, defaultdict

DB = '/Users/victor/Desktop/codeslef/fastfood-bom/server/data.sqlite'
BOM_CSV = '/Users/victor/Downloads/bom_export_20260512220019.csv'
COMBO_CSV = '/Users/victor/Downloads/export_package_20260513194341.csv'

SAUCE_KW = re.compile(r'酱|sauce|ซอส|น้ำจิ้ม|ketchup|mayo|mustard|ครีมสลัด|果酱', re.I)
SAUCE_EXCLUDE = re.compile(r'酱料盒|酱瓶|挂酱|挤酱|ขวดซอส|sauce bottle|sauce cup|sauce box', re.I)
PKG_KW = re.compile(
    r'袋|盒|杯|盖|纸|托盘|餐盒|餐袋|手提袋|打包|外卖盒|外卖袋|塑料盒|塑料盖|包装|垃圾袋|薯盒|碗|碟|筷|勺|叉|匙|吸管|封口膜'
    r'|cup|bag|box|wrap|container|lid|tray|straw|paper|film'
    r'|ฝา|ถุง|กล่อง|ถาด|ถ้วย|ห่อ|ฟิลม์ซีล',
    re.I
)

def classify_category(name):
    if SAUCE_KW.search(name) and not SAUCE_EXCLUDE.search(name):
        return 'sauce'
    if PKG_KW.search(name):
        return 'packaging'
    return 'raw'

def is_delivery(category_en, category_zh):
    return 'delivery' in (category_en or '').lower() or 'delivery' in (category_zh or '').lower()

# ---- 解析 bom_export ----
def parse_bom():
    """
    Return:
      products: OrderedDict pname_zh -> {
          name_en, lines: { material_code -> {qty(max), name, uom} }
      }
      mat_channels: dict code -> set('takeout'/'dinein')  (该物料在哪些 channel 行出现过)
      mat_meta: dict code -> {name_zh, name_en, uom}
    """
    products = OrderedDict()
    mat_channels = defaultdict(set)
    mat_meta = {}
    with open(BOM_CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            pname = r['product_name_zh'].strip()
            mcode = r['material_code'].strip()
            mname = r['material_name_zh'].strip()
            uom = r['material_unit_name_en'].strip()
            qty = float(r['material_qty']) if r['material_qty'] else 0
            servings = int(r['processing_servings']) if r['processing_servings'] else 1
            qty_per_serving = qty / servings if servings else qty
            if not pname or not mcode:
                continue
            chan = 'takeout' if is_delivery(r['product_category_name_en'], r['product_category_name_zh']) else 'dinein'
            mat_channels[mcode].add(chan)
            mat_meta[mcode] = {'name_zh': mname, 'name_en': r['material_name_en'].strip(), 'uom': uom}
            p = products.setdefault(pname, {'name_en': r['product_name_en'].strip(), 'lines': OrderedDict()})
            existing = p['lines'].get(mcode)
            if existing:
                existing['qty'] = max(existing['qty'], qty_per_serving)
            else:
                p['lines'][mcode] = {'qty': qty_per_serving, 'name': mname, 'uom': uom}
    return products, mat_channels, mat_meta

# ---- 解析套餐 ----
def parse_combos():
    combos = OrderedDict()
    with open(COMBO_CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            cname = r['combo_name_zh'].strip()
            uuid = r['combo_uuid'].strip()
            if not cname: continue
            if uuid not in combos:
                combos[uuid] = {
                    'name_zh': cname, 'name_en': r['combo_name_en'].strip(),
                    'groups': OrderedDict(),
                }
            gkey = (r['group_name_zh'].strip(), r['group_sort'])
            g = combos[uuid]['groups'].setdefault(gkey, {
                'type': r['group_type'].strip(), 'children': [],
            })
            g['children'].append({
                'name_zh': r['child_product_name_zh'].strip(),
                'name_en': r['child_product_name_en'].strip(),
                'num': int(r['num']) if r['num'] else 1,
                'is_default': r['is_default'] == '1',
            })
    return combos

def main():
    products, mat_channels, mat_meta = parse_bom()
    combos = parse_combos()
    print(f'Products: {len(products)}, Materials: {len(mat_meta)}, Combos: {len(combos)}')

    db = sqlite3.connect(DB)
    db.execute('PRAGMA foreign_keys = ON')
    cur = db.cursor()

    # ---- 1. Upsert materials with category + channel ----
    print('\n=== Upsert materials ===')
    cat_count = {'raw': 0, 'packaging': 0, 'sauce': 0}
    chan_count = {'takeout': 0, 'dinein': 0, 'null': 0}
    for code, m in mat_meta.items():
        cat = classify_category(m['name_zh'])
        cat_count[cat] += 1
        # 仅 packaging/sauce 才需 channel
        if cat == 'raw':
            chan = None
        else:
            chans = mat_channels[code]
            if 'takeout' in chans and 'dinein' in chans:
                chan = None
            elif 'takeout' in chans:
                chan = 'takeout'
            elif 'dinein' in chans:
                chan = 'dinein'
            else:
                chan = None
        chan_count[chan or 'null'] += 1
        existing = cur.execute('SELECT 1 FROM materials WHERE item_code = ?', (code,)).fetchone()
        if existing:
            cur.execute("""
                UPDATE materials SET item_name = ?, uom = ?, category = ?, channel = ?, updated_at = datetime('now')
                WHERE item_code = ?
            """, (m['name_zh'], m['uom'] or None, cat, chan, code))
        else:
            cur.execute("""
                INSERT INTO materials(item_code, item_name, uom, category, channel, source, updated_at)
                VALUES (?, ?, ?, ?, ?, 'manual', datetime('now'))
            """, (code, m['name_zh'], m['uom'] or None, cat, chan))
    print(f'  category: {cat_count}')
    print(f'  channel: {chan_count}')

    # ---- 2. Clear products + combos ----
    n_p = cur.execute('SELECT COUNT(*) FROM products').fetchone()[0]
    n_c = cur.execute('SELECT COUNT(*) FROM combos').fetchone()[0]
    # 先删 combos (CASCADE 删 combo_lines + combo_line_substitutes,
    # 这些表的 product_id FK 才不再阻塞 products 的删除)
    cur.execute('DELETE FROM combos')
    cur.execute('DELETE FROM products')
    print(f'\n=== Cleared {n_p} products, {n_c} combos (CASCADE clears lines) ===')

    # ---- 3. Create products (去重后) ----
    code_seq = 1
    name_to_pid = {}
    for pname, pinfo in products.items():
        code = f'P-{code_seq:04d}'
        code_seq += 1
        cur.execute('INSERT INTO products(code, name, description) VALUES (?, ?, ?)',
                    (code, pname, pinfo.get('name_en') or None))
        pid = cur.lastrowid
        name_to_pid[pname] = pid
        for mcode, ln in pinfo['lines'].items():
            cur.execute('INSERT INTO product_lines(product_id, material_code, qty) VALUES (?, ?, ?)',
                        (pid, mcode, ln['qty']))
    print(f'=== Created {len(products)} products ===')

    # ---- 4. Placeholder products ----
    missing_children = set()
    for c in combos.values():
        for g in c['groups'].values():
            for ch in g['children']:
                if ch['name_zh'] not in name_to_pid:
                    missing_children.add((ch['name_zh'], ch['name_en']))
    placeholders_created = 0
    for nm_zh, nm_en in sorted(missing_children):
        if nm_zh in name_to_pid: continue
        code = f'P-{code_seq:04d}'
        code_seq += 1
        cur.execute('INSERT INTO products(code, name, description) VALUES (?, ?, ?)',
                    (code, nm_zh, f'(占位 - 无 BOM 配方) {nm_en}'))
        name_to_pid[nm_zh] = cur.lastrowid
        placeholders_created += 1
    print(f'=== {placeholders_created} placeholder products ===')

    # ---- 5. Create combos ----
    code_seq_c = 1
    for c in combos.values():
        ccode = f'C-{code_seq_c:04d}'
        code_seq_c += 1
        cur.execute('INSERT INTO combos(code, name, description) VALUES (?, ?, ?)',
                    (ccode, c['name_zh'], c.get('name_en') or None))
        combo_id = cur.lastrowid
        for g in c['groups'].values():
            children = g['children']
            if not children: continue
            if g['type'] == 'fixed':
                for ch in children:
                    pid = name_to_pid.get(ch['name_zh'])
                    if pid is None: continue
                    cur.execute('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)',
                                (combo_id, pid, ch['num']))
            else:
                defaults = [c2 for c2 in children if c2['is_default']]
                main = defaults[0] if defaults else children[0]
                rest = [c2 for c2 in children if c2 is not main]
                pid = name_to_pid.get(main['name_zh'])
                if pid is None: continue
                cur.execute('INSERT INTO combo_lines(combo_id, product_id, qty) VALUES (?, ?, ?)',
                            (combo_id, pid, main['num']))
                line_id = cur.lastrowid
                for i, ch in enumerate(rest, start=1):
                    spid = name_to_pid.get(ch['name_zh'])
                    if spid is None: continue
                    cur.execute('INSERT INTO combo_line_substitutes(parent_line_id, product_id, qty, priority) VALUES (?, ?, ?, ?)',
                                (line_id, spid, ch['num'], i))
    print(f'=== Created {len(combos)} combos ===')

    db.commit()
    db.close()

    print(f'\n=== Final ===')
    print(f'  products: {len(name_to_pid)} (config: {len(products)} + placeholder: {placeholders_created})')
    print(f'  combos: {len(combos)}')
    if missing_children:
        print(f'\n⚠️  套餐里引用但无 BOM 配方的 ({len(missing_children)} 个):')
        for nm_zh, nm_en in sorted(missing_children):
            print(f'  - {nm_zh}  ({nm_en})')

if __name__ == '__main__':
    main()
