import type { Autonomy, SeatRole } from "../agent-core/types";

export const AUTONOMY_OPTIONS: readonly Autonomy[] = ["ask", "decide", "act"];
export const SEAT_ROLE_ORDER: readonly SeatRole[] = ["develop", "audit"];
export const DIFF_CONFIRM_FILE_THRESHOLD: number = 20;
