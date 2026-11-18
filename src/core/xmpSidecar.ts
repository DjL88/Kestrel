import type { PhotoEdit } from './photoEdits';
import type { PhotoFraming } from './photoFraming';
import type { PhotoFrame } from './types';

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Generates an Adobe/ISO-compatible non-destructive XMP sidecar file containing
 * ratings, tags/species, crop/rotation, Camera Raw compatible approximations, and
 * Kestrel's full lossless JSON recipe payload.
 */
export function buildXmpSidecar(
  frame: Pick<PhotoFrame, 'filename' | 'decision' | 'rating' | 'tags' | 'subjectNames' | 'edit' | 'framing'>,
): string {
  const edit: PhotoEdit = frame.edit ?? { exposure: 0, warmth: 0, colour: 0 };
  const framing: PhotoFraming | undefined = frame.framing;
  const tags = Array.from(new Set([...(frame.tags ?? []), ...(frame.subjectNames ?? [])].filter(Boolean)));
  const rating = frame.decision === 'reject' ? -1 : (frame.rating ?? 0);
  const label = frame.decision === 'keep' ? 'Green' : frame.decision === 'reject' ? 'Red' : '';
  const exposureEv = (edit.exposure * 0.4).toFixed(2);
  const contrast = Math.round((edit.contrast ?? 0) * 50);
  const highlights = Math.round((edit.highlights ?? 0) * 50);
  const shadows = Math.round((edit.shadows ?? 0) * 50);
  const whites = Math.round((edit.whites ?? 0) * 50);
  const blacks = Math.round((edit.blacks ?? 0) * 50);
  const vibrance = Math.round((edit.vibrance ?? 0) * 50);
  const saturation = edit.colour === -2 ? -100 : Math.round(edit.colour * 50);
  const clarity = Math.round((edit.clarity ?? 0) * 50);
  const texture = Math.round((edit.texture ?? 0) * 50);
  const sharpness = Math.round((edit.sharpen ?? 0) * 50);
  const denoise = Math.round((edit.denoise ?? 0) * 50);
  const tint = Math.round((edit.tint ?? 0) * 50);

  const tagItems = tags.map((tag) => `          <rdf:li>${escapeXml(tag)}</rdf:li>`).join('\n');
  const cropAttrs = framing && (framing.ratio !== null || framing.straighten !== 0 || framing.size !== 1)
    ? `\n      crs:HasCrop="True"\n      crs:CropAngle="${framing.straighten.toFixed(2)}"\n      crs:CropWidth="${(framing.size ?? 1).toFixed(4)}"`
    : '';
  const recipeJson = escapeXml(JSON.stringify({ edit, framing }));

  return `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Kestrel Photo Studio">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmlns:kestrel="https://kestrel.app/ns/1.0/"
      xmp:CreatorTool="Kestrel Photo Studio"
      xmp:Rating="${rating}"${label ? `\n      xmp:Label="${label}"` : ''}
      crs:Version="15.0"
      crs:ProcessVersion="11.0"
      crs:Exposure2012="${exposureEv}"
      crs:Tint="${tint}"
      crs:Contrast2012="${contrast}"
      crs:Highlights2012="${highlights}"
      crs:Shadows2012="${shadows}"
      crs:Whites2012="${whites}"
      crs:Blacks2012="${blacks}"
      crs:Clarity2012="${clarity}"
      crs:Texture="${texture}"
      crs:Vibrance="${vibrance}"
      crs:Saturation="${saturation}"
      crs:Sharpness="${sharpness}"
      crs:ColorNoiseReduction="${denoise}"${cropAttrs}
      kestrel:RecipeJson="${recipeJson}">
${tags.length ? `      <dc:subject>\n        <rdf:Bag>\n${tagItems}\n        </rdf:Bag>\n      </dc:subject>` : ''}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}
