import { Router } from 'express';
import { verifyCode, makeAuthCookie, clearAuthCookie } from '../auth.js';

export const authRouter = Router();

authRouter.get('/me', (req, res) => {
  // parse cookie inline (避免依赖)
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith('bom_auth='));
  const code = m ? decodeURIComponent(m.slice('bom_auth='.length)) : '';
  if (verifyCode(code)) return res.json({ ok: true, masked: code.slice(0, 2) + '••••' + code.slice(-2) });
  res.status(401).json({ ok: false });
});

authRouter.post('/verify', (req, res) => {
  const code = (req.body && req.body.code ? String(req.body.code) : '').trim().toUpperCase();
  if (!verifyCode(code)) return res.status(401).json({ error: '验证码无效 / Invalid code / รหัสไม่ถูกต้อง' });
  res.setHeader('Set-Cookie', makeAuthCookie(code));
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearAuthCookie());
  res.json({ ok: true });
});
