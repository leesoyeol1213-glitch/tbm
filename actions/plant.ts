"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";

export type ActionResult = { error: string | null; ok?: boolean };

const OK: ActionResult = { error: null, ok: true };

function refresh() {
  revalidatePath("/admin/plants");
  revalidatePath("/admin/patrol-template");
  revalidatePath("/admin/users");
  revalidatePath("/patrol");
}

/**
 * 공장을 만들거나 고친다. 본사만 다룬다.
 *
 * 공장은 법인 위에 있는 개념이라 사업장 관리자에게 맡길 수 없다. 진천 한 곳에
 * 법인이 넷 있어도 공장은 1공장·2공장 둘뿐이고, 그 경계를 정하는 것은 본사다.
 */
export async function savePlantAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const plantId = String(formData.get("plantId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim() || null;
  const managerId = String(formData.get("managerId") ?? "").trim() || null;
  const sortRaw = String(formData.get("sort") ?? "").trim();
  const sort = /^\d+$/.test(sortRaw) ? Number(sortRaw) : 0;

  if (!name) return { error: "공장 이름을 입력해 주세요." };

  if (managerId) {
    const manager = await prisma.user.findUnique({ where: { id: managerId } });
    if (!manager) return { error: "담당자를 찾을 수 없습니다." };
  }

  try {
    if (plantId) {
      await prisma.plant.update({
        where: { id: plantId },
        data: { name, address, managerId, sort },
      });
    } else {
      await prisma.plant.create({ data: { name, address, managerId, sort } });
    }
  } catch {
    return { error: "같은 이름의 공장이 이미 있습니다." };
  }

  refresh();
  return OK;
}

/** 사용 중지·재개. 지우지 않는 이유는 지난 순찰일지가 딸려 사라지기 때문이다. */
export async function togglePlantAction(formData: FormData): Promise<void> {
  await requireRole("HQ_ADMIN");
  const plantId = String(formData.get("plantId") ?? "");

  const plant = await prisma.plant.findUnique({ where: { id: plantId } });
  if (!plant) throw new Error("공장을 찾을 수 없습니다.");

  await prisma.plant.update({
    where: { id: plantId },
    data: { active: !plant.active },
  });

  refresh();
}

/** 순찰일지가 하나도 없는 공장만 지운다. 기록이 있으면 사용 중지로 돌린다. */
export async function deletePlantAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");
  const plantId = String(formData.get("plantId") ?? "");

  const count = await prisma.patrol.count({ where: { plantId } });
  if (count > 0) {
    return {
      error: `순찰일지 ${count}건이 있어 지울 수 없습니다. 사용 중지로 돌려 주세요.`,
    };
  }

  await prisma.plant.delete({ where: { id: plantId } });
  refresh();
  return OK;
}
