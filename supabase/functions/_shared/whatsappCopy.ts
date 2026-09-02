export type AddressGender = 'male' | 'female' | null;

export function genderText(
  gender: AddressGender | undefined,
  copy: { male: string; female: string; plural: string },
): string {
  if (gender === 'male') return copy.male;
  if (gender === 'female') return copy.female;
  return copy.plural;
}

export function normalizeAddressGender(value: unknown): AddressGender {
  return value === 'male' || value === 'female' ? value : null;
}

// ── addressing the user in their own gender ──────────────────────────────────
// The bot's copy is written in plural ("כתבו לי"), which is the safe default
// when nobody knows who is on the other side. Once the phone is matched to a
// profile we do know, so the plural is rewritten to that profile's gender at
// send time. One dictionary, so a new message never has to spell out three
// variants inline.
//
// Applied to the bot's OWN copy only — never to generated content (a post
// caption, deck text, an output body), where "כתבו" is the client's word.
const ADDRESS_FORMS: Array<[string, string, string]> = [
  // plural (as written), male, female
  ['כתבו', 'כתוב', 'כתבי'],
  ['ספרו', 'ספר', 'ספרי'],
  ['שלחו', 'שלח', 'שלחי'],
  ['בחרו', 'בחר', 'בחרי'],
  ['השיבו', 'השב', 'השיבי'],
  ['הזינו', 'הזן', 'הזיני'],
  ['לחצו', 'לחץ', 'לחצי'],
  ['שימו', 'שים', 'שימי'],
  ['בדקו', 'בדוק', 'בדקי'],
  ['נסו', 'נסה', 'נסי'],
  ['המתינו', 'המתן', 'המתיני'],
  ['בואו', 'בוא', 'בואי'],
  ['תרצו', 'תרצה', 'תרצי'],
  ['תוכלו', 'תוכל', 'תוכלי'],
  ['רוצים', 'רוצה', 'רוצה'],
  // Deliberately absent: מכירים / צריכים / יכולים — the bot uses those about
  // itself ("עדיין לא מכירים את המספר"), where a rewrite would be wrong.
  ['אתם', 'אתה', 'את'],
  ['לכם', 'לך', 'לך'],
  ['שלכם', 'שלך', 'שלך'],
  ['אליכם', 'אליך', 'אליך'],
  ['עליכם', 'עליך', 'עליך'],
  ['אצלכם', 'אצלך', 'אצלך'],
];

// Hebrew letters are not \w, so \b never fires between them — match on
// "not preceded/followed by a Hebrew letter" instead. The optional leading
// ו/ש/ה/ב/כ/ל prefix keeps forms like "וכתבו" and "שתרצו" in scope.
const ADDRESS_PATTERNS: Array<[RegExp, string, string]> = ADDRESS_FORMS.map(
  ([plural, male, female]) =>
    [new RegExp(`(?<![א-ת])([ושהבכל]?)${plural}(?![א-ת])`, 'g'), male, female] as [RegExp, string, string],
);

export function addressUser(text: string, gender: AddressGender | undefined): string {
  if (!text || (gender !== 'male' && gender !== 'female')) return text;
  let out = text;
  for (const [pattern, male, female] of ADDRESS_PATTERNS) {
    out = out.replace(pattern, (_m, prefix: string) => `${prefix}${gender === 'male' ? male : female}`);
  }
  return out;
}
