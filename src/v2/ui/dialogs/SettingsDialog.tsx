import { LANGUAGES, languageOption, type LanguageCode } from '../../../core/locale';
import { chooseLanguage, language } from '../../../i18n/messages';
import { StorageConnections } from './StorageConnections';
import { aiProviderControl, cacheCapControl } from '../../engineClient/realSettingsControls';
import { calmViewOn, calmViewPatch } from '../../engineClient/uiSettings';
import React, { useRef, useState } from 'react';
import { useDialogFocus } from '../utils/dialogFocus';
import ReadingSettings from './ReadingSettings';
import MarkingsReaderSetting from './MarkingsReaderSetting';
import { isDesktopApp, isMobileShell } from '../../../providers/desktopShell';

/** The published privacy policy. It is not bundled into the app, so a relative link would lead nowhere in the desktop app. */
import { publicSiteUrl } from '../../../core/publicSite';
const PRIVACY_URL = publicSiteUrl('/privacy.html');
import type {
  AiProviderConfig,
  AssistMode,
  SettingsTabId,
  StorageConnector,
  WorkspaceSettings,
} from '../contract';
import { STRINGS } from '../strings';
import { projectsText } from '../../../i18n/areas/projects';
import { readBuildInfo } from '../../../core/buildInfo';
import { ModelsSection } from '../panels/ModelsSection';

/** Settings → Build information (G10). Literal accesses, so Vite's build-time values replace them. */
const BUILD = readBuildInfo({
  VITE_KESTREL_BUILD_REVISION: import.meta.env.VITE_KESTREL_BUILD_REVISION,
  VITE_KESTREL_BUILD_FULL_REVISION: import.meta.env.VITE_KESTREL_BUILD_FULL_REVISION,
  VITE_KESTREL_BUILD_DIRTY: import.meta.env.VITE_KESTREL_BUILD_DIRTY,
  VITE_KESTREL_BUILD_TIMESTAMP: import.meta.env.VITE_KESTREL_BUILD_TIMESTAMP,
});
import { BrandIcon as OfficialMark, WorksWith } from '../../../components/BrandIcon';
import type { BrandIconId } from '../../../core/brandIcons';

/** Display genuine marks for named providers. Never replace an unlicensed/missing brand mark with an unrelated cloud icon. */
const AI_MARK: Partial<Record<AiProviderConfig['id'], BrandIconId>> = { gemini: 'gemini', claude: 'anthropic' };
const AI_NEUTRAL: Partial<Record<AiProviderConfig['id'], BrandIconName>> = { local: 'assist' };
import BrandIcon, { type BrandIconName } from '../icons/BrandIcon';

interface SettingsDialogProps {
  open: boolean;
  activeTab: SettingsTabId;
  accountPanel?: React.ReactNode;
  templates?: ReadonlyArray<{ id: string; name: string }>;
  onRenameTemplate?: (id: string, name: string) => void;
  onDeleteTemplate?: (id: string) => void;
  /** The Keyboard tab: key set, rebinding and clashes. */
  keyboardPanel?: React.ReactNode;
  settings: WorkspaceSettings;
  /** The mode that is on now. It is chosen here and shown by the flag at the bottom of the tool rail. */
  assistMode: AssistMode;
  onSetAssistMode: (mode: AssistMode) => void;
  onClose: () => void;
  onSelectTab: (tab: SettingsTabId) => void;
  onUpdateSettings: (patch: Partial<WorkspaceSettings>) => void;
  onSignInStub: (provider: 'google' | 'apple' | 'email', email?: string) => void;
  onSignOutStub: () => void;
  onToggleAiProvider: (id: AiProviderConfig['id']) => void;
  onToggleStorageConnector: (id: StorageConnector['id']) => void;
  onEraseDeviceData: () => void;
  /** True on a Basic account: show the Hide Pro features choice. */
  proChoiceOffered?: boolean;
}

const CALM_PARTS: Array<{ key: 'calmMotion' | 'calmBadges' | 'calmHints' | 'calmReadouts'; label: string; desc: string }> = [
  { key: 'calmMotion', label: STRINGS.settings.appearance.calmMotionLabel, desc: STRINGS.settings.appearance.calmMotionDesc },
  { key: 'calmBadges', label: STRINGS.settings.appearance.calmBadgesLabel, desc: STRINGS.settings.appearance.calmBadgesDesc },
  { key: 'calmHints', label: STRINGS.settings.appearance.calmHintsLabel, desc: STRINGS.settings.appearance.calmHintsDesc },
  { key: 'calmReadouts', label: STRINGS.settings.appearance.calmReadoutsLabel, desc: STRINGS.settings.appearance.calmReadoutsDesc },
];

const TABS: Array<{ id: SettingsTabId; label: string; icon: BrandIconName }> = [
  { id: 'appearance', label: STRINGS.settings.tabs.appearance, icon: 'palette' },
  { id: 'account', label: STRINGS.settings.tabs.account, icon: 'account' },
  { id: 'assistance', label: STRINGS.settings.tabs.assistance, icon: 'assist' },
  { id: 'aiProviders', label: STRINGS.settings.tabs.aiProviders, icon: 'cloud-assist' },
  { id: 'storage', label: STRINGS.settings.tabs.storage, icon: 'hard-drive' },
  { id: 'keyboard', label: STRINGS.settings.tabs.keyboard, icon: 'keyboard' },
  { id: 'language', label: STRINGS.settings.tabs.language, icon: 'language' },
  { id: 'presets', label: STRINGS.overlays.templatesHeading, icon: 'grid' },
  { id: 'privacy', label: STRINGS.settings.tabs.privacy, icon: 'info' },
];

export default function SettingsDialog({
  assistMode,
  onSetAssistMode,
  open,
  activeTab,
  accountPanel,
  templates = [],
  onRenameTemplate,
  onDeleteTemplate,
  keyboardPanel,
  settings,
  onClose,
  onSelectTab,
  onUpdateSettings,
  onSignInStub,
  onSignOutStub,
  onToggleAiProvider,
  onToggleStorageConnector,
  onEraseDeviceData,
  proChoiceOffered = false,
}: SettingsDialogProps) {
  const [eraseText, setEraseText] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const onDialogKeyDown = useDialogFocus(open, panelRef, onClose);

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
      onKeyDown={onDialogKeyDown}
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={panelRef} tabIndex={-1} className="flex h-[82vh] max-h-[680px] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-4">
          <h2 id="settings-dialog-title" className="text-base font-bold text-[var(--text-primary)]">
            {STRINGS.settings.heading}
          </h2>
          <button
            type="button"
            aria-label={STRINGS.settingsMore.closeSettings}
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
            aria-label={STRINGS.settingsMore.sections}
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
                  <div className="grid grid-cols-3 gap-2.5">
                    <button
                      type="button"
                      aria-pressed={settings.theme === 'auto'}
                      onClick={() => onUpdateSettings({ theme: 'auto' })}
                      className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                        settings.theme === 'auto'
                          ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                      }`}
                    >
                      <BrandIcon name="clock" size={18} />
                      <span className="text-xs font-semibold">{STRINGS.settings.appearance.auto}</span>
                    </button>
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

                {/* Text size, typeface and spacing: the device's display settings, shared with the previous app. */}
                <ReadingSettings />

                {/* Calm View (lives here, NOT in TopBar or Assistance): a preset, with each of its parts adjustable below. */}
                <section className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 id="calm-view-title" className="text-xs font-semibold text-[var(--text-primary)]">
                        {STRINGS.settings.appearance.calmViewLabel}
                      </h3>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {STRINGS.settings.appearance.calmViewDesc}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={calmViewOn(settings)}
                      aria-labelledby="calm-view-title"
                      onClick={() => onUpdateSettings(calmViewPatch(!calmViewOn(settings)))}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        calmViewOn(settings)
                          ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                          : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                      }`}
                    >
                      {calmViewOn(settings) ? STRINGS.settings.appearance.on : STRINGS.settings.appearance.off}
                    </button>
                  </div>
                  <ul className="mt-3 divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
                    {CALM_PARTS.map((part) => (
                      <li key={part.key} className="flex items-start justify-between gap-4 py-2.5">
                        <div>
                          <p id={`calm-${part.key}`} className="text-xs font-medium text-[var(--text-primary)]">{part.label}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">{part.desc}</p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={settings[part.key]}
                          aria-labelledby={`calm-${part.key}`}
                          onClick={() => onUpdateSettings({ [part.key]: !settings[part.key] })}
                          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                            settings[part.key]
                              ? 'border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] text-[var(--text-primary)]'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                          }`}
                        >
                          {settings[part.key] ? STRINGS.settings.appearance.on : STRINGS.settings.appearance.off}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Advanced editing controls stay out of Adjust until a confident person asks for them. */}
                <section className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
                  <div>
                    <h3 id="advanced-controls-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settings.appearance.advancedLabel}</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{STRINGS.settings.appearance.advancedDesc}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.advancedControls}
                    aria-labelledby="advanced-controls-title"
                    data-testid="advanced-controls-switch"
                    onClick={() => onUpdateSettings({ advancedControls: !settings.advancedControls })}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      settings.advancedControls
                        ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                        : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                    }`}
                  >
                    {settings.advancedControls ? STRINGS.settings.appearance.on : STRINGS.settings.appearance.off}
                  </button>
                </section>

                {/* Basic accounts only: leave locked Pro features out of the interface so they are not a constant reminder. */}
                {proChoiceOffered && (
                  <section className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-4">
                    <div>
                      <h3 id="hide-pro-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settings.appearance.hideProLabel}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{STRINGS.settings.appearance.hideProDesc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.hideProFeatures}
                      aria-labelledby="hide-pro-title"
                      onClick={() => onUpdateSettings({ hideProFeatures: !settings.hideProFeatures })}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        settings.hideProFeatures
                          ? 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                          : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                      }`}
                    >
                      {settings.hideProFeatures ? 'On' : 'Off'}
                    </button>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.hand.label}</h3>
                  <p className="text-[0.6875rem] leading-snug text-[var(--text-secondary)]">{STRINGS.hand.help}</p>
                  <div role="radiogroup" aria-label={STRINGS.hand.label} className="grid grid-cols-2 gap-2">
                    {(['right', 'left'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        role="radio"
                        aria-checked={settings.hand === side}
                        onClick={() => onUpdateSettings({ hand: side })}
                        className={`h-9 rounded-[var(--radius-sm)] border px-2 text-xs font-medium ${
                          settings.hand === side
                            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {STRINGS.hand[side]}
                      </button>
                    ))}
                  </div>
                </section>

              </div>
            )}

            {activeTab === 'account' && (
              accountPanel ? <div className="text-sm text-[var(--text-secondary)] [--account-foreground:var(--text-primary)] [--account-text:var(--text-secondary)] [--account-muted:var(--text-muted)] [--account-border:var(--border-default)] [--account-field:var(--bg-input)] [--account-warning:var(--text-primary)]">
                {accountPanel}
              </div> :
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
                        <span className="inline-flex items-center justify-center gap-2">
                          <OfficialMark id="apple" className="h-4 w-4 shrink-0" />
                          <span>{STRINGS.settings.account.continueApple}</span>
                        </span>
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
                        <label htmlFor="acc-email" className="text-[0.6875rem] text-[var(--text-secondary)]">
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
                        <label htmlFor="acc-pass" className="text-[0.6875rem] text-[var(--text-secondary)]">
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
                        onClick={() => { onSetAssistMode(m); onUpdateSettings({ defaultAssistMode: m }); }}
                        className={`h-9 rounded-[var(--radius-sm)] border text-xs font-medium ${
                          assistMode === m
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
                <MarkingsReaderSetting />
              </div>
            )}

            {/* 4. AI PROVIDERS (BYO AI) */}
            {activeTab === 'aiProviders' && (
              <div className="space-y-4">
                <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                  {STRINGS.settings.aiProviders.intro}
                </p>
                {accountPanel && <p id="v2-real-ai-unavailable" role="status" className="text-xs leading-relaxed text-[var(--text-secondary)]">{STRINGS.settingsMore.aiNotImplemented}</p>}
                <div className="space-y-2">
                  {settings.aiProviders.map((prov) => {
                    const connection = aiProviderControl(prov, Boolean(accountPanel));
                    return (
                    <div
                      key={prov.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-3.5"
                    >
                      {(AI_MARK[prov.id] || AI_NEUTRAL[prov.id]) && (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)]" aria-hidden="true">
                          {AI_MARK[prov.id]
                            ? <OfficialMark id={AI_MARK[prov.id]!} className="h-5 w-5" />
                            : <BrandIcon name={AI_NEUTRAL[prov.id]!} size={20} />}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[var(--text-primary)]">{prov.name}</p>
                        <p className="mt-0.5 text-[0.6875rem] text-[var(--text-secondary)]">
                          {prov.description}
                        </p>
                        <p className="mt-1 font-mono text-[0.625rem] text-[var(--text-muted)]">
                          {connection.modelLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={connection.disabled}
                        aria-describedby={accountPanel && prov.id !== 'local' ? 'v2-real-ai-unavailable' : undefined}
                        data-testid={`v2-ai-provider-${prov.id}`}
                        onClick={() => onToggleAiProvider(prov.id)}
                        className={`h-8 shrink-0 rounded-[var(--radius-sm)] px-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
                          connection.connected
                            ? 'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                            : 'bg-[var(--brand-accent)] text-[var(--text-on-accent)]'
                        }`}
                      >
                        {connection.buttonText}
                      </button>
                    </div>
                    );
                  })}
                </div>
                {accountPanel
                  ? <p className="text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.settingsMore.aiPlanned}</p>
                  : <div>
                    <p className="text-[0.6875rem] font-medium text-[var(--text-muted)]">{STRINGS.settingsMore.byoAi}</p>
                    <WorksWith items={[{ id: 'ollama', name: 'Ollama' }, { id: 'lmstudio', name: 'LM Studio' }]} />
                  </div>}
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
                      {accountPanel ? STRINGS.settingsMore.notConfigured : STRINGS.settingsMore.cacheCap(settings.localCacheLimitGb)}
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
                    disabled={cacheCapControl(Boolean(accountPanel)).disabled}
                    aria-describedby={accountPanel ? 'v2-cache-unavailable' : undefined}
                    data-testid="v2-cache-cap-control"
                    onChange={(e) => onUpdateSettings({ localCacheLimitGb: Number(e.target.value) })}
                    className="inflight-slider disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {accountPanel && <p id="v2-cache-unavailable" role="status" className="text-[0.6875rem] text-[var(--text-secondary)]">{cacheCapControl(true).description}</p>}
                </section>

                <StorageConnections />
                <div>
                    <p className="text-[0.6875rem] font-medium text-[var(--text-muted)]">{STRINGS.settingsMore.byoStorage}</p>
                    <WorksWith items={[{ id: 'synology', name: 'Synology' }, { id: 'qnap', name: 'QNAP' }, { id: 'nextcloud', name: 'Nextcloud' }, { id: 'owncloud', name: 'ownCloud' }, { id: 'backblaze', name: 'Backblaze B2' }]} />
                </div>
                <p className="pt-1 text-[0.6875rem] text-[var(--text-muted)]">
                  {STRINGS.settings.storage.inflightCloudNote}
                </p>
              </div>
            )}

            {/* 6. KEYBOARD */}
            {activeTab === 'keyboard' && (
              <div className="space-y-3">
                <p className="text-xs text-[var(--text-secondary)]">{STRINGS.settings.keyboard.intro}</p>
                <SettingSwitch
                  title={STRINGS.settings.keyboard.advanceLabel}
                  description={STRINGS.settings.keyboard.advanceDesc}
                  checked={settings.advanceAfterDecision}
                  onToggle={() => onUpdateSettings({ advanceAfterDecision: !settings.advanceAfterDecision })}
                />
                {keyboardPanel}
              </div>
            )}

            {/* 8. PRIVACY */}
            {activeTab === 'privacy' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settingsMore.privacyHeading}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {STRINGS.settingsMore.privacyBody}{' '}
                    <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--brand-accent)] underline"
                      onClick={(event) => {
                        // The policy page is part of the website, not the app build. On the desktop app it opens in the system browser.
                        if (!isDesktopApp() || isMobileShell()) return;
                        event.preventDefault();
                        void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(PRIVACY_URL)).catch(() => undefined);
                      }}>{STRINGS.settingsMore.privacyLink}</a> {STRINGS.settingsMore.privacyDraft}
                  </p>
                </div>
                <section aria-labelledby="build-information-title" data-testid="v2-build-information" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
                  <h3 id="build-information-title" className="text-xs font-semibold text-[var(--text-primary)]">{projectsText.licence.buildTitle}</h3>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{projectsText.licence.buildHint}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                    <dt>{projectsText.licence.sourceRevision}</dt>
                    <dd data-testid="v2-build-revision" title={BUILD.fullRevision ?? undefined} className="select-text break-all font-mono text-[var(--text-primary)]">{BUILD.revision ?? projectsText.licence.unavailable}</dd>
                    <dt>{projectsText.licence.builtAt}</dt>
                    <dd className="select-text break-all font-mono text-[var(--text-primary)]">{BUILD.builtAt ?? projectsText.licence.unavailable}</dd>
                  </dl>
                  {BUILD.modified && <p role="note" className="text-xs font-medium text-[var(--text-primary)]">⚠ {STRINGS.settingsMore.buildModified}</p>}
                </section>
                <ModelsSection />
                <section aria-labelledby="erase-device-title" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
                  <h3 id="erase-device-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settingsMore.eraseHeading}</h3>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {STRINGS.settingsMore.eraseBody}
                  </p>
                  <label htmlFor="erase-confirm" className="block text-xs font-medium text-[var(--text-secondary)]">{STRINGS.settingsMore.eraseConfirm}</label>
                  <input id="erase-confirm" type="text" autoComplete="off" value={eraseText} onChange={(e) => setEraseText(e.target.value)} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)]" />
                  <button type="button" disabled={eraseText.trim() !== 'ERASE'} onClick={onEraseDeviceData} className="min-h-11 rounded-[var(--radius-md)] bg-[var(--status-danger,#e5484d)] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{STRINGS.settingsMore.eraseButton}</button>
                </section>
                <section aria-labelledby="erase-account-title" className="space-y-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-4">
                  <h3 id="erase-account-title" className="text-xs font-semibold text-[var(--text-primary)]">{STRINGS.settingsMore.forgetHeading}</h3>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    {STRINGS.settingsMore.forgetBody}
                  </p>
                  <a href="/#contact" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">{STRINGS.settingsMore.forgetLink}</a>
                </section>
              </div>
            )}

            {activeTab === 'presets' && (
              <section className="space-y-3" aria-labelledby="settings-template-heading">
                <h3 id="settings-template-heading" className="text-sm font-semibold text-[var(--text-primary)]">{STRINGS.overlays.templatesHeading}</h3>
                <p className="text-xs text-[var(--text-secondary)]">{STRINGS.overlays.templatesIntro}</p>
                {templates.length === 0 && <p className="text-xs text-[var(--text-muted)]">{STRINGS.overlays.templatesNone}</p>}
                {templates.map(template => (
                  <form key={template.id + ':' + template.name} className="flex flex-wrap items-center gap-2 rounded border border-[var(--border-default)] p-2"
                    onSubmit={e => {
                      e.preventDefault();
                      const value = new FormData(e.currentTarget).get('name');
                      if (typeof value === 'string' && value.trim()) onRenameTemplate?.(template.id, value);
                    }}>
                    <label className="min-w-0 flex-1 text-xs text-[var(--text-secondary)]">{STRINGS.overlays.templateNameLabel}
                      <input name="name" defaultValue={template.name} required maxLength={40}
                        aria-label={`${STRINGS.overlays.templateNameLabel}: ${template.name}`}
                        className="mt-1 h-10 w-full rounded border border-[var(--border-default)] bg-[var(--bg-input)] px-2 text-[var(--text-primary)]" />
                    </label>
                    <button type="submit" disabled={!onRenameTemplate} aria-label={`${STRINGS.overlays.templateRename} ${template.name}`}
                      className="min-h-10 rounded border border-[var(--border-default)] px-3 text-xs">{STRINGS.overlays.templateRename}</button>
                    <button type="button" disabled={!onDeleteTemplate} aria-label={`${STRINGS.overlays.templateDelete} ${template.name}`}
                      className="min-h-10 rounded px-3 text-xs text-[var(--status-danger,#e5484d)]"
                      onClick={() => onDeleteTemplate?.(template.id)}>{STRINGS.overlays.templateDelete}</button>
                  </form>
                ))}
              </section>
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
                  value={language}
                  aria-label={STRINGS.settings.language.label}
                  onChange={(e) => chooseLanguage(e.target.value as LanguageCode)}
                  className="h-10 w-full max-w-xs rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
                >
                  {LANGUAGES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.nativeName}{option.status === 'source' ? STRINGS.settings.language.defaultSuffix : option.status === 'draft' ? STRINGS.settings.language.draftSuffix : ''}
                    </option>
                  ))}
                </select>
                {languageOption(language).status === 'draft' && (
                  <p className="text-xs text-[var(--text-secondary)]">{STRINGS.settings.language.draftNote}</p>
                )}
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
        aria-label={title}
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
