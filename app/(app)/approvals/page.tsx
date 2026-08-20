import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole, siteScope } from "@/lib/authz";
import { dateLabel, dateTimeLabel } from "@/lib/kst";
import { FlagChips } from "@/components/badges";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  // 승인은 법인 대표만 한다. 안전관리자·본사는 진행 상황을 보기만 한다.
  const user = await requireRole("CEO", "SITE_MANAGER", "HQ_ADMIN");

  const pending = await prisma.tbm.findMany({
    where: { ...siteScope(user), status: "SUBMITTED" },
    include: {
      team: { select: { name: true } },
      site: { select: { name: true, dueMinute: true } },
      author: { select: { name: true } },
      _count: { select: { photos: true, attendances: true } },
    },
    orderBy: [{ workDate: "asc" }, { submittedAt: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold text-slate-900">결재함</h1>
        <p className="text-sm text-slate-500">대기 {pending.length}건</p>
      </div>

      {user.role !== "CEO" && pending.length > 0 && (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-600 ring-1 ring-slate-200">
          승인·반려는 각 법인의 대표 계정으로만 할 수 있습니다. 여기서는 진행 상황만
          보입니다.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="card text-sm text-slate-500">결재할 건이 없습니다.</p>
      ) : (
        <ul className="space-y-2.5">
          {pending.map((tbm) => (
            <li key={tbm.id}>
              <Link href={`/tbm/${tbm.id}`} className="card block hover:bg-slate-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">
                      {tbm.team.name} · {dateLabel(tbm.workDate)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {tbm.site.name} · {tbm.author?.name ?? "작성자 미상"} · 사진{" "}
                      {tbm._count.photos}장 · 출석 {tbm._count.attendances}명
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                    {tbm.submittedAt ? dateTimeLabel(tbm.submittedAt) : ""}
                  </span>
                </div>
                <div className="mt-2">
                  <FlagChips tbm={tbm} site={tbm.site} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
