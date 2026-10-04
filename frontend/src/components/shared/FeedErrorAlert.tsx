import type { CSSProperties } from 'react';
import { Alert } from './Alert';

/**
 * Read-error banner for failed option/catalog feeds (cards 20261004_333 and
 * 20261004_337): a failed feed must render an explicit error with retry —
 * never a silently empty list or select. Encodes the two house mirrors:
 * QuotationCreateDialog's feed-Alert and card 333's Alert + "Thử lại"
 * (refetch disabled while `isFetching`, "Đang thử lại…" meanwhile).
 */
export function FeedErrorAlert({
  message,
  isFetching,
  onRetry,
  style,
}: {
  message: string;
  isFetching?: boolean;
  onRetry?: () => void;
  /** Inline styles for the alert wrapper (e.g. full-width in a flex row). */
  style?: CSSProperties;
}) {
  return (
    <Alert
      variant="error"
      style="soft"
      wrapperStyle={style}
      action={
        onRetry ? (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={isFetching}
            onClick={onRetry}
          >
            {isFetching ? 'Đang thử lại…' : 'Thử lại'}
          </button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}
