// Firebase Hosting predeploy: ship the open-source notices with the website.
// A script file rather than `node -e "..."`, because Windows shells strip the inner quotes of an inline program.
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
copyFileSync(join(root, 'NOTICE.md'), join(root, 'site', 'open-source-notices.txt'));
