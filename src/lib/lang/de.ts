import { deaccent, type LanguagePack } from './types';

/**
 * German.
 *
 * Three things make German different from English here, and all three are in
 * the stemmer:
 *
 *  1. **The umlaut carries inflection.** "fahren" becomes "fährt", "Haus"
 *     becomes "Häuser". Folding ä→a means two forms of the same word match;
 *     not folding it means a retake that switched person or number reads as
 *     a different sentence.
 *  2. **The participle takes a prefix, not a suffix.** "gewachsen" is
 *     "wachsen" with `ge-` on the front, and "wir sind um vierzig Prozent
 *     gewachsen" against "wir wachsen um vierzig Prozent" is the same claim.
 *  3. **The filler is a real word.** English needs the ASR to be asked for
 *     "um"; German says "also", "halt", "eben", "quasi", which every ASR
 *     transcribes without being asked. So this list earns its keep — but
 *     every one of those words is also load-bearing in some sentence, which
 *     is why a filler is only ever cut when it sits in its own pocket of
 *     silence.
 */

const FUNCTION_WORDS = new Set([
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'man', 'mich', 'mir', 'dich', 'dir', 'sich',
  'uns', 'euch', 'ihm', 'ihn', 'ihnen', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein',
  'eine', 'einen', 'einem', 'einer', 'eines', 'kein', 'keine', 'und', 'oder', 'aber', 'denn',
  'doch', 'so', 'dann', 'wenn', 'ob', 'von', 'vom', 'zu', 'zum', 'zur', 'in', 'im', 'an',
  'am', 'auf', 'bei', 'beim', 'mit', 'aus', 'nach', 'uber', 'unter', 'vor', 'fur', 'um',
  'durch', 'gegen', 'ohne', 'als', 'wie', 'ist', 'sind', 'war', 'waren', 'bin', 'bist',
  'sein', 'haben', 'hat', 'hatte', 'hast', 'habe', 'werden', 'wird', 'wurde', 'worden',
  'hier', 'da', 'dort', 'jetzt', 'nur', 'auch', 'noch', 'schon', 'mal', 'eben', 'halt',
  'eigentlich', 'wirklich', 'sehr', 'ganz', 'etwas', 'nichts', 'alles', 'viel', 'mehr',
  'was', 'wer', 'warum', 'wo', 'weil', 'nicht', 'ja', 'nein', 'okay', 'ding', 'sache',
  'zeug', 'dies', 'diese', 'dieser', 'dieses', 'jede', 'jeder', 'jedes', 'alle', 'einige',
  'immer', 'nie', 'wieder', 'dass', 'damit', 'also', 'quasi', 'irgendwie', 'vielleicht',
  'wahrscheinlich', 'fast', 'rund', 'innerhalb', 'bereits', 'mir', 'gerade', 'genau',
]);

const SYNONYMS: Record<string, string> = {
  beginnen: 'anfangen', starten: 'anfangen', losgehen: 'anfangen', loslegen: 'anfangen',
  beenden: 'enden', aufhoren: 'enden', abschliessen: 'enden', fertigstellen: 'enden',
  riesig: 'gross', enorm: 'gross', gigantisch: 'gross', massiv: 'gross',
  winzig: 'klein', gering: 'klein',
  erstellen: 'machen', erzeugen: 'machen', bauen: 'machen', herstellen: 'machen',
  produzieren: 'machen', basteln: 'machen',
  darstellen: 'zeigen', praesentieren: 'zeigen', vorfuhren: 'zeigen',
  rasch: 'schnell', zugig: 'schnell', fix: 'schnell',
  leicht: 'einfach', simpel: 'einfach', unkompliziert: 'einfach',
  schwierig: 'schwer', kompliziert: 'schwer', knifflig: 'schwer',
  entscheidend: 'wichtig', zentral: 'wichtig', wesentlich: 'wichtig', essenziell: 'wichtig',
  super: 'gut', toll: 'gut', klasse: 'gut', genial: 'gut', hervorragend: 'gut', stark: 'gut',
  schlimm: 'schlecht', furchtbar: 'schlecht', mies: 'schlecht', katastrophal: 'schlecht',
  erwerben: 'kaufen', besorgen: 'kaufen',
  nutzen: 'benutzen', verwenden: 'benutzen', einsetzen: 'benutzen',
  glauben: 'denken', meinen: 'denken', vermuten: 'denken', finden: 'denken',
  erzahlen: 'sagen', erwahnen: 'sagen', berichten: 'sagen',
  ansehen: 'sehen', anschauen: 'sehen', schauen: 'sehen', gucken: 'sehen',
  kohle: 'geld', umsatz: 'geld', einnahmen: 'geld',
  menschen: 'leute', personen: 'leute', jeder: 'leute',
  brauchen: 'mussen', sollen: 'mussen', notig: 'mussen',
  unterstutzen: 'helfen',
  verbessern: 'besser', optimieren: 'besser', aufwerten: 'besser',
  reduzieren: 'senken', verringern: 'senken', kurzen: 'senken',
  steigen: 'wachsen', erhohen: 'wachsen', zunehmen: 'wachsen', steigern: 'wachsen',
  clip: 'video', aufnahme: 'video', material: 'video',
  drehen: 'filmen', aufnehmen: 'filmen',
  komplett: 'ganz', vollstandig: 'ganz',
};

/**
 * Strong verbs and the modals, which no suffix rule reaches. Written in the
 * form the stemmer produces, so the table is consulted after folding.
 */
const IRREGULARS: Record<string, string> = {
  musst: 'muss', mussen: 'muss', musste: 'muss', mussten: 'muss', muessen: 'muss',
  kann: 'kann', kannst: 'kann', konnen: 'kann', konnte: 'kann', konnten: 'kann',
  will: 'will', willst: 'will', wollen: 'will', wollte: 'will', wollten: 'will',
  soll: 'muss', sollst: 'muss', sollte: 'muss', sollten: 'muss',
  darf: 'darf', durfen: 'darf', durfte: 'darf',
  bin: 'sein', bist: 'sein', ist: 'sein', sind: 'sein', seid: 'sein', war: 'sein',
  waren: 'sein', warst: 'sein', gewesen: 'sein',
  habe: 'haben', hast: 'haben', hat: 'haben', hatte: 'haben', hatten: 'haben',
  gehabt: 'haben',
  wird: 'werden', werde: 'werden', wirst: 'werden', wurde: 'werden', wurden: 'werden',
  geht: 'gehen', ging: 'gehen', gegangen: 'gehen',
  gibt: 'geben', gab: 'geben', gegeben: 'geben',
  nimmt: 'nehmen', nahm: 'nehmen', genommen: 'nehmen',
  spricht: 'sprechen', sprach: 'sprechen', gesprochen: 'sprechen',
  begonnen: 'anfangen', begann: 'anfangen', angefangen: 'anfangen', fangt: 'anfangen',
  gewachsen: 'wachsen', wuchs: 'wachsen',
  gemacht: 'machen', macht: 'machen',
  gesagt: 'sagen', sagt: 'sagen',
  gedacht: 'denken', denkt: 'denken',
  gesehen: 'sehen', sieht: 'sehen', sah: 'sehen',
  weiss: 'wissen', wusste: 'wissen', gewusst: 'wissen',
};

const PHRASES: Array<[string[], string[]]> = [
  [['eine', 'menge'], ['viel']],
  [['ein', 'paar'], ['einige']],
  [['zum', 'beispiel'], ['beispiel']],
  [['auf', 'jeden', 'fall'], ['sicher']],
  [['im', 'endeffekt'], ['letztlich']],
  [['nicht', 'wahr'], []],
  [['weisst', 'du'], []],
  [['oder', 'so'], []],
];

/**
 * Lowercase, ß→ss, umlauts folded, the participle's `ge-` taken off, then the
 * suffix. Minimum three characters out, because a German stem shorter than
 * that matches far too much.
 */
function stem(word: string): string {
  let out = deaccent(word.replace(/ß/g, 'ss'));
  if (out.length < 4) return out;

  // "gewachsen" is "wachsen" wearing a participle. "gegen" and "gerade" are
  // not, hence the length floor on what is left behind.
  if (/^ge/.test(out) && out.length >= 7) {
    const bare = out.slice(2);
    if (/^[bcdfghjklmnpqrstvwxz]/.test(bare)) out = bare;
  }

  // Longest suffix first, one only: "Wohnungen" loses "ungen", not "en"
  // and then "ung".
  for (const suffix of ['ungen', 'ung', 'ern', 'est', 'end', 'en', 'em', 'er', 'es', 'st', 'te', 'e', 'n', 't', 's']) {
    if (!out.endsWith(suffix)) continue;
    const cut = out.slice(0, -suffix.length);
    // Three characters is the floor. Below it a German stem matches half the
    // language — and "muss" shortened to "mus" matches the wrong half.
    if (cut.length >= 3) out = cut;
    break;
  }
  return out;
}

export const GERMAN: LanguagePack = {
  code: 'de',
  name: 'German',
  endonym: 'Deutsch',

  fillers: new Set([
    'äh', 'ähm', 'ah', 'ahm', 'öh', 'öhm', 'hm', 'hmm', 'mh', 'mhm', 'em', 'ähem',
    'tja', 'naja', 'ne', 'nä', 'gell', 'halt', 'eben', 'quasi', 'sozusagen', 'irgendwie',
    /*
     * "Also" is the German "so" and the German "um" at once. As the first
     * word out of somebody's mouth it is pure throat-clearing — "Also, der
     * Punkt ist…" is a better video without it — and anywhere else the
     * isolation rule protects it, because a load-bearing "also" sits inside
     * a sentence with no pause around it.
     */
    'also', 'nun', 'ja',
  ]),

  hedgePhrases: [
    ['weißt', 'du'], ['ich', 'meine'], ['so', 'gesehen'], ['mehr', 'oder', 'weniger'],
    ['im', 'grunde'], ['eigentlich'], ['praktisch'], ['sag', 'ich', 'mal'],
  ],

  functionWords: FUNCTION_WORDS,

  strongFrames: [
    'was ich meine ist', 'was ich sagen will ist', 'was ich eigentlich sagen will ist',
    'was ich damit sagen will ist', 'ich will damit sagen', 'anders gesagt',
    'mit anderen worten', 'oder besser gesagt', 'besser gesagt', 'genauer gesagt',
    'anders formuliert', 'nochmal anders', 'lass mich das anders sagen', 'ich sag es nochmal',
    'ich sage es nochmal', 'um es klar zu sagen', 'um das klarzustellen', 'das heißt',
    'das heisst', 'sprich', 'beziehungsweise', 'entschuldigung', 'sorry', 'ich meine',
    'der punkt ist', 'mein punkt ist', 'worauf ich hinaus will',
  ],

  weakFrames: [
    'also nochmal', 'okay also', 'ja also', 'gut also', 'na also', 'und dann', 'schau mal',
    'schau', 'hör zu', 'hor zu', 'im grunde', 'im prinzip', 'grundsätzlich', 'eigentlich',
    'also', 'und', 'aber', 'so', 'na', 'naja', 'tja', 'ja', 'okay', 'gut', 'jetzt', 'nochmal',
  ],

  trailingHedges: [
    'glaube ich', 'denke ich', 'würde ich sagen', 'wurde ich sagen', 'sag ich mal',
    'weißt du', 'weisst du', 'oder so', 'oder was weiß ich', 'nicht wahr', 'oder',
    'mehr oder weniger', 'wenn das sinn macht', 'verstehst du',
  ],

  sequencingOpeners: [
    'dann', 'und dann', 'danach', 'als nächstes', 'als nachstes', 'zweitens', 'drittens',
    'zum schluss', 'zuletzt', 'außerdem', 'ausserdem', 'anschließend', 'anschliessend',
    'erstens', 'zuerst', 'schritt zwei', 'schritt drei', 'übrigens', 'ubrigens',
    'darüber hinaus', 'daruber hinaus', 'zusätzlich', 'zusatzlich', 'weiter',
  ],

  coordinators: ['und', 'oder', 'sowie'],

  subordinators: new Set([
    'wenn', 'falls', 'weil', 'obwohl', 'wahrend', 'bis', 'bevor', 'nachdem', 'sobald',
    'solange', 'sofern', 'ausser', 'ohne', 'anstatt', 'sodass', 'wohingegen',
  ]),

  clauseOpeners: new Set([
    'aber', 'und', 'oder', 'weil', 'denn', 'dass', 'wenn', 'als', 'obwohl', 'sondern', 'also',
    'doch', 'damit', 'sodass', 'wobei', 'wahrend', 'bis', 'bevor',
  ]),

  negations: new Set(['nicht', 'kein', 'keine', 'keinen', 'keiner', 'nie', 'niemals', 'nichts', 'niemand',
    'ohne', 'weder']),

  numberWords: {
    null: '0', eins: '1', ein: '1', eine: '1', zwei: '2', drei: '3', vier: '4', fünf: '5',
    sechs: '6', sieben: '7', acht: '8', neun: '9', zehn: '10', elf: '11', zwölf: '12',
    dreizehn: '13', vierzehn: '14', fünfzehn: '15', sechzehn: '16', siebzehn: '17',
    achtzehn: '18', neunzehn: '19', zwanzig: '20', dreißig: '30', dreissig: '30',
    vierzig: '40', fünfzig: '50', sechzig: '60', siebzig: '70', achtzig: '80',
    neunzig: '90', hundert: '100', tausend: '1000', million: '1000000',
    millionen: '1000000', milliarde: '1000000000', milliarden: '1000000000',
  },

  synonyms: SYNONYMS,
  irregulars: IRREGULARS,
  phrases: PHRASES,

  // "Was ich eigentlich sagen will ist …" — the verb goes to the end, so the
  // German lead-in runs longer than the English one before the copula.
  genericFrame: {
    openers: ['was', 'der', 'die', 'das', 'dies', 'alles', 'mein', 'hier', 'da'],
    copulas: ['ist', 'war'],
    maxGap: 5,
  },

  punch: {
    figure:
      /(?:\d[\d.,]*\s*(?:%|x\b|k\b|m\b|mio\b)?|\bprozent\b|\b(?:zwanzig|drei(?:ß|ss)ig|vierzig|f(?:ü|ue)nfzig|sechzig|siebzig|achtzig|neunzig|hundert|tausend|million(?:en)?|milliarde(?:n)?|dutzend)\b)/i,
    pivotOpens:
      /^(?:und\s+|also\s+|aber\s+|jetzt\s+)?(?:aber|jedoch|allerdings|trotzdem|dennoch|stattdessen|eigentlich|nur)\b/i,
    pivotAnywhere:
      /\b(?:das ding ist|die sache ist|das problem ist|die wahrheit ist|der punkt ist|deswegen|deshalb|darum|es stellt sich heraus|der fehler (?:ist|war))\b/i,
    superlative:
      /\b(?:nie|niemals|immer|niemand|keiner|jeder|alle|der einzige|die einzige|das einzige|der beste|die beste|das beste|der schlechteste|der gr(?:ö|oe)(?:ß|ss)te|der schnellste|am wichtigsten|wirklich jeder|buchst(?:ä|ae)blich)\b/i,
  },

  stem,
  elision: false,

  markers: ['und', 'ist', 'nicht', 'ich', 'das', 'die', 'der', 'auch', 'sind', 'dass', 'mit', 'für'],
  asrCode: 'de',
  // Measured: German `smart_format` writes "40 Prozent" correctly, where the
  // French and Spanish formatters turn "pour cent" into the numeral 100.
  smartFormat: true,
};
