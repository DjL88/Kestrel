/**
 * Where a project's photos were taken, for matching species names (src/core/speciesArea.ts). British English, the source for every translation.
 */
export const source = {
  whereTaken: "Where were these taken?",
  whereTakenHint: "Species names are matched against the animals found there. This applies to this project only.",
  home: (region: string) => `Home region (${region})`,
  worldwide: "Worldwide",
  regionsHeading: "Regions",
  countriesHeading: "Countries",
  homeSetting: "Home region",
  homeSettingHint: "Where you usually take photos. Projects match species names against it unless you choose another place for them.",
  matchedIn: (area: string) => `Species list used: ${area}`,
  promptOutside: (name: string) => `Some photos look like species from outside your home region, such as ${name}.`,
  suggestionPrivacy: "Read from the files on this device. The locations are not sent anywhere.",
  usePhotosPlace: (area: string) => `Photos' locations: ${area}`,
  notNow: "Not now",
  changed: (area: string) => `Species names now come from: ${area}. Photos you have not named yourself are looked at again.`,
  promptGps: "These photos' locations are outside your home region.",
  regions: {
    palearctic: "Europe, North Africa and northern Asia",
    nearctic: "North America",
    neotropics: "Central and South America",
    afrotropics: "Africa south of the Sahara",
    oriental: "South and South-East Asia",
    australasia: "Australia, New Guinea and New Zealand",
    oceans: "Oceans, islands and polar seas",
  },
};
