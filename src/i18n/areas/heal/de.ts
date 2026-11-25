import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** German (Sie). DRAFT: written without a native speaker's check. */
export const de: AreaTranslation<typeof source> = {
  title: "Bereichsreparatur",
  intro: "Überdeckt Staub, einen Zweig oder störende Sitzwarten mit Pixeln, die aus der Nähe im selben Foto kopiert werden. Nichts wird erfunden, und die Originaldatei wird nie verändert.",
  start: "Stellen markieren",
  stop: "Fertig",
  placing: "Klicken oder tippen Sie auf jede Stelle, die überdeckt werden soll. Drücken Sie Esc, wenn Sie fertig sind.",
  size: "Größe",
  feather: "Weichheit",
  method: "Methode",
  heal: "Reparieren: an die Umgebung anpassen",
  clone: "Klonen: exakte Kopie",
  nextSource: "Von anderer Stelle kopieren",
  remove: "Stelle entfernen",
  removeAll: "Alle Stellen entfernen",
  show: "Stelle anzeigen",
  hide: "Stelle ausblenden",
  spot: (n: number) => `Stelle ${n}`,
  hidden: "ausgeblendet",
  count: (n: number) => plural(n, { one: `${n} Stelle`, other: `${n} Stellen` }),
  empty: "Noch keine Stellen.",
  added: "Stelle überdeckt. Ziehen Sie den gestrichelten Kreis oder wählen Sie „Von anderer Stelle kopieren“, um die Quelle zu ändern.",
  full: (n: number) => `Dieses Foto hat bereits ${n} Stellen, das Maximum.`,
  noSource: "In der Nähe war nichts ähnlich genug zum Kopieren. Versuchen Sie eine kleinere Größe.",
  unreadable: "Das Foto konnte gerade nicht gelesen werden, daher wurde keine Stelle hinzugefügt.",
  noOther: "Es gibt keine andere Stelle in der Nähe zum Kopieren.",
  working: "Suche nach einer Stelle zum Kopieren…",
  historyStep: "Bereichsreparatur",
  layer: "Reparierte Stellen",
  select: (n: number) => `Stelle ${n}: auswählen`,
  source: (n: number) => `Quelle von Stelle ${n}: ziehen oder Pfeiltasten verwenden`,
};
