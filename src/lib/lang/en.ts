import type { LanguagePack } from './types';

/**
 * English. The reference pack — the other three are built to match its
 * shape, and anything the pipeline needs that is missing from them falls
 * back to here.
 */

const FUNCTION_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'we', 'our', 'us', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
  'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'a', 'an', 'the',
  'and', 'or', 'but', 'so', 'then', 'if', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'by', 'as', 'be', 'do', 'go', 'get', 'got', 'have', 'has', 'had', 'there', 'here', 'about',
  'just', 'like', 'well', 'okay', 'ok', 'now', 'really', 'very', 'actually', 'basically',
  'literally', 'anyway', 'yeah', 'yes', 'no', 'not', 'dont', 'im', 'ive', 'thats', 'kind',
  'sort', 'lot', 'also', 'too', 'even', 'still', 'again', 'right', 'thing', 'stuff',
  'something', 'anything', 'everything', 'one', 'some', 'any', 'all', 'more', 'most', 'what',
  'which', 'who', 'whom', 'how', 'why', 'when', 'where', 'because', 'out', 'up', 'down',
  'over', 'into', 'than', 'much', 'many', 'own', 'off', 'onto', 'per',
  'almost', 'nearly', 'within', 'around', 'maybe', 'probably', 'already',
]);

const SYNONYMS: Record<string, string> = {
  begin: 'start', commence: 'start', launch: 'start', kick: 'start',
  finish: 'end', complete: 'end', wrap: 'end', conclude: 'end',
  huge: 'big', massive: 'big', enormous: 'big', giant: 'big', large: 'big',
  tiny: 'small', little: 'small', minor: 'small',
  create: 'make', build: 'make', produce: 'make', construct: 'make',
  demonstrate: 'show', reveal: 'show', display: 'show',
  fast: 'quick', rapid: 'quick', speedy: 'quick',
  simple: 'easy', straightforward: 'easy', effortless: 'easy',
  difficult: 'hard', tough: 'hard', tricky: 'hard',
  crucial: 'important', key: 'important', vital: 'important', essential: 'important',
  critical: 'important', major: 'important',
  great: 'good', awesome: 'good', amazing: 'good', excellent: 'good', brilliant: 'good',
  terrible: 'bad', awful: 'bad', horrible: 'bad', poor: 'bad',
  purchase: 'buy', acquire: 'buy',
  utilize: 'use', utilise: 'use', employ: 'use',
  believe: 'think', reckon: 'think', figure: 'think', suppose: 'think',
  tell: 'say', mention: 'say', state: 'say',
  watch: 'look', see: 'look', view: 'look',
  cash: 'money', revenue: 'money', income: 'money',
  folk: 'people', guy: 'people', person: 'people', everybody: 'people', everyone: 'people',
  need: 'must', require: 'must', ought: 'must',
  assist: 'help',
  improve: 'better', enhance: 'better', upgrade: 'better',
  reduce: 'cut', decrease: 'cut', lower: 'cut', shrink: 'cut',
  increase: 'grow', raise: 'grow', boost: 'grow', expand: 'grow',
  clip: 'video', footage: 'video',
  film: 'shoot', record: 'shoot', capture: 'shoot', filming: 'shoot',
  should: 'must', shall: 'must',
  entire: 'whole',
};

const IRREGULARS: Record<string, string> = {
  is: 'be', are: 'be', was: 'be', were: 'be', am: 'be', been: 'be', being: 'be',
  does: 'do', did: 'do', doing: 'do', done: 'do',
  goes: 'go', going: 'go', went: 'go', gone: 'go',
  gets: 'get', getting: 'get', gotten: 'get',
  made: 'make', said: 'say', told: 'say', took: 'take', taken: 'take',
  thought: 'think', brought: 'bring', bought: 'buy', built: 'make',
  grew: 'grow', grown: 'grow', ran: 'run', came: 'come', gave: 'give',
  meant: 'mean', kept: 'keep', left: 'leave', felt: 'feel', found: 'find',
  knew: 'know', known: 'know', saw: 'look', seen: 'look', shown: 'show',
  has: 'have', had: 'have', having: 'have', lost: 'lose', spent: 'spend',
};

const PHRASES: Array<[string[], string[]]> = [
  [['have', 'to'], ['must']],
  [['has', 'to'], ['must']],
  [['had', 'to'], ['must']],
  [['got', 'to'], ['must']],
  [['gotta'], ['must']],
  [['need', 'to'], ['must']],
  [['needs', 'to'], ['must']],
  [['ought', 'to'], ['must']],
  [['supposed', 'to'], ['must']],
  [['going', 'to'], ['will']],
  [['gonna'], ['will']],
  [['you', 'want', 'to'], ['you', 'must']],
  [['you', 'wanna'], ['you', 'must']],
  [['you', 'always', 'want', 'to'], ['you', 'always', 'must']],
  [['a', 'lot'], ['many']],
  [['tons', 'of'], ['many']],
  [['loads', 'of'], ['many']],
  [['plenty', 'of'], ['many']],
  [['kick', 'off'], ['start']],
  [['give', 'up'], ['quit']],
  [['end', 'up'], ['end']],
  [['come', 'down', 'to'], ['be']],
  [['figure', 'out'], ['solve']],
  [['work', 'out'], ['solve']],
  [['set', 'up'], ['setup']],
  [['make', 'sure'], ['ensure']],
];

/**
 * Enough stemming to join "saying" to "say" and no more. A real stemmer
 * would also join "starting" to "star", which is how two unrelated sentences
 * end up scoring as a match.
 */
function stem(word: string): string {
  if (word.length < 4) return word;
  let out = word;
  if (out.endsWith('ies') && out.length >= 5) out = `${out.slice(0, -3)}y`;
  else if (out.endsWith('ing') && out.length >= 5) out = undouble(out.slice(0, -3));
  else if (out.endsWith('ed') && out.length >= 5) out = undouble(out.slice(0, -2));
  else if (out.endsWith('es') && out.length >= 5) out = out.slice(0, -2);
  else if (out.endsWith('s') && !/(?:ss|us|is)$/.test(out)) out = out.slice(0, -1);
  // And then the silent 'e': "make" and "making" strip to "make" and "mak",
  // and a comparison that cannot see those as one word cannot see a retake.
  if (out.endsWith('e') && out.length > 2) out = out.slice(0, -1);
  return out.length >= 2 ? out : word;
}

function undouble(stemmed: string): string {
  const last = stemmed.at(-1);
  const prev = stemmed.at(-2);
  if (last && last === prev && !'lsz'.includes(last)) return stemmed.slice(0, -1);
  return stemmed;
}

export const ENGLISH: LanguagePack = {
  code: 'en',
  name: 'English',
  endonym: 'English',

  fillers: new Set(['um', 'uh', 'umm', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm', 'eh']),

  hedgePhrases: [
    ['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'],
    ['basically'], ['literally'], ['actually'],
  ],

  functionWords: FUNCTION_WORDS,

  strongFrames: [
    'what i mean is', 'what i meant is', "what i'm saying is", 'what im saying is',
    "what i'm trying to say is", 'what im trying to say is', 'all im saying is',
    "all i'm saying is", 'in other words', 'put another way', 'to put it another way',
    'another way to say', 'or rather', 'or better yet', 'better yet', 'which is to say',
    'let me say that again', 'let me rephrase', 'let me put it this way', 'let me try that again',
    'let me try again', 'say that again', 'to be clear', 'to put it simply', 'put simply',
    'i should say', 'i mean to say', 'scratch that', 'sorry', 'i mean', 'or actually',
    'the point is', 'my point is', 'the point being', 'point is',
  ],

  weakFrames: [
    'so basically', 'okay so', 'ok so', 'alright so', 'right so', 'and so', 'so look',
    'look', 'listen', 'see', 'now', 'basically', 'essentially', 'anyway', 'and then',
    'so', 'and', 'but', 'well', 'yeah', 'okay', 'ok', 'alright', 'again',
  ],

  trailingHedges: [
    'i think', 'i guess', 'you know', 'or whatever', 'or something', 'more or less',
    'i suppose', 'if that makes sense', 'right', 'you know what i mean',
  ],

  sequencingOpeners: [
    'then', 'and then', 'next', 'after that', 'second', 'secondly', 'third', 'thirdly',
    'finally', 'lastly', 'also', 'plus', 'another', 'the other', 'meanwhile', 'later',
    'first', 'firstly', 'step two', 'step three', 'now for', 'as for', 'on top of that',
  ],

  coordinators: ['and', 'or'],

  subordinators: new Set([
    'if', 'unless', 'until', 'when', 'whenever', 'because', 'since', 'although',
    'though', 'while', 'whereas', 'provided', 'assuming', 'once', 'before',
    'after', 'except', 'without', 'versus',
  ]),

  clauseOpeners: new Set([
    'but', 'so', 'and', 'or', 'because', 'cause', 'which', 'that', 'than', 'if', 'when', 'while',
    'though', 'although', 'since', 'where', 'whereas', 'plus', 'like', 'as',
  ]),

  negations: new Set(['not', 'dont', 'doesnt', 'didnt', 'cant', 'cannot', 'wont', 'isnt', 'arent', 'wasnt',
    'never', 'no', 'none', 'nobody', 'nothing', 'nor', 'without', 'havent', 'hasnt']),

  numberWords: {
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
    eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', thirteen: '13',
    fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18',
    nineteen: '19', twenty: '20', thirty: '30', forty: '40', fourty: '40', fifty: '50',
    sixty: '60', seventy: '70', eighty: '80', ninety: '90', hundred: '100',
    thousand: '1000', million: '1000000', billion: '1000000000',
  },

  synonyms: SYNONYMS,
  irregulars: IRREGULARS,
  phrases: PHRASES,

  genericFrame: {
    openers: ['what', 'the', 'that', 'this', 'all', 'my', 'here', 'there'],
    copulas: ['is', 'was'],
    maxGap: 4,
  },

  punch: {
    figure:
      /(?:\d[\d.,]*\s*(?:%|x\b|k\b|m\b)?|\bper ?cent\b|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen)\b)/i,
    pivotOpens: /^(?:and\s+|so\s+|but\s+|now\s+)?(?:but|however|except|instead|actually|still|yet)\b/i,
    pivotAnywhere:
      /\b(?:here'?s the (?:thing|problem|catch)|the (?:truth|problem|point|catch|reality) is|that'?s (?:why|exactly why)|which is why|turns out|the mistake)\b/i,
    superlative:
      /\b(?:never|always|nobody|no one|everyone|everybody|literally|the only|the best|the worst|the biggest|the fastest|the hardest|the single|most important)\b/i,
  },

  stem,
  elision: false,

  markers: ['the', 'and', 'you', 'that', 'is', 'to', 'of', 'it', 'what', 'we'],
  asrCode: 'en',
  smartFormat: true,
};
