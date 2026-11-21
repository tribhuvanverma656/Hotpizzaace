const INDIA_UTC_OFFSET_MINUTES = 330;
const BUSINESS_DAY_START_MINUTES = 180;

export function localBusinessDate(value: string | Date): string {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('The order timestamp is invalid.');
  const businessDateTimestamp =
    timestamp + (INDIA_UTC_OFFSET_MINUTES - BUSINESS_DAY_START_MINUTES) * 60_000;
  return new Date(businessDateTimestamp).toISOString().slice(0, 10);
}
