import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Lang = 'zh' | 'en' | 'th';

const LS_KEY = 'fastfood-bom-lang';

/* ---------------- 字典 ---------------- */
type Dict = Record<string, Record<Lang, string>>;
const D: Dict = {
  // nav
  'nav.materials':  { zh: '物料库',     en: 'Materials',   th: 'วัตถุดิบ' },
  'nav.products':   { zh: 'BOM 单元',   en: 'BOM Units',   th: 'หน่วย BOM' },
  'nav.combos':     { zh: 'BOM 组合',   en: 'BOM Sets',    th: 'ชุด BOM' },
  'nav.shared':     { zh: '共享物料',   en: 'Shared BOM',  th: 'BOM ร่วม' },
  'nav.orders':     { zh: '订单 BOM',   en: 'Order BOM',   th: 'BOM ออเดอร์' },
  'nav.settings':   { zh: '设置',       en: 'Settings',    th: 'ตั้งค่า' },
  // common buttons
  'btn.new':        { zh: '新建',       en: 'New',         th: 'เพิ่ม' },
  'btn.save':       { zh: '保存',       en: 'Save',        th: 'บันทึก' },
  'btn.delete':     { zh: '删除',       en: 'Delete',      th: 'ลบ' },
  'btn.cancel':     { zh: '取消',       en: 'Cancel',      th: 'ยกเลิก' },
  'btn.export':     { zh: '导出',       en: 'Export',      th: 'ส่งออก' },
  'btn.edit':       { zh: '编辑',       en: 'Edit',        th: 'แก้ไข' },
  'btn.select_all': { zh: '全选',       en: 'Select all',  th: 'เลือกทั้งหมด' },
  'btn.selected_n': { zh: '已选',       en: 'Selected',    th: 'เลือกแล้ว' },
  // shared field labels
  'lbl.name':       { zh: '名称',       en: 'Name',        th: 'ชื่อ' },
  'lbl.name_zh':    { zh: '中文名',     en: '中文 Name',   th: 'ชื่อจีน' },
  'lbl.name_en':    { zh: '英文名',     en: 'English',     th: 'ชื่ออังกฤษ' },
  'lbl.name_th':    { zh: '泰文名',     en: 'ภาษาไทย',     th: 'ชื่อไทย' },
  'lbl.code':       { zh: '编码',       en: 'Code',        th: 'รหัส' },
  'lbl.qty':        { zh: '数量',       en: 'Qty',         th: 'จำนวน' },
  'lbl.unit':       { zh: '单位',       en: 'Unit',        th: 'หน่วย' },
  'lbl.category':   { zh: '类别',       en: 'Category',    th: 'หมวดหมู่' },
  'lbl.channel':    { zh: '渠道',       en: 'Channel',     th: 'ช่อง' },
  'lbl.source':     { zh: '来源',       en: 'Source',      th: 'ที่มา' },
  'lbl.priority':   { zh: '优先级',     en: 'Priority',    th: 'ลำดับ' },
  'lbl.desc':       { zh: '描述',       en: 'Description', th: 'รายละเอียด' },
  // category
  'cat.raw':        { zh: '原材料',     en: 'Raw',         th: 'วัตถุดิบ' },
  'cat.packaging':  { zh: '包材',       en: 'Packaging',   th: 'บรรจุภัณฑ์' },
  'cat.sauce':      { zh: '酱料',       en: 'Sauce',       th: 'ซอส' },
  'cat.other':      { zh: '未分类',     en: 'Uncategorized', th: 'ไม่จัดหมวด' },
  'cat.all':        { zh: '全部',       en: 'All',         th: 'ทั้งหมด' },
  // channel
  'chan.takeout':   { zh: '外卖',       en: 'Takeout',     th: 'เดลิเวอรี' },
  'chan.dinein':    { zh: '到店',       en: 'Dine-in',     th: 'ในร้าน' },
  'chan.generic':   { zh: '通用',       en: 'Generic',     th: 'ทั่วไป' },
  // misc
  'lbl.main':       { zh: '主',         en: 'Main',        th: 'หลัก' },
  'lbl.sub':        { zh: '替换',       en: 'Sub',         th: 'แทน' },
  'lbl.shared':     { zh: '共享',       en: 'Shared',      th: 'ร่วม' },
  'lbl.placeholder_auto_code': { zh: '(保存后自动分配编码)', en: '(code auto-assigned on save)', th: '(สร้างรหัสอัตโนมัติเมื่อบันทึก)' },
  'placeholder.optional': { zh: '可选', en: 'optional', th: 'ตัวเลือก' },

  // editor labels
  'editor.zh_main':          { zh: '中文名 · 主名',        en: 'Chinese · Primary',     th: 'ชื่อจีน · หลัก' },
  'editor.bom_list':         { zh: 'BOM 物料清单',         en: 'BOM Materials',         th: 'รายการ BOM' },
  'editor.combo_items':      { zh: '套餐内单品',           en: 'Items in Set',          th: 'รายการในชุด' },
  'editor.takeout_config':   { zh: '外卖配置',             en: 'Takeout Config',        th: 'ตั้งค่าเดลิเวอรี' },
  'editor.dinein_config':    { zh: '到店配置',             en: 'Dine-in Config',        th: 'ตั้งค่าในร้าน' },
  'editor.packaging':        { zh: '包材',                 en: 'Packaging',             th: 'บรรจุภัณฑ์' },
  'editor.sauce':            { zh: '酱料',                 en: 'Sauce',                 th: 'ซอส' },
  'editor.bom_preview':      { zh: '汇总 BOM 预览',        en: 'BOM Rollup Preview',    th: 'สรุป BOM' },
  'editor.empty_bom':        { zh: '🍔 把右侧原材料拖到这里,或点击右侧物料即可添加', en: '🍔 Drag raw materials here, or click on the right panel', th: '🍔 ลากวัตถุดิบจากด้านขวามาที่นี่' },
  'editor.empty_combo':      { zh: '📦 把右侧"单品"拖到这里组成套餐 (相同单品自动 +1)', en: '📦 Drag items here to compose a set (same item auto +1)', th: '📦 ลากรายการเข้าที่นี่เพื่อประกอบชุด' },
  'editor.add_sub':          { zh: '+ 添加替换品…',        en: '+ Add substitute…',     th: '+ เพิ่มสินค้าทดแทน…' },
  'editor.add_sub_product':  { zh: '+ 添加替换单品…',      en: '+ Add substitute item…',th: '+ เพิ่มชุดทดแทน…' },
  'editor.add_packaging':    { zh: '+ 添加包材…',          en: '+ Add packaging…',      th: '+ เพิ่มบรรจุภัณฑ์…' },
  'editor.add_sauce':        { zh: '+ 添加酱料…',          en: '+ Add sauce…',          th: '+ เพิ่มซอส…' },
  'editor.row_actions':      { zh: '操作',                 en: 'Actions',               th: 'การดำเนินการ' },
  'editor.unsaved_bom':      { zh: '⚠️ 保存后才能看到汇总 BOM (按渠道 / 包材 / 酱料 自动计算)', en: '⚠️ Save first to see the rollup BOM (auto-computed by channel / packaging / sauce)', th: '⚠️ บันทึกก่อนเพื่อดูสรุป BOM' },
  'editor.no_bom_rows':      { zh: '没有 BOM 行 — 给套餐加点单品吧', en: 'No BOM rows — add items to the set', th: 'ยังไม่มีรายการ BOM — เพิ่มรายการในชุด' },
  'editor.none_option':      { zh: '— 不配置 —',           en: '— None —',              th: '— ไม่ตั้งค่า —' },
  'editor.confirm_delete_product': { zh: '删除该 BOM 单元? 已使用此单品的套餐将失效', en: 'Delete this BOM unit? Sets using it will become invalid', th: 'ลบหน่วย BOM นี้?' },
  'editor.confirm_delete_combo':   { zh: '删除该 BOM 组合?', en: 'Delete this BOM set?', th: 'ลบชุด BOM นี้?' },
  'editor.delete_row_title': { zh: '删除整行 (主+替换品)',  en: 'Delete row (main + subs)', th: 'ลบทั้งแถว' },
  'editor.remove_sub':       { zh: '移除该替换品',         en: 'Remove substitute',     th: 'นำสินค้าทดแทนออก' },
  'editor.bom_priority':     { zh: '优先级',               en: 'Priority',              th: 'ลำดับ' },
  'editor.qty_hint':         { zh: '💡 提示: 从右侧"原材料库"面板拖动物料到上面区域,系统会自动按编码合并并 +1。数量、删除可在每行直接编辑。', en: '💡 Tip: Drag materials from the right panel into the area above. Same code auto-merges +1. Edit qty / delete inline.', th: '💡 ลากวัตถุดิบจากด้านขวามาด้านบน; รหัสเดียวกันรวมอัตโนมัติ +1' },
  // panel
  'panel.material_lib':      { zh: '原材料库',             en: 'Raw Materials',         th: 'คลังวัตถุดิบ' },
  'panel.material_hint':     { zh: '拖到中间区域,或直接点击 +1', en: 'Drag to center, or click to add +1', th: 'ลากไปตรงกลาง หรือคลิกเพื่อเพิ่ม' },
  'panel.product_lib':       { zh: '单品库',               en: 'BOM Units',             th: 'คลังหน่วย BOM' },
  'panel.product_hint':      { zh: '拖到中间区域,或直接点击 +1', en: 'Drag to center, or click to add +1', th: 'ลากไปตรงกลาง หรือคลิกเพื่อเพิ่ม' },
  'panel.search':            { zh: '搜索…',                en: 'Search…',               th: 'ค้นหา…' },
  'panel.search_with_code':  { zh: '搜索 编码 / 名称',     en: 'Search code / name',    th: 'ค้นหา รหัส / ชื่อ' },
  // empty states
  'empty.select_or_new_product': { zh: '从左侧选择一个 BOM 单元,或点击「新建」开始配置', en: 'Select a BOM unit on the left, or click "New" to start', th: 'เลือกหน่วย BOM ทางซ้าย หรือคลิก "เพิ่ม"' },
  'empty.select_or_new_combo':   { zh: '选择左侧 BOM 组合,或点击「新建」开始组合', en: 'Select a BOM set on the left, or click "New" to start', th: 'เลือกชุด BOM ทางซ้าย หรือคลิก "เพิ่ม"' },
  'empty.no_products':       { zh: '还没有 BOM 单元',      en: 'No BOM units yet',      th: 'ยังไม่มีหน่วย BOM' },
  'empty.no_combos':         { zh: '还没有 BOM 组合',      en: 'No BOM sets yet',       th: 'ยังไม่มีชุด BOM' },
  'empty.click_new_to_start':{ zh: '点击"新建"开始',       en: 'Click "New" to start',  th: 'คลิก "เพิ่ม" เพื่อเริ่ม' },
  // list meta
  'meta.n_units':            { zh: '个',                   en: 'units',                 th: 'หน่วย' },
  'meta.n_rows':             { zh: '行',                   en: 'rows',                  th: 'แถว' },
  'meta.n_items':            { zh: '项',                   en: 'items',                 th: 'รายการ' },
  'meta.n_products':         { zh: '单品',                 en: 'items',                 th: 'รายการ' },
  'meta.n_count_selected':   { zh: '已选',                 en: 'Selected',              th: 'เลือกแล้ว' },
  'meta.also_selected':      { zh: '已选',                 en: 'Selected',              th: 'เลือกแล้ว' },
  // BOM 单元/组合 内部标题
  'title.bom_units':         { zh: 'BOM 单元',             en: 'BOM Units',             th: 'หน่วย BOM' },
  'title.bom_sets':          { zh: 'BOM 组合',             en: 'BOM Sets',              th: 'ชุด BOM' },
  // 品牌 / Logo
  'brand.title':             { zh: '快餐 BOM',             en: 'Fastfood BOM',          th: 'BOM ฟาสต์ฟู้ด' },
  'brand.subtitle':          { zh: '配置中心',             en: 'Config Center',         th: 'ศูนย์ตั้งค่า' },
  // 登录
  'login.subtitle':          { zh: '请输入访问验证码',     en: 'Enter your access code', th: 'กรอกรหัสเข้าใช้งาน' },
  'login.code_label':        { zh: '访问验证码 (8 位)',    en: 'Access code (8 chars)', th: 'รหัสเข้าใช้งาน (8 ตัว)' },
  'login.enter':             { zh: '进入',                 en: 'Enter',                 th: 'เข้าสู่ระบบ' },
  'login.logout':            { zh: '退出',                 en: 'Log out',               th: 'ออกจากระบบ' },

  // 物料库 Materials page
  'mat.title':               { zh: '物料库',               en: 'Materials',             th: 'คลังวัตถุดิบ' },
  'mat.subtitle':            { zh: 'BOM 的最小单元 — 原材料、包材(分外卖/到店)、酱料(分外卖/到店)。', en: 'Atomic units of BOM — raw materials, packaging (by channel), sauces (by channel).', th: 'หน่วยพื้นฐานของ BOM — วัตถุดิบ บรรจุภัณฑ์(แยกช่อง) ซอส(แยกช่อง)' },
  'mat.bulk_pick_field':     { zh: '请先选择要修改的字段', en: 'Pick a field to update first', th: 'เลือกฟิลด์ที่ต้องการแก้ก่อน' },
  'mat.bulk_updated':        { zh: '批量更新成功: 修改',   en: 'Bulk update OK:',       th: 'อัปเดตหลายรายการสำเร็จ:' },
  'mat.bulk_update_failed':  { zh: '批量更新失败',         en: 'Bulk update failed',    th: 'อัปเดตหลายรายการล้มเหลว' },
  'mat.bulk_delete_confirm': { zh: '删除选中的物料? 已被单品/套餐引用的会跳过', en: 'Delete selected? Items referenced by BOM units/sets are skipped', th: 'ลบที่เลือก? รายการที่ใช้งานในชุดจะถูกข้าม' },
  'mat.bulk_delete_msg':     { zh: '批量删除',             en: 'Bulk delete',           th: 'ลบหลายรายการ' },
  'mat.btn_classify':        { zh: '自动分类',             en: 'Auto-classify',         th: 'จัดหมวดอัตโนมัติ' },
  'mat.btn_split':           { zh: '分流渠道',             en: 'Split channel',         th: 'แยกช่อง' },
  'mat.btn_dedupe':          { zh: '去重',                 en: 'Dedupe',                th: 'รวมซ้ำ' },
  'mat.btn_sync':            { zh: '从 ERP 同步原材料',    en: 'Sync from ERP',         th: 'ซิงค์จาก ERP' },
  'mat.btn_add':             { zh: '新增物料',             en: 'Add material',          th: 'เพิ่มวัตถุดิบ' },
  'mat.confirm_delete':      { zh: '删除',                 en: 'Delete',                th: 'ลบ' },
  'mat.dropdown_unchanged_cat':  { zh: '→ 类别 (不变)',    en: '→ Category (unchanged)', th: '→ หมวด (ไม่เปลี่ยน)' },
  'mat.dropdown_unchanged_chan': { zh: '→ 渠道 (不变)',    en: '→ Channel (unchanged)', th: '→ ช่อง (ไม่เปลี่ยน)' },
  'mat.dropdown_apply':      { zh: '应用',                 en: 'Apply',                 th: 'ใช้' },
  'mat.to_raw':              { zh: '→ 原材料',             en: '→ Raw',                 th: '→ วัตถุดิบ' },
  'mat.to_packaging':        { zh: '→ 包材',               en: '→ Packaging',           th: '→ บรรจุภัณฑ์' },
  'mat.to_sauce':            { zh: '→ 酱料',               en: '→ Sauce',               th: '→ ซอส' },
  'mat.to_other':            { zh: '→ 未分类',             en: '→ Uncategorized',       th: '→ ไม่จัดหมวด' },
  'mat.to_takeout':          { zh: '→ 外卖',               en: '→ Takeout',             th: '→ เดลิเวอรี' },
  'mat.to_dinein':           { zh: '→ 到店',               en: '→ Dine-in',             th: '→ ในร้าน' },
  'mat.to_generic':          { zh: '→ 通用 (清空)',        en: '→ Generic (clear)',     th: '→ ทั่วไป (ล้าง)' },
  'mat.empty':               { zh: '暂无数据',             en: 'No data',               th: 'ไม่มีข้อมูล' },
  'mat.loading':             { zh: '加载中…',              en: 'Loading…',              th: 'กำลังโหลด…' },
  'mat.source_erp':          { zh: 'ERP',                  en: 'ERP',                   th: 'ERP' },
  'mat.source_manual':       { zh: '手动',                 en: 'Manual',                th: 'มือ' },

  // 共享 BOM page
  'shared.title':            { zh: '订单级共享 BOM',       en: 'Order-level Shared BOM', th: 'BOM ร่วมระดับออเดอร์' },
  'shared.subtitle':         { zh: '每组按单品 BOM 配置方式 (主物料 + 替换品 + 优先级)。订单匹配渠道时,组内全部物料并入汇总 BOM。', en: 'Each group is configured like a BOM unit (main + substitutes + priority). When an order matches the channel, the whole group is rolled into the BOM.', th: 'แต่ละกลุ่มตั้งค่าแบบเดียวกับหน่วย BOM' },
  'shared.enabled':          { zh: '已启用',               en: 'Enabled',               th: 'เปิดใช้งาน' },
  'shared.disabled':         { zh: '已停用',               en: 'Disabled',              th: 'ปิดใช้งาน' },
  'shared.trigger_takeout':  { zh: '订单含 ≥1 外卖套餐时触发', en: 'Triggers when order has ≥1 takeout set', th: 'ทริกเกอร์เมื่อออเดอร์มีชุดเดลิเวอรีอย่างน้อย 1' },
  'shared.trigger_dinein':   { zh: '订单含 ≥1 到店套餐时触发', en: 'Triggers when order has ≥1 dine-in set', th: 'ทริกเกอร์เมื่อออเดอร์มีชุดในร้านอย่างน้อย 1' },
  'shared.trigger_all':      { zh: '任何非空订单触发',     en: 'Triggers on any non-empty order', th: 'ทริกเกอร์ทุกออเดอร์ที่ไม่ว่าง' },
  'shared.empty':            { zh: '还没有物料,从下面"添加"开始', en: 'No materials yet, add below to start', th: 'ยังไม่มีวัตถุดิบ' },
  'shared.add_line':         { zh: '+ 添加物料行…',        en: '+ Add material…',       th: '+ เพิ่มแถววัตถุดิบ…' },
  'shared.saved_msg':        { zh: '已保存',               en: 'Saved',                 th: 'บันทึกแล้ว' },

  // 订单 BOM page
  'order.title':             { zh: '订单 BOM 计算',        en: 'Order BOM Calculator',  th: 'คำนวณ BOM ออเดอร์' },
  'order.subtitle':          { zh: '拼一个临时订单(单品 + 套餐 + 数量 + 渠道),右侧实时汇总最终物料', en: 'Build a temp order, see real-time BOM rollup on the right', th: 'สร้างออเดอร์ชั่วคราว ดูสรุป BOM ทันที' },
  'order.clear':             { zh: '清空',                 en: 'Clear',                 th: 'ล้าง' },
  'order.add_product':       { zh: '添加单品',             en: 'Add BOM unit',          th: 'เพิ่มหน่วย BOM' },
  'order.add_combo':         { zh: '添加套餐',             en: 'Add BOM set',           th: 'เพิ่มชุด BOM' },
  'order.pick_product':      { zh: '+ 选一个单品加入订单…', en: '+ Pick a BOM unit…',    th: '+ เลือกหน่วย BOM…' },
  'order.pick_combo':        { zh: '+ 选一个套餐加入订单 (默认外卖)…', en: '+ Pick a BOM set (takeout by default)…', th: '+ เลือกชุด BOM (เดลิเวอรีเริ่มต้น)…' },
  'order.items_title':       { zh: '订单项',               en: 'Order items',           th: 'รายการออเดอร์' },
  'order.items_count':       { zh: '项 · 共',              en: 'items · total',         th: 'รายการ · รวม' },
  'order.servings':          { zh: '份',                   en: 'servings',              th: 'ชุด' },
  'order.empty':             { zh: '🛒 上面下拉选单品/套餐加入订单', en: '🛒 Use dropdowns above to add items', th: '🛒 เพิ่มรายการจากด้านบน' },
  'order.kind_product':      { zh: '单品',                 en: 'Unit',                  th: 'หน่วย' },
  'order.kind_combo':        { zh: '套餐',                 en: 'Set',                   th: 'ชุด' },
  'order.deleted':           { zh: '(已删除)',             en: '(deleted)',             th: '(ถูกลบ)' },
  'order.applied_shared':    { zh: '已自动应用的共享 BOM', en: 'Auto-applied Shared BOM', th: 'BOM ร่วมที่ใช้อัตโนมัติ' },
  'order.groups_triggered':  { zh: '组触发',               en: 'groups triggered',      th: 'กลุ่มถูกทริกเกอร์' },
  'order.contains_takeout':  { zh: '· 含外卖套餐时触发',   en: '· triggers with takeout', th: '· ทริกเกอร์เมื่อมีเดลิเวอรี' },
  'order.contains_dinein':   { zh: '· 含到店套餐时触发',   en: '· triggers with dine-in', th: '· ทริกเกอร์เมื่อมีในร้าน' },
  'order.any_trigger':       { zh: '· 任何订单触发',       en: '· triggers on any order', th: '· ทริกเกอร์ทุกออเดอร์' },
  'order.lines_count':       { zh: '行',                   en: 'rows',                  th: 'แถว' },
  'order.sub_count':         { zh: '替',                   en: 'subs',                  th: 'แทน' },
  'order.bom_title':         { zh: '汇总 BOM',             en: 'Rollup BOM',            th: 'สรุป BOM' },
  'order.computing':         { zh: '计算中…',              en: 'computing…',            th: 'กำลังคำนวณ…' },
  'order.empty_left':        { zh: '订单为空,左侧添加项即可看到汇总', en: 'Empty order. Add items on the left.', th: 'ออเดอร์ว่าง เพิ่มรายการทางซ้าย' },
  'order.no_bom':            { zh: '无 BOM 数据',          en: 'No BOM data',           th: 'ไม่มีข้อมูล BOM' },

  // Settings page
  'set.title':               { zh: '设置',                 en: 'Settings',              th: 'ตั้งค่า' },
  'set.subtitle':            { zh: '配置 ERPNext 连接,从指定 Item Group 同步 Raw Material 物料到本地物料库。', en: 'Configure ERPNext: sync items from the specified Item Group into the local materials library.', th: 'ตั้งค่า ERPNext: ซิงค์ Item Group ที่ระบุเข้าคลังวัตถุดิบ' },
  'set.erp_conn':            { zh: 'ERPNext / Frappe 连接', en: 'ERPNext / Frappe Connection', th: 'การเชื่อมต่อ ERPNext / Frappe' },
  'set.url':                 { zh: 'ERP URL',              en: 'ERP URL',               th: 'ERP URL' },
  'set.api_key':             { zh: 'API Key',              en: 'API Key',               th: 'API Key' },
  'set.api_secret':          { zh: 'API Secret',           en: 'API Secret',            th: 'API Secret' },
  'set.api_secret_saved':    { zh: '已保存',               en: 'saved',                 th: 'บันทึกแล้ว' },
  'set.api_secret_placeholder_kept': { zh: '留空表示不修改', en: 'leave empty to keep unchanged', th: 'เว้นว่างเพื่อไม่เปลี่ยน' },
  'set.api_secret_placeholder_new':  { zh: '输入 API secret', en: 'Enter API secret', th: 'กรอก API secret' },
  'set.item_group':          { zh: 'Item Group',           en: 'Item Group',            th: 'Item Group' },
  'set.item_group_hint':     { zh: '只同步该 Item Group 下、未禁用的 Item。', en: 'Only synced from this Item Group, non-disabled.', th: 'ซิงค์เฉพาะ Item Group นี้' },
  'set.name_field':          { zh: '中文名称字段',         en: 'ZH name field',         th: 'ฟิลด์ชื่อจีน' },
  'set.name_field_hint':     { zh: 'ERPNext「Item Name (ZH)」对应的字段名。若该字段不存在,自动退回 item_name。', en: 'Field for Item Name (ZH). Falls back to item_name if missing.', th: 'ฟิลด์ที่ใช้สำหรับ Item Name (ZH)' },
  'set.whitelist_title':     { zh: 'Item Code 白名单',     en: 'Item Code Whitelist',   th: 'ไวต์ลิสต์ Item Code' },
  'set.whitelist_parsed':    { zh: '已解析',               en: 'parsed',                th: 'แยกแล้ว' },
  'set.whitelist_unique':    { zh: '个 unique code',       en: 'unique codes',          th: 'โค้ดไม่ซ้ำ' },
  'set.whitelist_last':      { zh: '上次保存',             en: 'last saved',            th: 'บันทึกล่าสุด' },
  'set.strict_mode':         { zh: '严格模式',             en: 'Strict mode',           th: 'โหมดเข้มงวด' },
  'set.strict_mode_hint':    { zh: '启用后,同步结束自动删除 source=erp 且不在白名单内的物料(被 BOM 引用的跳过)。留空白名单 = 退回按 Item Group 全量同步。', en: 'When enabled, after sync delete source=erp items not in whitelist (BOM-referenced are skipped). Empty whitelist = sync by Item Group fully.', th: 'ลบรายการ ERP ที่ไม่อยู่ในไวต์ลิสต์หลังซิงค์' },
  'set.sync_now':            { zh: '立即同步',             en: 'Sync now',              th: 'ซิงค์ทันที' },
  'set.syncing':             { zh: '同步中…',              en: 'syncing…',              th: 'กำลังซิงค์…' },
  'set.save_ok':             { zh: '保存成功',             en: 'Saved',                 th: 'บันทึกสำเร็จ' },
  'set.save_fail':           { zh: '保存失败',             en: 'Save failed',           th: 'บันทึกล้มเหลว' },
  'set.usage_title':         { zh: '使用流程',             en: 'How to use',            th: 'ขั้นตอนการใช้งาน' },
};

export function t(key: string, lang: Lang): string {
  const entry = D[key];
  if (!entry) return key;
  return entry[lang] || entry.zh || key;
}

/* ---------------- Context ---------------- */
const LanguageContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: 'zh',
  setLang: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = (typeof window !== 'undefined' && localStorage.getItem(LS_KEY)) as Lang | null;
    return (saved === 'zh' || saved === 'en' || saved === 'th') ? saved : 'zh';
  });
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);
  function setLang(l: Lang) { setLangState(l); }
  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  return useContext(LanguageContext);
}

/** 在组件里 const tr = useT(); tr('btn.save') */
export function useT() {
  const { lang } = useLang();
  return (key: string) => t(key, lang);
}

/** 给一个含 (name, name_en, name_th) 的对象,按当前语言返回最佳显示名 */
export function localizedName(obj: { name?: string; name_en?: string | null; name_th?: string | null } | null | undefined, lang: Lang): string {
  if (!obj) return '';
  if (lang === 'en' && obj.name_en) return obj.name_en;
  if (lang === 'th' && obj.name_th) return obj.name_th;
  return obj.name || obj.name_en || obj.name_th || '';
}

export const LANG_OPTIONS: { value: Lang; label: string; flag: string }[] = [
  { value: 'zh', label: '中文',   flag: '🇨🇳' },
  { value: 'en', label: 'EN',     flag: '🇬🇧' },
  { value: 'th', label: 'ไทย',    flag: '🇹🇭' },
];
