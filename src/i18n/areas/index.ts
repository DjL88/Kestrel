import type { AreaEntry } from '../localise';
import { aiReviewArea } from './aiReview';
import { appArea } from './app';
import { colourArea } from './colour';
import { editorArea } from './editor';
import { emailArea } from './email';
import { engineArea } from './engine';
import { exportArea } from './export';
import { hdrArea } from './hdr';
import { healArea } from './heal';
import { libraryArea } from './library';
import { livePanelArea } from './livePanel';
import { looksArea } from './looks';
import { panoArea } from './pano';
import { workflowArea } from './workflow';
import { photoTagsArea } from './photoTags';
import { previewArea } from './preview';
import { speciesAreaArea } from './speciesArea';
import { stackArea } from './stack';
import { projectsArea } from './projects';
import { v2Area } from './v2';
import { vehiclesArea } from './vehicles';
import { verificationArea } from './verification';
import { viewerArea } from './viewer';
import { welcomeArea } from './welcome';

/**
 * Every area of the app's words, for the completeness tests in `src/core/locale.test.ts`. Each area lives in its own
 * folder: `source.ts` (British English), one file per language, and `index.ts`, which exports the area's words for
 * the session's language and an `AreaEntry`.
 */
export const AREAS: AreaEntry[] = [aiReviewArea, appArea, colourArea, editorArea, emailArea, engineArea, exportArea, hdrArea, healArea, libraryArea, livePanelArea, looksArea, panoArea, photoTagsArea, previewArea, projectsArea, speciesAreaArea, stackArea, v2Area, vehiclesArea, verificationArea, viewerArea, welcomeArea, workflowArea];
