/**
 * What a generated B-roll insert is asked for.
 *
 * Its own module, and not because it is long: it is imported by BOTH generation
 * paths, and when it lived inside one of them the other kept a weaker copy of
 * the rule. That copy is what produced the giveaway in the first test render —
 * a generated barista with a generated face, under a wall of confident gibberish
 * signage. Two copies of a rule is one rule and one bug.
 */

/**
 * Words that mean the subject of the shot is a PERSON.
 *
 * Not a content filter — a giveaway detector. Everything below is about the
 * one thing that tells a viewer they are looking at a generated shot, and it
 * is always the same thing.
 */
const PEOPLE = new RegExp(
  '\\b(' +
    [
      'person', 'people', 'man', 'men', 'woman', 'women', 'guy', 'guys', 'girl', 'girls',
      'boy', 'boys', 'someone', 'somebody', 'human', 'humans', 'crowd', 'crowds', 'team',
      'audience', 'family', 'friends', 'couple', 'kid', 'kids', 'child', 'children', 'baby',
      'customer', 'customers', 'client', 'clients', 'founder', 'founders', 'developer',
      'developers', 'worker', 'workers', 'employee', 'employees', 'student', 'students',
      'teacher', 'doctor', 'nurse', 'barista', 'chef', 'athlete', 'runner', 'speaker',
      'entrepreneur', 'manager', 'designer', 'artist', 'musician', 'model', 'portrait',
      'face', 'faces', 'selfie', 'hands', 'hand', 'handshake', 'meeting', 'interview',
      'presenter', 'presenting', 'talking', 'smiling', 'walking', 'sitting', 'working',
    ].join('|') +
    ')\\b',
  'i',
);

/** True when this shot would put a person in frame if nobody stopped it. */
export function subjectHasPeople(subject: string): boolean {
  return PEOPLE.test(subject);
}

/**
 * The look is ours; the subject is the director's.
 *
 * ── Nobody in frame. Ever. ──────────────────────────────────────────────
 *
 * This is the single rule that decides whether generated B-roll passes as
 * footage, and it is not a matter of degree. A face is where every one of
 * these models gives itself away — the eyes, the teeth, the way a smile sits
 * slightly wrong — and hands are the second place, which is why "hands only"
 * is not the escape hatch it looks like and is banned here too. An object, a
 * room, a surface, a machine, a street: none of those have a tell.
 *
 * So when the director asks for a person, the shot is RECAST rather than
 * refused. "A barista making coffee" becomes the espresso machine and the cup;
 * "a team in a meeting" becomes the table, the laptops, the cold coffee. The
 * cue is illustrating a noun either way, and the noun that survives is the one
 * that cannot look fake.
 *
 * ── Realistic means unremarkable ────────────────────────────────────────
 *
 * The words that read as quality in a prompt — cinematic, epic, hyperreal, 8K,
 * award-winning — are the words that produce the plastic, over-lit, over-graded
 * look everybody now recognises on sight. Asking for documentary photography on
 * a real lens in ordinary light produces something duller and far more
 * convincing, which is the whole job: this has to sit next to real footage of a
 * real person and not announce itself.
 *
 * ── And no lettering, anywhere ──────────────────────────────────────────
 *
 * Not just "no captions". Generated scenes love putting signage on walls and
 * labels on packaging, and it comes out as confident gibberish — the first
 * test render of this had TKO SES LYOPE MOM across a cafe wall. Under our own
 * caption track that is the one artefact nobody can edit away afterwards.
 */
export function brollPrompt(subject: string, medium: 'still' | 'clip'): string {
  const recast = subjectHasPeople(subject)
    ? 'Shoot the OBJECTS and the SPACE only — the tools, surfaces, machines and room ' +
      'that belong to this, with nobody in the picture. '
    : '';

  const motion =
    medium === 'clip'
      ? 'Handheld documentary footage, small natural camera drift, one slow continuous move. '
      : 'A single documentary photograph. ';

  return (
    `${subject}. ${recast}${motion}` +
    // "Room around the subject" is not decoration: a still gets pushed into and
    // panned across, so anything tight to an edge leaves frame mid-insert.
    'Shot on a full-frame camera with a 35mm lens, natural available light, ordinary ' +
    'realistic colour, real materials and real wear, generous room around the subject. ' +
    'NO PEOPLE: no person, no face, no body, no hands, no silhouette, no reflection of anyone. ' +
    'No text of any kind anywhere in the frame: no signage, no labels, no lettering, no ' +
    'logos, no captions, no watermark. ' +
    'Not cinematic, not stylised, not a render, not an illustration — it must look like an ' +
    'unremarkable frame from real footage.'
  );
}

