import { prisma } from "@/lib/db";
import { requireRole, ROLE_LABEL } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { deleteUserAction, toggleUserAction } from "@/actions/admin";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import DeleteButton from "@/components/admin/DeleteButton";
import { NewUserForm, ResetPassword } from "@/components/admin/UserManager";

export const dynamic = "force-dynamic";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const me = await requireRole("SITE_MANAGER", "HQ_ADMIN");
  const { site: requested } = await searchParams;
  const { sites, site } = await resolveAdminSite(me, requested);

  if (!site) {
    return <p className="card text-sm text-slate-500">관리할 사업장이 없습니다.</p>;
  }

  const isHq = me.role === "HQ_ADMIN";

  const users = await prisma.user.findMany({
    where: isHq
      ? { OR: [{ siteId: site.id }, { role: "HQ_ADMIN" }] }
      : { siteId: site.id },
    include: {
      site: { select: { name: true } },
      _count: { select: { ledTeams: true } },
    },
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">로그인 계정</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {isHq
              ? `${site.name} 소속 계정과 본사 계정`
              : `${site.name} 소속 계정 (팀장 계정만 만들 수 있습니다)`}
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      <NewUserForm
        sites={sites.map((s) => ({ id: s.id, name: s.name }))}
        canPickRole={isHq}
        defaultSiteId={site.id}
      />

      <section>
        <h2 className="mb-2 font-bold text-slate-900">등록된 계정</h2>
        {users.length === 0 ? (
          <p className="card text-sm text-slate-500">계정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {users.map((u) => (
              <li key={u.id} className={`card ${u.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {u.name}
                      {u.id === me.id && (
                        <span className="ml-2 text-xs font-normal text-slate-400">(나)</span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{u.email}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {ROLE_LABEL[u.role]} · {u.site?.name ?? "본사"}
                      {u.role === "TEAM_LEAD" && ` · 담당 팀 ${u._count.ledTeams}개`}
                      {!u.active && " · 비활성"}
                    </p>
                  </div>

                  {u.id !== me.id && (
                    <form action={toggleUserAction}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button
                        type="submit"
                        className="shrink-0 text-xs font-semibold text-slate-500 hover:underline"
                      >
                        {u.active ? "잠금" : "해제"}
                      </button>
                    </form>
                  )}
                </div>

                {u.role === "TEAM_LEAD" && u.active && u._count.ledTeams === 0 && (
                  <p className="mt-2 text-xs font-medium text-amber-700">
                    담당 팀이 없습니다. 작업팀 화면에서 팀장으로 지정하세요.
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
                  <ResetPassword userId={u.id} />
                  {u.id !== me.id && (
                    <DeleteButton
                      action={deleteUserAction}
                      fields={{ userId: u.id }}
                      question={`${u.name}(${u.email}) 계정을 지울까요? 되돌릴 수 없습니다.`}
                      label="계정 삭제"
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
