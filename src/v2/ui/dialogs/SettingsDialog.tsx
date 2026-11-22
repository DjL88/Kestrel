import React, { useState } from 'react';
import type {
  AiProviderConfig,
  AssistMode,
  SettingsTabId,
  StorageConnector,
  WorkspaceSettings,
} from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { type BrandIconName } from '../icons/BrandIcon';

interface SettingsDialogProps {
  open: boolean;
  activeTab: SettingsTabId;
  settings: WorkspaceSettings;
  onClose: () => void;
  onSelectTab: (tab: SettingsTabId) => void;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
  onSignInStub: (provider: 'google' | 'apple' | 'email', email?: string) => void;
  onSignOutStub: () => void;
  onToggleAiProvider: (id: AiProviderConfig['id']) => void;
  onToggleStorageConnector: (id: StorageConnector['id']) => void;
}

const TABS: Array<{ id: SettingsTabId; label: string; icon: BrandIconName }> = [
  { id: 'appearance', label: STRINGS.settings.tabs.appearance, icon: 'palette' },
  { id: 'account', label: STRINGS.settings.tabs.account, icon: 'account' },
  { id: 'assistance', label: STRINGS.settings.tabs.assistance, icon: 'assist' },
  { id: 'aiProviders', label: STRINGS.settings.tabs.aiProviders, icon: 'cloud-assist' },
  { id: 'storage', label: STRINGS.settings.tabs.storage, icon: 'hard-drive' },
  { id: 'keyboard', label: STRINGS.settings.tabs.keyboard, icon: 'keyboard' },
  { id: 'language', label: STRINGS.settings.tabs.language, icon: 'language' },
];

const SHORTCUTS = [
  { keys: 'F', action: 'Flag / Unflag selected photo(s)' },
  { keys: '1 – 5', action: 'Assign 1 to 5 star rating' },
  { keys: '⌘Z / ⇧⌘Z', action: 'Undo / Redo adjustment' },
  { keys: '⌘C / ⌘V', action: 'Copy / Paste adjustments' },
  { keys: '⌘A', action: 'Select all photos in filmstrip' },
  { keys: 'G', action: 'Toggle All Photos grid view' },
  { keys: '\\', action: 'Compare Before & After' },
  { keys: '⌘E', action: 'Open Export dialog' },
];

export default function SettingsDialog({
  open,
  activeTab,
  settings,
  onClose,
  onSelectTab,
  onUpdateSettings,
  onSignInStub,
  onSignOutStub,
  onToggleAiProvider,
  onToggleStorageConnector,
}: SettingsDialogProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!open) return null;

  const handleEmailSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    onSignInStub('email', email);
    setEmail('');
    setPassword('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[82vh] max-h-[680px] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 id="settings-dialog-title" className="text-base font-bold text-[var(--text-primary)]">
            {STRINGS.settings.heading}
          </h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]"
          >
            <BrandIcon name="close" size={16} />
          </button>
        </div>

        {/* Tabbed body */}
        <div className="flex flex-1 flex-col overflow-hidden sm:flex-row">
          <nav
            role="tablist"
            aria-label="Settings sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] bg-[var(--bg-input)] p-2 sm:w-48 sm:flex-col sm:border-b-0 sm:border-r"
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectTab(tab.id)}
                  className={`flex items-center gap-2.5 rounded-[var(--radius-sm)] px-3 py-2 text-left text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <BrandIcon name={tab.icon} size={15} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto inflight-scroll p-6">
            {/* 1. APPEARANCE */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.settings.appearance.themeLabel}
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ theme: 'dark' })}
                      className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                        settings.theme === 'dark'
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <BrandIcon name="theme-dark" size={18} />
                      <span className="text-xs font-semibold">{STRINGS.settings.appearance.dark}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ theme: 'light' })}
                      className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                        settings.theme === 'light'
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <BrandIcon name="theme-light" size={18} />
                      <span className="text-xs font-semibold">{STRINGS.settings.appearance.light}</span>
                    </button>
                  </div>
                </section>

                {/* Calm View toggle (lives here, NOT in TopBar) */}
                <section className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
                  <div>
                    <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                      {STRINGS.settings.appearance.calmViewLabel}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {STRINGS.settings.appearance.calmViewDesc}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.calmView}
                    onClick={() => onUpdateSettings({ calmView: !settings.calmView })}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      settings.calmView
                        ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    {settings.calmView ? 'On' : 'Off'}
                  </button>
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.settings.appearance.densityLabel}
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(['comfortable', 'compact'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => onUpdateSettings({ touchDensity: d })}
                        className={`h-9 rounded-[var(--radius-sm)] border text-xs font-medium capitalize ${
                          settings.touchDensity === d
                            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {STRINGS.settings.appearance[d]}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* 2. ACCOUNT (Google, Apple, Email/Password UI stubs — no real auth) */}
            {activeTab === 'account' && (
              <div className="space-y-5">
                {settings.account.signedIn ? (
                  <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                          {settings.account.displayName}
                        </p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {settings.account.email} · via {settings.account.provider}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={onSignOutStub}
                        className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                      >
                        {STRINGS.settings.account.signOutButton}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {STRINGS.settings.account.signedOutTitle}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {STRINGS.settings.account.signedOutDesc}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => onSignInStub('google')}
                        className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                      >
                        {STRINGS.settings.account.continueGoogle}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSignInStub('apple')}
                        className="h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]"
                      >
                        {STRINGS.settings.account.continueApple}
                      </button>
                    </div>

                    <form
                      onSubmit={handleEmailSignIn}
                      className="space-y-3 border-t border-[var(--border-subtle)] pt-4"
                    >
                      <p className="text-xs font-semibold text-[var(--text-primary)]">
                        {STRINGS.settings.account.emailHeading}
                      </p>
                      <div className="space-y-1">
                        <label htmlFor="acc-email" className="text-[11px] text-[var(--text-secondary)]">
                          {STRINGS.settings.account.emailLabel}
                        </label>
                        <input
                          id="acc-email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="name@studio.co.uk"
                          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="acc-pass" className="text-[11px] text-[var(--text-secondary)]">
                          {STRINGS.settings.account.passwordLabel}
                        </label>
                        <input
                          id="acc-pass"
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
                        />
                      </div>
                      <button
                        type="submit"
                        className="h-9 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]"
                      >
                        {STRINGS.settings.account.signInButton}
                      </button>
                    </form>
                  </>
                )}
              </div>
            )}

            {/* 3. ASSISTANCE */}
            {activeTab === 'assistance' && (
              <div className="space-y-5">
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.settings.assistance.defaultModeLabel}
                  </h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(['solo', 'copilot', 'autopilot'] as AssistMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onUpdateSettings({ defaultAssistMode: m })}
                        className={`h-9 rounded-[var(--radius-sm)] border text-xs font-medium ${
                          settings.defaultAssistMode === m
                            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {STRINGS.topBar.assistModes[m]}
                      </button>
                    ))}
                  </div>
                </section>

                <SettingSwitch
                  title={STRINGS.settings.assistance.cvdLabel}
                  description={STRINGS.settings.assistance.cvdDesc}
                  checked={settings.cvdGuidance}
                  onToggle={() => onUpdateSettings({ cvdGuidance: !settings.cvdGuidance })}
                />
                <SettingSwitch
                  title={STRINGS.settings.assistance.ongoingLabel}
                  description={STRINGS.settings.assistance.ongoingDesc}
                  checked={settings.ongoingCritique}
                  onToggle={() => onUpdateSettings({ ongoingCritique: !settings.ongoingCritique })}
                />
              </div>
            )}

            {/* 4. AI PROVIDERS (BYO AI) */}
            {activeTab === 'aiProviders' && (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  {STRINGS.settings.aiProviders.intro}
                </p>
                <div className="space-y-2">
                  {settings.aiProviders.map((prov) => (
                    <div
                      key={prov.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{prov.name}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                          {prov.description}
                        </p>
                        <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                          {prov.modelLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={prov.id === 'local'}
                        onClick={() => onToggleAiProvider(prov.id)}
                        className={`h-8 shrink-0 rounded-[var(--radius-sm)] px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          prov.connected
                            ? 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                            : 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                        }`}
                      >
                        {prov.id === 'local'
                          ? 'Built-in'
                          : prov.connected
                          ? STRINGS.settings.aiProviders.disconnect
                          : STRINGS.settings.aiProviders.connect}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. STORAGE */}
            {activeTab === 'storage' && (
              <div className="space-y-5">
                <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                      {STRINGS.settings.storage.localCacheHeading}
                    </h3>
                    <span className="font-mono text-xs text-[var(--brand-accent)] tabular-nums">
                      {settings.localCacheLimitGb} GB cap
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {STRINGS.settings.storage.localCacheDesc}
                  </p>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={settings.localCacheLimitGb}
                    onChange={(e) => onUpdateSettings({ localCacheLimitGb: Number(e.target.value) })}
                    className="inflight-slider"
                  />
                </section>

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.settings.storage.connectorsHeading}
                  </h3>
                  <div className="space-y-2">
                    {settings.storageConnectors.map((conn) => (
                      <div
                        key={conn.id}
                        className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3.5 py-2.5"
                      >
                        <div>
                          <p className="text-xs font-semibold text-[var(--text-primary)]">{conn.name}</p>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            {conn.status === 'connected' ? conn.accountLabel || 'Connected' : 'Not connected'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleStorageConnector(conn.id)}
                          className={`h-8 rounded-[var(--radius-sm)] px-3 text-xs font-medium ${
                            conn.status === 'connected'
                              ? 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                              : 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                          }`}
                        >
                          {conn.status === 'connected' ? 'Disconnect' : 'Connect'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="pt-1 text-[11px] text-[var(--text-muted)]">
                    {STRINGS.settings.storage.inflightCloudNote}
                  </p>
                </section>
              </div>
            )}

            {/* 6. KEYBOARD */}
            {activeTab === 'keyboard' && (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-secondary)]">{STRINGS.settings.keyboard.intro}</p>
                <div className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)]">
                  {SHORTCUTS.map((s) => (
                    <div key={s.keys} className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                      <span className="text-[var(--text-primary)]">{s.action}</span>
                      <kbd className="rounded border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
                        {s.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 7. LANGUAGE */}
            {activeTab === 'language' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                    {STRINGS.settings.language.label}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {STRINGS.settings.language.desc}
                  </p>
                </div>
                <select
                  value={settings.language}
                  aria-label="Display language"
                  onChange={(e) =>
                    onUpdateSettings({
                      language: e.target.value as WorkspaceSettings['language'],
                    })
                  }
                  className="h-10 w-full max-w-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
                >
                  <option value="en-GB">English (United Kingdom) — Default</option>
                  <option value="en-US">English (United States)</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="fr-FR">Français</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingSwitch({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
      <div>
        <h4 className="text-xs font-semibold text-[var(--text-primary)]">{title}</h4>
        <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
          checked
            ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
            : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
        }`}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}
