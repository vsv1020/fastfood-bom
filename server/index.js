import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { seedIfEmpty } from './seed.js';
import { materialsRouter } from './routes/materials.js';
import { productsRouter } from './routes/products.js';
import { combosRouter } from './routes/combos.js';
import { ordersRouter } from './routes/orders.js';
import { sharedBomsRouter } from './routes/sharedBoms.js';
import { erpRouter } from './routes/erp.js';

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '4mb' }));

app.get('/api/health', (req, res) => {
  const n = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n;
  res.json({ ok: true, materials: n });
});

app.use('/api/materials', materialsRouter);
app.use('/api/products', productsRouter);
app.use('/api/combos', combosRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/shared-boms', sharedBomsRouter);
app.use('/api/erp', erpRouter);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => console.log(`[bom-server] listening on http://localhost:${PORT}`));
