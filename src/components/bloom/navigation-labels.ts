/** Bloom navigation uses Title Case for both visible and accessible labels. */
export function navigationLabel(value: string): string {
  if (value === 'users') return 'People';
  return value.replace(/\b[a-z]/g, letter => letter.toUpperCase());
}
