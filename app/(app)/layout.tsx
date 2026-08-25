import { prisma } from "@/lib/db";
import { requireUser, ROLE_LABEL } from "@/lib/authz";
import { logoutAction } from "@/actions/auth";
import NavLinks, { type NavItem } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // 법인에 속한 사람은 법인 이름을, 사업부를 맡는 자리는 사업부 이름을 단다.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      site: { select: { name: true } },
      division: { select: { name: true } },
    },
  });
  const belongsTo = me?.site?.name ?? me?.division?.name ?? "본사";

  const items: NavItem[] = [];
  // 대시보드를 맨 왼쪽에 둔다. 로그인하고 처음 보는 것이 전체 현황이어야 한다.
  if (user.role !== "TEAM_LEAD") items.push({ href: "/dashboard", label: "대시보드" });
  items.push({ href: "/tbm", label: "TBM 기록" });
  // 순찰은 팀이 아니라 공장을 도는 일이라 팀장은 쓰지도 결재하지도 않는다.
  if (user.role !== "TEAM_LEAD") {
    items.push({ href: "/patrol", label: "순찰일지" });
    items.push({ href: "/approvals", label: "결재함" });
  }
  // 법인 대표는 결재만 한다. 현장 설정·명부는 안전관리자와 본사가 맡는다.
  if (user.role === "SITE_MANAGER" || user.role === "HQ_ADMIN") {
    items.push({ href: "/admin", label: "관리" });
  }

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-base font-bold text-slate-900">
              가공사업부 안전관리
            </p>
            <p className="truncate text-xs text-slate-500">
              {belongsTo} · {user.name} ({ROLE_LABEL[user.role]})
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              로그아웃
            </button>
          </form>
        </div>
        <NavLinks items={items} />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
    </div>
  );
}
