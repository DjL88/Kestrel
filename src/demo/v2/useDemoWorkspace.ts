import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceActions, WorkspaceStore } from '../../v2/ui/contract';
import { useEngineWorkspace } from '../../v2/engineClient/useEngineWorkspace';
import { fetchDemoFiles, loadDemoPhotos } from './demoPhotos';

const DEMO_PROJECT = 'InFlight demo';
const NOTICE = 'This is a demonstration with fixed photographs. Importing, exporting and your own projects are in the InFlight app.';

/** Actions that would touch the visitor's own files, accounts or projects. In the demo they do nothing but say so. */
const LOCKED: ReadonlyArray<keyof WorkspaceActions> = [
  'backToProjects', 'createProject', 'createProjectFromFolder', 'renameProject', 'archiveProject', 'deleteProject',
  'importPhotos', 'importFolder', 'importDroppedPhotos', 'removePhotos', 'reconnectOriginal', 'setExportOpen', 'runExport',
  'importWatermarkImage', 'eraseDeviceData', 'signInStub', 'signOutStub', 'toggleAiProvider', 'toggleStorageConnector',
  'runDeepVisionReview', 'denoisePhoto', 'runAutoCull',
];

/**
 * The real Version 2 workspace and engine, opened on a fixed set of photographs. It uses the visitor's own browser
 * catalogue (nothing is uploaded; nothing reaches the owner), opens or makes one project called "InFlight demo", and
 * adds the fixed photos to it once. Everything that edits the picture works as in the app.
 */
export function useDemoWorkspace(): { store: WorkspaceStore; actions: WorkspaceActions } {
  const { store, actions } = useEngineWorkspace();
  const [notice, setNotice] = useState<string | null>(null);
  const step = useRef<'start' | 'creating' | 'importing' | 'done'>('start');
  const real = useRef(actions);
  real.current = actions;

  const say = useCallback(() => { setNotice(NOTICE); window.setTimeout(() => setNotice(null), 5000); }, []);

  useEffect(() => {
    if (step.current === 'start' && store.screen === 'hub' && (store.hubState === 'ready' || store.hubState === 'empty')) {
      const existing = store.projects.find((project) => project.name === DEMO_PROJECT && !project.archived);
      step.current = existing ? 'done' : 'creating';
      if (existing) real.current.openProject(existing.id);
      else real.current.createProject(DEMO_PROJECT);
    }
    if (step.current === 'creating' && store.screen === 'editor') {
      step.current = 'importing';
      void (async () => {
        const files = await fetchDemoFiles(await loadDemoPhotos());
        if (files.length) real.current.importDroppedPhotos(files);
        step.current = 'done';
      })();
    }
  }, [store.screen, store.hubState, store.projects]);

  const locked = useMemo(() => {
    const overrides: Partial<WorkspaceActions> = {};
    for (const name of LOCKED) (overrides as Record<string, unknown>)[name] = () => { say(); };
    return overrides;
  }, [say]);

  const merged = useMemo(() => ({
    store: { ...store, lastActionNotice: notice ?? store.lastActionNotice },
    actions: { ...actions, ...locked } as WorkspaceActions,
  }), [store, actions, locked, notice]);
  return merged;
}
