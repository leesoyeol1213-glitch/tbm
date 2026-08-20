import { prisma } from "@/lib/db";
import { requireUser, ROLE_LABEL } from "@/lib/authz";
import { logoutAction } from "@/actions/auth";
import NavLinks, { type NavItem } from "@/components/NavLinks";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  const siteName = user.siteId
    ? (await prisma.site.findUnique({
        where: { id: user.siteId },
        select: { name: true },
      }))?.name ?? null
    : null;

  const items: NavItem[] = [{ href: "/tbm", label: "TBM 기록" }];
  if (user.role !== "TEAM_LEAD") {
    items.push({ href: "/approvals", label: "결재함" });
    items.push({ href: "/dashboard", label: "대시보드" });
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
              TBM 안전점검 기록
            </p>
            <p className="truncate text-xs text-slate-500">
              {siteName ?? "본사"} · {user.name} ({ROLE_LABEL[user.role]})
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
