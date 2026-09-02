import { prisma } from "@/lib/db";
import { describeFlags } from "@/lib/tbm";
import { rosterFor } from "@/lib/roster";
import type { TbmPdfData } from "@/lib/pdf";

/**
 * TBM 한 건을 PDF에 넣을 모양으로 모은다.
 *
 * 한 건 내려받기와 일괄 인쇄가 같은 문서를 내야 하므로 조립을 한곳에 둔다.
 * 양쪽에 같은 매핑을 두면 한쪽만 고쳐져 서로 다른 문서가 나온다.
 *
 * 찾지 못하면 null. 권한 확인은 부르는 쪽이 한다 — 여기서는 문서만 만든다.
 */
export async function loadTbmPdfData(
  tbmId: string,
): Promise<{ data: TbmPdfData; siteCode: string; siteId: string } | null> {
  const tbm = await prisma.tbm.findUnique({
    where: { id: tbmId },
    include: {
      site: true,
      team: { select: { name: true } },
      author: { select: { name: true } },
      approver: { select: { name: true } },
      onBehalfOf: { select: { name: true } },
      eduItems: { orderBy: { sort: "asc" } },
      hazards: { orderBy: { sort: "asc" } },
      // 문서에는 추린 사진만 싣는다. 합동 TBM에서 사진이 여럿 모이지만
      // 결재 서류에 다 들어가면 몇 장짜리 문서가 된다.
      photos: { where: { included: true }, orderBy: { uploadedAt: "asc" } },
      attendances: { include: { worker: { select: { name: true, empNo: true } } } },
    },
  });
  if (!tbm) return null;

  // 명부를 기준으로 출결을 채운다. 기록이 없는 사람도 문서에 남아야 한다.
  // 다만 그만둬서 비활성이 된 사람은, 그날 실제로 나온 게 아니면 싣지 않는다.
  const workers = await prisma.worker.findMany({
    where: { teamId: tbm.teamId },
    select: { id: true, name: true, empNo: true, active: true },
    orderBy: [{ empNo: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
  const roster = rosterFor(workers, tbm.attendances);
  const byWorker = new Map(tbm.attendances.map((a) => [a.workerId, a]));

  return {
    siteId: tbm.siteId,
    siteCode: tbm.site.code,
    data: {
      siteName: tbm.site.name,
      siteCode: tbm.site.code,
      teamName: tbm.team.name,
      workDate: tbm.workDate,
      heldAt: tbm.heldAt,
      heldUntil: tbm.heldUntil,
      weather: tbm.weather,
      status: tbm.status,
      workDescription: tbm.workDescription,
      remarks: tbm.remarks,
      lateReason: tbm.lateReason,
      authorName: tbm.author?.name ?? null,
      submittedAt: tbm.submittedAt,
      approverName: tbm.approver?.name ?? null,
      approvedAt: tbm.approvedAt,
      onBehalfOfName: tbm.onBehalfOf?.name ?? null,
      correctedAt: tbm.correctedAt,
      eduItems: tbm.eduItems.map((e) => ({ content: e.content, done: e.done })),
      hazards: tbm.hazards.map((h) => ({ hazard: h.hazard, control: h.control })),
      attendances: roster.map((w) => {
        const a = byWorker.get(w.id);
        return {
          empNo: w.empNo,
          name: w.name,
          state: a?.state ?? null,
          method: a?.method ?? null,
          checkedInAt: a?.checkedInAt ?? null,
        };
      }),
      photos: tbm.photos.map((p) => ({
        url: p.url,
        takenAt: p.takenAt,
        distanceM: p.distanceM,
        warnings: p.warnings,
        archivedAt: p.archivedAt,
        rotation: p.rotation,
      })),
      flags: describeFlags(tbm, tbm.site).map((f) => ({
        label: f.label,
        detail: f.detail,
      })),
    },
  };
}
