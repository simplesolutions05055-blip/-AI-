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
