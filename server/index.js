import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { materialsRouter } from './routes/materials.js';
import { productsRouter } from './routes/products.js';
import { combosRouter } from './routes/combos.js';
import { ordersRouter } from './routes/orders.js';
import { sharedBomsRouter } from './routes/sharedBoms.js';
import { exportRouter } from './routes/export.js';
import { erpRouter } from './routes/erp.js';
import { authRouter } from './routes/auth.js';
import { initAccessCodes, authMiddleware } from './auth.js';

seedIfEmpty();
initAccessCodes();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n;
  res.json({ ok: true, materials: n });
});

// auth router 不受保护
app.use('/api/auth', authRouter);
// 之后所有 /api/* 由 middleware 验证 cookie
app.use('/api', authMiddleware);

app.use('/api/materials', materialsRouter);
app.use('/api/products', productsRouter);
app.use('/api/combos', combosRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/shared-boms', sharedBomsRouter);
app.use('/api/export', exportRouter);
app.use('/api/erp', erpRouter);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`[bom-server] listening on http://localhost:${PORT}`));
