import { db } from './db.js';

const SEED_MATERIALS = [
  // 主料
  ['RM-BUN-PLAIN', '原味汉堡胚', 'Nos', 'raw', null],
  ['RM-BUN-SESAME', '芝麻汉堡胚', 'Nos', 'raw', null],
  ['RM-PATTY-BEEF', '牛肉饼 (110g)', 'Nos', 'raw', null],
  ['RM-PATTY-CHIK', '鸡肉饼 (95g)', 'Nos', 'raw', null],
  ['RM-PATTY-FISH', '鱼柳饼 (80g)', 'Nos', 'raw', null],
  ['RM-CHEESE-CHED', '车达芝士片', 'Nos', 'raw', null],
  ['RM-LETTUCE', '生菜叶', 'g', 'raw', null],
  ['RM-TOMATO', '番茄片', 'Nos', 'raw', null],
  ['RM-PICKLE', '酸黄瓜片', 'Nos', 'raw', null],
  ['RM-ONION', '洋葱碎', 'g', 'raw', null],
  ['RM-BACON', '培根片', 'Nos', 'raw', null],
  ['RM-EGG', '鸡蛋', 'Nos', 'raw', null],
  // 副食
  ['RM-FRIES-M', '薯条 (中份)', 'Nos', 'raw', null],
  ['RM-FRIES-L', '薯条 (大份)', 'Nos', 'raw', null],
  ['RM-NUGGET', '鸡块', 'Nos', 'raw', null],
  ['RM-WING', '鸡翅', 'Nos', 'raw', null],
  // 饮料
  ['RM-COKE-M', '可乐 (中杯)', 'Nos', 'raw', null],
  ['RM-COKE-L', '可乐 (大杯)', 'Nos', 'raw', null],
  ['RM-SPRITE-M', '雪碧 (中杯)', 'Nos', 'raw', null],
  ['RM-COFFEE', '美式咖啡', 'Nos', 'raw', null],
  ['RM-MILK', '鲜牛奶', 'ml', 'raw', null],
  // 包材 - 外卖
  ['PKG-BURGER-TO', '汉堡纸盒 (外卖)', 'Nos', 'packaging', 'takeout'],
  ['PKG-FRIES-TO', '薯条纸袋 (外卖)', 'Nos', 'packaging', 'takeout'],
  ['PKG-CUP-TO', '一次性饮料杯 (外卖)', 'Nos', 'packaging', 'takeout'],
  ['PKG-BAG-TO', '外卖打包袋', 'Nos', 'packaging', 'takeout'],
  ['PKG-COMBO-TO', '套餐打包套装 (外卖)', 'Nos', 'packaging', 'takeout'],
  // 包材 - 到店
  ['PKG-TRAY-DI', '托盘垫纸 (到店)', 'Nos', 'packaging', 'dinein'],
  ['PKG-CUP-DI', '到店饮料杯', 'Nos', 'packaging', 'dinein'],
  ['PKG-WRAP-DI', '汉堡包装纸 (到店)', 'Nos', 'packaging', 'dinein'],
  ['PKG-COMBO-DI', '套餐托盘 (到店)', 'Nos', 'packaging', 'dinein'],
  // 酱料 - 外卖(独立小包)
  ['SAU-KETCH-TO', '番茄酱包 (外卖)', 'Nos', 'sauce', 'takeout'],
  ['SAU-MAYO-TO', '蛋黄酱包 (外卖)', 'Nos', 'sauce', 'takeout'],
  ['SAU-BBQ-TO', 'BBQ 酱包 (外卖)', 'Nos', 'sauce', 'takeout'],
  ['SAU-CHILI-TO', '辣酱包 (外卖)', 'Nos', 'sauce', 'takeout'],
  ['SAU-MUSTARD-TO', '芥末酱包 (外卖)', 'Nos', 'sauce', 'takeout'],
  // 酱料 - 到店(自助/分装杯)
  ['SAU-KETCH-DI', '番茄酱杯 (到店)', 'Nos', 'sauce', 'dinein'],
  ['SAU-MAYO-DI', '蛋黄酱杯 (到店)', 'Nos', 'sauce', 'dinein'],
  ['SAU-BBQ-DI', 'BBQ 酱杯 (到店)', 'Nos', 'sauce', 'dinein'],
  ['SAU-CHILI-DI', '辣酱杯 (到店)', 'Nos', 'sauce', 'dinein'],
];

export function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n;
  if (count > 0) return;
  const stmt = db.prepare(
    `INSERT INTO materials(item_code, item_name, uom, category, channel, source)
     VALUES (?, ?, ?, ?, ?, 'manual')`
  );
  const tx = db.transaction((rows) => rows.forEach((r) => stmt.run(...r)));
  tx(SEED_MATERIALS);
  console.log(`[seed] inserted ${SEED_MATERIALS.length} demo materials`);
}
