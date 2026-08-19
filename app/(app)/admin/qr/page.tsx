/* eslint-disable @next/next/no-img-element -- QR은 data URL이라 next/image 최적화 대상이 아니다 */
import { headers } from "next/headers";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { dateTimeLabel } from "@/lib/kst";
import { deletePointAction, togglePointAction } from "@/actions/admin";
import DeleteButton from "@/components/admin/DeleteButton";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import NewPointForm from "@/components/admin/NewPointForm";
import PrintButton from "@/components/admin/PrintButton";
import PointCoverage from "@/components/admin/PointCoverage";

export const dynamic = "force-dynamic";

/** 공개 접속 주소. 환경변수가 있으면 그것을 쓰고, 없으면 요청 호스트에서 유추한다. */
async function baseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function QrPage({
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

  const [points, allSites] = await Promise.all([
    prisma.checkinPoint.findMany({
      where: { siteId: site.id },
      include: { coverage: { include: { site: true } } },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    // 담당 사업장 지정은 사업장 경계를 넘으므로 본사만 다룬다.
    user.role === "HQ_ADMIN"
      ? prisma.site.findMany({
          where: { active: true },
          select: { id: true, code: true, name: true, address: true },
          orderBy: { code: "asc" },
        })
      : Promise.resolve([]),
  ]);

  /** 주소가 같은 사업장 = 같은 지문인식기를 쓸 가능성이 높은 묶음 */
  const normalizeAddr = (a: string | null) => (a ?? "").replace(/\s+/g, "");
  const sameAddressIds = allSites
    .filter((s) => normalizeAddr(s.address) === normalizeAddr(site.address))
    .map((s) => s.id);

  const origin = await baseUrl();
  const cards = await Promise.all(
    points.map(async (p) => {
      const coveredSites = [
        { id: site.id, code: site.code, name: site.name },
        ...p.coverage
          .filter((c) => c.siteId !== site.id)
          .map((c) => ({ id: c.site.id, code: c.site.code, name: c.site.name })),
      ];
      return {
        ...p,
        coveredSites,
        coveredIds: coveredSites.map((c) => c.id),
        url: `${origin}/c/${p.token}`,
        qr: await QRCode.toDataURL(`${origin}/c/${p.token}`, {
          width: 720,
          margin: 1,
          errorCorrectionLevel: "M",
        }),
      };
    }),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-bold text-slate-900">출석 QR</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            인쇄해서 지문인식기 옆에 부착하세요. 토큰은 고정이라 한 번만 인쇄하면 됩니다.
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      <div className="print:hidden">
        <NewPointForm siteId={site.id} />
      </div>

      {cards.length === 0 ? (
        <p className="card text-sm text-slate-500 print:hidden">
          등록된 QR 지점이 없습니다. 위에서 추가하세요.
        </p>
      ) : (
        <>
          <div className="print:hidden">
            <PrintButton />
          </div>

          <ul className="grid gap-4 sm:grid-cols-2 print:grid-cols-2 print:gap-6">
            {cards.map((p) => (
              <li
                key={p.id}
                className={`card break-inside-avoid text-center print:shadow-none print:ring-1 ${
                  p.active ? "" : "opacity-50"
                }`}
              >
                <p className="text-sm font-semibold text-slate-500">
                  {p.coveredSites.length > 1
                    ? `${p.coveredSites.length}개 사업장 공용`
                    : site.name}
                </p>
                <p className="mt-0.5 text-xl font-bold text-slate-900">{p.name}</p>
                {p.coveredSites.length > 1 && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">
                    {p.coveredSites.map((c) => c.name).join(" · ")}
                  </p>
                )}
                <p className="mt-3 text-lg font-bold text-slate-900">TBM 출석 체크</p>
                <p className="text-sm text-slate-600">출근 시 스마트폰으로 스캔</p>

                <img
                  src={p.qr}
                  alt={`${p.name} 출석 QR`}
                  className="mx-auto my-3 w-full max-w-56"
                />

                <p className="break-all text-[10px] text-slate-400">{p.url}</p>

                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 print:hidden">
                  <p className="text-xs text-slate-500">
                    {p.lastUsedAt
                      ? `최근 사용 ${dateTimeLabel(p.lastUsedAt)}`
                      : "아직 사용 기록 없음"}
                  </p>

                  {user.role === "HQ_ADMIN" && (
                    <PointCoverage
                      pointId={p.id}
                      ownerSiteId={site.id}
                      allSites={allSites}
                      selectedIds={p.coveredIds}
                      sameAddressIds={sameAddressIds}
                    />
                  )}

                  <div className="flex items-center justify-center gap-4">
                    <form action={togglePointAction}>
                      <input type="hidden" name="pointId" value={p.id} />
                      <button
                        type="submit"
                        className="text-xs font-semibold text-slate-600 hover:underline"
                      >
                        {p.active ? "사용 중지" : "다시 사용"}
                      </button>
                    </form>
                    <DeleteButton
                      action={deletePointAction}
                      fields={{ pointId: p.id }}
                      question={`"${p.name}" QR을 지웁니다. 이미 인쇄해 붙인 QR이 있다면 즉시 못 쓰게 됩니다. 계속할까요?`}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
