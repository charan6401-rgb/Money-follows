import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/useI18n';
import { errorMessageKey } from '@/lib/errors';
import { workspaceStore } from '@/lib/workspace-store';
import { Button } from '@/components/ui/Button';
import { SelectField, TextField } from '@/components/ui/Field';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { useAuth } from '@/features/auth/auth-context';
import { useCreateWorkspace, useWorkspaces } from '@/features/workspaces/hooks';
import type { Language } from '@/types/api';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useI18n();
  const auth = useAuth();
  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 py-8">
      <p className="font-serif text-2xl text-ink-900">{t('app.name')}</p>
      <h1 className="mt-6 font-serif text-xl text-ink-900">{title}</h1>
      <div className="mt-4">{children}</div>
      <Button variant="quiet" className="mt-6" onClick={() => void auth.signOut()}>
        {t('auth.signOut')}
      </Button>
    </main>
  );
}

/** Pick which business to work in. Shown when more than one exists or none is selected. */
export function WorkspacePickerPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const query = useWorkspaces();

  return (
    <Shell title={t('workspace.pickTitle')}>
      {query.isPending ? (
        <ListSkeleton rows={2} />
      ) : query.isError ? (
        <ErrorState error={query.error} title={t('workspace.loadFailed')} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <ul className="space-y-3">
            {query.data.items.map((workspace) => (
              <li key={workspace.id}>
                <button
                  type="button"
                  onClick={() => {
                    workspaceStore.set(workspace.id);
                    navigate('/', { replace: true });
                  }}
                  className="flex min-h-touch w-full items-center justify-between rounded-card border border-cement-300 bg-white px-4 py-4 text-left hover:bg-cement-50"
                >
                  <span className="font-semibold text-ink-900">{workspace.name}</span>
                  <span className="text-sm text-ink-500">{t(`role.${workspace.role}`)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link
            to="/workspace/new"
            className="mt-4 inline-flex min-h-touch items-center font-semibold text-ink-900 underline"
          >
            {t('workspace.createAnother')}
          </Link>
        </>
      )}
    </Shell>
  );
}

/** First-run: create the business. The id, owner and role are chosen by the server. */
export function WorkspaceCreatePage() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>(lang);
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      setNameError(t('form.nameLength'));
      return;
    }
    setNameError(undefined);
    // The button is disabled while pending: a double submit would create two businesses.
    create.mutate(
      { name: trimmed, default_language: language },
      { onSuccess: () => navigate('/', { replace: true }) },
    );
  };

  return (
    <Shell title={t('workspace.createTitle')}>
      <form onSubmit={submit} noValidate className="space-y-4 rounded-card border border-cement-300 bg-white p-5">
        <p className="text-ink-600">{t('workspace.createHint')}</p>
        <TextField
          label={t('workspace.name')}
          value={name}
          maxLength={120}
          autoComplete="organization"
          error={nameError}
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          label={t('workspace.language')}
          value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}
        >
          <option value="en">{t('lang.en')}</option>
          <option value="te">{t('lang.te')}</option>
        </SelectField>
        {create.isError ? (
          <p role="alert" className="text-sm font-medium text-stamp">
            {t(errorMessageKey(create.error))}
          </p>
        ) : null}
        <Button type="submit" block loading={create.isPending}>
          {t('workspace.create')}
        </Button>
      </form>
    </Shell>
  );
}
