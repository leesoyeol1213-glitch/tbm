import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, ROLE_LABEL } from "@/lib/authz";
import { deletePlantAction, togglePlantAction } from "@/actions/plant";
import DeleteButton from "@/components/admin/DeleteButton";
import PlantForm, { type ManagerOption } from "@/components/admin/PlantForm";

export const dynamic = "force-dynamic";

export default async function PlantsPage() {
  await requireRole("HQ_ADMIN");

  const [plants, candidates] = await Promise.all([
    prisma.plant.findMany({
      include: {
        manager: { select: { name: true, username: true } },
        _count: { select: { patrols: true } },
      },
      orderBy: [{ active: "desc" }, { sort: "asc" }, { name: "asc" }],
    }),
    // 순찰일지를 쓸 사람. 안전관리자와 본사만 후보로 둔다.
    prisma.user.findMany({
      where: { active: true, role: { in: ["SITE_MANAGER", "HQ_ADMIN"] } },
      select: { id: true, name: true, role: true, site: { select: { name: true } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
  ]);

  const managers: ManagerOption[] = candidates.map((u) => ({
    id: u.id,
    name: u.name,
    label: `${u.name} · ${u.site?.name ?? ROLE_LABEL[u.role]}`,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">공장</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          안전(순찰)일지의 단위입니다. 법인과 따로 관리합니다.
        </p>
      </div>

      <PlantForm managers={managers} mode="create" />

      <section>
        <h2 className="mb-2 font-bold text-slate-900">등록된 공장</h2>
        {plants.length === 0 ? (
          <p className="card text-sm text-slate-500">
            등록된 공장이 없습니다. 위에서 추가하세요.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {plants.map((p) => (
              <li key={p.id} className={`card ${p.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">
                      {p.name}
                      {!p.active && (
                        <span className="ml-2 text-xs font-normal text-slate-400">
                          사용 중지
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.address || "주소 없음"}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      담당{" "}
                      {p.manager ? (
                        <strong className="text-slate-800">{p.manager.name}</strong>
                      ) : (
                        <span className="font-medium text-amber-700">미지정</span>
                      )}{" "}
                      · 순찰일지 {p._count.patrols}건
                    </p>
                  </div>
                  <form action={togglePlantAction}>
                    <input type="hidden" name="plantId" value={p.id} />
                    <button
                      type="submit"
                      className="shrink-0 text-xs font-semibold text-slate-500 hover:underline"
                    >
                      {p.active ? "사용 중지" : "다시 사용"}
                    </button>
                  </form>
                </div>

                {!p.manager && p.active && (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    담당자가 없습니다. 본사 관리자만 이 공장의 순찰일지를 쓸 수 있습니다.
                  </p>
                )}

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <PlantForm
                    managers={managers}
                    mode="edit"
                    plant={{
                      id: p.id,
                      name: p.name,
                      address: p.address ?? "",
                      managerId: p.managerId ?? "",
                      sort: p.sort,
                    }}
                  />
                  <div className="mt-2">
                    <DeleteButton
                      action={deletePlantAction}
                      fields={{ plantId: p.id }}
                      question={`"${p.name}"을 지웁니다. 순찰일지가 있으면 지워지지 않습니다. 계속할까요?`}
                      label="공장 삭제"
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/admin" className="block text-center text-sm text-slate-500 hover:underline">
        ← 관리
      </Link>
    </div>
  );
}
