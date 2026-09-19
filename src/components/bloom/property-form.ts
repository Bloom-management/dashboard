/** Same integer-cent bound as the integrated property-create operation. Never round user input. */
export function parseSoloRate(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 2 && cents <= 2_147_483_646 && cents % 2 === 0 ? cents : null;
}

/** Explicit ownership modes prevent stale picker state from assigning an unintended owner. */
export function propertyOwnership(isBloomOwned: boolean, mode: 'existing' | 'pending', ownerIds: string[], email: string): { ownerIds: string[]; pendingOwnerEmail: string | null } | null {
  if (isBloomOwned) return { ownerIds: [], pendingOwnerEmail: null };
  if (mode === 'existing') return ownerIds.length ? { ownerIds: [...new Set(ownerIds)], pendingOwnerEmail: null } : null;
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return { ownerIds: [], pendingOwnerEmail: normalized };
}
