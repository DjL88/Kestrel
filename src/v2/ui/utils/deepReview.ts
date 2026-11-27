/**
 * "Check photo on this device" (the deep review, src/v2/engineClient/deepVisionReview.ts) runs entirely on this device:
 * the on-device subject finder and the Look rules. Nothing is sent anywhere, so it needs no plan and no connection
 * (owner decision 13: every on-device model is Basic).
 *
 * It was gated on the online Pro features (online review, cloud assist). Those stay off for every plan until an
 * administrator switches them on, so a Pro account that was online was told "Not available on this plan or while
 * offline" (Dave, 27 Nov, installed build). The plan and the connection play no part; the review is always offered.
 */
export function deepReviewAvailable(_access: { features: Partial<Record<string, boolean>>; online: boolean }): boolean {
  return true;
}

/**
 * Why a review could not finish, in the words the failure gave (the subject finder not installed, its file not matching
 * its checksum), or the general line when nothing readable came back. Never "not on this plan".
 */
export function deepReviewFailure(error: unknown, fallback: string): string {
  const reason = error instanceof Error ? error.message.trim() : typeof error === 'string' ? error.trim() : '';
  return reason && reason.length < 300 ? reason : fallback;
}
