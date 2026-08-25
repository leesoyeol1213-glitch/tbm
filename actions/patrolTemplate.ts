"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { DEFAULT_PATROL_ITEMS } from "@/lib/patrolRules";
import { managedPlantIds } from "@/lib/patrol";

export type ActionResult = { error: string | null; ok?: boolean };

const OK: ActionResult = { error: null, ok: true };

/**
 * 점검표를 저장한다.
 *
 * 전사 공통 점검표는 본사만 고칠 수 있다. 공장 전용은 그 공장 담당자도 고친다 —
 * 공장마다 설비가 달라 점검항목이 같을 수 없기 때문이다.
 */
export async function savePatrolTemplateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const templateId = String(formData.get("templateId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const items = formData
    .getAll("items")
    .map(String)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (!name) return { error: "점검표 이름을 입력해 주세요." };
  if (items.length === 0) return { error: "점검항목을 최소 하나 남겨 주세요." };

  const template = await prisma.patrolTemplate.findUnique({ where: { id: templateId } });
  if (!template) return { error: "점검표를 찾을 수 없습니다." };

  if (template.plantId === null) {
    if (user.role !== "HQ_ADMIN") {
      return { error: "전사 공통 점검표는 본사만 고칠 수 있습니다." };
    }
  } else if (!(await managedPlantIds(user)).includes(template.plantId)) {
    return { error: "담당하지 않는 공장의 점검표입니다." };
  }

  await prisma.$transaction([
    prisma.patrolTemplate.update({ where: { id: templateId }, data: { name } }),
    prisma.patrolTemplateItem.deleteMany({ where: { templateId } }),
    prisma.patrolTemplateItem.createMany({
      data: items.map((content, sort) => ({ templateId, content, sort })),
    }),
  ]);

  revalidatePath("/admin/patrol-template");
  return OK;
}

/**
 * 전사 공통 점검표를 이 공장 전용으로 복사한다.
 * 복사본이 생기면 그때부터 그 공장은 공통본 대신 자기 것을 쓴다.
 */
export async function forkPatrolTemplateAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const plantId = String(formData.get("plantId") ?? "");
  if (!(await managedPlantIds(user)).includes(plantId)) {
    return { error: "담당하지 않는 공장입니다." };
  }

  const plant = await prisma.plant.findUnique({ where: { id: plantId } });
  if (!plant) return { error: "공장을 찾을 수 없습니다." };

  const existing = await prisma.patrolTemplate.findFirst({
    where: { plantId, active: true },
  });
  if (existing) return { error: "이미 공장 전용 점검표가 있습니다." };

  const shared = await prisma.patrolTemplate.findFirst({
    where: { plantId: null, active: true },
    include: { items: { orderBy: { sort: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  // 공통본이 없으면 표준 항목으로 시작한다. 빈 점검표를 주면 아무도 안 채운다.
  const items = shared
    ? shared.items.map((i) => ({ content: i.content, sort: i.sort }))
    : DEFAULT_PATROL_ITEMS.map((content, sort) => ({ content, sort }));

  await prisma.patrolTemplate.create({
    data: {
      plantId,
      name: `${plant.name} 순찰 점검표`,
      items: { create: items },
    },
  });

  revalidatePath("/admin/patrol-template");
  return OK;
}

/** 점검표가 하나도 없을 때 전사 공통 점검표를 표준 항목으로 만든다. 본사 전용. */
export async function createSharedPatrolTemplateAction(): Promise<ActionResult> {
  const user = await requireUser();
  if (user.role !== "HQ_ADMIN") return { error: "본사 관리자만 만들 수 있습니다." };

  const existing = await prisma.patrolTemplate.findFirst({
    where: { plantId: null, active: true },
  });
  if (existing) return { error: "이미 전사 공통 점검표가 있습니다." };

  await prisma.patrolTemplate.create({
    data: {
      plantId: null,
      name: "전사 공통 순찰 점검표",
      items: {
        create: DEFAULT_PATROL_ITEMS.map((content, sort) => ({ content, sort })),
      },
    },
  });

  revalidatePath("/admin/patrol-template");
  return OK;
}
