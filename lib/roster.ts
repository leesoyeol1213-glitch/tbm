import type { AttendanceState } from "@prisma/client";

/**
 * TBM 한 건에 실을 작업자 명부를 고른다.
 *
 * 명부는 "지금 팀에 있는 사람"이고 TBM은 "그날 있었던 일"이라, 둘을 그냥 겹치면
 * 두 방향으로 어긋난다.
 *
 * 하나. 그만둔 사람을 비활성으로 돌려도 문서에는 계속 따라 나온다. 출력물은 팀
 * 명부를 다시 훑어 뽑기 때문이다. 팀장이 매일 아침 그 사람을 불참으로 찍어 두는
 * 일이 실제로 있었다.
 *
 * 둘. 그렇다고 비활성을 전부 빼면, 지난달에 실제로 나왔던 사람이 이미 승인된
 * 문서에서 사라진다. 그날 그 자리에 있던 사람을 지우는 것은 기록을 고치는 일이다.
 *
 * 그래서 기준을 하나로 둔다 — **지금 명부에 있거나, 그날 실제로 나왔거나.**
 * 불참으로 찍힌 비활성 인원만 빠지는데, 그 줄이 말하는 것은 "없었다"뿐이라
 * 빠져도 잃는 것이 없다.
 *
 * 출결 기록 자체는 손대지 않는다. 문서에 싣지 않을 뿐이다.
 */
export type RosterWorker = {
  id: string;
  name: string;
  empNo: string | null;
  active: boolean;
};

/** 그날 자리에 있었던 것으로 치는 출결. 불참은 아니다. */
export function wasThere(state: AttendanceState): boolean {
  return state !== "ABSENT";
}

/**
 * 받은 차례를 그대로 지킨다. 부르는 쪽이 사번순으로 뽑아 오므로 여기서 다시
 * 세우면 두 곳의 차례가 어긋날 수 있다.
 */
export function rosterFor<W extends RosterWorker>(
  workers: W[],
  attendances: { workerId: string; state: AttendanceState }[],
): W[] {
  const there = new Set(
    attendances.filter((a) => wasThere(a.state)).map((a) => a.workerId),
  );
  return workers.filter((w) => w.active || there.has(w.id));
}
