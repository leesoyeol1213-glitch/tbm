import type { Patrol } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/permissions";

// 규칙과 표시값은 DB를 모르는 곳에 따로 두고 여기서 다시 내보낸다.
// 서버 쪽은 이 파일만 쓰면 되고, 클라이언트 컴포넌트는 patrolRules를 직접 가져간다.
export * from "@/lib/patrolRules";

const templateInclude = {
  items: { orderBy: { sort: "asc" } },
} as const;

/** 이 사람이 순찰일지를 쓸 수 있는 공장 목록. 본사는 전부. */
export async function managedPlantIds(user: SessionUser): Promise<string[]> {
  const plants = await prisma.plant.findMany({
    where: user.role === "HQ_ADMIN" ? { active: true } : { active: true, managerId: user.id },
    select: { id: true },
  });
  return plants.map((p) => p.id);
}

/** 공장 전용 점검표를 우선 쓰고, 없으면 전사 공통을 쓴다. */
export async function pickPatrolTemplate(plantId: string) {
  const own = await prisma.patrolTemplate.findFirst({
    where: { plantId, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
  if (own) return own;

  return prisma.patrolTemplate.findFirst({
    where: { plantId: null, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 공장의 해당 날짜 순찰일지를 가져오고, 없으면 점검표를 복사해 새로 만든다.
 * 점검항목은 매번 같으므로 사람이 처음부터 적을 이유가 없다.
 */
export async function ensurePatrol(
  plantId: string,
  patrolDate: Date,
  opts: { actorId?: string | null; patrollerName?: string } = {},
): Promise<Patrol> {
  const key = { plantId_patrolDate: { plantId, patrolDate } };

  const existing = await prisma.patrol.findUnique({ where: key });
  if (existing) return existing;

  const template = await pickPatrolTemplate(plantId);

  try {
    return await prisma.patrol.create({
      data: {
        plantId,
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
    // 같은 공장을 두 사람이 동시에 열면 unique 충돌이 날 수 있다.
    const again = await prisma.patrol.findUnique({ where: key });
    if (again) return again;
    throw new Error("순찰일지 생성에 실패했습니다.");
  }
}

/** 대결 상대를 찾는다. 그 역할의 활성 계정 중 먼저 만든 것을 쓴다. */
export async function delegateTarget(
  role: "SAFETY_DIRECTOR" | "DIVISION_HEAD",
): Promise<string | null> {
  const u = await prisma.user.findFirst({
    where: { role, active: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return u?.id ?? null;
}
