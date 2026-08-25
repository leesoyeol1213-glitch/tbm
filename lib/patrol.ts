import type { Patrol } from "@prisma/client";
import { prisma } from "@/lib/db";

// 규칙과 표시값은 DB를 모르는 곳에 따로 두고 여기서 다시 내보낸다.
// 서버 쪽은 이 파일만 쓰면 되고, 클라이언트 컴포넌트는 patrolRules를 직접 가져간다.
export * from "@/lib/patrolRules";

const templateInclude = {
  items: { orderBy: { sort: "asc" } },
} as const;

/** 사업장 전용 점검표를 우선 쓰고, 없으면 전사 공통을 쓴다. */
export async function pickPatrolTemplate(siteId: string) {
  const own = await prisma.patrolTemplate.findFirst({
    where: { siteId, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
  if (own) return own;

  return prisma.patrolTemplate.findFirst({
    where: { siteId: null, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 사업장의 해당 날짜 순찰일지를 가져오고, 없으면 점검표를 복사해 새로 만든다.
 * 점검항목은 매번 같으므로 사람이 처음부터 적을 이유가 없다.
 */
export async function ensurePatrol(
  siteId: string,
  patrolDate: Date,
  opts: { actorId?: string | null; patrollerName?: string } = {},
): Promise<Patrol> {
  const key = { siteId_patrolDate: { siteId, patrolDate } };

  const existing = await prisma.patrol.findUnique({ where: key });
  if (existing) return existing;

  const template = await pickPatrolTemplate(siteId);

  try {
    return await prisma.patrol.create({
      data: {
        siteId,
        patrolDate,
        authorId: opts.actorId ?? null,
        patrollerName: opts.patrollerName ?? "",
        checks: {
          create:
            template?.items.map((i) => ({ content: i.content, sort: i.sort })) ?? [],
        },
        // 순찰사항은 그날그날 다르므로 빈 줄 하나만 두고 사람이 채운다.
        rounds: { create: [{ place: "", content: "", sort: 0 }] },
        logs: {
          create: {
            action: "CREATE",
            actorId: opts.actorId ?? null,
            detail: template ? `점검표 "${template.name}" 적용` : "점검표 없음",
          },
        },
      },
    });
  } catch {
    // 같은 사업장에서 두 사람이 동시에 열면 unique 충돌이 날 수 있다.
    const again = await prisma.patrol.findUnique({ where: key });
    if (again) return again;
    throw new Error("순찰일지 생성에 실패했습니다.");
  }
}
