import type { AreaEntry } from '../localise';
import { aiReviewArea } from './aiReview';
import { appArea } from './app';
import { colourArea } from './colour';
import { editorArea } from './editor';
import { emailArea } from './email';
import { engineArea } from './engine';
import { exportArea } from './export';
import { healArea } from './heal';
import { libraryArea } from './library';
import { photoTagsArea } from './photoTags';
import { speciesAreaArea } from './speciesArea';
import { stackArea } from './stack';
import { projectsArea } from './projects';
import { v2Area } from './v2';
import { vehiclesArea } from './vehicles';
import { viewerArea } from './viewer';

/**
 * Every area of the app's words, for the completeness tests in `src/core/locale.test.ts`. Each area lives in its own
 * folder: `source.ts` (British English), one file per language, and `index.ts`, which exports the area's words for
 * the session's language and an `AreaEntry`.
 */
export const AREAS: AreaEntry[] = [aiReviewArea, appArea, colourArea, editorArea, emailArea, engineArea, exportArea, healArea, libraryArea, photoTagsArea, projectsArea, speciesAreaArea, stackArea, v2Area, vehiclesArea, viewerArea];
