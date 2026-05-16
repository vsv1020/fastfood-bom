import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useT, useLang, LANG_OPTIONS, type Lang } from './i18n';

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'login' | 'ok'>('checking');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const { lang, setLang } = useLang();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => setState(r.ok ? 'ok' : 'login'))
      .catch(() => setState('login'));
  }, []);

  async function submit() {
    if (!code.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: 'failed' }));
        setErr(j.error || 'failed');
        return;
      }
      setState('ok');
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  if (state === 'checking') {
    return (
      <div className="h-screen flex items-center justify-center text-slate-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (state === 'login') {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="card p-8 w-full max-w-md">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-3xl">🍔</span>
            <h1 className="text-xl font-semibold text-slate-900">{t('brand.title')}</h1>
          </div>
          <p className="text-sm text-slate-500 mb-6">{t('login.subtitle')}</p>

          <label className="label flex items-center gap-1.5">
            <KeyRound size={13} /> {t('login.code_label')}
          </label>
          <input
            autoFocus
            className="input mt-2 font-mono text-center tracking-widest uppercase"
            placeholder="XXXXXXXX"
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          {err && <div className="mt-3 text-sm text-rose-600">{err}</div>}

          <button
            className="btn-primary w-full mt-5 justify-center"
            onClick={submit}
            disabled={busy || !code.trim()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : t('login.enter')}
          </button>

          <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5">
            {LANG_OPTIONS.map((l) => (
              <button
                key={l.value}
                onClick={() => setLang(l.value as Lang)}
                className={
                  'text-xs rounded-md px-2 py-1 ' +
                  (lang === l.value ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                }
              >
                {l.flag} {l.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
