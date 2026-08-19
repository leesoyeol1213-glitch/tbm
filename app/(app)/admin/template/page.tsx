import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { pickTemplate } from "@/lib/tbm";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import TemplateEditor from "@/components/admin/TemplateEditor";
import ForkTemplateForm from "@/components/admin/ForkTemplateForm";

export const dynamic = "force-dynamic";

export default async function TemplatePage({
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

  const template = await pickTemplate(site.id);

  if (!template) {
    return (
      <p className="card text-sm text-slate-500">
        적용할 템플릿이 없습니다. <code>npm run db:seed</code>로 기본 템플릿을 만들거나
        본사 관리자에게 요청하세요.
      </p>
    );
  }

  const isShared = template.siteId === null;
  const readOnly = isShared && user.role !== "HQ_ADMIN";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">교육 템플릿</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {site.name}에 적용 중:{" "}
            <strong className="text-slate-700">{template.name}</strong>{" "}
            {isShared ? "(전사 공통)" : "(사업장 전용)"}
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      {isShared && <ForkTemplateForm siteId={site.id} siteName={site.name} />}

      <TemplateEditor
        templateId={template.id}
        name={template.name}
        workDescription={template.workDescription ?? ""}
        eduItems={template.eduItems.map((e) => e.content)}
        hazards={template.hazards.map((h) => ({ hazard: h.hazard, control: h.control }))}
        readOnly={readOnly}
      />
    </div>
  );
}
