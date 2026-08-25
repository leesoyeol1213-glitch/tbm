import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { minuteLabel } from "@/lib/kst";
import { resolveAdminSite } from "@/lib/adminSite";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import PhotoRetentionNotice from "@/components/admin/PhotoRetentionNotice";

export const dynamic = "force-dynamic";

export default async function AdminPage({
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

  const query = `?site=${site.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-900">관리</h1>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      <section className="card">
        <h2 className="font-bold text-slate-900">처음 설정하는 순서</h2>
        <ol className="mt-2 space-y-1 text-sm text-slate-600">
          <li>1. 사업장을 만들고 아래에서 <strong>위도·경도</strong>를 넣습니다.</li>
          <li>
            2. <strong>법인 대표</strong>·안전관리자·팀장 계정을 만듭니다.
            (대표가 없으면 결재가 되지 않습니다)
          </li>
          <li>3. 작업팀을 만들고 팀장을 지정합니다.</li>
          <li>4. 작업자 명부를 엑셀로 한 번에 올립니다.</li>
          <li>5. 교육 템플릿을 현장에 맞게 고칩니다.</li>
          <li>6. 출석 QR을 인쇄해 지문인식기 옆에 붙입니다.</li>
        </ol>
      </section>

      <nav className="grid gap-2.5 sm:grid-cols-3">
        {user.role === "HQ_ADMIN" && (
          <AdminCard
            href="/admin/sites"
            title="사업장"
            desc="사업장을 추가하거나 삭제합니다."
            step="1"
          />
        )}
        {user.role === "HQ_ADMIN" && (
          <AdminCard
            href="/admin/plants"
            title="공장"
            desc="안전(순찰)일지의 단위. 법인과 따로 관리합니다."
            step="1"
          />
        )}
        <AdminCard
          href={`/admin/users${query}`}
          title="계정"
          desc="법인 대표·안전관리자·팀장 계정을 만듭니다."
          step="2"
        />
        <AdminCard
          href={`/admin/teams${query}`}
          title="작업팀"
          desc="팀을 만들고 팀장을 지정합니다."
          step="3"
        />
        <AdminCard
          href={`/admin/workers${query}`}
          title="작업자 명부"
          desc="엑셀로 인원을 한 번에 등록합니다."
          step="4"
        />
        <AdminCard
          href={`/admin/template${query}`}
          title="교육 템플릿"
          desc="매일 자동으로 채워질 교육 항목과 위험요인."
          step="5"
        />
        <AdminCard
          href={`/admin/qr${query}`}
          title="출석 QR"
          desc="지문인식기 옆에 부착할 QR을 인쇄합니다."
          step="6"
        />
        <AdminCard
          href="/admin/patrol-template"
          title="순찰 점검표"
          desc="안전(순찰)일지에 매번 채워질 점검항목."
          step="7"
        />
      </nav>

      {/* 사진 정리는 본사가 백업과 함께 하는 일이라 여기에 둔다. */}
      {user.role === "HQ_ADMIN" && <PhotoRetentionNotice />}

      <section className="card">
        <h2 className="mb-1 font-bold text-slate-900">사업장 설정</h2>
        <p className="mb-4 text-xs text-slate-500">
          현재 마감 {minuteLabel(site.dueMinute)} · 체크인{" "}
          {minuteLabel(site.checkinFrom)}~{minuteLabel(site.checkinUntil)} · 허용 반경{" "}
          {site.geofenceM}m
        </p>
        <SiteSettingsForm key={site.id} site={site} />
      </section>
    </div>
  );
}

function AdminCard({
  href,
  title,
  desc,
  step,
}: {
  href: string;
  title: string;
  desc: string;
  step: string;
}) {
  return (
    <Link href={href} className="card block hover:bg-slate-50">
      <p className="font-bold text-slate-900">
        <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
          {step}
        </span>
        {title}
      </p>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
    </Link>
  );
}
