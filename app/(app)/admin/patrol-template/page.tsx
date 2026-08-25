import { requireRole } from "@/lib/authz";
import { resolveAdminSite } from "@/lib/adminSite";
import { pickPatrolTemplate } from "@/lib/patrol";
import SiteSwitcher from "@/components/admin/SiteSwitcher";
import PatrolTemplateEditor, {
  CreateSharedPatrolTemplateForm,
  ForkPatrolTemplateForm,
} from "@/components/admin/PatrolTemplateEditor";

export const dynamic = "force-dynamic";

export default async function PatrolTemplatePage({
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

  const template = await pickPatrolTemplate(site.id);

  if (!template) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-slate-900">순찰 점검표</h1>
          <SiteSwitcher sites={sites} currentId={site.id} />
        </div>
        {user.role === "HQ_ADMIN" ? (
          <CreateSharedPatrolTemplateForm />
        ) : (
          <p className="card text-sm text-slate-500">
            적용할 점검표가 없습니다. 본사 관리자에게 요청하세요.
          </p>
        )}
      </div>
    );
  }

  const isShared = template.siteId === null;
  const readOnly = isShared && user.role !== "HQ_ADMIN";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">순찰 점검표</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {site.name}에 적용 중:{" "}
            <strong className="text-slate-700">{template.name}</strong>{" "}
            {isShared ? "(전사 공통)" : "(사업장 전용)"}
          </p>
        </div>
        <SiteSwitcher sites={sites} currentId={site.id} />
      </div>

      {isShared && <ForkPatrolTemplateForm key={site.id} siteId={site.id} siteName={site.name} />}

      <PatrolTemplateEditor
        key={template.id}
        templateId={template.id}
        name={template.name}
        items={template.items.map((i) => i.content)}
        readOnly={readOnly}
      />
    </div>
  );
}
