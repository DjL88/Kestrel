/** Pure proof selection: no pixels, original files or network touched. */
export type ProofDestination = { id: string; label: string; width: number; height: number };
export type SubjectEvidence = { label: string; source: 'user' | 'verified-local-model'; confidence?: number; verified?: boolean };
export type ProofPlan = Readonly<{ photoIds: readonly string[]; destinations: readonly ProofDestination[]; selectedPhotoId: string; selectedDestinationId: string; subject: string; metadata: Readonly<Record<string,string>>; showLocation: boolean }>;
const clean = (v: string, max=240) => v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const privateKey = (key: string) => /^(gps|latitude|longitude|location|serial|owner|deviceid|artistaddress|contact)/i.test(key.replace(/[\s_-]/g,''));
export function evidencedSubject(e?: SubjectEvidence): string {
  if (!e) return '';
  if (e.source === 'user') return clean(e.label);
  return e.source === 'verified-local-model' && e.verified === true && typeof e.confidence === 'number' && Number.isFinite(e.confidence) && e.confidence >= 0.9 ? clean(e.label) : '';
}
export function createProofPlan(input: { photoIds: readonly string[]; destinations: readonly ProofDestination[]; selectedPhotoId?: string; selectedDestinationId?: string; evidence?: SubjectEvidence; metadata?: Record<string,string|undefined>; showLocation?: boolean }): ProofPlan {
  const photos = [...new Set(input.photoIds.map(id => clean(id,512)))].filter(Boolean);
  const destinations = input.destinations.map(d => ({...d,id:clean(d.id,128),label:clean(d.label)}));
  if (!photos.length || !destinations.length) throw new Error('Choose a photo and export destination to preview.');
  if (new Set(destinations.map(d=>d.id)).size !== destinations.length || destinations.some(d=>!d.id || !d.label || !Number.isSafeInteger(d.width) || !Number.isSafeInteger(d.height) || d.width<1 || d.height<1)) throw new Error('Export destinations must have unique names and valid dimensions.');
  const photo = input.selectedPhotoId ?? photos[0], destination = input.selectedDestinationId ?? destinations[0].id;
  if (!photos.includes(photo) || !destinations.some(d=>d.id===destination)) throw new Error('Selected proof photo or destination is unavailable.');
  const metadata: Record<string,string> = {};
  for (const [key,value] of Object.entries(input.metadata ?? {})) if (typeof value==='string' && (!privateKey(key) || input.showLocation)) metadata[clean(key,80)]=clean(value,500);
  return Object.freeze({ photoIds:Object.freeze(photos), destinations:Object.freeze(destinations.map(d=>Object.freeze(d))), selectedPhotoId:photo, selectedDestinationId:destination, subject:evidencedSubject(input.evidence), metadata:Object.freeze(metadata), showLocation:input.showLocation===true });
}
export function selectProof(plan: ProofPlan, selection: {photoId?: string; destinationId?: string}): ProofPlan {
  return createProofPlan({photoIds:plan.photoIds,destinations:plan.destinations,selectedPhotoId:selection.photoId??plan.selectedPhotoId,selectedDestinationId:selection.destinationId??plan.selectedDestinationId,evidence:{source:'user',label:plan.subject},metadata:plan.metadata,showLocation:plan.showLocation});
}
export function selectedProofDestination(plan: ProofPlan): ProofDestination {
  const destination=plan.destinations.find(d=>d.id===plan.selectedDestinationId);
  if (!destination) throw new Error('Proof destination no longer exists.');
  return destination;
}
