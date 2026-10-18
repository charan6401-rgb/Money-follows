import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { Button } from '@/components/ui/Button';
import { SelectField } from '@/components/ui/Field';
import { useAuth } from '@/features/auth/auth-context';
import { useCurrentWorkspace } from '@/features/workspaces/hooks';
import { workspaceStore } from '@/lib/workspace-store';
import type { Language } from '@/types/api';

export function MorePage() {
  const { t, lang, setLang } = useI18n();
  const auth = useAuth();
  const navigate = useNavigate();
  const workspace = useCurrentWorkspace();

  return (
    <div className="max-w-xl space-y-5">
      <h1 className="font-serif text-2xl text-ink-900">{t('account.title')}</h1>

      <section className="space-y-3 rounded-card border border-cement-300 bg-white p-5">
        {auth.email ? <p className="text-ink-600">{t('account.signedInAs', { email: auth.email })}</p> : null}
        {workspace ? (
          <dl className="space-y-2">
            <div>
              <dt className="text-sm text-ink-500">{t('account.business')}</dt>
              <dd className="font-semibold text-ink-900">{workspace.name}</dd>
            </div>
            <div>
              <dt className="text-sm text-ink-500">{t('account.role')}</dt>
              <dd className="text-ink-900">{t(`role.${workspace.role}`)}</dd>
            </div>
          </dl>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            workspaceStore.set(null);
            navigate('/workspace');
          }}
        >
          {t('workspace.switch')}
        </Button>
      </section>

      <section className="rounded-card border border-cement-300 bg-white p-5">
        <SelectField label={t('account.language')} value={lang} onChange={(event) => setLang(event.target.value as Language)}>
          <option value="en">{t('lang.en')}</option>
          <option value="te">{t('lang.te')}</option>
        </SelectField>
      </section>

      <Button variant="secondary" onClick={() => void auth.signOut()}>
        {t('auth.signOut')}
      </Button>
    </div>
  );
}
