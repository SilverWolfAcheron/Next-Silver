import { Fragment, useEffect } from "react";
import type { JSX } from "react";
import { ConnectionScreen } from "./components/shell/ConnectionScreen";
import { ErrorToast } from "./components/shell/ErrorToast";
import { WorkbenchShell } from "./components/shell/WorkbenchShell";
import { useThemeSync } from "./hooks/useThemeSync";
import { useRuntimeStore } from "./stores/runtimeStore";
import type { DesktopConnection } from "./types/runtime";
import type { RuntimeStore } from "./types/stores";

export default function App(): JSX.Element {
  const connection: DesktopConnection = useRuntimeStore(
    (s: RuntimeStore): DesktopConnection => s.connection
  );
  const connectionError: string = useRuntimeStore(
    (s: RuntimeStore): string => s.connectionError
  );
  const error: string = useRuntimeStore((s: RuntimeStore): string => s.error);
  const clearError: () => void = useRuntimeStore(
    (s: RuntimeStore): (() => void) => s.clearError
  );
  const connectDesktop: () => () => void = useRuntimeStore(
    (s: RuntimeStore): (() => () => void) => s.connectDesktop
  );

  useThemeSync();
  useEffect((): (() => void) => connectDesktop(), [connectDesktop]);

  if (connection !== "ready") {
    return <ConnectionScreen connection={connection} connectionError={connectionError} />;
  }

  return (
    <Fragment>
      <WorkbenchShell />
      <ErrorToast error={error} onDismiss={clearError} />
    </Fragment>
  );
}
