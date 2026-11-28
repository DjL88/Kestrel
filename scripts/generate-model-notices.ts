/** Regenerates docs/notices/THIRD-PARTY-MODELS.md from models/licences.json. Run: npm run models:notices */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderNotices, type LicenceRegistry } from '../src/core/modelLicences.ts';

const registry = JSON.parse(readFileSync('models/licences.json', 'utf8')) as LicenceRegistry;
writeFileSync('docs/notices/THIRD-PARTY-MODELS.md', renderNotices(registry));
console.log('Wrote docs/notices/THIRD-PARTY-MODELS.md');
