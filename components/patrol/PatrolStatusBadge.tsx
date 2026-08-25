import type { PatrolStatus } from "@prisma/client";
import { PATROL_STATUS_LABEL, PATROL_STATUS_STYLE } from "@/lib/patrolRules";

/**
 * 순찰일지 상태 뱃지.
 *
 * TBM의 StatusBadge와 따로 두는 이유는 결재가 두 단계라서다. "결재 대기"만으로는
 * 안전실장 차례인지 본부장 차례인지 알 수 없어 결재자가 자기 건을 못 찾는다.
 */
export function PatrolStatusBadge({ status }: { status: PatrolStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${PATROL_STATUS_STYLE[status]}`}
    >
      {PATROL_STATUS_LABEL[status]}
    </span>
  );
}
