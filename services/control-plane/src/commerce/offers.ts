export interface ProVersionOffer {
  version: string;
  gbpBasePence: number;
  /** Optional built-in discount for a previous paid edition. */
  discountBasisPoints?: number;
}

export interface ProCoupon {
  code: string;
  versions: readonly string[];
  discountBasisPoints: number;
  startsAt: string;
  endsAt: string;
}

const normaliseCode = (value: string) => value.trim().toUpperCase();

export function resolveProOffer(
  version: ProVersionOffer,
  coupons: readonly ProCoupon[],
  couponCode: string | undefined,
  nowMs: number,
) {
  if (!version.version.trim() || !Number.isSafeInteger(version.gbpBasePence) || version.gbpBasePence <= 0
    || !Number.isFinite(nowMs)) {
    throw new Error('The Pro version is unavailable.');
  }

  const code = couponCode === undefined ? undefined : normaliseCode(couponCode);
  let discountBasisPoints = version.discountBasisPoints ?? 0;
  if (code !== undefined) {
    const matches = coupons.filter(coupon => normaliseCode(coupon.code) === code);
    const coupon = matches[0];
    if (!/^[A-Z0-9-]{1,40}$/.test(code) || matches.length !== 1 || !coupon.versions.includes(version.version)
      || !(Date.parse(coupon.startsAt) <= nowMs && nowMs < Date.parse(coupon.endsAt))) {
      throw new Error('This coupon is unavailable for the selected version.');
    }
    // Apply the larger discount when an event overlaps an older-version offer.
    if (!Number.isInteger(coupon.discountBasisPoints) || coupon.discountBasisPoints <= 0 || coupon.discountBasisPoints >= 10000) {
      throw new Error('Invalid coupon discount.');
    }
    discountBasisPoints = Math.max(discountBasisPoints, coupon.discountBasisPoints);
  }
  if (!Number.isInteger(discountBasisPoints) || discountBasisPoints < 0 || discountBasisPoints >= 10000) {
    throw new Error('Invalid Pro version discount.');
  }
  return { ...version, discountBasisPoints, couponCode: code ?? null };
}
