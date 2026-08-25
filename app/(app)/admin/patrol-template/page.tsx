import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { managedPlantIds, pickPatrolTemplate } from "@/lib/patrol";
import PatrolTemplateEditor, {
  CreateSharedPatrolTemplateForm,
  ForkPatrolTemplateForm,
} from "@/components/admin/PatrolTemplateEditor";
import PlantForm, { type ManagerOption } from "@/components/admin/PlantForm";

export const dynamic = "force-dynamic";

export default async function PatrolTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "SITE_MANAGER" && user.role !== "HQ_ADMIN") notFound();
  const isHq = user.role === "HQ_ADMIN";

  const mine = await managedPlantIds(user);
  const [plants, managers] = await Promise.all([
    prisma.plant.findMany({
      where: { id: { in: mine }, active: true },
      // 어느 공장이 전용 점검표를 갖고 있는지 탭에서 바로 보이게 한다.
      include: { templates: { where: { active: true }, select: { id: true } } },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    }),
    isHq
      ? prisma.user.findMany({
          where: { active: true, role: { in: ["SITE_MANAGER", "HQ_ADMIN"] } },
          select: { id: true, name: true, site: { select: { name: true } } },
          orderBy: [{ role: "asc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  const managerOptions: ManagerOption[] = managers.map((m) => ({
    id: m.id,
    name: m.name,
    label: `${m.name} · ${m.site?.name ?? "본사"}`,
  }));

  // 공장이 없어도 화면을 막지 않는다. 본사는 여기서 바로 만들 수 있어야 한다.
  if (plants.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-lg font-bold text-slate-900">순찰 점검표</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            안전(순찰)일지를 열 때 이 항목들이 그대로 채워집니다.
          </p>
        </div>
        {isHq ? (
          <>
            <p className="card text-sm text-slate-500">
              등록된 공장이 없습니다. 아래에서 만들면 그 공장의 점검표를 바로 만들 수
              있습니다.
            </p>
            <PlantForm managers={managerOptions} mode="create" />
          </>
        ) : (
          <p className="card text-sm text-slate-500">
            담당하는 공장이 없습니다. 본사 관리자에게 공장 담당 지정을 요청하세요.
          </p>
        )}
      </div>
    );
  }

  const { plant: requested } = await searchParams;
  const plant = plants.find((p) => p.id === requested) ?? plants[0];
  const template = await pickPatrolTemplate(plant.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">순찰 점검표</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          안전(순찰)일지를 열 때 이 항목들이 그대로 채워집니다.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1.5">
        {plants.map((p) => (
          <Link
            key={p.id}
            href={`/admin/patrol-template?plant=${p.id}`}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition ${
              p.id === plant.id
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
            }`}
          >
            {p.name}
            {/* 전용 점검표가 없으면 전사 공통을 쓰고 있다는 뜻이다. */}
            {p.templates.length === 0 && (
              <span
                className={`ml-1.5 font-normal ${
                  p.id === plant.id ? "text-slate-300" : "text-slate-400"
                }`}
              >
                공통
              </span>
            )}
          </Link>
        ))}
      </nav>

      {!template ? (
        user.role === "HQ_ADMIN" ? (
          <CreateSharedPatrolTemplateForm />
        ) : (
          <p className="card text-sm text-slate-500">
            적용할 점검표가 없습니다. 본사 관리자에게 요청하세요.
          </p>
        )
      ) : (
        <>
          <p className="text-xs text-slate-500">
            <strong className="text-slate-700">{plant.name}</strong>에 적용 중:{" "}
            {template.name} {template.plantId === null ? "(전사 공통)" : "(공장 전용)"}
          </p>

          {template.plantId === null && (
            <ForkPatrolTemplateForm key={plant.id} plantId={plant.id} plantName={plant.name} />
          )}

          <PatrolTemplateEditor
            key={template.id}
            templateId={template.id}
            name={template.name}
            patrollerName={template.patrollerName ?? ""}
            items={template.items.map((i) => ({
              content: i.content,
              defaultAction: i.defaultAction ?? "",
            }))}
            rounds={template.rounds.map((r) => ({
              place: r.place,
              content: r.content,
            }))}
            readOnly={template.plantId === null && user.role !== "HQ_ADMIN"}
          />
        </>
      )}

      {isHq && (
        <section className="border-t border-slate-200 pt-5">
          <h2 className="mb-1 font-bold text-slate-900">공장 추가</h2>
          <p className="mb-3 text-xs text-slate-500">
            공장을 만들면 위 탭에 바로 나타나고, 그 자리에서 전용 점검표를 만들 수
            있습니다. 담당자를 지정해야 그 사람이 순찰일지를 씁니다.{" "}
            <Link href="/admin/plants" className="font-semibold underline">
              공장 관리로 이동
            </Link>
          </p>
          <PlantForm managers={managerOptions} mode="create" />
        </section>
      )}
    </div>
  );
}
