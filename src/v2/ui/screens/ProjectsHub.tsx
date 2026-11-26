import React, { useEffect, useId, useRef, useState } from 'react';
import type { AssistMode, HubViewState, Project, ThemeMode } from '../contract';
import { STRINGS } from '../strings';
import { useDialogFocus } from '../utils/dialogFocus';
import BrandIcon, { BrandLogo } from '../icons/BrandIcon';
import { useIsPro } from '../../../components/BrandLogo';
import { LayoutToggle, ProjectRow, ProjectTile, readHubLayout, saveHubLayout, type HubLayout } from './ProjectCards';
import { footerKiteLogo } from '../footerKiteLogo';
import { POLICY_PATHS, SiteLink } from '../../../components/SiteLink';
import WelcomeCard from './WelcomeCard';
import FlightModePicker from '../panels/FlightModePicker';

interface ProjectsHubProps {
  projects: Project[];
  hubState: HubViewState;
  theme: ThemeMode;
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string, kind?: 'photography' | 'collage', mode?: AssistMode) => void;
  /** The Flight mode a new project starts in (Settings → Assistance); the person can pick another when creating it. */
  defaultAssistMode?: AssistMode;
  onCreateFromFolder: () => void;
  /** First run: pick photos and get an Auto-edited photo ready to export. */
  onQuickStart?: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  /** A .kestrel.json backup becomes a new project. */
  onRestoreBackup?: (file: File) => void;
  onArchiveProject: (projectId: string, archived: boolean) => void;
  /** Moves the project to Recently deleted (kept 30 days). */
  onDeleteProject: (projectId: string) => void;
  onRestoreDeletedProject?: (projectId: string) => void;
  /** Removes a project in Recently deleted for good, after its own confirmation. */
  onDeleteProjectForever?: (projectId: string) => void;
  /** Makes a separate copy of the project, shown as a task in Tasks. */
  onDuplicateProject?: (projectId: string) => void;
  onOpenSettings: () => void;
  /** Top right: who is signed in (or a Sign in button), opening Settings → Account. Left out when sign-in is not built. */
  account?: React.ReactNode;
  onToggleTheme: () => void;
  onSetHubState: (state: HubViewState) => void;
}

export default function ProjectsHub({
  projects,
  hubState,
  theme,
  onOpenProject,
  onCreateProject,
  defaultAssistMode = 'copilot',
  onCreateFromFolder,
  onQuickStart,
  onRenameProject,
  onRestoreBackup,
  onArchiveProject,
  onDeleteProject,
  onRestoreDeletedProject,
  onDeleteProjectForever,
  onDuplicateProject,
  onOpenSettings,
  account,
  onToggleTheme,
  onSetHubState,
}: ProjectsHubProps) {
  const isPro = useIsPro();
  const footerLogo = footerKiteLogo(theme, isPro);
  const [search, setSearch] = useState('');
  const [layout, setLayout] = useState<HubLayout>(readHubLayout);
  const chooseLayout = (next: HubLayout) => { setLayout(next); saveHubLayout(next); };
  const [sortBy, setSortBy] = useState<ProjectSort>('edited');
  const [failedCovers, setFailedCovers] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const createPanel = useRef<HTMLFormElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const onCreateDialogKeyDown = useDialogFocus(modalOpen, createPanel, () => setModalOpen(false));
  const [projectKind, setProjectKind] = useState<'photography' | 'collage'>('photography');
  const [projectMode, setProjectMode] = useState<AssistMode>(defaultAssistMode);
  const openCreate = () => { setProjectMode(defaultAssistMode); setModalOpen(true); };

  const [view, setView] = useState<'projects' | 'archived' | 'deleted'>('projects');
  const showArchived = view === 'archived';
  const showDeleted = view === 'deleted';
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const archivedCount = projects.filter((p) => p.archived && !p.trashed).length;
  const deletedCount = projects.filter((p) => p.trashed).length;
  // Deleting forever is offered only where it can be confirmed; without it, deleted projects simply wait out their 30 days.
  const canEmpty = Boolean(onDeleteProjectForever);

  const filtered = projects
    .filter((p) => showDeleted ? Boolean(p.trashed) : !p.trashed && Boolean(p.archived) === showArchived)
    .filter((p) => `${p.name} ${p.folderPath}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : sortBy === 'photos' ? b.photoCount - a.photoCount
      : sortBy === 'flagged' ? b.flaggedCount - a.flaggedCount
      : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    onCreateProject(projectName, projectKind, projectMode);
    setProjectName('');
    setModalOpen(false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-app)]">
      {/* Clean 3-zone header */}
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 sm:gap-6 sm:px-6 md:px-10">
        <div className="flex items-center shrink-0">
          <BrandLogo height={44} pro={isPro} light={theme === 'light'} />
        </div>

        <nav className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
          {onRestoreBackup && (
            <>
              <input ref={backupInputRef} type="file" accept=".json,application/json" hidden data-testid="restore-backup-input"
                onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onRestoreBackup(file); }} />
              <button type="button" onClick={() => backupInputRef.current?.click()} title={STRINGS.backup.restore} aria-label={STRINGS.backup.restore}
                className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
                <BrandIcon name="restore" size={17} /><span className="hidden sm:inline">{STRINGS.backup.restore}</span>
              </button>
            </>
          )}
          <button type="button" aria-label={STRINGS.settings.heading} onClick={onOpenSettings}
            className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-2 hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--brand-accent)]">
            <BrandIcon name="settings" size={17} /><span className="hidden sm:inline">{STRINGS.settings.heading}</span>
          </button>
          {account}
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
              <LayoutToggle value={layout} onChange={chooseLayout} />
              <button type="button" onClick={openCreate}
                className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-3 text-xs font-semibold text-[var(--text-on-accent)] hover:bg-[var(--brand-accent-hover)]">
                <BrandIcon name="plus" size={15}/>{STRINGS.hub.newProject}
              </button>
            </div>
          </div>

          {/* First run only: three plain facts, then never again on this device. */}
          <WelcomeCard />

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
                onClick={openCreate}
                className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]"
              >
                <BrandIcon name="plus" size={14} />
                <span>{STRINGS.hub.newProject}</span>
              </button>
              {onQuickStart && projects.length === 0 ? (
                <div className="mt-6 max-w-md border-t border-[var(--border-subtle)] pt-5">
                  <button
                    type="button"
                    onClick={onQuickStart}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-primary)]"
                  >
                    <BrandIcon name="assist" size={14} />
                    <span>{STRINGS.quickStart.hubButton}</span>
                  </button>
                  <p className="mt-2 text-xs text-[var(--text-secondary)]">{STRINGS.quickStart.hubHint}</p>
                </div>
              ) : null}
            </div>
          )}

          {hubState === 'ready' && (archivedCount > 0 || deletedCount > 0 || view !== 'projects') && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {view !== 'projects' ? (
                <button type="button" onClick={() => setView('projects')}
                  className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)]">
                  {STRINGS.topBar.backToProjects}
                </button>
              ) : (
                <>
                  {archivedCount > 0 && (
                    <button type="button" onClick={() => setView('archived')}
                      className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)]">
                      {STRINGS.hubMore.archived(archivedCount)}
                    </button>
                  )}
                  {deletedCount > 0 && (
                    <button type="button" onClick={() => setView('deleted')} data-testid="hub-recently-deleted"
                      className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-medium text-[var(--text-secondary)]">
                      {STRINGS.hubMore.deletedList(deletedCount)}
                    </button>
                  )}
                </>
              )}
              {showArchived && <span className="text-xs text-[var(--text-muted)]">{STRINGS.hubMore.archivedNote}</span>}
              {showDeleted && <span className="text-xs text-[var(--text-muted)]">{STRINGS.hubMore.deletedNote}</span>}
            </div>
          )}
          {hubState === 'ready' && filtered.length === 0 && showArchived && (
            <p className="text-sm text-[var(--text-muted)]">{STRINGS.hubMore.nothingArchived}</p>
          )}
          {hubState === 'ready' && filtered.length === 0 && showDeleted && (
            <p className="text-sm text-[var(--text-muted)]">{STRINGS.hubMore.nothingDeleted}</p>
          )}
          {hubState === 'ready' && filtered.length > 0 && (
            <ul aria-label={STRINGS.hub.heading} data-project-layout={layout}
              // List rows sit two across from tablet-landscape width and three on very wide screens; phones keep one column.
              className={layout === 'list' ? 'grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6'}>
              {filtered.map((project) => {
                const Card = layout === 'list' ? ProjectRow : ProjectTile;
                return (
                  <Card
                    key={project.id}
                    project={project}
                    coverFailed={failedCovers.includes(project.id)}
                    onCoverError={() => setFailedCovers((ids) => ids.includes(project.id) ? ids : [...ids, project.id])}
                    menuOpen={menuFor === project.id}
                    onToggleMenu={() => setMenuFor(menuFor === project.id ? null : project.id)}
                    // A deleted project is not opened: its card offers Restore and Delete forever instead.
                    onOpen={() => project.trashed ? setMenuFor(project.id) : onOpenProject(project.id)}
                    onRename={() => { setMenuFor(null); setRenaming({ id: project.id, name: project.name }); }}
                    onArchive={() => {
                      setMenuFor(null);
                      if (project.trashed) onRestoreDeletedProject?.(project.id);
                      else onArchiveProject(project.id, !project.archived);
                    }}
                    onDelete={() => { setMenuFor(null); if (!project.trashed || canEmpty) setDeleting(project); }}
                    onDuplicate={onDuplicateProject ? () => { setMenuFor(null); onDuplicateProject(project.id); } : undefined}
                  />
                );
              })}
            </ul>
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
          <span className="font-semibold text-[var(--text-primary)]">{isPro ? 'InFlight Pro' : 'InFlight'}</span>
          <SiteLink path={POLICY_PATHS.privacy} className="underline-offset-2 hover:underline">{STRINGS.hub.privacyLink}</SiteLink>
          <SiteLink path={POLICY_PATHS.terms} className="underline-offset-2 hover:underline">{STRINGS.hub.termsLink}</SiteLink>
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
          onKeyDown={onCreateDialogKeyDown}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-scrim)] p-2 sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <form
            ref={createPanel}
            tabIndex={-1}
            onSubmit={handleCreate}
            className="flex max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-panel)] sm:max-h-[calc(100dvh-2rem)]"
          >
            <h2 id="create-proj-title" className="shrink-0 px-4 py-3 text-base font-bold text-[var(--text-primary)] sm:px-6">
              {STRINGS.hub.modalTitle}
            </h2>
            <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6">
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
                          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--brand-accent)] px-2 py-0.5 text-[0.625rem] font-semibold text-[var(--text-on-accent)]">
                            <BrandIcon name="check" size={11} />{STRINGS.hub.kindSelected}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <div className="space-y-1">
                <FlightModePicker name="new-project-flight-mode" label={STRINGS.hub.modeQuestion}
                  value={projectMode} onChange={setProjectMode} />
                <p className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">{STRINGS.hub.modeChangeLater}</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="new-proj-name" className="text-xs font-medium text-[var(--text-secondary)]">
                  {STRINGS.hub.modalNameLabel}
                </label>
                <input
                  id="new-proj-name"
                  type="text"
                  required
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={STRINGS.hub.modalNamePlaceholder}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-input)] px-3 text-base text-[var(--text-primary)] sm:text-sm"
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
              <p className="text-[0.6875rem] leading-snug text-[var(--text-muted)]">{STRINGS.hubMore.fromFolderNote}</p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-2 sm:px-6">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-11 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-secondary)]"
              >
                {STRINGS.hub.modalCancel}
              </button>
              <button
                type="submit"
                className="min-h-11 rounded-[var(--radius-md)] bg-[var(--brand-accent)] px-4 text-xs font-semibold text-[var(--text-on-accent)]"
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
            <h2 id="delete-proj-title" className="text-base font-bold text-[var(--text-primary)]">
              {deleting.trashed ? STRINGS.hubMore.deleteForeverTitle(deleting.name) : STRINGS.hubMore.deleteTitle(deleting.name)}
            </h2>
            <p id="delete-proj-body" className="text-sm leading-relaxed text-[var(--text-secondary)]">
              {deleting.trashed ? STRINGS.hubMore.deleteForeverBody : STRINGS.hubMore.deleteBody}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setDeleting(null)} className="min-h-10 rounded-[var(--radius-md)] border border-[var(--border-default)] px-4 text-xs font-medium text-[var(--text-primary)]">{STRINGS.hubMore.keepProject}</button>
              <button type="button"
                onClick={() => { if (deleting.trashed) onDeleteProjectForever?.(deleting.id); else onDeleteProject(deleting.id); setDeleting(null); }}
                className="min-h-10 rounded-[var(--radius-md)] bg-[var(--status-danger,#e5484d)] px-4 text-xs font-semibold text-white">
                {deleting.trashed ? STRINGS.hubMore.deleteForever : STRINGS.hubMore.deleteProject}
              </button>
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
  // One key handler for the open list, whichever of the button or the list has focus: the list takes focus only after
  // it has drawn, and a quick second key must still move the highlight rather than reopen the list.
  const onListKey = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(last, i + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(last); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active); }
    else if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
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
          if (open) onListKey(event);
          else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
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
          onKeyDown={onListKey}
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
                // Only a pointer that actually moves takes the highlight: a list opened under a resting pointer keeps the keyboard's place.
                onPointerMove={(event) => { if (event.movementX || event.movementY) setActive(index); }}
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
