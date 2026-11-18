import type { Prisma, Tbm } from "@prisma/client";
import { prisma } from "@/lib/db";
import { distanceMeters, distanceLabel } from "@/lib/geo";
import { kstDateOnly, kstMinuteOfDay, minuteLabel, ymd } from "@/lib/kst";

/**
 * 자기 일지에 직접 올릴 수 있는 사진 수.
 *
 * 받은 사진과 따로 센다. 같은 주소에 법인이 넷인 공장에서는 옆 법인이 올린
 * 사본이 자리를 다 먹어, 정작 자기가 찍은 사진을 못 올리는 일이 있었다.
 * 각 법인의 일지에 "우리가 찍은 사진"은 반드시 들어가야 한다.
 */
export const MAX_OWN_PHOTOS = 2;

/**
 * 결재 문서에 기본으로 싣는 사진 수.
 *
 * 받는 사진에는 상한을 두지 않는다. 한 공장에 법인이 넷이라 서로 올린 것이
 * 다 모이는데, 상한에 걸려 정작 필요한 사진이 안 넘어가는 일이 있었다.
 * 대신 문서에는 먼저 들어온 순으로 이만큼만 싣고, 나머지는 화면에 참고용으로
 * 둔다. 무엇을 실을지는 상신 전에 사람이 바꿀 수 있다.
 */
export const DOC_PHOTOS = 2;

/**
 * 상신할 때 문서에 남길 작성자.
 *
 * QR 첫 체크인으로 자동 생성된 TBM은 작성자 자리에 팀장을 넣어 둔다. 그저
 * 잠정값이라, 처음 상신할 때 실제로 올린 사람으로 확정한다. 이걸 안 하면
 * 팀장 자리에 남은 옛 계정이 쓰지도 않은 문서의 작성자로 찍힌다.
 *
 * 반려 뒤 다시 올릴 때는 바꾸지 않는다. 그때는 이미 확정된 값이고, 정정하는
 * 사람이 작성자를 가로채면 누가 쓴 문서인지 흐려진다.
 */
export function submitAuthorId(
  tbm: { autoCreated: boolean; submittedAt: Date | null; authorId: string | null },
  submitterId: string,
): string {
  if (tbm.autoCreated && !tbm.submittedAt) return submitterId;
  return tbm.authorId ?? submitterId;
}

/**
 * TBM 실시 시간 기본값 (KST "HH:mm"). 작성 화면에 미리 채워 두기만 하고,
 * 저장을 눌러야 기록에 남는다. 아무도 손대지 않은 문서에 시간이 찍혀
 * 나가면 안 되기 때문이다.
 */
export const DEFAULT_HELD_FROM = "07:30";
export const DEFAULT_HELD_UNTIL = "08:00";

const templateInclude = {
  eduItems: { orderBy: { sort: "asc" } },
  hazards: { orderBy: { sort: "asc" } },
} satisfies Prisma.TbmTemplateInclude;

/** 사업장 전용 템플릿을 우선 쓰고, 없으면 전사 공통 템플릿을 쓴다. */
export async function pickTemplate(siteId: string) {
  const own = await prisma.tbmTemplate.findFirst({
    where: { siteId, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
  if (own) return own;

  return prisma.tbmTemplate.findFirst({
    where: { siteId: null, active: true },
    include: templateInclude,
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 팀의 해당 날짜 TBM을 가져오고, 없으면 템플릿을 복사해 새로 만든다.
 *
 * 작업자가 출근 QR을 찍는 시점이 팀장이 TBM을 여는 시점보다 이른 경우가 많아서,
 * 첫 체크인이 곧 그날 기록의 시작점이 된다.
 */
export async function ensureTbm(
  teamId: string,
  workDate: Date,
  opts: { autoCreated?: boolean; actorId?: string | null } = {},
): Promise<Tbm> {
  const key = { teamId_workDate: { teamId, workDate } };

  const existing = await prisma.tbm.findUnique({ where: key });
  if (existing) return existing;

  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("팀을 찾을 수 없습니다.");

  const template = await pickTemplate(team.siteId);
  const autoCreated = opts.autoCreated ?? false;

  try {
    return await prisma.tbm.create({
      data: {
        siteId: team.siteId,
        teamId,
        workDate,
        autoCreated,
        // 자동 생성이면 팀장을 잠정 작성자로 둔다. 실제 상신 시점에 확정된다.
        authorId: opts.actorId ?? team.leaderId ?? null,
        workDescription: template?.workDescription ?? "",
        eduItems: {
          create:
            template?.eduItems.map((e) => ({ content: e.content, sort: e.sort })) ?? [],
        },
        hazards: {
          create:
            template?.hazards.map((h) => ({
              hazard: h.hazard,
              control: h.control,
              sort: h.sort,
            })) ?? [],
        },
        logs: {
          create: {
            action: autoCreated ? "AUTO_CREATE" : "CREATE",
            actorId: opts.actorId ?? null,
            detail: template ? `템플릿 "${template.name}" 적용` : "템플릿 없음",
          },
        },
      },
    });
  } catch {
    // 여러 명이 동시에 QR을 찍으면 (teamId, workDate) unique 충돌이 날 수 있다.
    const again = await prisma.tbm.findUnique({ where: key });
    if (again) return again;
    throw new Error("TBM 생성에 실패했습니다.");
  }
}

export type PhotoCheck = {
  distanceM: number | null;
  warnings: string[];
};

/** 업로드된 사진 한 장을 사업장·작업일 기준으로 검증한다. */
export function checkPhoto(
  exif: { hasExif: boolean; takenAt: Date | null; lat: number | null; lng: number | null },
  site: { lat: number | null; lng: number | null; geofenceM: number },
  workDate: Date,
): PhotoCheck {
  const warnings: string[] = [];
  let distanceM: number | null = null;

  if (!exif.hasExif) {
    warnings.push("촬영 정보(EXIF)가 없습니다. 캡처 화면이거나 재전송된 사진일 수 있습니다.");
  }

  if (exif.takenAt) {
    if (ymd(exif.takenAt) !== ymd(workDate)) {
      warnings.push(
        `촬영일(${ymd(exif.takenAt)})이 작업일(${ymd(workDate)})과 다릅니다.`,
      );
    }
  } else if (exif.hasExif) {
    warnings.push("촬영 시각을 읽을 수 없습니다.");
  }

  if (exif.lat !== null && exif.lng !== null) {
    if (site.lat !== null && site.lng !== null) {
      distanceM = distanceMeters(exif.lat, exif.lng, site.lat, site.lng);
      if (distanceM > site.geofenceM) {
        warnings.push(
          `촬영 위치가 사업장에서 ${distanceLabel(distanceM)} 떨어져 있습니다. (허용 ${distanceLabel(site.geofenceM)})`,
        );
      }
    }
  } else {
    warnings.push("위치 정보가 없습니다. 카메라 앱의 위치 태그를 켜 주세요.");
  }

  return { distanceM, warnings };
}

/** TBM 전체의 검증 플래그를 다시 계산해 저장한다. */
export async function recomputeFlags(tbmId: string): Promise<void> {
  const tbm = await prisma.tbm.findUnique({
    where: { id: tbmId },
    include: { photos: true, site: true },
  });
  if (!tbm) return;

  // 경고는 문서에 실리는 사진만 보고 매긴다. 참고용으로 붙어 있는 사진 때문에
  // 결재까지 끝난 일지의 경고가 나중에 바뀌면 안 된다.
  const site = tbm.site;
  const photos = tbm.photos.filter((p) => p.included);

  const flagNoExif = photos.length > 0 && photos.some((p) => !p.hasExif);
  const flagPhotoDateGap = photos.some(
    (p) => p.takenAt !== null && ymd(p.takenAt) !== ymd(tbm.workDate),
  );
  const flagOutsideFence = photos.some(
    (p) => p.distanceM !== null && p.distanceM > site.geofenceM,
  );
  const flagLateSubmit = tbm.submittedAt
    ? ymd(tbm.submittedAt) !== ymd(tbm.workDate) ||
      kstMinuteOfDay(tbm.submittedAt) > site.dueMinute
    : false;

  await prisma.tbm.update({
    where: { id: tbmId },
    data: { flagNoExif, flagPhotoDateGap, flagOutsideFence, flagLateSubmit },
  });
}

/**
 * 사업장 좌표나 허용 반경이 바뀌었을 때, 이미 올라간 사진의 거리와 경고를
 * 다시 계산한다.
 *
 * 거리와 경고문은 업로드하는 순간 사진에 박아 둔다. 그래서 좌표를 고쳐도
 * 예전 사진은 옛 기준으로 잰 값을 그대로 달고 있었다. 인천은 도로명주소가
 * 가리키는 점이 실제 작업 구역에서 693m 떨어져 있어, 정상 작업 사진에
 * "현장에서 693m 떨어져 있습니다"가 붙어 결재로 올라갔다.
 *
 * 결재가 끝난 일지는 건드리지 않는다. 승인된 문서는 그 시점의 기록이고,
 * 나중에 설정을 고쳤다고 이미 결재된 경고문이 조용히 바뀌면 안 된다.
 */
export async function recomputeSitePhotos(siteId: string): Promise<number> {
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return 0;

  const photos = await prisma.tbmPhoto.findMany({
    where: { tbm: { siteId, status: { not: "APPROVED" } } },
    select: {
      id: true,
      tbmId: true,
      hasExif: true,
      takenAt: true,
      lat: true,
      lng: true,
      distanceM: true,
      warnings: true,
      tbm: { select: { workDate: true } },
    },
  });

  const touched = new Set<string>();
  for (const p of photos) {
    const check = checkPhoto(
      { hasExif: p.hasExif, takenAt: p.takenAt, lat: p.lat, lng: p.lng },
      site,
      p.tbm.workDate,
    );
    const same =
      check.distanceM === p.distanceM &&
      check.warnings.length === p.warnings.length &&
      check.warnings.every((w, i) => w === p.warnings[i]);
    if (same) continue;

    await prisma.tbmPhoto.update({
      where: { id: p.id },
      data: { distanceM: check.distanceM, warnings: check.warnings },
    });
    touched.add(p.tbmId);
  }

  for (const tbmId of touched) await recomputeFlags(tbmId);
  return touched.size;
}
export type FlagInfo = { key: string; label: string; detail: string };

/** 화면에 띄울 경고 목록 */
export function describeFlags(
  tbm: Pick<
    Tbm,
    "flagLateSubmit" | "flagPhotoDateGap" | "flagOutsideFence" | "flagNoExif" | "submittedAt"
  >,
  site: { dueMinute: number },
): FlagInfo[] {
  const out: FlagInfo[] = [];

  if (tbm.flagLateSubmit) {
    out.push({
      key: "late",
      label: "지연 상신",
      detail: `마감(${minuteLabel(site.dueMinute)})을 넘겨 상신되었습니다.`,
    });
  }
  if (tbm.flagPhotoDateGap) {
    out.push({
      key: "dategap",
      label: "촬영일 불일치",
      detail: "작업일과 다른 날 찍힌 사진이 포함되어 있습니다.",
    });
  }
  if (tbm.flagOutsideFence) {
    out.push({
      key: "fence",
      label: "현장 이탈 촬영",
      detail: "사업장 반경 밖에서 찍힌 사진이 포함되어 있습니다.",
    });
  }
  if (tbm.flagNoExif) {
    out.push({
      key: "noexif",
      label: "촬영 정보 없음",
      detail: "EXIF가 없는 사진이 포함되어 있습니다.",
    });
  }

  return out;
}

export function hasAnyFlag(
  tbm: Pick<Tbm, "flagLateSubmit" | "flagPhotoDateGap" | "flagOutsideFence" | "flagNoExif">,
): boolean {
  return (
    tbm.flagLateSubmit || tbm.flagPhotoDateGap || tbm.flagOutsideFence || tbm.flagNoExif
  );
}

/** 오늘 이 사업장에서 체크인을 받을 수 있는 시간인지 */
export function checkinWindowState(
  site: { checkinFrom: number; checkinUntil: number; lateAfterMinute: number },
  at: Date = new Date(),
): { open: boolean; late: boolean; reason?: string } {
  const m = kstMinuteOfDay(at);
  if (m < site.checkinFrom) {
    return {
      open: false,
      late: false,
      reason: `출석 체크는 ${minuteLabel(site.checkinFrom)}부터 가능합니다.`,
    };
  }
  if (m > site.checkinUntil) {
    return {
      open: false,
      late: false,
      reason: `출석 체크가 ${minuteLabel(site.checkinUntil)}에 마감되었습니다.`,
    };
  }
  return { open: true, late: m > site.lateAfterMinute };
}
// ---------------------------------------------------------------------------
// 늦게 올리는 사유
// ---------------------------------------------------------------------------

/**
 * 고를 수 있는 사유. 실제로 적혀 있던 값에서 뽑았다(2026-11, 진천 69건 기준).
 *
 * 자유 입력만 두었더니 "." 한 글자가 16건 들어왔다. 규칙을 통과하려고 아무
 * 글자나 넣은 것이다. 이 칸의 목적은 "휴무일 작업을 다음 날 올린 것"과 "사후에
 * 꾸며 넣은 것"을 가르는 데 있는데, 점 하나는 그 둘을 가르지 못한다.
 *
 * 그래서 고를 수 있게 바꿨다. 한 번 누르면 통과하니 점을 찍을 이유가 없고,
 * 고른 사유는 나중에 세어 볼 수 있다. 자유 입력은 그대로 남겨 둔다 —
 * "2공장 휴무 / 왓산 입원 중"처럼 선택지에 없는 사정이 실제로 적혀 있었다.
 */
export const LATE_PRESETS = [
  "휴무일·주말 작업",
  "작성 누락",
  "사진 전달 지연",
  "업무 과다",
] as const;

export type LatePreset = (typeof LATE_PRESETS)[number];

/**
 * 작업일에서 며칠 지났는지. 같은 날이면 0.
 *
 * workDate 와 kstDateOnly 는 둘 다 "UTC 자정 Date" 규약이라 밀리초 차를
 * 그대로 날로 환산할 수 있다(lib/kst.ts 머리말 참고).
 */
export function lateDays(workDate: Date, today: Date = kstDateOnly()): number {
  return Math.round((today.getTime() - workDate.getTime()) / 86_400_000);
}

/**
 * 사유로 받아들일 글자인지.
 *
 * 문장부호와 공백만 남는 값을 거른다 — "." 하나로 통과하던 자리다. 길이를
 * 길게 요구하지는 않는다. "휴무"처럼 짧아도 뜻이 있는 말은 받아야 하고,
 * 글자 수를 늘려 받으면 통과용으로 "...."을 찍게 될 뿐이다.
 */
export function isMeaningfulLateReason(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return raw.replace(/[^\p{L}\p{N}]/gu, "").length >= 2;
}

/**
 * 늦은 정도를 한 줄로. 하루 늦은 것과 3주 늦은 것은 다른 일인데, 지금까지는
 * 문서에 사유만 남아 둘이 구분되지 않았다.
 */
export function lateDaysLabel(days: number): string {
  if (days <= 0) return "";
  if (days === 1) return "하루 지난 기록입니다";
  if (days <= 3) return `${days}일 지난 기록입니다`;
  if (days <= 7) return `${days}일 지났습니다 — 한 주가 다 됐습니다`;
  return `${days}일 지났습니다 — 사후 작성으로 보일 수 있습니다`;
}

// ---------------------------------------------------------------------------
// 휴일 부분 가동
// ---------------------------------------------------------------------------

/**
 * 출석이 명부에 비해 눈에 띄게 적은 날인지.
 *
 * 토요일에 몇 명만 나오는 일이 매주 있다. 그런 날 출력물에는 "총 9명 중 참석
 * 1명"으로 찍혀, 여덟 명이 안전교육을 빠진 것처럼 보인다. 그래서 작성자들이
 * 특이사항에 "주말 출근자만 출석체크"를 매번 손으로 적어 왔다.
 *
 * 기준을 절반으로 둔다. 한두 명 빠진 날까지 안내를 띄우면 평소 결근과 휴일
 * 부분 가동이 섞이고, 무엇보다 상투어가 특이사항에 끼어들기 시작한다. 그 칸은
 * 아차사고와 위험요인이 실제로 적히는 자리라(진천 43% 채움) 지켜야 한다.
 */
export function isThinAttendance(present: number, rosterSize: number): boolean {
  // 명부가 두세 명이면 "적다"를 말할 수 없다.
  if (rosterSize < 4) return false;
  // 아무도 안 나온 날은 부분 가동이 아니라 다른 문제다.
  if (present === 0) return false;
  return present * 2 <= rosterSize;
}

/**
 * 출석이 적은 날 특이사항에 덧붙이는 한 줄.
 *
 * 문구를 새로 만들지 않고 진천에서 쓰던 말을 그대로 쓴다. 쓰는 사람이 이미
 * 아는 문장이어야 읽는 사람도 같은 뜻으로 받는다.
 */
export const THIN_ATTENDANCE_NOTE = "주말·휴일 출근자만 출석체크";

/**
 * 특이사항에 그 한 줄을 더한다. 이미 있으면 그대로 둔다.
 *
 * 덮어쓰지 않고 뒤에 붙이는 것이 중요하다. 그 칸에 이미 적힌 위험요인을
 * 상투어로 지워 버리면 단추가 기록을 깎는 셈이 된다.
 */
export function withThinAttendanceNote(remarks: string): string {
  const trimmed = remarks.trim();
  if (trimmed.includes(THIN_ATTENDANCE_NOTE)) return remarks;
  return trimmed ? `${trimmed}\n${THIN_ATTENDANCE_NOTE}` : THIN_ATTENDANCE_NOTE;
}
