/**
 * Where the sun was when a photo was taken, from its true capture instant (UTC) and where it was taken. Pure maths
 * (NOAA's solar position equations, accurate to well under a degree between 1900 and 2100), no network.
 *
 * Used for light tags that must be computed, never guessed from the picture: golden hour, blue hour and night.
 */

const RAD = Math.PI / 180;

/** The sun's height above the horizon in degrees (negative below it), corrected for atmospheric refraction near the horizon. */
export function sunElevation(utcMs: number, latitude: number, longitude: number): number {
  const julianDay = utcMs / 86_400_000 + 2_440_587.5;
  const t = (julianDay - 2_451_545) / 36_525;
  const meanLongitude = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const trueLongitude = meanLongitude + centre;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime = 4 / RAD * (y * Math.sin(2 * meanLongitude * RAD) - 2 * eccentricity * Math.sin(meanAnomaly * RAD)
    + 4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD)
    - 0.5 * y * y * Math.sin(4 * meanLongitude * RAD) - 1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD));
  const minutesUtc = ((utcMs % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;
  const trueSolarTime = (((minutesUtc + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180;
  const cosZenith = Math.sin(latitude * RAD) * Math.sin(declination) + Math.cos(latitude * RAD) * Math.cos(declination) * Math.cos(hourAngle * RAD);
  const elevation = 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / RAD;
  return elevation + refraction(elevation);
}

/** NOAA's approximation of how much the air lifts the sun's apparent position, in degrees. */
function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const tan = Math.tan(elevation * RAD);
  if (elevation > 5) return (58.1 / tan - 0.07 / tan ** 3 + 0.000086 / tan ** 5) / 3600;
  if (elevation > -0.575) return (1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))) / 3600;
  return -20.772 / tan / 3600;
}

/** The light the sun gave, by its height. The usual photographic bands: golden hour +6° to −4°, blue hour −4° to −6°. */
export type SunLight = 'day' | 'golden-hour' | 'blue-hour' | 'twilight' | 'night';

export function sunLight(elevation: number): SunLight {
  if (!Number.isFinite(elevation)) throw new RangeError('Elevation must be a number.');
  if (elevation >= 6) return 'day';
  if (elevation >= -4) return 'golden-hour';
  if (elevation >= -6) return 'blue-hour';
  // Between civil and astronomical darkness the sky still glows: called neither blue hour nor night.
  if (elevation >= -12) return 'twilight';
  return 'night';
}
