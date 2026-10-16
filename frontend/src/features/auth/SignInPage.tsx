import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^[0-9]{6,10}$/;
const RESEND_SECONDS = 30;

type Step = 'email' | 'code';

export function SignInPage() {
  const { t, lang, setLang } = useI18n();
  const auth = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (auth.session) return <Navigate to="/" replace />;

  const send = async () => {
    const trimmed = email.trim();
    if (!EMAIL.test(trimmed)) {
      setFieldError(t('form.invalidEmail'));
      return;
    }
    setFieldError(undefined);
    setFailure(undefined);
    setBusy(true);
    try {
      await auth.sendCode(trimmed);
      setEmail(trimmed);
      setStep('code');
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch {
      setFailure(t('auth.sendFailed'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const trimmed = code.trim();
    if (!CODE.test(trimmed)) {
      setFieldError(t('form.invalidCode'));
      return;
    }
    setFieldError(undefined);
    setFailure(undefined);
    setBusy(true);
    try {
      await auth.verifyCode(email, trimmed);
      // The session change redirects through the router.
    } catch {
      setFailure(t('auth.verifyFailed'));
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void (step === 'email' ? send() : verify());
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-cement-100 px-4 py-8">
      <div className="w-full max-w-sm">
        <p className="font-serif text-2xl text-ink-900">{t('app.name')}</p>
        <form onSubmit={onSubmit} noValidate className="mt-6 rounded-card border border-cement-300 bg-white p-5">
          <h1 className="font-serif text-xl text-ink-900">{t('auth.title')}</h1>
          {step === 'email' ? (
            <>
              <p className="mt-1 text-ink-600">{t('auth.subtitle')}</p>
              <div className="mt-4">
                <TextField
                  label={t('auth.email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={email}
                  error={fieldError}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-ink-600">{t('auth.codeSentTo', { email })}</p>
              <div className="mt-4">
                <TextField
                  label={t('auth.code')}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  error={fieldError}
                  onChange={(event) => setCode(event.target.value.replace(/\s/g, ''))}
                />
              </div>
            </>
          )}
          {failure ? (
            <p role="alert" className="mt-3 text-sm font-medium text-stamp">
              {failure}
            </p>
          ) : null}
          <Button type="submit" block loading={busy} className="mt-5">
            {step === 'email' ? t('auth.sendCode') : t('auth.verify')}
          </Button>
          {step === 'code' ? (
            <div className="mt-3 flex flex-col gap-1">
              <Button variant="quiet" disabled={cooldown > 0 || busy} onClick={() => void send()}>
                {cooldown > 0 ? t('auth.resendIn', { n: cooldown }) : t('auth.resend')}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setStep('email');
                  setFailure(undefined);
                  setFieldError(undefined);
                }}
              >
                {t('auth.changeEmail')}
              </Button>
            </div>
          ) : null}
        </form>
        <div className="mt-4 flex justify-center gap-2">
          {(['en', 'te'] as const).map((l) => (
            <Button
              key={l}
              variant={lang === l ? 'secondary' : 'quiet'}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
            >
              {t(`lang.${l}`)}
            </Button>
          ))}
        </div>
      </div>
    </main>
  );
}
