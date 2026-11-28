import { useSliderValue } from '../utils/useSliderValue';
import React from 'react';
import type { EditRecipe, LensProfileOutcome, LookPreset, Photo } from '../contract';
import { STRINGS } from '../strings';
import BrandIcon from '../icons/BrandIcon';
import InfoPopover from '../shell/InfoPopover';
import { getActiveGroup } from '../utils/studioMath';
import { ColourMixerControl, KelvinControl, ToneCurveControl } from './CurveMixerControls';
import { ColourGradeControl } from './ColourGradeControl';
import { CalibrationControl, EffectsControls } from './EffectsControls';
import { FringeControls, LensControls } from './FringeControls';
import { captureProfileFor } from '../../../core/captureSharpen';
import UserLooksSection, { type UserLookActions } from './UserLooksSection';
import ColourVisionToggle from './ColourVisionToggle';
import ColourVerdictLine, { type ColourVerdictLineProps } from './ColourVerdictLine';
import AutoEditButton, { type AutoEditButtonProps } from './AutoEditButton';

interface AdjustPanelProps {
  photo: Photo | null;
  selectedPhotoCount: number;
  looks: LookPreset[];
  cvdGuidance: boolean;
  /** Turns Colour-vision support on or off here; it is the same setting as Settings → Assistance. */
  onToggleCvdGuidance?: () => void;
  /** One-click Auto at the top of the panel. Absent: no button (a locked photo, or no engine). */
  autoEdit?: Omit<AutoEditButtonProps, 'photoId'>;
  /** Colour-vision support's verdict line: its actions. The verdict itself comes from the photo. */
  colourVerdict?: Omit<ColourVerdictLineProps, 'photoId' | 'verdict' | 'words'>;
  hideReadouts: boolean;
  /** Settings → Show advanced controls: colour grading and channel curves. */
  showAdvanced?: boolean;
  onUpdateRecipe: (photoId: string, patch: Partial<EditRecipe>) => void;
  onDetectColourEdges: (photoId: string) => Promise<'corrected' | 'clean' | 'unclear'>;
  onApplyLensProfile: (photoId: string, download: boolean) => Promise<LensProfileOutcome>;
  onApplyLook: (photoId: string, lookId: string) => void;
  onHoverLook: (lookId: string | null) => void;
  /** Your own looks. Without these the section is not shown. */
  userLookActions?: UserLookActions;
  onResetPhoto: (photoId: string) => void;
  /** White balance from the picture: Auto (no point) runs at once; the eyedropper waits for a click on the canvas. */
  onNeutralWhite?: (photoId: string) => void;
  /** Whether the canvas is waiting for a click on a neutral spot. */
  whitePicking?: boolean;
  onSetWhitePicking?: (picking: boolean) => void;
  /** The last white-balance result, in words (role=status). */
  whiteNote?: string | null;
}

interface SliderRowProps {
  id: string;
  label: string;
  tooltip: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  leftHint?: string;
  rightHint?: string;
  hideReadouts: boolean;
  onChange: (val: number) => void;
}

function SliderRow({
  id,
  label,
  tooltip,
  value: workspaceValue,
  min,
  max,
  step = 1,
  unit = '',
  leftHint,
  rightHint,
  hideReadouts,
  onChange: commit,
}: SliderRowProps) {
  // The thumb moves at once; the edit follows as a transition, so dragging never waits for the editor.
  const [value, onChange] = useSliderValue(workspaceValue, commit);
  const formatted =
    step < 1
      ? `${value > 0 ? '+' : ''}${value.toFixed(1)}${unit}`
      : `${value > 0 ? '+' : ''}${Math.round(value)}${unit}`;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-[var(--text-primary)]">
            {label}
          </label>
          <InfoPopover title={label} body={tooltip} />
        </div>
        {!hideReadouts && (
          <button
            type="button"
            title={`Double-click or click to reset ${label} to 0`}
            onClick={() => onChange(0)}
            className="v2-hit font-mono text-[0.6875rem] text-[var(--text-secondary)] tabular-nums hover:text-[var(--brand-accent)]"
          >
            {formatted}
          </button>
        )}
      </div>

      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="inflight-slider"
      />

      {(leftHint || rightHint) && (
        <div className="flex items-center justify-between text-[0.625rem] text-[var(--text-muted)]">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  );
}

type AdvancedGroup = 'light' | 'tone' | 'colour' | 'detail';
const ADVANCED_GROUPS: Array<{ id: AdvancedGroup; label: string }> = [
  { id: 'light', label: 'Light' }, { id: 'tone', label: 'Tone' }, { id: 'colour', label: 'Colour' }, { id: 'detail', label: 'Detail' },
];
/** On a phone only one group of sliders shows at a time (the pill tabs choose it); from 768px wide every slider shows, as before. */
const phoneGroupClass = (active: AdvancedGroup, group: AdvancedGroup) => (active === group ? '' : 'max-md:hidden');

import SliderGroup from './SliderGroup';
import { groupChanged, groupResetPatch, readClosedGroups, writeClosedGroups, type SliderGroupId } from '../utils/sliderGroups';

export default function AdjustPanel({
  photo,
  selectedPhotoCount,
  looks,
  cvdGuidance,
  onToggleCvdGuidance,
  colourVerdict,
  autoEdit,
  hideReadouts,
  showAdvanced = false,
  onUpdateRecipe,
  onDetectColourEdges,
  onApplyLensProfile,
  onApplyLook,
  onHoverLook,
  userLookActions,
  onResetPhoto,
  onNeutralWhite,
  whitePicking = false,
  onSetWhitePicking,
  whiteNote,
}: AdjustPanelProps) {
  const [activeTab, setActiveTab] = React.useState<'looks' | 'advanced'>('looks');
  const [advancedGroup, setAdvancedGroup] = React.useState<AdvancedGroup>('light');
  const groupStore = () => { try { return window.localStorage; } catch { return null; } };
  const [closedGroups, setClosedGroups] = React.useState<Set<SliderGroupId>>(() => readClosedGroups(typeof window === 'undefined' ? null : groupStore()));
  const toggleGroup = (id: SliderGroupId) => setClosedGroups((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id); else next.add(id);
    writeClosedGroups(groupStore(), next);
    return next;
  });
  const previousPhotoId = React.useRef(photo?.id);
  React.useEffect(() => {
    if (previousPhotoId.current !== photo?.id) {
      previousPhotoId.current = photo?.id;
      // Hover previews are temporary: never carry one photo's Look into another.
      onHoverLook(null);
    }
  }, [photo?.id, onHoverLook]);
  if (!photo) {
    return <p className="text-xs text-[var(--text-muted)]">{STRINGS.panelWords.selectToAdjust}</p>;
  }

  const group = getActiveGroup(photo);
  const recipe = group.recipe;
  const builtInLooks = looks.filter((look) => !look.mine);

  return (
    <div className="space-y-3 md:space-y-5">
      {autoEdit && <AutoEditButton photoId={photo.id} {...autoEdit} />}
      {onToggleCvdGuidance && (
        <div className="space-y-2">
          <ColourVisionToggle on={cvdGuidance} onToggle={onToggleCvdGuidance} />
          {cvdGuidance && (
            <ColourVerdictLine photoId={photo.id} verdict={photo.assistCritique.colourVerdict} words={photo.assistCritique.colourCheck} {...colourVerdict} />
          )}
        </div>
      )}
      {selectedPhotoCount > 1 && (
        <div className="rounded-[var(--radius-sm)] border border-[var(--brand-accent-border)] bg-[var(--brand-accent-soft)] px-2.5 py-1.5 text-[0.6875rem] font-medium text-[var(--brand-accent)]">
          Group edit active: sliders apply to {selectedPhotoCount} selected photos
        </div>
      )}

      <div role="tablist" aria-label={STRINGS.panelWords.adjustTools} className="grid grid-cols-2 gap-1 rounded-[var(--radius-sm)] bg-[var(--bg-input)] p-1">
        <button type="button" role="tab" id="adjust-looks-tab" aria-selected={activeTab === 'looks'}
          aria-controls="adjust-looks-panel" tabIndex={activeTab === 'looks' ? 0 : -1}
          onClick={() => setActiveTab('looks')}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setActiveTab('advanced'); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#adjust-advanced-tab')?.focus(); } }}
          className={`rounded-[var(--radius-sm)] px-2 py-2 text-xs font-medium ${activeTab === 'looks' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          {STRINGS.adjust.looksHeading}
        </button>
        <button type="button" role="tab" id="adjust-advanced-tab" aria-selected={activeTab === 'advanced'}
          aria-controls="adjust-advanced-panel" tabIndex={activeTab === 'advanced' ? 0 : -1}
          onClick={() => { onHoverLook(null); setActiveTab('advanced'); }}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onHoverLook(null); setActiveTab('looks'); e.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#adjust-looks-tab')?.focus(); } }}
          className={`rounded-[var(--radius-sm)] px-2 py-2 text-xs font-medium ${activeTab === 'advanced' ? 'bg-[var(--bg-surface-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          {STRINGS.panelWords.advancedEdits}
        </button>
      </div>
      <div role="tabpanel" id="adjust-looks-panel" aria-labelledby="adjust-looks-tab" hidden={activeTab !== 'looks'}>
      {/* Curated Looks (12 looks with live thumbnail preview + hover main photo preview + direct slider update on click) */}
      <section aria-labelledby="looks-heading" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 id="looks-heading" className="text-xs font-semibold text-[var(--text-primary)]">
            {STRINGS.adjust.looksHeading}
          </h3>
          <span className="text-[0.625rem] text-[var(--text-muted)]">{builtInLooks.filter((look) => look.id !== 'none').length} styles</span>
        </div>
        <p className="v2-mouse-hint text-[0.6875rem] text-[var(--text-muted)]">{STRINGS.adjust.looksHint}</p>

        <div
          className="grid grid-cols-2 gap-2"
          onMouseLeave={() => onHoverLook(null)}
        >
          {builtInLooks.map((look) => {
            const active = recipe.lookId === look.id;
            return (
              <button
                key={look.id}
                type="button"
                title={look.description}
                onMouseEnter={() => onHoverLook(look.id)}
                onFocus={() => onHoverLook(look.id)}
                onBlur={() => onHoverLook(null)}
                aria-pressed={active}
                onClick={() => { onApplyLook(photo.id, look.id); onHoverLook(null); }}
                className={`group flex flex-col overflow-hidden rounded-[var(--radius-sm)] border text-left transition-colors ${
                  active
                    ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]'
                }`}
              >
                <div className="aspect-[16/10] w-full overflow-hidden bg-[var(--bg-canvas)]">
                  <img
                    src={photo.thumbUrl}
                    alt={`${look.name} preview`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                    style={{ filter: look.previewFilter }}
                  />
                </div>
                <span
                  className={`truncate px-2 py-1.5 text-[0.6875rem] font-medium ${
                    active ? 'text-[var(--brand-accent)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {look.name}{active ? ' · Applied' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      {userLookActions && (
        <UserLooksSection photo={photo} looks={looks.filter((look) => look.mine)} appliedLookId={recipe.lookId}
          onApplyLook={onApplyLook} onHoverLook={onHoverLook} {...userLookActions} />
      )}

      </div>
      <div role="tabpanel" id="adjust-advanced-panel" aria-labelledby="adjust-advanced-tab" hidden={activeTab !== 'advanced'}>
      {/* Phone: one group of sliders at a time, chosen by pill tabs. Hidden from 768px wide. */}
      <div role="tablist" aria-label={STRINGS.panelWords.adjustmentGroups} className="sticky -top-4 z-10 -mx-4 mb-3 flex items-center gap-1.5 bg-[var(--bg-surface)] px-4 py-1.5 md:hidden">
        {ADVANCED_GROUPS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={advancedGroup === entry.id} onClick={() => setAdvancedGroup(entry.id)}
            className={`min-h-11 flex-1 rounded-full border px-3 text-xs font-medium ${advancedGroup === entry.id ? 'border-[var(--brand-accent)] bg-[var(--brand-accent-soft)] text-[var(--brand-accent)]' : 'border-[var(--border-subtle)] bg-[var(--bg-input)] text-[var(--text-secondary)]'}`}>
            {entry.label}
          </button>
        ))}
        <button type="button" aria-label={STRINGS.adjust.resetPhoto} onClick={() => onResetPhoto(photo.id)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--border-subtle)] text-[var(--text-muted)]">
          <BrandIcon name="restore" size={14} />
        </button>
      </div>
      {/* Advanced Edits in groups (Dave, 27 Nov: "group the edit sliders more distinctly"): each a labelled card that
          opens and closes (remembered on this device), says "Changed" when any of its values is off its default, and
          resets on its own. The whole-photo reset stays here, above them. Slider maths unchanged. */}
      <div className="flex justify-end max-md:hidden">
        <button type="button" onClick={() => onResetPhoto(photo.id)}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--text-muted)] hover:text-[var(--brand-accent)]">
          <BrandIcon name="restore" size={12} />
          <span>{STRINGS.adjust.resetPhoto}</span>
        </button>
      </div>
      <div className="space-y-3">
      <SliderGroup id="adjust-light" title={STRINGS.adjust.lightToneHeading} open={!closedGroups.has('light')} onToggle={() => toggleGroup('light')}
        changed={groupChanged(recipe, 'light')}
        onReset={() => onUpdateRecipe(photo.id, groupResetPatch('light'))} className={advancedGroup === 'light' || advancedGroup === 'tone' ? '' : 'max-md:hidden'}>
          <div className={phoneGroupClass(advancedGroup, 'light')}><SliderRow
            id="slider-exposure"
            label="Exposure"
            tooltip={STRINGS.adjust.tooltips.exposure}
            value={recipe.exposure}
            min={-5}
            max={5}
            step={0.1}
            unit={` ${STRINGS.adjust.stopsSuffix}`}
            leftHint="-5 EV"
            rightHint="+5 EV"
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { exposure: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'light')}><SliderRow
            id="slider-contrast"
            label="Contrast"
            tooltip={STRINGS.adjust.tooltips.contrast}
            value={recipe.contrast}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { contrast: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'tone')}><SliderRow
            id="slider-highlights"
            label="Highlights"
            tooltip={STRINGS.adjust.tooltips.highlights}
            value={recipe.highlights}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { highlights: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'tone')}><SliderRow
            id="slider-shadows"
            label="Shadows"
            tooltip={STRINGS.adjust.tooltips.shadows}
            value={recipe.shadows}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { shadows: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'tone')}><SliderRow
            id="slider-whites"
            label="Whites"
            tooltip={STRINGS.adjust.tooltips.whites}
            value={recipe.whites}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { whites: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'tone')}><SliderRow
            id="slider-blacks"
            label="Blacks"
            tooltip={STRINGS.adjust.tooltips.blacks}
            value={recipe.blacks}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { blacks: v })}
          /></div>
      </SliderGroup>
      <SliderGroup id="adjust-colour" title={STRINGS.adjust.groupColour} open={!closedGroups.has('colour')} onToggle={() => toggleGroup('colour')}
        changed={groupChanged(recipe, 'colour')}
        onReset={() => onUpdateRecipe(photo.id, groupResetPatch('colour'))} className={phoneGroupClass(advancedGroup, 'colour')}>
          <div className={`space-y-1.5 ${phoneGroupClass(advancedGroup, 'colour')}`} data-testid="white-balance-tools">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" data-testid="wb-as-shot"
                onClick={() => onUpdateRecipe(photo.id, { temperature: 0, tint: 0, whiteBalance: undefined })}
                className="rounded border border-[var(--border-default)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)]">
                {STRINGS.adjust.kelvin.reset}
              </button>
              {onNeutralWhite && (
                <button type="button" data-testid="wb-auto" onClick={() => onNeutralWhite(photo.id)}
                  className="rounded border border-[var(--border-default)] px-2 py-1 text-[0.6875rem] font-medium text-[var(--text-primary)] hover:border-[var(--brand-accent)]">
                  {STRINGS.adjust.neutral.auto}
                </button>
              )}
              {onSetWhitePicking && (
                <button type="button" data-testid="wb-pick" aria-pressed={whitePicking} onClick={() => onSetWhitePicking(!whitePicking)}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[0.6875rem] font-medium ${whitePicking ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)] text-white' : 'border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--brand-accent)]'}`}>
                  <span aria-hidden="true">{whitePicking ? '✓' : '⊕'}</span>{STRINGS.adjust.neutral.pick}
                </button>
              )}
              <InfoPopover title={STRINGS.adjust.kelvin.label} body={STRINGS.adjust.neutral.help} />
            </div>
            {(whitePicking || whiteNote) && (
              <p role="status" data-testid="wb-note" className="text-[0.6875rem] text-[var(--text-secondary)]">
                {whitePicking ? STRINGS.adjust.neutral.picking : whiteNote}
              </p>
            )}
          </div>
          {photo.asShotKelvin && (
            <div className={phoneGroupClass(advancedGroup, 'colour')}>
              <KelvinControl recipe={recipe} asShotK={photo.asShotKelvin} calmView={hideReadouts} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
            </div>
          )}
          <div className={phoneGroupClass(advancedGroup, 'colour')}><SliderRow
            id="slider-temperature"
            label={photo.asShotKelvin ? STRINGS.adjust.kelvin.warmthLabel : 'Temperature'}
            tooltip={STRINGS.adjust.tooltips.temperature}
            value={recipe.temperature}
            min={-100}
            max={100}
            leftHint={cvdGuidance ? 'Cooler (Blue)' : 'Cool'}
            rightHint={cvdGuidance ? 'Warmer (Amber)' : 'Warm'}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { temperature: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'colour')}><SliderRow
            id="slider-tint"
            label="Tint"
            tooltip={STRINGS.adjust.tooltips.tint}
            value={recipe.tint}
            min={-100}
            max={100}
            leftHint={cvdGuidance ? STRINGS.panelWords.greenBias : undefined}
            rightHint={cvdGuidance ? STRINGS.panelWords.magentaBias : undefined}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { tint: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'colour')}><SliderRow
            id="slider-vibrance"
            label="Vibrance"
            tooltip={STRINGS.adjust.tooltips.vibrance}
            value={recipe.vibrance}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { vibrance: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'colour')}><SliderRow
            id="slider-saturation"
            label="Saturation"
            tooltip={STRINGS.adjust.tooltips.saturation}
            value={recipe.saturation}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { saturation: v })}
          /></div>
      </SliderGroup>
      <SliderGroup id="adjust-detail" title={STRINGS.adjust.groupDetail} open={!closedGroups.has('detail')} onToggle={() => toggleGroup('detail')}
        changed={groupChanged(recipe, 'detail')}
        onReset={() => onUpdateRecipe(photo.id, groupResetPatch('detail'))} className={phoneGroupClass(advancedGroup, 'detail')}>
          <div className={phoneGroupClass(advancedGroup, 'detail')}><SliderRow
            id="slider-clarity"
            label="Clarity"
            tooltip={STRINGS.adjust.tooltips.clarity}
            value={recipe.clarity}
            min={-100}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { clarity: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'detail')}><SliderRow
            id="slider-sharpen"
            label="Sharpen"
            tooltip={STRINGS.adjust.tooltips.sharpen}
            value={recipe.sharpen}
            min={0}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { sharpen: v })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'detail')}><SliderRow
            id="slider-capture-sharpen"
            label={STRINGS.history.sliders.captureSharpen}
            tooltip={STRINGS.adjust.tooltips.captureSharpen}
            value={recipe.captureSharpen ?? 0}
            min={0}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { captureSharpen: v, captureProfile: recipe.captureProfile ?? captureProfileFor(photo.exif.camera) })}
          /></div>
          <div className={phoneGroupClass(advancedGroup, 'detail')}><SliderRow
            id="slider-deblur"
            label={STRINGS.history.sliders.deblur}
            tooltip={STRINGS.adjust.tooltips.deblur}
            value={recipe.deblur ?? 0}
            min={0}
            max={100}
            hideReadouts={hideReadouts}
            onChange={(v) => onUpdateRecipe(photo.id, { deblur: v, captureProfile: recipe.captureProfile ?? captureProfileFor(photo.exif.camera) })}
          /></div>
      </SliderGroup>
      <SliderGroup id="adjust-effects" title={STRINGS.adjust.effects.heading} open={!closedGroups.has('effects')} onToggle={() => toggleGroup('effects')}
        changed={groupChanged(recipe, 'effects')}
        onReset={() => onUpdateRecipe(photo.id, groupResetPatch('effects'))} className={phoneGroupClass(advancedGroup, 'detail')}>
          <EffectsControls recipe={recipe} calmView={hideReadouts} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <LensControls key={photo.id} recipe={recipe} calmView={hideReadouts} onChange={(patch) => onUpdateRecipe(photo.id, patch)} onUseProfile={(download) => onApplyLensProfile(photo.id, download)} />
          </div>
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <FringeControls recipe={recipe} calmView={hideReadouts} showAdvanced={showAdvanced} onChange={(patch) => onUpdateRecipe(photo.id, patch)} onDetect={() => onDetectColourEdges(photo.id)} />
          </div>
      </SliderGroup>
      <SliderGroup id="adjust-curve" title={STRINGS.adjust.curve.heading} open={!closedGroups.has('curve')} onToggle={() => toggleGroup('curve')}
        changed={groupChanged(recipe, 'curve')} className={phoneGroupClass(advancedGroup, 'tone')}>
          <ToneCurveControl bare recipe={recipe} calmView={hideReadouts} channels={showAdvanced} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
      </SliderGroup>
      <SliderGroup id="adjust-mixer" title={STRINGS.adjust.mixer.heading} open={!closedGroups.has('mixer')} onToggle={() => toggleGroup('mixer')}
        changed={groupChanged(recipe, 'mixer')} className={phoneGroupClass(advancedGroup, 'colour')}>
          <ColourMixerControl bare recipe={recipe} calmView={hideReadouts} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
      </SliderGroup>
        {showAdvanced ? (
  <SliderGroup id="adjust-grading" title={STRINGS.adjust.grade.heading} open={!closedGroups.has('grading')} onToggle={() => toggleGroup('grading')}
        changed={groupChanged(recipe, 'grading')}
        testId="advanced-controls" className={phoneGroupClass(advancedGroup, 'colour')}>
          <ColourGradeControl bare recipe={recipe} calmView={hideReadouts} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <CalibrationControl recipe={recipe} calmView={hideReadouts} pictureUrl={photo.previewUrl} onChange={(patch) => onUpdateRecipe(photo.id, patch)} />
          </div>
      </SliderGroup>
        ) : (recipe.colourGrade || recipe.channelCurves || recipe.calibration) && (
          // Hidden is never discarded: say plainly that hidden adjustments are still on this photo.
          <p className="pt-1 text-[0.6875rem] leading-snug text-[var(--text-muted)]" data-testid="advanced-hidden-note">
            {STRINGS.adjust.advanced.hiddenActive}
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
