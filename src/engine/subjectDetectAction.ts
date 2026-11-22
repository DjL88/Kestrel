import { judgeSubject, type CullSuggestion, type SubjectFinding } from '../core/autoCull';
import { corroborateSubject, detectorWitness, modelWitness, type Corroboration } from '../core/subjectCorroboration';
import type { Detection } from '../core/objectDetection';
import { runEngineTask } from './taskManager';
import type { EngineRunner } from './types';

/**
 * Subject detection as a registered engine action, alongside denoise/upscale/mask (owner direction, 22 Nov
 * 2026: every process should go through the task manager to "the appropriate engine"). This does NOT give
 * subject detection a decide -> render -> verify -> retry loop like denoise or upscale: detection has no
 * numeric strength to turn down, and a bad detection isn't "overshoot", so inventing a retry here would be
 * make-believe, not a real safeguard.
 *
 * What it DOES do is make this capability use the two REAL trust checks that already exist for exactly
 * this question, instead of accepting a raw detector box at face value:
 *  - `autoCull.ts`'s `judgeSubject` - the real score/size/sharpness gate that decides whether a
 *    detection is strong enough to call a subject at all, and how confidently (the same logic
 *    `scoreWithSubject` applies when a whole-frame score already exists to merge it onto; this action
 *    has no such frame-level score, so it uses the factored-out subject-only half directly).
 *  - `subjectCorroboration.ts`'s `corroborateSubject` - the real vision-vs-detector agreement check, so a
 *    disputed subject (bird vs. aircraft) is flagged rather than asserted.
 * Neither check is new; both already ship today for other callers. This module's only job is running
 * detection through the task manager and packaging its result with those two real verdicts attached, so
 * every caller of this capability gets the same trust signal rather than each reimplementing it.
 *
 * `detect` and `visionDescription` are both injected: this module has no DOM/Worker/ONNX dependency of
 * its own (that lives in `src/providers/objectDetector.ts`/`photoCheck.ts`), so it stays pure and
 * testable with fakes, same pattern as `render` in `denoiseAction.ts`.
 */

export interface DetectedSubject {
  detection: Detection;
  sharpness: number;
  /** Share of the photo's area the detected box covers, 0-1. */
  coverage: number;
}

export interface SubjectDetectActionInput {
  frameId: string;
  detect: () => Promise<DetectedSubject | null>;
  /** The on-device vision scene reading's free-text description for this photo, if one already exists
   * (e.g. from `photoCheck.ts`). Omit when none has run yet - the corroboration result is then correctly
   * 'unverified', not a guess at what the vision model would have said. */
  visionDescription?: string;
  runner?: EngineRunner;
}

export interface SubjectDetectActionResult {
  finding: DetectedSubject | null;
  /** The real score/size/sharpness trust gate (`autoCull.ts`'s `judgeSubject`, the same logic
   * `scoreWithSubject` uses, factored out so it can be applied here with no whole-frame score to merge
   * onto). `decision: 'keep'` with high confidence is the closest this capability has to denoise/
   * upscale's `verification.ok`. */
  trust: CullSuggestion;
  /** The real vision-vs-detector agreement check. 'conflict' means do not assert a subject kind even if
   * `trust` is otherwise confident; 'unverified' means only one witness exists (or `visionDescription`
   * was not given), which is not a failure, just incomplete corroboration. */
  corroboration: Corroboration;
}

export async function runSubjectDetectAction(input: SubjectDetectActionInput): Promise<SubjectDetectActionResult> {
  return runEngineTask('subject-detect', input.runner ?? 'device', 'Finding the subject', async () => {
    const finding = await input.detect();
    const subjectInput: SubjectFinding | null = finding
      ? { label: finding.detection.label, score: finding.detection.score, size: Math.max(finding.detection.box.w, finding.detection.box.h), sharpness: finding.sharpness }
      : null;
    const trust: CullSuggestion = { frameId: input.frameId, ...judgeSubject(subjectInput) };
    const detector = finding ? detectorWitness({ label: finding.detection.label, score: finding.detection.score }) : null;
    const reading = input.visionDescription !== undefined ? modelWitness(input.visionDescription) : null;
    const corroboration = corroborateSubject(reading, detector);
    return { finding, trust, corroboration };
  });
}
