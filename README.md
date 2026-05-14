# 快餐 BOM 配置中心

可视化配置快餐场景的 BOM 编排:**最小单元的单品** → **套餐拖拽组合** → **外卖/到店包材二选一 + 酱料二选一** → 自动汇总最终物料清单。

## 架构

```
fastfood-bom/
├── server/   Node + Express + better-sqlite3   (端口 3001)
└── web/      Vite + React + TS + Tailwind + dnd-kit  (端口 5173)
```

数据存 `server/data.sqlite`(自动创建,首次启动注入 39 条 demo 物料)。

## 快速开始

```bash
# 1. 装依赖
cd server && npm install
cd ../web && npm install

# 2. 启动后端 (端口 3001)
cd ../server && npm run dev

# 3. 启动前端 (端口 5173,自动代理 /api → 3001)
cd ../web && npm run dev
```

访问 <http://localhost:5173> 即可。

## 使用流程

1. **设置** — 填 `https://erp-victor.ttpos.dev` 的 API key/secret + Item Group(默认 `Raw Material`)→ 保存 → 立即同步,Raw Material 物料会写入本地。
2. **物料库** — 按需新增「包材」「酱料」,标记 `外卖 / 到店`(原材料则不需要渠道字段)。
3. **单品 BOM** — 把原材料拖到中间区域;相同物料自动 +1,可调数量(支持小数,适合 g/ml)。
4. **套餐组合** — 把单品拖到中间区域 → 套餐二选一选包材(外卖一份+到店一份)、二选一选酱料 → 切换右下角 `外卖/到店`,实时预览汇总 BOM。

## ERP 集成

`POST /api/erp/sync` 调用:

```
GET {erp_url}/api/resource/Item
  ?filters=[["item_group","=","Raw Material"],["disabled","=",0]]
  &fields=["item_code","item_name","stock_uom","item_group"]
  &limit_page_length=0
```

凭证用 `Authorization: token <api_key>:<api_secret>`(Frappe 标准)。

## API 速查

```
GET    /api/health
GET    /api/materials?category=raw|packaging|sauce&channel=takeout|dinein&q=
POST   /api/materials              新增
PUT    /api/materials/:item_code   更新
DELETE /api/materials/:item_code

GET    /api/products
GET    /api/products/:id           含 lines
POST   /api/products
PUT    /api/products/:id
DELETE /api/products/:id

GET    /api/combos
GET    /api/combos/:id             含 lines
POST   /api/combos
PUT    /api/combos/:id
DELETE /api/combos/:id
GET    /api/combos/:id/bom?channel=takeout|dinein   汇总 BOM

GET    /api/erp/settings
PUT    /api/erp/settings
POST   /api/erp/sync
```
