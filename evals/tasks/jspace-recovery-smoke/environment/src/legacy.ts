export const LEGACY_ID_PREFIX = 'acct_';
export const LEGACY_ID_WIDTH = 8;

export function formatLegacyId(value: number): string {
  return `${LEGACY_ID_PREFIX}${String(value).padStart(LEGACY_ID_WIDTH, '0')}`;
}
