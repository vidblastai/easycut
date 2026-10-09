import { deaccent, type LanguagePack } from './types';

/**
 * French.
 *
 * The elision is the thing. "Ce que je veux dire, c'est qu'il faut juste se
 * lancer" carries four apostrophes' worth of joined words, and treating
 * "qu'il" as one token means it never matches "il" anywhere else. So French
 * splits on the apostrophe where English strips it, and the one-letter
 * clitics that fall out — l', d', j', n', c', qu' — are function words.
 *
 * Accents come off in the stem, not because the ASR gets them wrong (it does
 * not) but because they move with the conjugation: "commencé" and "commence"
 * are the same verb.
 */

const FUNCTION_WORDS = new Set([
  'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'me', 'te', 'se', 'lui',
  'leur', 'moi', 'toi', 'soi', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au',
  'aux', 'ce', 'cet', 'cette', 'ces', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa',
  'ses', 'notre', 'nos', 'votre', 'vos', 'et', 'ou', 'mais', 'donc', 'alors', 'si', 'que',
  'qui', 'quoi', 'dont', 'ou', 'a', 'dans', 'sur', 'sous', 'par', 'pour', 'avec', 'sans',
  'chez', 'vers', 'entre', 'comme', 'est', 'sont', 'etait', 'etaient', 'suis', 'es', 'etre',
  'ai', 'as', 'avons', 'avez', 'ont', 'avoir', 'fait', 'faire', 'va', 'vais', 'vont',
  'aller', 'ici', 'la', 'maintenant', 'juste', 'aussi', 'encore', 'deja', 'tres', 'vraiment',
  'assez', 'trop', 'plus', 'moins', 'tout', 'tous', 'toute', 'toutes', 'rien', 'chose',
  'truc', 'machin', 'pas', 'ne', 'oui', 'non', 'ok', 'bon', 'enfin', 'quoi',
  // The clitics the apostrophe leaves behind.
  'd', 'l', 'j', 'n', 's', 'm', 't', 'c', 'qu', 'y', 'en',
  'presque', 'environ', 'peut', 'etre', 'deja', 'surtout', 'meme',
]);

const SYNONYMS: Record<string, string> = {
  commencer: 'commencer', debuter: 'commencer', demarrer: 'commencer', lancer: 'commencer',
  terminer: 'finir', achever: 'finir', conclure: 'finir',
  enorme: 'grand', immense: 'grand', gigantesque: 'grand', massif: 'grand',
  minuscule: 'petit', faible: 'petit',
  creer: 'faire', construire: 'faire', produire: 'faire', fabriquer: 'faire',
  realiser: 'faire', monter: 'faire',
  montrer: 'montrer', demontrer: 'montrer', presenter: 'montrer', afficher: 'montrer',
  rapide: 'vite', vite: 'vite', rapidement: 'vite',
  facile: 'simple', evident: 'simple',
  difficile: 'dur', complique: 'dur', ardu: 'dur',
  crucial: 'important', essentiel: 'important', cle: 'important', vital: 'important',
  genial: 'bien', super: 'bien', excellent: 'bien', top: 'bien', formidable: 'bien',
  terrible: 'mauvais', nul: 'mauvais', horrible: 'mauvais',
  acheter: 'acheter', acquerir: 'acheter',
  utiliser: 'utiliser', employer: 'utiliser', servir: 'utiliser',
  penser: 'penser', croire: 'penser', estimer: 'penser', trouver: 'penser',
  dire: 'dire', raconter: 'dire', mentionner: 'dire',
  regarder: 'voir', voir: 'voir', visionner: 'voir',
  argent: 'argent', fric: 'argent', revenu: 'argent', chiffre: 'argent',
  gens: 'gens', personnes: 'gens', monde: 'gens', tout_le_monde: 'gens',
  devoir: 'devoir', falloir: 'devoir', necessiter: 'devoir',
  aider: 'aider', assister: 'aider',
  ameliorer: 'mieux', optimiser: 'mieux',
  reduire: 'baisser', diminuer: 'baisser',
  grandir: 'croitre', augmenter: 'croitre', croitre: 'croitre', progresser: 'croitre',
  clip: 'video', sequence: 'video', images: 'video',
  filmer: 'filmer', tourner: 'filmer', enregistrer: 'filmer',
  entier: 'tout', complet: 'tout',
  pourcent: 'percent',
};

const IRREGULARS: Record<string, string> = {
  faut: 'falloir', fallait: 'falloir', faudra: 'falloir', faudrait: 'falloir',
  veux: 'vouloir', veut: 'vouloir', voulez: 'vouloir', voulons: 'vouloir',
  voulait: 'vouloir', voudrais: 'vouloir',
  peux: 'pouvoir', peut: 'pouvoir', pouvez: 'pouvoir', pouvons: 'pouvoir',
  pouvait: 'pouvoir', pourrait: 'pouvoir',
  dois: 'devoir', doit: 'devoir', devez: 'devoir', devons: 'devoir', devait: 'devoir',
  suis: 'etre', es: 'etre', est: 'etre', sommes: 'etre', etes: 'etre', sont: 'etre',
  etait: 'etre', etaient: 'etre', sera: 'etre', serait: 'etre', ete: 'etre',
  ai: 'avoir', as: 'avoir', avons: 'avoir', avez: 'avoir', ont: 'avoir', avait: 'avoir',
  eu: 'avoir',
  vais: 'aller', vas: 'aller', va: 'aller', allons: 'aller', allez: 'aller', vont: 'aller',
  fais: 'faire', fait: 'faire', faisons: 'faire', faites: 'faire', font: 'faire',
  dis: 'dire', dit: 'dire', disons: 'dire', dites: 'dire', disent: 'dire',
  sais: 'savoir', sait: 'savoir', savez: 'savoir', savons: 'savoir',
  prends: 'prendre', prend: 'prendre', prenez: 'prendre',
  mets: 'mettre', met: 'mettre', mettez: 'mettre',
  grandi: 'grandir', grandit: 'grandir',
};

const PHRASES: Array<[string[], string[]]> = [
  // Unit, not number: without this "quarante pour cent" and "cinquante pour
  // cent" share the figure 100 and the conflict check never fires.
  [['pour', 'cent'], ['percent']],
  [['il', 'faut'], ['devoir']],
  [['il', 'faudrait'], ['devoir']],
  [['tu', 'dois'], ['devoir']],
  [['on', 'doit'], ['devoir']],
  [['beaucoup', 'de'], ['beaucoup']],
  [['plein', 'de'], ['beaucoup']],
  [['un', 'tas', 'de'], ['beaucoup']],
  [['par', 'exemple'], ['exemple']],
  [['du', 'coup'], []],
  [['en', 'fait'], []],
  [['tu', 'vois'], []],
  [['tu', 'sais'], []],
  [['c', 'est', 'a', 'dire'], ['cad']],
  [['tout', 'le', 'monde'], ['gens']],
  [['mise', 'en', 'place'], ['installation']],
];

/** Accents off, then the conjugation. Three characters minimum. */
function stem(word: string): string {
  let out = deaccent(word);
  if (out.length < 4) return out;
  for (const suffix of [
    'ements', 'ement', 'ations', 'ation', 'aient', 'erait', 'eront', 'ions', 'iez',
    'ent', 'ons', 'ez', 'er', 'ir', 're', 'es', 'ee', 'is', 'it', 'us', 'ue',
    's', 'e', 'i',
  ]) {
    if (!out.endsWith(suffix)) continue;
    const cut = out.slice(0, -suffix.length);
    if (cut.length >= 3) out = cut;
    break;
  }
  return out;
}

export const FRENCH: LanguagePack = {
  code: 'fr',
  name: 'French',
  endonym: 'Français',

  fillers: new Set([
    'euh', 'euhm', 'eu', 'hein', 'ben', 'bah', 'beh', 'hum', 'heu', 'mmh', 'mouais',
    'genre', 'bref', 'disons', 'voila', 'voilà', 'quoi',
    // Same as the German "also": "Alors, le truc c'est…" opens on filler.
    'alors', 'bon',
  ]),

  hedgePhrases: [
    ['tu', 'vois'], ['tu', 'sais'], ['je', 'veux', 'dire'], ['en', 'fait'],
    ['du', 'coup'], ['en', 'gros'], ['on', 'va', 'dire'], ['plus', 'ou', 'moins'],
  ],

  functionWords: FUNCTION_WORDS,

  strongFrames: [
    'ce que je veux dire c est', 'ce que je veux dire', 'ce que j essaie de dire',
    'ce que je voulais dire', 'autrement dit', 'en d autres termes', 'en d autres mots',
    'ou plutot', 'plutot', 'disons plutot', 'je veux dire', 'je reformule',
    'laisse moi reformuler', 'je le redis', 'pour etre clair', 'pour etre precis',
    'plus precisement', 'c est a dire', 'je m explique', 'pardon', 'desole', 'excuse moi',
    'le point c est', 'mon point c est', 'ce qui compte c est',
  ],

  weakFrames: [
    'alors ecoute', 'bon alors', 'ok alors', 'oui alors', 'et puis', 'ecoute', 'regarde',
    'en gros', 'en principe', 'globalement', 'basiquement', 'alors', 'et', 'mais', 'donc',
    'bon', 'ben', 'bah', 'voila', 'maintenant', 'enfin', 'du coup', 'en fait',
  ],

  trailingHedges: [
    'je crois', 'je pense', 'je dirais', 'on va dire', 'tu vois', 'tu sais', 'ou quoi',
    'ou un truc comme ca', 'non', 'quoi', 'plus ou moins', 'si ca a du sens', 'hein',
  ],

  sequencingOpeners: [
    'ensuite', 'puis', 'et puis', 'apres', 'apres ca', 'deuxiemement', 'troisiemement',
    'finalement', 'pour finir', 'en plus', 'aussi', 'd abord', 'premierement',
    'etape deux', 'etape trois', 'par ailleurs', 'a cote de ca', 'ensuite tu', 'puis tu',
  ],

  coordinators: ['et', 'ou', 'ni'],

  subordinators: new Set([
    'si', 'sauf', 'quand', 'lorsque', 'parce', 'puisque', 'tant', 'jusqu', 'avant',
    'apres', 'sans', 'moins', 'pourvu', 'bien', 'tandis', 'alors',
  ]),

  clauseOpeners: new Set([
    'mais', 'et', 'ou', 'parce', 'que', 'qui', 'quand', 'si', 'donc', 'car', 'lorsque', 'alors',
    'puisque', 'comme', 'sauf', 'tandis',
  ]),

  negations: new Set(['ne', 'pas', 'jamais', 'rien', 'aucun', 'aucune', 'non', 'personne', 'sans', 'ni']),

  numberWords: {
    zero: '0', un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6',
    sept: '7', huit: '8', neuf: '9', dix: '10', onze: '11', douze: '12', treize: '13',
    quatorze: '14', quinze: '15', seize: '16', vingt: '20', trente: '30', quarante: '40',
    cinquante: '50', soixante: '60', septante: '70', huitante: '80', nonante: '90',
    cent: '100', cents: '100', mille: '1000', million: '1000000', millions: '1000000',
    milliard: '1000000000', milliards: '1000000000', demi: '0.5',
  },

  synonyms: SYNONYMS,
  irregulars: IRREGULARS,
  phrases: PHRASES,

  genericFrame: {
    openers: ['ce', 'le', 'la', 'l', 'mon', 'tout', 'ici'],
    copulas: ['est', 'etait'],
    maxGap: 5,
  },

  punch: {
    figure:
      /(?:\d[\d.,]*\s*(?:%|x\b|k\b|m\b)?|\bpour ?cent\b|\b(?:vingt|trente|quarante|cinquante|soixante|septante|quatre-vingts?|nonante|cent|mille|millions?|milliards?|douzaine)\b)/i,
    pivotOpens:
      /^(?:et\s+|alors\s+|mais\s+|donc\s+)?(?:mais|cependant|pourtant|sauf|en revanche|par contre|au contraire|en fait|plut(?:ô|o)t)\b/i,
    pivotAnywhere:
      /\b(?:le truc c'?est|le probl(?:è|e)me c'?est|la v(?:é|e)rit(?:é|e) c'?est|le point c'?est|c'?est pour (?:ç|c)a|voil(?:à|a) pourquoi|il s'?av(?:è|e)re|l'?erreur c'?est)\b/i,
    superlative:
      /\b(?:jamais|toujours|personne|aucun|tout le monde|chacun|le seul|la seule|le meilleur|la meilleure|le pire|le plus grand|le plus rapide|le plus important|litt(?:é|e)ralement)\b/i,
  },

  stem,
  // "qu'il" is two words. This is the one pack where that is true.
  elision: true,

  markers: ['le', 'la', 'les', 'est', 'que', 'pour', 'une', 'des', 'je', 'pas', 'qui', 'dans'],
  asrCode: 'fr',
  /*
   * Measured, not assumed: Deepgram's `smart_format` reads "pour cent" as
   * the numeral and writes "40 pour 100" into the captions. Off.
   */
  smartFormat: false,
};
