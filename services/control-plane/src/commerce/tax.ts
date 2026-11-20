// Standard rates in basis points. Source: European Commission Access2Markets VAT rates.
const euRates = new Map(Object.entries({
  AT: 2000, BE: 2100, BG: 2000, CY: 1900, CZ: 2100, DE: 1900, DK: 2500,
  EE: 2400, ES: 2100, FI: 2550, FR: 2000, GR: 2400, HR: 2500, HU: 2700,
  IE: 2300, IT: 2200, LT: 2100, LU: 1700, LV: 2100, MT: 1800, NL: 2100,
  PL: 2300, PT: 2300, RO: 2100, SE: 2500, SI: 2200, SK: 2300,
}));

export const PRO_BASE_PENCE = 2900;

export interface TaxSettings {
  ukVatRegistered: boolean;
  ukVatNumber?: string;
  b2cPricing: 'inclusive' | 'exclusive';
  localTaxes: Readonly<Record<string, { enabled: boolean; rateBasisPoints: number }>>;
}

// Constructed by the server from the verification response.
export interface VerifiedVatId {
  country: string;
  vatId: string;
  provider: 'VIES' | 'HMRC';
  checkedAt: string;
  reference: string | null;
}

export interface LocationEvidence {
  source: 'billing-address' | 'ip-geolocation' | 'card-issuer';
  country: string;
  observedAt: string;
}

export type TaxTreatment = 'uk-vat' | 'uk-unregistered' | 'eu-oss' | 'eu-reverse-charge' | 'local-tax' | 'outside-uk-vat';

export function quoteProTax(input: {
  country: string;
  region?: string;
  verification?: VerifiedVatId;
  evidence: readonly LocationEvidence[];
}, settings: TaxSettings) {
  const { country, region, verification, evidence } = input;
  if (!/^[A-Z]{2}$/.test(country) || (region !== undefined && !/^[A-Z0-9]{1,8}$/.test(region))) {
    throw new Error('Invalid tax jurisdiction.');
  }
  const euRate = euRates.get(country);
  const eligibleProvider = country === 'GB' ? 'HMRC' : euRate !== undefined ? 'VIES' : undefined;
  const verified = eligibleProvider !== undefined && verification?.provider === eligibleProvider
    && verification.country === country ? verification : null;
  const customerType = verified ? 'B2B' : 'B2C';
  if (!verified && (new Set(evidence.map(item => item.source)).size < 2
    || evidence.some(item => item.country !== country))) {
    throw new Error('Two matching pieces of customer location evidence are required.');
  }

  let treatment: TaxTreatment = 'outside-uk-vat';
  let jurisdiction = country;
  let rateBasisPoints = 0;
  if (country === 'GB') {
    if (settings.ukVatRegistered && !/^(?:GB)?\d{9}(?:\d{3})?$/.test(settings.ukVatNumber ?? '')) {
      throw new Error('UK VAT registration requires a VAT number.');
    }
    treatment = settings.ukVatRegistered ? 'uk-vat' : 'uk-unregistered';
    rateBasisPoints = settings.ukVatRegistered ? 2000 : 0;
  } else if (euRate !== undefined) {
    treatment = verified ? 'eu-reverse-charge' : 'eu-oss';
    rateBasisPoints = verified ? 0 : euRate;
  } else {
    const regional = region ? settings.localTaxes[country + '-' + region] : undefined;
    const local = regional ?? settings.localTaxes[country];
    if (local?.enabled) {
      treatment = 'local-tax';
      jurisdiction = regional ? country + '-' + region : country;
      rateBasisPoints = local.rateBasisPoints;
    }
  }
  if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10000) {
    throw new Error('Invalid indirect tax rate.');
  }

  const inclusive = customerType === 'B2C' && settings.b2cPricing === 'inclusive';
  const taxPence = Math.round(PRO_BASE_PENCE * rateBasisPoints / (inclusive ? 10000 + rateBasisPoints : 10000));
  const netPence = inclusive ? PRO_BASE_PENCE - taxPence : PRO_BASE_PENCE;
  return {
    currency: 'GBP' as const, country, jurisdiction, customerType, treatment, rateBasisPoints,
    netPence, taxPence, totalPence: netPence + taxPence,
    vatNumber: treatment === 'uk-vat' ? settings.ukVatNumber! : null,
    invoiceNotice: treatment === 'eu-reverse-charge' ? 'Reverse charge' : null,
    verification: verified, evidence: [...evidence],
  };
}
