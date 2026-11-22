import type { JSX } from "react";
import { ERROR_CODES } from "../../constants/errors";
import { useI18n } from "../../hooks/useI18n";
import { formatError } from "../../i18n/errors";
import type { ConnectionScreenProps } from "../../types/shell";

export function ConnectionScreen({
  connection,
  connectionError,
}: ConnectionScreenProps): JSX.Element {
  const { t }: ReturnType<typeof useI18n> = useI18n();

  return (
    <main className="flex h-full items-center justify-center bg-surface px-4 text-center text-secondary">
      <div>
        <p>{connection === "unavailable" ? t.connection.unavailable : t.connection.connecting}</p>
        {connectionError && (
          <p className="mt-2 text-[13px] text-danger">
            {formatError(connectionError, t, ERROR_CODES.DESKTOP_CONNECTION_LOST)}
          </p>
        )}
      </div>
    </main>
  );
}
