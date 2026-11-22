import React, { useState } from 'react';
import type { HubViewState, Project, ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { BrandLogo } from '../icons/BrandIcon';

interface ProjectsHubProps {
  projects: Project[];
  hubState: HubViewState;
  theme: ThemeMode;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string) => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
  onSetHubState: (state: HubViewState) => void;
}

export default function ProjectsHub({
  projects,
  hubState,
  theme,
  onOpenProject,
  onCreateProject,
  onOpenSettings,
  onToggleTheme,
  onSetHubState,
}: ProjectsHubProps) {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');

  const filtered = projects.filter((p) =>
    `${p.name} ${p.folderPath}`.toLowerCase().includes(search.trim().toLowerCase())
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    onCreateProject(projectName);
    setProjectName('');
    setModalOpen(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-app)]">
      {/* Clean 3-zone header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-6 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-6 md:px-10">
        <div className="flex items-center shrink-0">
          <BrandLogo height={30} />
        </div>

        <nav className="hidden sm:flex items-center gap-6 text-sm font-medium text-[var(--text-secondary)]">
          <button
            type="button"
            onClick={() => onSetHubState('ready')}
            className="hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
          >
            Library
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="inline-flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
          >
            <BrandIcon name={theme === 'dark' ? 'theme-light' : 'theme-dark'} size={15} />
            <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
          >
            <BrandIcon name="settings" size={15} />
            <span>Settings</span>
          </button>
        </nav>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)] transition-colors hover:bg-[var(--brand-accent-hover)] whitespace-nowrap shrink-0"
        >
          <BrandIcon name="plus" size={15} />
          <span>{STRINGS.hub.newProject}</span>
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto inflight-scroll px-6 py-8 md:px-10">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] md:text-3xl">
                {STRINGS.hub.heading}
              </h1>
              <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                {STRINGS.hub.subheading}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <BrandIcon
                  name="search"
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={STRINGS.hub.searchPlaceholder}
                  aria-label={STRINGS.hub.searchPlaceholder}
                  className="h-10 w-60 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>
          </div>

          {/* Hub States: Loading / Error / Empty / Ready */}
          {hubState === 'loading' && (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center">
              <BrandIcon name="loader" size={28} className="animate-spin text-[var(--brand-accent)]" />
              <h2 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
                {STRINGS.hub.loadingTitle}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{STRINGS.hub.loadingBody}</p>
            </div>
          )}

          {hubState === 'error' && (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--semantic-danger)]/30 bg-[var(--bg-surface)] p-10 text-center">
              <BrandIcon name="alert" size={28} className="text-[var(--semantic-danger)]" />
              <h2 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
                {STRINGS.hub.errorTitle}
              </h2>
              <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
                {STRINGS.hub.errorBody}
              </p>
              <button
                type="button"
                onClick={() => onSetHubState('ready')}
                className="mt-5 h-9 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]"
              >
                {STRINGS.hub.retry}
              </button>
            </div>
          )}

          {(hubState === 'empty' || (hubState === 'ready' && filtered.length === 0)) && (
            <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-10 text-center">
              <BrandIcon name="folder-open" size={28} className="text-[var(--text-muted)]" />
              <h2 className="mt-4 text-sm font-semibold text-[var(--text-primary)]">
                {STRINGS.hub.emptyTitle}
              </h2>
              <p className="mt-1 max-w-md text-xs text-[var(--text-secondary)]">
                {STRINGS.hub.emptyBody}
              </p>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]"
              >
                <BrandIcon name="plus" size={14} />
                <span>{STRINGS.hub.newProject}</span>
              </button>
            </div>
          )}

          {hubState === 'ready' && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((project) => (
                <article
                  key={project.id}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-colors hover:border-[var(--brand-accent-border)]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="relative aspect-[16/10] w-full overflow-hidden bg-[var(--bg-canvas)] text-left"
                  >
                    <img
                      src={project.coverUrl}
                      alt={project.name}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  </button>
                  <div className="flex flex-1 flex-col justify-between p-4">
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="text-left text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--brand-accent)] transition-colors"
                      >
                        {project.name}
                      </button>
                      <p className="mt-1.5 text-xs text-[var(--text-secondary)] tabular-nums">
                        {STRINGS.hub.photosCount(project.photoCount)} ·{' '}
                        {STRINGS.hub.flaggedCount(project.flaggedCount)} · {project.updatedAt}
                      </p>
                      <p className="mt-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                        {project.folderPath}
                      </p>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
                      <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                        <BrandIcon
                          name={project.localCopyStatus === 'synced' ? 'cloud' : 'hard-drive'}
                          size={13}
                          className="text-[var(--semantic-success)]"
                        />
                        <span>
                          {project.localCopyStatus === 'synced' ? 'Local + Cloud synced' : 'Offline ready'}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-accent)] hover:underline"
                      >
                        <span>{STRINGS.hub.openProject}</span>
                        <BrandIcon name="arrow" size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Create Project Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-proj-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]"
          >
            <h2 id="create-proj-title" className="text-base font-bold text-[var(--text-primary)]">
              {STRINGS.hub.modalTitle}
            </h2>
            <div className="space-y-1.5">
              <label htmlFor="new-proj-name" className="text-xs font-medium text-[var(--text-secondary)]">
                {STRINGS.hub.modalNameLabel}
              </label>
              <input
                id="new-proj-name"
                type="text"
                autoFocus
                required
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder={STRINGS.hub.modalNamePlaceholder}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-xs text-[var(--text-primary)]"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="h-9 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-secondary)]"
              >
                {STRINGS.hub.modalCancel}
              </button>
              <button
                type="submit"
                className="h-9 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]"
              >
                {STRINGS.hub.modalCreate}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
