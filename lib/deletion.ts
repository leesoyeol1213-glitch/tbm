/**
 * 삭제 허용 여부 판단.
 *
 * 안전 기록(출석·TBM)은 보존 대상이므로, 기록이 붙어 있는 항목은 지우지 않고
 * 비활성화로 유도한다. 서버 액션이 이 판단을 그대로 쓴다.
 */

export type DeleteVerdict =
  | { allowed: true; note?: string }
  | { allowed: false; reason: string };

export function judgeWorkerDelete(
  name: string,
  counts: { attendances: number },
): DeleteVerdict {
  if (counts.attendances > 0) {
    return {
      allowed: false,
      reason:
        `${name} 님은 출석 기록이 ${counts.attendances}건 있어 삭제할 수 없습니다. ` +
        `대신 비활성화하면 명단에서 빠지고 과거 기록은 남습니다.`,
    };
  }
  return { allowed: true };
}

export function judgeTeamDelete(
  name: string,
  counts: { tbms: number; workers: number },
): DeleteVerdict {
  if (counts.tbms > 0) {
    return {
      allowed: false,
      reason:
        `"${name}" 팀은 TBM 기록이 ${counts.tbms}건 있어 삭제할 수 없습니다. ` +
        `삭제하면 그 기록이 함께 사라집니다. 대신 비활성화하세요.`,
    };
  }
  return {
    allowed: true,
    note:
      counts.workers > 0
        ? `소속 작업자 ${counts.workers}명은 '팀 미지정'이 되었습니다.`
        : undefined,
  };
}

/**
 * 로그인 계정 삭제 판단.
 *
 * 계정은 TBM의 작성자·결재자와 감사 기록에 이름으로 걸려 있다. 스키마상 그 참조는
 * 계정이 사라지면 비워지므로(SetNull), 지우는 순간 "누가 썼고 누가 결재했는지"가
 * 과거 문서에서 조용히 없어진다. 그래서 기록이 붙은 계정은 잠금으로 유도한다.
 */
export function judgeUserDelete(
  name: string,
  counts: {
    ledTeams: number;
    authoredTbms: number;
    approvedTbms: number;
    auditLogs: number;
  },
): DeleteVerdict {
  if (counts.ledTeams > 0) {
    return {
      allowed: false,
      reason:
        `${name} 님은 담당 팀이 ${counts.ledTeams}개 있습니다. ` +
        `작업팀 화면에서 팀장을 바꾼 뒤에 지울 수 있습니다.`,
    };
  }

  const records = counts.authoredTbms + counts.approvedTbms + counts.auditLogs;
  if (records > 0) {
    return {
      allowed: false,
      reason:
        `${name} 님은 작성·결재한 기록이 ${records}건 있어 삭제할 수 없습니다. ` +
        `지우면 그 문서에서 작성자·결재자가 빈칸이 됩니다. ` +
        `대신 잠그면 로그인만 막히고 기록은 그대로 남습니다.`,
    };
  }

  return { allowed: true };
}

/** 비활성 인원 일괄 삭제 대상 선별 */
export function splitInactiveForDelete<T extends { id: string; _count: { attendances: number } }>(
  targets: T[],
): { deletable: T[]; kept: T[] } {
  return {
    deletable: targets.filter((w) => w._count.attendances === 0),
    kept: targets.filter((w) => w._count.attendances > 0),
  };
}

export function summarizeBulkDelete(deleted: number, kept: number): string {
  return (
    `${deleted}명을 삭제했습니다.` +
    (kept > 0 ? ` ${kept}명은 출석 기록이 있어 그대로 두었습니다.` : "")
  );
}
