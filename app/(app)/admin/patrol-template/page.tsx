import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { managedPlantIds, pickPatrolTemplate } from "@/lib/patrol";
import PatrolTemplateEditor, {
  CreateSharedPatrolTemplateForm,
  ForkPatrolTemplateForm,
} from "@/components/admin/PatrolTemplateEditor";

export const dynamic = "force-dynamic";

export default async function PatrolTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ plant?: string }>;
}) {
  const user = await requireUser();
  if (user.role !== "SITE_MANAGER" && user.role !== "HQ_ADMIN") notFound();

  const mine = await managedPlantIds(user);
  const plants = await prisma.plant.findMany({
    where: { id: { in: mine }, active: true },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });

  if (plants.length === 0) {
    return (
      <p className="card text-sm text-slate-500">
        담당하는 공장이 없습니다. 본사 관리자에게 공장 담당 지정을 요청하세요.
      </p>
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

      {plants.length > 1 && (
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
            </Link>
          ))}
        </nav>
      )}

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
    </div>
  );
}
