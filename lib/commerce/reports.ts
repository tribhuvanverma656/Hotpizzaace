import type { Order } from '../../types';
import {
  buildSalesReport,
  parseReportRequest,
  toSalesExportRow,
  type ReportMode,
  type SalesExportResponse,
  type SalesSummaryResponse,
} from '../analytics';

type ReportDatabase = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: { message?: string } | null;
  }>;
};
export class ReportError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'report_invalid',
  ) {
    super(message);
    this.name = 'ReportError';
  }
}
const MAX_REPORT_ORDERS = 10000;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_EXPORT_BYTES = 6 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failIncomplete(): never {
  throw new ReportError(
    'The report is incomplete. No partial figures were returned. Please retry or choose fewer dates.',
    503,
    'report_incomplete',
  );
}
function tooLarge(): never {
  throw new ReportError(
    'This report is too large. Choose fewer dates; no partial report was downloaded.',
    413,
    'report_too_large',
  );
}

/** Actor comes from verified server Auth. The RPC independently checks trusted owner membership. */
export async function handleSalesReport(
  db: ReportDatabase,
  actorId: string,
  rawRequest: unknown,
): Promise<SalesSummaryResponse | SalesExportResponse> {
  if (typeof actorId !== 'string' || !UUID.test(actorId))
    throw new ReportError(
      'Sign in with an authorized owner account.',
      403,
      'report_owner_required',
    );
  let request: ReturnType<typeof parseReportRequest>;
  try {
    request = parseReportRequest(rawRequest);
  } catch (cause) {
    throw new ReportError(
      cause instanceof Error ? cause.message : 'Choose a valid report date range.',
    );
  }
  if (request.cursor !== undefined || request.snapshotAt !== undefined)
    throw new ReportError(
      'This report downloads in one complete snapshot. Start a new download.',
      400,
      'report_page_unsupported',
    );
  const { data, error } = await db.rpc('hpa_sales_report_snapshot', {
    p_actor_id: actorId,
    p_branch_id: request.branchId,
    p_from: request.fromUtc,
    p_to: request.toUtc,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('report_too_large')) tooLarge();
    if (message.includes('report_owner_required'))
      throw new ReportError(
        'Sign in with an authorized owner account.',
        403,
        'report_owner_required',
      );
    if (message.includes('report_branch_not_found'))
      throw new ReportError('This branch is no longer available.', 404, 'report_branch_not_found');
    if (message.includes('report_range_invalid'))
      throw new ReportError('Choose valid India business dates, up to 31 days at a time.');
    throw new ReportError(
      'Sales reports are temporarily unavailable. Please try again.',
      503,
      'report_unavailable',
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) failIncomplete();
  const snapshot = data as Record<string, unknown>;
  if (snapshot.complete !== true || !Array.isArray(snapshot.orders)) failIncomplete();
  if (snapshot.orders.length > MAX_REPORT_ORDERS) tooLarge();
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_SNAPSHOT_BYTES)
    tooLarge();
  if (snapshot.mode !== 'production' && snapshot.mode !== 'development') failIncomplete();
  if (
    typeof snapshot.snapshotAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(snapshot.snapshotAt) ||
    !Number.isFinite(Date.parse(snapshot.snapshotAt))
  )
    failIncomplete();
  const ids = new Set<string>();
  for (const value of snapshot.orders) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) failIncomplete();
    const row = value as Record<string, unknown>;
    if (
      typeof row.id !== 'string' ||
      !UUID.test(row.id) ||
      ids.has(row.id) ||
      row.branchId !== request.branchId ||
      typeof row.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(row.createdAt))
    )
      failIncomplete();
    ids.add(row.id);
  }
  const orders = snapshot.orders as Order[];
  const mode: ReportMode = snapshot.mode;
  try {
    if (request.kind === 'summary')
      return {
        summary: buildSalesReport(orders, {
          branchId: request.branchId,
          from: request.from,
          to: request.to,
          mode,
        }),
        complete: true,
        snapshotAt: snapshot.snapshotAt,
      };
    const result: SalesExportResponse = {
      rows: orders.map((order) => toSalesExportRow(order, mode, request)),
      nextCursor: null,
      snapshotAt: snapshot.snapshotAt,
      complete: true,
    };
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_EXPORT_BYTES) tooLarge();
    return result;
  } catch (cause) {
    if (cause instanceof ReportError) throw cause;
    throw new ReportError(
      'Some report records need review. No partial report was returned. Contact the owner.',
      503,
      'report_data_invalid',
    );
  }
}
