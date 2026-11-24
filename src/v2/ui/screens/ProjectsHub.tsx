import React, { useEffect, useId, useRef, useState } from 'react';
import type { HubViewState, Project, ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon, { BrandLogo } from '../icons/BrandIcon';
import footerKiteDark from '../../../assets/brand/mark/inflight-kite-dark.svg';
import footerKiteLight from '../../../assets/brand/mark/inflight-kite-light.svg';

interface ProjectsHubProps {
  projects: Project[];
  hubState: HubViewState;
  theme: ThemeMode;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string, kind?: 'photography' | 'collage') => void;
  onCreateFromFolder: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onArchiveProject: (projectId: string, archived: boolean) => void;
  onDeleteProject: (projectId: string) => void;
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
  onCreateFromFolder,
  onRenameProject,
  onArchiveProject,
  onDeleteProject,
  onOpenSettings,
  onToggleTheme,
  onSetHubState,
}: ProjectsHubProps) {
  const footerLogo = theme === 'dark' ? footerKiteDark : footerKiteLight;
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<ProjectSort>('edited');
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectKind, setProjectKind] = useState<'photography' | 'collage'>('photography');

  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const archivedCount = projects.filter((p) => p.archived).length;

  const filtered = projects
    .filter((p) => Boolean(p.archived) === showArchived)
    .filter((p) => `${p.name} ${p.folderPath}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : sortBy === 'photos' ? b.photoCount - a.photoCount
      : sortBy === 'flagged' ? b.flaggedCount - a.flaggedCount
      : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    onCreateProject(projectName, projectKind);
    setProjectName('');
    setModalOpen(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-app)]">
      {/* Clean 3-zone header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 sm:gap-6 sm:px-6 md:px-10">
        <div className="flex items-center shrink-0">
          <BrandLogo height={44} />
        </div>

        <nav className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
          <button type="button" aria-label={STRINGS.settings.heading} onClick={onOpenSettings}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
            <BrandIcon name="settings" size={17} /><span className="hidden sm:inline">{STRINGS.settings.heading}</span>
          </button>
        </nav>
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

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1 sm:flex-none">
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
                  className="h-10 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] pl-9 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
              </div>
              <SortMenu value={sortBy} onChange={setSortBy} />
              <button type="button" onClick={() => setModalOpen(true)}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]">
                <BrandIcon name="plus" size={15}/>{STRINGS.hub.newProject}
              </button>
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

          {hubState === 'ready' && (archivedCount > 0 || showArchived) && (
            <div className="mb-4 flex items-center gap-3">
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)]"
              >
                {showArchived ? STRINGS.topBar.backToProjects : STRINGS.hubMore.archived(archivedCount)}
              </button>
              {showArchived && <span className="text-xs text-[var(--text-muted)]">{STRINGS.hubMore.archivedNote}</span>}
            </div>
          )}
          {hubState === 'ready' && filtered.length === 0 && showArchived && (
            <p className="text-sm text-[var(--text-muted)]">{STRINGS.hubMore.nothingArchived}</p>
          )}
          {hubState === 'ready' && filtered.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((project) => (
                <article
                  key={project.id}
                  className="group flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] transition-colors hover:border-[var(--brand-accent-border)]"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--bg-canvas)] text-left"
                  >
                    {project.coverUrl && !failedCovers.includes(project.id) ? (
                      <img src={project.coverUrl} alt={STRINGS.hubMore.coverAlt(project.name)}
                        referrerPolicy="no-referrer" onError={() => setFailedCovers((ids) => ids.includes(project.id) ? ids : [...ids, project.id])}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <span className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-secondary)]">
                        <BrandIcon name="folder-open" size={30}/>
                        <span className="text-xs">{STRINGS.hubMore.coverUnavailable}</span>
                      </span>
                    )}
                  </button>
                  <div className="flex flex-1 flex-col justify-between p-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="text-left text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--brand-accent)] transition-colors"
                      >
                        {project.name}
                      </button>
                      <p className="mt-1.5 text-xs text-[var(--text-secondary)] tabular-nums">
                        {project.kind === 'collage' ? 'Collage · ' : ''}{STRINGS.hub.photosCount(project.photoCount)} ·{' '}
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
                          {project.localCopyStatus === 'synced' ? STRINGS.hubMore.synced : STRINGS.hubMore.offlineReady}
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
                      <div className="relative">
                        <button
                          type="button"
                          aria-label={STRINGS.hubMore.actionsFor(project.name)}
                          aria-haspopup="menu"
                          aria-expanded={menuFor === project.id}
                          onClick={() => setMenuFor(menuFor === project.id ? null : project.id)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)]"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                        </button>
                        {menuFor === project.id && (
                          <div role="menu" aria-label={STRINGS.hubMore.actionsMenu} className="absolute bottom-11 right-0 z-30 w-44 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] py-1 shadow-[var(--shadow-popover)]">
                            <button type="button" role="menuitem" className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]" onClick={() => { setMenuFor(null); setRenaming({ id: project.id, name: project.name }); }}>{STRINGS.hubMore.rename}</button>
                            <button type="button" role="menuitem" className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)]" onClick={() => { setMenuFor(null); onArchiveProject(project.id, !project.archived); }}>{project.archived ? STRINGS.hubMore.restore : STRINGS.hubMore.archive}</button>
                            <button type="button" role="menuitem" className="flex min-h-10 w-full items-center px-3 text-left text-xs text-[var(--status-danger,#e5484d)] hover:bg-[var(--bg-surface-hover)]" onClick={() => { setMenuFor(null); setDeleting(project); }}>{STRINGS.hubMore.deleteMenu}</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
      <footer className="flex min-h-[56px] shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3 text-xs text-[var(--text-secondary)] sm:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <img
            src={footerLogo}
            alt=""
            aria-hidden="true"
            width={72}
            height={32}
            className="h-7 w-[62px] shrink-0 object-contain sm:h-8 sm:w-[72px]"
            data-testid="inflight-footer-kite"
          />
          <span className="font-semibold text-[var(--text-primary)]">InFlight</span>
          <a href="/privacy.html" className="underline-offset-2 hover:underline">{STRINGS.hub.privacyLink}</a>
        </div>
        <button type="button" onClick={onToggleTheme} aria-label={theme === 'dark' ? STRINGS.hubMore.switchToLight : STRINGS.hubMore.switchToDark}
          className="inline-flex min-h-10 items-center gap-2 rounded-[var(--radius-md)] px-2 hover:bg-[var(--bg-surface-hover)]">
          <BrandIcon name={theme === 'dark' ? 'theme-light' : 'theme-dark'} size={16}/>
          {theme === 'dark' ? STRINGS.hubMore.lightMode : STRINGS.hubMore.darkMode}
        </button>
      </footer>

      {/* Create Project Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-proj-title"
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--bg-scrim)] p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <form
            onSubmit={handleCreate}
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]"
          >
            <h2 id="create-proj-title" className="text-base font-bold text-[var(--text-primary)]">
              {STRINGS.hub.modalTitle}
            </h2>
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-[var(--text-secondary)]">{STRINGS.hub.kindQuestion}</legend>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {([
                  ['photography', STRINGS.hub.kindPhotoShootTitle, STRINGS.hub.kindPhotoShootBody],
                  ['collage', STRINGS.hub.kindCollageTitle, STRINGS.hub.kindCollageBody],
                ] as const).map(([kind, title, description]) => {
                  const selected = projectKind === kind;
                  return (
                    <label key={kind} data-testid={`project-kind-${kind}`}
                      className={`relative flex cursor-pointer flex-col gap-2 rounded-[var(--radius-lg)] border-2 p-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--brand-accent)] focus-within:ring-offset-1 focus-within:ring-offset-[var(--bg-surface)] ${selected ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]' : 'border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)]'}`}>
                      <input type="radio" className="sr-only" name="project-kind" value={kind} checked={selected}
                        onChange={() => setProjectKind(kind)} />
                      <ProjectKindPicture kind={kind} selected={selected} />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
                      <span className="block text-xs leading-snug text-[var(--text-secondary)]">{description}</span>
                      {selected && (
                        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--brand-accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-on-accent)]">
                          <BrandIcon name="check" size={11} />{STRINGS.hub.kindSelected}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
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
            <button
              type="button"
              onClick={() => { setModalOpen(false); onCreateFromFolder(); }}
              disabled={projectKind === 'collage'}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] text-xs font-medium text-[var(--text-primary)]"
            >
              <BrandIcon name="folder" size={16} />
              <span>{STRINGS.hubMore.fromFolder}</span>
            </button>
            <p className="text-[11px] leading-snug text-[var(--text-muted)]">{STRINGS.hubMore.fromFolderNote}</p>
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
      {renaming && (
        <div role="dialog" aria-modal="true" aria-labelledby="rename-proj-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4">
          <form
            onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) { onRenameProject(renaming.id, renaming.name); setRenaming(null); } }}
            className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]"
          >
            <h2 id="rename-proj-title" className="text-base font-bold text-[var(--text-primary)]">{STRINGS.hubMore.renameTitle}</h2>
            <label htmlFor="rename-proj-name" className="sr-only">{STRINGS.hub.modalNameLabel}</label>
            <input id="rename-proj-name" type="text" autoFocus required value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} className="h-11 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)]" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-secondary)]">{STRINGS.hub.modalCancel}</button>
              <button type="submit" className="min-h-10 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]">{STRINGS.hubMore.rename}</button>
            </div>
          </form>
        </div>
      )}
      {deleting && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="delete-proj-title" aria-describedby="delete-proj-body" className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-4">
          <div className="w-full max-w-md space-y-4 rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-[var(--shadow-panel)]">
            <h2 id="delete-proj-title" className="text-base font-bold text-[var(--text-primary)]">{STRINGS.hubMore.deleteTitle(deleting.name)}</h2>
            <p id="delete-proj-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {STRINGS.hubMore.deleteBody}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setDeleting(null)} className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">{STRINGS.hubMore.keepProject}</button>
              <button type="button" onClick={() => { onDeleteProject(deleting.id); setDeleting(null); }} className="min-h-10 rounded-[var(--radius-md)] bg-[var(--status-danger,#e5484d)] px-4 text-xs font-semibold text-white">{STRINGS.hubMore.deleteProject}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A small picture of what each kind of project makes, so the choice reads at a glance:
 * a row of separate frames for a photo shoot, one page laid out with several photos for a collage or album.
 * Drawn in the theme's own colours, so it suits light and dark.
 */
function ProjectKindPicture({ kind, selected }: { kind: 'photography' | 'collage'; selected: boolean }) {
  const stroke = selected ? 'var(--brand-accent)' : 'var(--text-muted)';
  const fill = selected ? 'var(--brand-accent)' : 'var(--text-muted)';
  return (
    <svg viewBox="0 0 120 56" aria-hidden="true" className="h-14 w-full rounded-[var(--radius-md)] bg-[var(--bg-input)]" preserveAspectRatio="xMidYMid meet">
      {kind === 'photography' ? (
        <g fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
          {[10, 44, 78].map((x, i) => (
            <g key={x} opacity={i === 1 ? 1 : 0.6}>
              <rect x={x} y="12" width="32" height="24" rx="2" />
              <path d={`M${x + 3} 33 l8 -9 6 6 4 -4 8 7`} />
              <circle cx={x + 24} cy="18" r="2" fill={fill} stroke="none" />
            </g>
          ))}
          <path d="M10 44 h100" strokeDasharray="3 3" opacity="0.5" />
          <path d="M56 41 l4 4 8 -8" strokeWidth="2" />
        </g>
      ) : (
        <g fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
          <rect x="30" y="4" width="60" height="48" rx="2" />
          <rect x="35" y="9" width="28" height="22" rx="1" fill={fill} fillOpacity="0.25" />
          <rect x="66" y="9" width="19" height="10" rx="1" fill={fill} fillOpacity="0.4" />
          <rect x="66" y="22" width="19" height="9" rx="1" fill={fill} fillOpacity="0.25" />
          <rect x="35" y="34" width="50" height="13" rx="1" fill={fill} fillOpacity="0.4" />
        </g>
      )}
    </svg>
  );
}

type ProjectSort = 'edited' | 'name' | 'photos' | 'flagged';

/**
 * The Projects sort control. A native select opens the operating system's own menu, which on Windows ignores the
 * page's theme and shape; this list is drawn in the page's colours instead, and keeps select-like keyboard use:
 * Enter, Space or the arrow keys open it, the arrow keys, Home and End move, Enter or Space choose, Escape closes.
 */
function SortMenu({ value, onChange }: { value: ProjectSort; onChange: (value: ProjectSort) => void }) {
  const options: ReadonlyArray<readonly [ProjectSort, string]> = [
    ['edited', STRINGS.hub.sortEdited],
    ['name', STRINGS.hub.sortName],
    ['photos', STRINGS.hub.sortPhotos],
    ['flagged', STRINGS.hub.sortFlagged],
  ];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex(([key]) => key === value));

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const show = () => { setActive(selectedIndex); setOpen(true); };
  const choose = (index: number) => {
    onChange(options[index][0]);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <span id={`${id}-label`} className="sr-only">{STRINGS.hub.sortProjects}</span>
      <button
        ref={buttonRef}
        type="button"
        id="project-sort"
        data-testid="project-sort"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
        }}
        className={`inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] pl-3 pr-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] ${open ? 'border-[var(--brand-accent)]' : 'border-[var(--border-default)]'}`}
      >
        <BrandIcon name="sort" size={14} />
        <span id={`${id}-value`} className="whitespace-nowrap">{options[selectedIndex][1]}</span>
        <BrandIcon name="chevron-down" size={14} />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={(event) => {
            const last = options.length - 1;
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(last, i + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
            else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
            else if (event.key === 'End') { event.preventDefault(); setActive(last); }
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
            else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
          }}
          className="absolute right-0 top-full z-40 mt-1 min-w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 text-xs text-[var(--text-primary)] shadow-[var(--shadow-popover)] focus:outline-none"
        >
          {options.map(([key, label], index) => {
            const selected = key === value;
            return (
              <li
                key={key}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={selected}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex min-h-9 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-2 ${index === active ? 'bg-[var(--bg-surface-hover)]' : ''} ${selected ? 'font-semibold' : ''}`}
              >
                <span className="inline-flex w-4 justify-center text-[var(--brand-accent)]" aria-hidden="true">{selected ? <BrandIcon name="check" size={13} /> : null}</span>
                {label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
