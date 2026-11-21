import { z } from 'zod';
import { localBusinessDate } from '@/lib/local-pos/business-day';
import { getLocalSalesAnalytics } from '@/lib/local-pos/orders';
import { logLocalPosFailure, localPosJson, requireLocalPosUser } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isCalendarDate = (date: string) =>
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const querySchema = z
  .object({
    from: z.string().regex(datePattern).optional(),
    to: z.string().regex(datePattern).optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (!!query.from !== !!query.to)
      context.addIssue({ code: 'custom', message: 'Choose both dates for a custom report.' });
    if (query.from && query.to && query.from > query.to)
      context.addIssue({ code: 'custom', message: 'The start date must be on or before the end date.' });
    if (query.from && !isCalendarDate(query.from))
      context.addIssue({ code: 'custom', message: 'Enter a valid start date.' });
    if (query.to && !isCalendarDate(query.to))
      context.addIssue({ code: 'custom', message: 'Enter a valid end date.' });
    if (
      query.from &&
      query.to &&
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) /
        86_400_000 >
        365
    )
      context.addIssue({ code: 'custom', message: 'Choose a period of 366 days or less.' });
  });

function subtractDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  try {
    await requireLocalPosUser(['super_user']);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const to = query.to ?? localBusinessDate(new Date());
    const from = query.from ?? subtractDays(to, 29);
    return localPosJson(getLocalSalesAnalytics(from, to));
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
