import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import {
  deleteInactiveWorkersAction,
  deleteWorkerAction,
  toggleWorkerAction,
} from "@/actions/admin";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import DeleteButton from "@/components/admin/DeleteButton";
import WorkerForm from "@/components/admin/WorkerForm";
import WorkerImport from "@/components/admin/WorkerImport";

export const dynamic = "force-dynamic";

export default async function WorkersPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const user = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const { site: requested } = await searchParams;
  const { sites, site } = await resolveAdminSite(user, requested);

  if (!site) {
    return <p className="card text-sm text-slate-500">관리할 사업장이 없습니다.</p>;
  }

  const [teams, workers] = await Promise.all([
    prisma.team.findMany({
      where: { siteId: site.id, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.worker.findMany({
      where: { siteId: site.id },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { attendances: true } },
      },
      // 사번순. 사번이 없는 사람은 뒤로 보내고 이름순으로 붙인다.
      orderBy: [
        { active: "desc" },
        { empNo: { sort: "asc", nulls: "last" } },
        { name: "asc" },
      ],
    }),
  ]);

  const activeCount = workers.filter((w) => w.active).length;
  const unassigned = workers.filter((w) => w.active && !w.teamId).length;
  const inactive = workers.filter((w) => !w.active);
  const noEmpNo = workers.filter((w) => w.active && !w.empNo).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">작업자 명부</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {site.name} · 재직 {activeCount}명
            {unassigned > 0 && (
              <span className="ml-1 font-semibold text-rose-600">
                · 팀 미지정 {unassigned}명
              </span>
            )}
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      {unassigned > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          팀이 지정되지 않은 작업자 {unassigned}명은 QR을 찍어도 출석이 기록되지 않습니다.
        </p>
      )}
      {noEmpNo > 0 && (
        <p className="rounded-lg bg-slate-100 px-3 py-2.5 text-sm text-slate-700">
          사번이 없는 인원이 {noEmpNo}명 있습니다. 명단 맨 아래에 표시되며, 명부를 다시
          올릴 때 같은 사람으로 인식되지 않아 중복 등록될 수 있습니다.
        </p>
      )}

      {inactive.length > 0 && (
        <div className="card">
          <p className="text-sm font-semibold text-slate-900">
            비활성 인원 {inactive.length}명
          </p>
          <p className="mt-1 mb-2 text-xs text-slate-500">
            출석 기록이 없는 인원만 지웁니다. 기록이 있는 인원은 그대로 남습니다.
          </p>
          <DeleteButton
            action={deleteInactiveWorkersAction}
            fields={{ siteId: site.id }}
            question={`비활성 ${inactive.length}명 중 출석 기록이 없는 인원을 모두 지웁니다. 계속할까요?`}
            label="비활성 인원 일괄 삭제"
            confirmLabel="모두 삭제"
            size="md"
          />
        </div>
      )}

      <WorkerImport key={site.id} siteId={site.id} hasTeams={teams.length > 0} />

      <section>
        <h2 className="mb-2 font-bold text-slate-900">한 명씩 등록</h2>
        <WorkerForm key={site.id} siteId={site.id} teams={teams} mode="create" />
      </section>

      <section>
        <h2 className="mb-2 font-bold text-slate-900">등록된 작업자</h2>
        {workers.length === 0 ? (
          <p className="card text-sm text-slate-500">등록된 작업자가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {workers.map((w) => (
              <li key={w.id} className={`card ${w.active ? "" : "opacity-60"}`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="font-semibold text-slate-900">
                    {w.empNo && (
                      <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-normal text-slate-600">
                        {w.empNo}
                      </span>
                    )}
                    {w.name}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {w.team?.name ?? "팀 미지정"}
                      {w._count.attendances > 0 && ` · 출석기록 ${w._count.attendances}건`}
                      {!w.active && " · 비활성"}
                    </span>
                  </p>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <form action={toggleWorkerAction}>
                      <input type="hidden" name="workerId" value={w.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-slate-500 hover:underline"
                      >
                        {w.active ? "비활성화" : "복귀"}
                      </button>
                    </form>
                    <DeleteButton
                      action={deleteWorkerAction}
                      fields={{ workerId: w.id }}
                      question={`${w.name} 님을 명단에서 완전히 지웁니다. 계속할까요?`}
                    />
                  </div>
                </div>

                <WorkerForm
                  siteId={site.id}
                  teams={teams}
                  mode="edit"
                  worker={{
                    id: w.id,
                    name: w.name,
                    empNo: w.empNo ?? "",
                    phone: w.phone ?? "",
                    jobTitle: w.jobTitle ?? "",
                    teamId: w.teamId ?? "",
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
