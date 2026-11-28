import { plural } from '../../../core/locale';
import type { AreaTranslation } from '../../localise';
import type { source } from './source';

/** Irish. DRAFT: written without a native speaker's check. */
export const ga: AreaTranslation<typeof source> = {
  paint: `Péinteáil`,
  erase: `Scrios`,
  mode: `Mód an scuaibín`,
  size: `Méid an scuaibín`,
  stop: `Stop ag péinteáil`,
  layer: (name: string) => `Scuaibín ar ${name}`,
  help: `Tarraing ar an ngrianghraf chun péinteáil. Coinnigh Alt síos chun scriosadh ar feadh tamaillín. Brúigh [ nó ] chun an méid a athrú. Leis an méarchlár, bogann na saigheada an scuaibín agus péinteálann Spás.`,
  painting: (name: string) => `Ag péinteáil ar ${name}. Oibríonn a choigeartuithe san áit a bpéinteálann tú.`,
  erasing: (name: string) => `Ag scriosadh ó ${name}. Stopann a choigeartuithe san áit a scriosann tú.`,
  added: `Cuireadh masc scuaibín leis. Tarraing ar an ngrianghraf chun péinteáil san áit ar cheart dá choigeartuithe oibriú.`,
  pickMask: `Oscail masc scuaibín, ábhair nó cúlra sa liosta thíos, ansin péinteáil ar an ngrianghraf chun cur leis nó scriosadh as.`,
  refine: `Beachtaíonn an scuaibín agus an scriosán masc ábhair nó cúlra freisin: oscail sa liosta é, ansin péinteáil chun cur leis nó scrios chun baint de.`,
  full: (n: number) => `Tá ${n} stríoc scuaibín ar an masc seo cheana, an líon is mó. Cuir masc scuaibín eile leis chun leanúint ag péinteáil.`,
  strokes: (n: number) => plural(n, { one: `${n} stríoc scuaibín`, other: `${n} stríoc scuaibín` }),
  unavailable: `Is réamhamharc í an phéinteáil. Cas air Scuaibín maisc i Gnéithe réamhamhairc chun í a úsáid.`,
};
