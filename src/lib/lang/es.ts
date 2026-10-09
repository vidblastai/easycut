import { deaccent, type LanguagePack } from './types';

/**
 * Spanish.
 *
 * The conjugation does the work here — "crecimos", "crecer", "crece" are one
 * verb and no two of them share a suffix — so the stemmer carries a longer
 * list of endings than the others. What it cannot reach is the stem-changing
 * verb: "tienes" is "tener" and "empieza" is "empezar", and no rule gets
 * from one to the other. Those are in `irregulars`, which is why that table
 * is the biggest of the four.
 *
 * Fillers are mostly real words — "bueno", "pues", "o sea", "este" — so the
 * isolation rule matters more here than in English: "bueno" alone in a pocket
 * of silence is noise, and "bueno" inside a sentence is the word "good".
 */

const FUNCTION_WORDS = new Set([
  'yo', 'tu', 'el', 'ella', 'usted', 'nosotros', 'vosotros', 'ellos', 'ellas', 'me', 'te',
  'se', 'nos', 'os', 'le', 'les', 'lo', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'a', 'en', 'con', 'sin', 'por', 'para', 'sobre', 'entre', 'desde',
  'hasta', 'hacia', 'y', 'e', 'o', 'u', 'pero', 'pues', 'que', 'quien', 'cual', 'como',
  'cuando', 'donde', 'porque', 'si', 'no', 'es', 'son', 'era', 'eran', 'soy', 'eres',
  'ser', 'estar', 'esta', 'estan', 'estoy', 'hay', 'he', 'has', 'ha', 'hemos', 'han',
  'haber', 'muy', 'mas', 'menos', 'mucho', 'muchos', 'poco', 'todo', 'todos', 'toda',
  'nada', 'algo', 'cosa', 'cosas', 'aqui', 'ahi', 'alli', 'ahora', 'ya', 'tambien', 'aun',
  'todavia', 'solo', 'bien', 'vale', 'ok', 'entonces', 'asi', 'este', 'esta', 'esto',
  'ese', 'esa', 'eso', 'mi', 'su', 'sus', 'nuestro', 'tus', 'casi', 'alrededor',
  'dentro', 'quiza', 'probablemente', 'realmente', 'simplemente', 'justo',
]);

const SYNONYMS: Record<string, string> = {
  comenzar: 'empezar', iniciar: 'empezar', arrancar: 'empezar', lanzar: 'empezar',
  terminar: 'acabar', finalizar: 'acabar', concluir: 'acabar',
  enorme: 'grande', inmenso: 'grande', gigante: 'grande', masivo: 'grande',
  pequeno: 'pequeno', diminuto: 'pequeno', minusculo: 'pequeno',
  crear: 'hacer', construir: 'hacer', producir: 'hacer', fabricar: 'hacer',
  montar: 'hacer', armar: 'hacer',
  mostrar: 'mostrar', demostrar: 'mostrar', presentar: 'mostrar', ensenar: 'mostrar',
  rapido: 'rapido', veloz: 'rapido', agil: 'rapido',
  facil: 'facil', sencillo: 'facil', simple: 'facil',
  dificil: 'dificil', complicado: 'dificil', duro: 'dificil',
  crucial: 'importante', esencial: 'importante', clave: 'importante', vital: 'importante',
  genial: 'bueno', excelente: 'bueno', increible: 'bueno', brutal: 'bueno',
  terrible: 'malo', horrible: 'malo', penoso: 'malo',
  comprar: 'comprar', adquirir: 'comprar',
  usar: 'usar', utilizar: 'usar', emplear: 'usar',
  pensar: 'pensar', creer: 'pensar', opinar: 'pensar',
  decir: 'decir', contar: 'decir', mencionar: 'decir',
  mirar: 'ver', ver: 'ver', observar: 'ver',
  dinero: 'dinero', plata: 'dinero', ingresos: 'dinero', facturacion: 'dinero',
  gente: 'gente', personas: 'gente', todos: 'gente',
  necesitar: 'deber', deber: 'deber', requerir: 'deber',
  ayudar: 'ayudar', apoyar: 'ayudar',
  mejorar: 'mejor', optimizar: 'mejor',
  reducir: 'bajar', disminuir: 'bajar',
  crecer: 'crecer', aumentar: 'crecer', subir: 'crecer', incrementar: 'crecer',
  clip: 'video', metraje: 'video', grabacion: 'video',
  grabar: 'filmar', filmar: 'filmar', rodar: 'filmar',
  entero: 'todo', completo: 'todo',
};

const IRREGULARS: Record<string, string> = {
  tengo: 'tener', tienes: 'tener', tiene: 'tener', tenemos: 'tener', tienen: 'tener',
  tenia: 'tener', tuve: 'tener', tendras: 'tener',
  puedo: 'poder', puedes: 'poder', puede: 'poder', podemos: 'poder', pueden: 'poder',
  podia: 'poder', pude: 'poder', podria: 'poder',
  quiero: 'querer', quieres: 'querer', quiere: 'querer', queremos: 'querer',
  quieren: 'querer', queria: 'querer',
  empiezo: 'empezar', empiezas: 'empezar', empieza: 'empezar', empiezan: 'empezar',
  empece: 'empezar', empezado: 'empezar',
  comienzo: 'empezar', comienzas: 'empezar', comienza: 'empezar', comienzan: 'empezar',
  voy: 'ir', vas: 'ir', va: 'ir', vamos: 'ir', van: 'ir', iba: 'ir', fui: 'ir',
  hago: 'hacer', haces: 'hacer', hace: 'hacer', hacemos: 'hacer', hacen: 'hacer',
  hice: 'hacer', hecho: 'hacer', haria: 'hacer',
  digo: 'decir', dices: 'decir', dice: 'decir', decimos: 'decir', dicen: 'decir',
  dije: 'decir', dicho: 'decir',
  veo: 'ver', ves: 'ver', ve: 'ver', vemos: 'ver', ven: 'ver', visto: 'ver', vi: 'ver',
  se: 'saber', sabes: 'saber', sabe: 'saber', sabemos: 'saber', saben: 'saber',
  pongo: 'poner', pones: 'poner', pone: 'poner', ponemos: 'poner', puesto: 'poner',
  soy: 'ser', eres: 'ser', es: 'ser', somos: 'ser', son: 'ser', era: 'ser', fue: 'ser',
  sido: 'ser', sera: 'ser',
  estoy: 'estar', estas: 'estar', esta: 'estar', estamos: 'estar', estan: 'estar',
  estaba: 'estar', estado: 'estar',
  crecimos: 'crecer', crecio: 'crecer', crecido: 'crecer', crece: 'crecer',
  anades: 'anadir', anade: 'anadir', anado: 'anadir',
};

const PHRASES: Array<[string[], string[]]> = [
  // Unit, not number: "cuarenta por ciento" must not carry the figure 100.
  [['por', 'ciento'], ['percent']],
  [['tienes', 'que'], ['deber']],
  [['tiene', 'que'], ['deber']],
  [['hay', 'que'], ['deber']],
  [['tengo', 'que'], ['deber']],
  [['debes', 'de'], ['deber']],
  [['un', 'monton', 'de'], ['mucho']],
  [['muchas', 'veces'], ['frecuentemente']],
  [['por', 'ejemplo'], ['ejemplo']],
  [['o', 'sea'], []],
  [['es', 'decir'], ['esdecir']],
  [['de', 'hecho'], []],
  [['la', 'verdad'], []],
  [['todo', 'el', 'mundo'], ['gente']],
];

/** Accents off, then the conjugation. Three characters minimum. */
function stem(word: string): string {
  let out = deaccent(word);
  if (out.length < 4) return out;
  for (const suffix of [
    'aciones', 'acion', 'amente', 'mente', 'abamos', 'aremos', 'eremos', 'iremos',
    'amos', 'emos', 'imos', 'aron', 'ieron', 'ando', 'iendo', 'ados', 'adas', 'ado',
    'ada', 'ares', 'eres', 'ires', 'ar', 'er', 'ir', 'es', 'os', 'as', 'an', 'en',
    'a', 'o', 'e', 's',
  ]) {
    if (!out.endsWith(suffix)) continue;
    const cut = out.slice(0, -suffix.length);
    if (cut.length >= 3) out = cut;
    break;
  }
  return out;
}

export const SPANISH: LanguagePack = {
  code: 'es',
  name: 'Spanish',
  endonym: 'Español',

  fillers: new Set([
    'eh', 'ehh', 'em', 'este', 'esto', 'pues', 'bueno', 'digamos', 'tipo', 'nada',
    'mmm', 'ajá', 'aja', 'vale',
  ]),

  hedgePhrases: [
    ['o', 'sea'], ['es', 'decir'], ['la', 'verdad'], ['digamos', 'que'],
    ['más', 'o', 'menos'], ['mas', 'o', 'menos'], ['de', 'alguna', 'manera'],
    ['no', 'sé'], ['sabes'],
  ],

  functionWords: FUNCTION_WORDS,

  strongFrames: [
    'lo que quiero decir es', 'lo que quiero decir', 'lo que intento decir es',
    'lo que trato de decir es', 'lo que queria decir es', 'en otras palabras',
    'dicho de otra forma', 'dicho de otro modo', 'mejor dicho', 'o mas bien',
    'dejame reformularlo', 'lo repito', 'lo digo otra vez', 'para que quede claro',
    'para ser claro', 'mas concretamente', 'es decir', 'o sea', 'quiero decir',
    'perdon', 'perdona', 'disculpa', 'el punto es', 'mi punto es', 'lo importante es',
  ],

  weakFrames: [
    'bueno pues', 'vale pues', 'okay pues', 'si pues', 'y luego', 'mira', 'escucha',
    'basicamente', 'en principio', 'en general', 'bueno', 'pues', 'y', 'pero',
    'entonces', 'asi que', 'vale', 'ahora', 'ya', 'o sea',
  ],

  trailingHedges: [
    'creo', 'creo yo', 'pienso yo', 'diria yo', 'me parece', 'sabes', 'no se',
    'o algo asi', 'mas o menos', 'si tiene sentido', 'verdad', 'no',
  ],

  sequencingOpeners: [
    'luego', 'despues', 'y luego', 'y despues', 'segundo', 'tercero', 'por ultimo',
    'finalmente', 'ademas', 'tambien', 'primero', 'paso dos', 'paso tres',
    'por otro lado', 'aparte', 'encima', 'a continuacion',
  ],

  coordinators: ['y', 'e', 'o', 'u', 'ni'],

  subordinators: new Set([
    'si', 'salvo', 'cuando', 'porque', 'aunque', 'mientras', 'hasta', 'antes',
    'despues', 'sin', 'menos', 'siempre', 'ya', 'puesto', 'mientras', 'excepto',
  ]),

  clauseOpeners: new Set([
    'pero', 'y', 'e', 'o', 'porque', 'que', 'quien', 'cuando', 'si', 'entonces', 'pues', 'aunque',
    'sino', 'como', 'mientras', 'salvo',
  ]),

  negations: new Set(['no', 'nunca', 'jamás', 'jamas', 'nada', 'ningún', 'ningun', 'ninguna', 'nadie',
    'sin', 'ni', 'tampoco']),

  numberWords: {
    cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5',
    seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12',
    trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17',
    dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40',
    cincuenta: '50', sesenta: '60', setenta: '70', ochenta: '80', noventa: '90',
    cien: '100', ciento: '100', mil: '1000', millon: '1000000', millones: '1000000',
    medio: '0.5',
  },

  synonyms: SYNONYMS,
  irregulars: IRREGULARS,
  phrases: PHRASES,

  genericFrame: {
    openers: ['lo', 'el', 'la', 'esto', 'mi', 'todo', 'aqui'],
    copulas: ['es', 'era'],
    maxGap: 4,
  },

  punch: {
    figure:
      /(?:\d[\d.,]*\s*(?:%|x\b|k\b|m\b)?|\bpor ?ciento\b|\b(?:veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil|mill(?:ó|o)n|millones|docena)\b)/i,
    pivotOpens:
      /^(?:y\s+|entonces\s+|pero\s+|ahora\s+)?(?:pero|sin embargo|aunque|salvo|en cambio|al contrario|en realidad|m(?:á|a)s bien)\b/i,
    pivotAnywhere:
      /\b(?:la cosa es|el tema es|el problema es|la verdad es|el punto es|por eso|resulta que|el error (?:es|fue))\b/i,
    superlative:
      /\b(?:nunca|jam(?:á|a)s|siempre|nadie|ninguno|todos|todo el mundo|el (?:ú|u)nico|la (?:ú|u)nica|el mejor|la mejor|el peor|el m(?:á|a)s grande|el m(?:á|a)s r(?:á|a)pido|lo m(?:á|a)s importante|literalmente)\b/i,
  },

  stem,
  elision: false,

  markers: ['que', 'de', 'la', 'el', 'es', 'por', 'los', 'una', 'con', 'para', 'pero', 'como'],
  asrCode: 'es',
  /*
   * Measured: `smart_format` reads "por ciento" as the numeral and writes
   * "40 por 100" into the captions. Off.
   */
  smartFormat: false,
};
