import Image from "next/image";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  canApprove,
  canEdit,
  canAccessSite,
  isDelegatedApproval,
  requireUser,
} from "@/lib/authz";
import { dateLabel, dateTimeLabel, timeLabel } from "@/lib/kst";
import { distanceLabel } from "@/lib/geo";
import { DEFAULT_HELD_FROM, DEFAULT_HELD_UNTIL, MAX_OWN_PHOTOS } from "@/lib/tbm";
import { siblingSites } from "@/lib/siteGroup";
import {
  deletePhotoAction,
  toggleCheckinAction,
  togglePhotoIncludedAction,
} from "@/actions/tbm";
import { FlagPanel, StatusBadge } from "@/components/badges";
import TbmForm from "@/components/tbm/TbmForm";
import PhotoUploader from "@/components/tbm/PhotoUploader";
import AttendancePanel, { type AttendanceRow } from "@/components/tbm/AttendancePanel";
import { ApprovePanel, SubmitPanel } from "@/components/tbm/ApprovalPanel";

export const dynamic = "force-dynamic";

export default async function TbmDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const tbm = await prisma.tbm.findUnique({
    where: { id },
    include: {
      site: true,
      team: { select: { id: true, name: true, company: true } },
      author: { select: { name: true } },
      approver: { select: { name: true } },
      onBehalfOf: { select: { name: true } },
      eduItems: { orderBy: { sort: "asc" } },
      hazards: { orderBy: { sort: "asc" } },
      photos: { orderBy: { uploadedAt: "asc" } },
      attendances: { include: { worker: { select: { id: true, name: true } } } },
      logs: {
        include: { actor: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      },
    },
  });

  if (!tbm) notFound();
  if (!canAccessSite(user, tbm.siteId)) notFound();

  const ledTeams = await prisma.team.findMany({
    where: { leaderId: user.id },
    select: { id: true },
  });
  const editable = canEdit(user, tbm, ledTeams.map((t) => t.id));
  const approvable = canApprove(user, tbm);

  // 같은 공장을 쓰는 다른 법인. 아침 TBM을 합동으로 하는 곳이라 사진을 함께 올린다.
  const siblings = editable ? await siblingSites(tbm.site) : [];

  // 이미 공유된 사진이 어느 법인들에 들어가 있는지. 화면에만 쓰고 PDF에는 넣지 않는다.
  const groupIds = tbm.photos
    .map((p) => p.sharedGroupId)
    .filter((v): v is string => Boolean(v));
  const sharedRows =
    groupIds.length > 0
      ? await prisma.tbmPhoto.findMany({
          where: { sharedGroupId: { in: groupIds }, tbmId: { not: tbm.id } },
          select: { sharedGroupId: true, tbm: { select: { site: { select: { name: true } } } } },
        })
      : [];
  const sharedWith = new Map<string, string[]>();
  for (const row of sharedRows) {
    if (!row.sharedGroupId) continue;
    const names = sharedWith.get(row.sharedGroupId) ?? [];
    names.push(row.tbm.site.name);
    sharedWith.set(row.sharedGroupId, names);
  }

  // 옆 법인에서 받아 온 사진은 어느 법인이 올린 것인지 이름으로 보여 준다.
  const fromSiteIds = [
    ...new Set(
      tbm.photos.map((p) => p.sharedFromSiteId).filter((v): v is string => Boolean(v)),
    ),
  ];
  const fromSiteName = new Map<string, string>();
  if (fromSiteIds.length > 0) {
    const rows = await prisma.site.findMany({
      where: { id: { in: fromSiteIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) fromSiteName.set(r.id, r.name);
  }

  // 상한은 직접 올린 사진만 센다. 받은 사본이 자리를 먹으면 정작 자기 사진을
  // 못 올리게 된다.
  const ownPhotoCount = tbm.photos.filter((p) => !p.sharedFromSiteId).length;
  // 결재 문서에 실리는 장수. 나머지는 화면에만 남는 참고용이다.
  const docPhotoCount = tbm.photos.filter((p) => p.included).length;

  // 본사가 결재하면 그 법인 대표를 대신한 대결이 된다. 누구를 대신하는지 미리 보여 준다.
  const delegateFor =
    approvable && isDelegatedApproval(user)
      ? (
          await prisma.user.findFirst({
            where: { role: "CEO", siteId: tbm.siteId, active: true },
            select: { name: true },
            orderBy: { createdAt: "asc" },
          })
        )?.name ?? null
      : null;

  // 팀 전체 명부에 출결 기록을 얹는다 (기록이 없는 사람도 보여야 한다)
  const workers = await prisma.worker.findMany({
    where: { teamId: tbm.teamId, active: true },
    select: { id: true, name: true, empNo: true },
    orderBy: [{ empNo: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
  const attendanceByWorker = new Map(tbm.attendances.map((a) => [a.workerId, a]));
  const rows: AttendanceRow[] = workers.map((w) => {
    const a = attendanceByWorker.get(w.id);
    return {
      workerId: w.id,
      name: w.name,
      empNo: w.empNo,
      state: a?.state ?? null,
      method: a?.method ?? null,
      checkedInAt: a?.checkedInAt ?? null,
      note: a?.note ?? null,
    };
  });

  return (
    <div className="space-y-5">
      {/* --- 헤더 --- */}
      <header className="card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-slate-900">{tbm.team.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {tbm.site.name} · {dateLabel(tbm.workDate)}
              {tbm.heldAt &&
                ` · 실시 ${timeLabel(tbm.heldAt)}${
                  tbm.heldUntil ? `~${timeLabel(tbm.heldUntil)}` : ""
                }`}
            </p>
          </div>
          <StatusBadge status={tbm.status} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">작성자</dt>
            <dd className="font-medium text-slate-800">{tbm.author?.name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">상신</dt>
            <dd className="font-medium text-slate-800">
              {tbm.submittedAt ? dateTimeLabel(tbm.submittedAt) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">결재자</dt>
            <dd className="font-medium text-slate-800">
              {tbm.onBehalfOf
                ? `${tbm.onBehalfOf.name}`
                : (tbm.approver?.name ?? "—")}
              {tbm.onBehalfOf && (
                <span className="ml-1 text-xs font-normal text-slate-500">
                  (대결 {tbm.approver?.name ?? "—"})
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">승인</dt>
            <dd className="font-medium text-slate-800">
              {tbm.approvedAt ? dateTimeLabel(tbm.approvedAt) : "—"}
            </dd>
          </div>
        </dl>
      </header>

      {tbm.correctedAt && (
        <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
          승인 후 정정된 기록입니다 ({dateTimeLabel(tbm.correctedAt)}). 정정 내역은 아래
          기록에 남아 있고, 결재 문서에도 표시됩니다.
        </p>
      )}

      {editable && tbm.status === "APPROVED" && (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700 ring-1 ring-slate-200">
          승인이 끝난 기록입니다. 본사 관리자만 정정할 수 있고, 고치면 정정한 사실과
          시각이 문서에 남습니다.
        </p>
      )}

      {tbm.status === "APPROVED" && (
        <a
          href={`/api/tbm/${tbm.id}/pdf`}
          className="btn-secondary w-full"
          download
        >
          결재 문서 PDF 내려받기
        </a>
      )}

      {tbm.status === "REJECTED" && tbm.rejectReason && (
        <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-rose-200">
          <p className="text-sm font-bold text-rose-900">반려 사유</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-rose-800">{tbm.rejectReason}</p>
        </div>
      )}

      <FlagPanel tbm={tbm} site={tbm.site} />

      {/* --- 출석 --- */}
      <AttendancePanel tbmId={tbm.id} rows={rows} editable={editable} />

      {editable && (
        <form action={toggleCheckinAction}>
          <input type="hidden" name="tbmId" value={tbm.id} />
          <button type="submit" className="btn-secondary w-full text-sm">
            {tbm.checkinOpen ? "QR 출석 체크 마감하기" : "QR 출석 체크 다시 열기"}
          </button>
        </form>
      )}

      {/* --- 사진 --- */}
      <section className="card">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="font-bold text-slate-900">현장 사진</h2>
          <p className="text-sm text-slate-500">
            {tbm.photos.length}장
            {tbm.photos.length > docPhotoCount && (
              <span className="text-slate-400"> · 문서에 {docPhotoCount}장</span>
            )}
          </p>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          촬영 시각과 위치를 자동으로 확인합니다.
          {tbm.photos.length > docPhotoCount &&
            " 결재 문서에는 아래에서 고른 사진만 들어갑니다."}
        </p>

        {tbm.photos.length > 0 && (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {tbm.photos.map((photo) => (
              <li key={photo.id} className="overflow-hidden rounded-lg ring-1 ring-slate-200">
                <div className="relative aspect-square bg-slate-100">
                  {photo.archivedAt ? (
                    // 파일은 지웠지만 촬영 시각·위치·경고는 아래에 그대로 남는다.
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-2 text-center">
                      <span className="text-xs font-semibold text-slate-500">
                        보관 처리됨
                      </span>
                      <span className="text-[11px] leading-tight text-slate-400">
                        원본은 월간 백업에 있습니다
                      </span>
                    </div>
                  ) : (
                    <Image
                      src={photo.url}
                      alt="현장 사진"
                      fill
                      sizes="(max-width: 640px) 50vw, 33vw"
                      className="object-cover"
                    />
                  )}
                </div>
                <div
                  className={`space-y-1 p-2 ${photo.included ? "" : "bg-slate-50"}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`text-xs font-semibold ${
                        photo.included ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {photo.included ? "문서에 넣음" : "참고용"}
                    </span>
                    {editable && (
                      <form action={togglePhotoIncludedAction}>
                        <input type="hidden" name="photoId" value={photo.id} />
                        <button
                          type="submit"
                          className="text-xs font-semibold text-slate-500 hover:underline"
                        >
                          {photo.included ? "빼기" : "넣기"}
                        </button>
                      </form>
                    )}
                  </div>
                  {photo.sharedFromSiteId ? (
                    <p className="text-xs font-semibold text-sky-700">
                      {fromSiteName.get(photo.sharedFromSiteId) ?? "다른 법인"}에서
                      받음
                      <span className="block font-normal text-slate-500">
                        합동 TBM 사진입니다. 우리 사진 상한과 별개입니다.
                      </span>
                    </p>
                  ) : null}
                  {!photo.sharedFromSiteId &&
                    photo.sharedGroupId &&
                    sharedWith.has(photo.sharedGroupId) && (
                      <p className="text-xs font-semibold text-sky-700">
                        {sharedWith.get(photo.sharedGroupId)!.length + 1}개 법인 공용
                        <span className="block font-normal text-slate-500">
                          {sharedWith.get(photo.sharedGroupId)!.join(", ")}에도 있음
                        </span>
                      </p>
                    )}
                  <p className="text-xs font-medium text-slate-700">
                    {photo.takenAt ? `촬영 ${dateTimeLabel(photo.takenAt)}` : "촬영 시각 없음"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {photo.distanceM !== null
                      ? `현장에서 ${distanceLabel(photo.distanceM)}`
                      : "위치 정보 없음"}
                  </p>
                  {photo.warnings.length > 0 && (
                    <ul className="space-y-0.5">
                      {photo.warnings.map((w, i) => (
                        <li key={i} className="text-xs font-medium text-rose-700">
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  )}
                  {editable && (
                    <form action={deletePhotoAction}>
                      <input type="hidden" name="photoId" value={photo.id} />
                      <button
                        type="submit"
                        className="mt-1 text-xs font-semibold text-rose-600 hover:underline"
                      >
                        삭제
                      </button>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {editable ? (
          <PhotoUploader
            tbmId={tbm.id}
            remaining={MAX_OWN_PHOTOS - ownPhotoCount}
            shareSiteNames={siblings.map((s) => s.name)}
          />
        ) : (
          tbm.photos.length === 0 && (
            <p className="text-sm text-slate-500">등록된 사진이 없습니다.</p>
          )
        )}
      </section>

      {/* --- 본문 --- */}
      {editable ? (
        <TbmForm
          tbmId={tbm.id}
          eduItems={tbm.eduItems.map((e) => ({
            id: e.id,
            content: e.content,
            done: e.done,
          }))}
          hazards={tbm.hazards.map((h) => ({ hazard: h.hazard, control: h.control }))}
          workDescription={tbm.workDescription}
          remarks={tbm.remarks ?? ""}
          weather={tbm.weather ?? ""}
          heldAt={tbm.heldAt ? timeLabel(tbm.heldAt) : DEFAULT_HELD_FROM}
          heldUntil={tbm.heldUntil ? timeLabel(tbm.heldUntil) : DEFAULT_HELD_UNTIL}
        />
      ) : (
        <ReadOnlyBody tbm={tbm} />
      )}

      {/* --- 결재 --- */}
      {editable && (tbm.status === "DRAFT" || tbm.status === "REJECTED") && (
        <SubmitPanel tbmId={tbm.id} rejected={tbm.status === "REJECTED"} />
      )}
      {approvable && <ApprovePanel tbmId={tbm.id} delegateFor={delegateFor} />}

      {/* --- 이력 --- */}
      <section className="card">
        <h2 className="mb-3 font-bold text-slate-900">처리 이력</h2>
        <ul className="space-y-2">
          {tbm.logs.map((log) => (
            <li key={log.id} className="flex justify-between gap-3 text-sm">
              <span className="text-slate-700">
                <span className="font-semibold">{ACTION_LABEL[log.action] ?? log.action}</span>
                {log.actor?.name && <span className="text-slate-500"> · {log.actor.name}</span>}
                {log.detail && <span className="text-slate-500"> · {log.detail}</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {dateTimeLabel(log.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  CREATE: "생성",
  AUTO_CREATE: "자동 생성(첫 출석 체크인)",
  UPDATE: "내용 수정",
  SUBMIT: "결재 상신",
  APPROVE: "승인",
  REJECT: "반려",
  PHOTO_ADD: "사진 등록",
  PHOTO_DELETE: "사진 삭제",
  CHECKIN: "QR 출석",
  ATTENDANCE: "출결 수정",
};

function ReadOnlyBody({
  tbm,
}: {
  tbm: {
    workDescription: string;
    remarks: string | null;
    weather: string | null;
    eduItems: { id: string; content: string; done: boolean }[];
    hazards: { id: string; hazard: string; control: string }[];
    status: string;
  };
}) {
  return (
    <div className="space-y-5">
      <div className="card">
        <h2 className="mb-2 font-bold text-slate-900">오늘의 작업 내용</h2>
        <p className="text-sm whitespace-pre-wrap text-slate-700">
          {tbm.workDescription || "—"}
        </p>
        {tbm.weather && (
          <p className="mt-2 text-xs text-slate-500">날씨: {tbm.weather}</p>
        )}
      </div>

      {tbm.eduItems.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-bold text-slate-900">안전보건교육 실시 항목</h2>
          <ul className="space-y-1.5">
            {tbm.eduItems.map((e) => (
              <li key={e.id} className="flex gap-2 text-sm">
                <span className={e.done ? "text-emerald-600" : "text-slate-300"}>
                  {e.done ? "✓" : "○"}
                </span>
                <span className={e.done ? "text-slate-700" : "text-slate-400 line-through"}>
                  {e.content}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tbm.hazards.length > 0 && (
        <div className="card">
          <h2 className="mb-3 font-bold text-slate-900">위험요인 및 안전대책</h2>
          <ul className="space-y-2.5">
            {tbm.hazards.map((h, i) => (
              <li key={h.id} className="rounded-lg bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">
                  {i + 1}. {h.hazard}
                </p>
                <p className="mt-1 text-sm text-slate-600">→ {h.control}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tbm.remarks && (
        <div className="card">
          <h2 className="mb-2 font-bold text-slate-900">특이사항</h2>
          <p className="text-sm whitespace-pre-wrap text-slate-700">{tbm.remarks}</p>
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        {tbm.status === "APPROVED"
          ? "승인된 기록은 수정할 수 없습니다."
          : "수정 권한이 없습니다."}
      </p>
    </div>
  );
}
