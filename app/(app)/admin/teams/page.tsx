import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { deleteTeamAction, toggleTeamAction } from "@/actions/admin";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import DeleteButton from "@/components/admin/DeleteButton";
import TeamForm, { type LeaderOption } from "@/components/admin/TeamForm";

export const dynamic = "force-dynamic";

export default async function TeamsPage({
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

  const [teams, leaderUsers] = await Promise.all([
    prisma.team.findMany({
      where: { siteId: site.id },
      include: {
        leader: { select: { id: true, name: true } },
        _count: { select: { workers: { where: { active: true } }, tbms: true } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { siteId: site.id, active: true, role: { in: ["TEAM_LEAD", "SITE_MANAGER"] } },
      select: { id: true, name: true, username: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const leaders: LeaderOption[] = leaderUsers;
  const noLeader = teams.filter((t) => t.active && !t.leaderId).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">작업팀</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {site.name} · {teams.filter((t) => t.active).length}개 팀
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      {leaders.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          이 사업장에 로그인 계정이 없습니다.{" "}
          <Link href={`/admin/users?site=${site.id}`} className="underline">
            계정 관리
          </Link>
          에서 팀장 계정을 먼저 만드세요.
        </p>
      )}
      {noLeader > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          팀장이 지정되지 않은 팀이 {noLeader}개 있습니다. 팀장이 없으면 그 팀 TBM을
          작성할 사람이 없습니다.
        </p>
      )}

      <TeamForm key={site.id} siteId={site.id} leaders={leaders} mode="create" />

      {teams.length === 0 ? (
        <p className="card text-sm text-slate-500">등록된 팀이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {teams.map((team) => (
            <li key={team.id} className={`card ${team.active ? "" : "opacity-60"}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-900">
                  {team.name}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    작업자 {team._count.workers}명 · 기록 {team._count.tbms}건
                    {team.leader ? ` · 팀장 ${team.leader.name}` : " · 팀장 없음"}
                    {!team.active && " · 비활성"}
                  </span>
                </p>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <form action={toggleTeamAction}>
                    <input type="hidden" name="teamId" value={team.id} />
                    <button
                      type="submit"
                      className="text-xs font-semibold text-slate-500 hover:underline"
                    >
                      {team.active ? "비활성화" : "복귀"}
                    </button>
                  </form>
                  <DeleteButton
                    action={deleteTeamAction}
                    fields={{ teamId: team.id }}
                    question={
                      team._count.workers > 0
                        ? `"${team.name}" 팀을 지웁니다. 소속 작업자 ${team._count.workers}명은 삭제되지 않고 '팀 미지정'이 됩니다. 계속할까요?`
                        : `"${team.name}" 팀을 지웁니다. 계속할까요?`
                    }
                  />
                </div>
              </div>

              <TeamForm
                siteId={site.id}
                leaders={leaders}
                mode="edit"
                team={{
                  id: team.id,
                  name: team.name,
                  company: team.company ?? "",
                  leaderId: team.leaderId ?? "",
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
