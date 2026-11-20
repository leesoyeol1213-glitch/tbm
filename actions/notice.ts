"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/authz";
import { dateLabel, kstDateOnly, parseYmd } from "@/lib/kst";
import { deleteStoredImage } from "@/lib/storage";
import { DEFAULT_POST_DAYS, defaultEndsOn, isPosted } from "@/lib/notice";
import type { NoticeKind } from "@/lib/notice";

export type ActionResult = { error: string | null; ok?: boolean; id?: string };

const OK: ActionResult = { error: null, ok: true };

/**
 * 체크인 때 심는 쿠키 이름. actions/checkin.ts와 같은 값이어야 한다.
 *
 * 상수를 거기서 가져오지 않는 이유: checkin.ts는 "use server" 파일이라
 * 상수만 꺼내 올 수 없다. 두 곳에 적히므로 한쪽을 고치면 다른 쪽도 고쳐야
 * 한다 — 이름이 어긋나면 확인 버튼이 조용히 동작을 멈춘다.
 */
const WORKER_COOKIE = "tbm_worker";

const KINDS: NoticeKind[] = ["TIDY", "RESULT", "SCHEDULE"];

function parseKind(raw: string): NoticeKind {
  return (KINDS as string[]).includes(raw) ? (raw as NoticeKind) : "TIDY";
}

/** "YYYY-MM-DD" → Date. 모양이 틀리면 null. */
function parseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = parseYmd(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 체크박스로 고른 법인. 하나도 없으면 전사 공지다. */
function parseSiteIds(formData: FormData): string[] {
  return [...new Set(formData.getAll("siteIds").map((v) => String(v)).filter(Boolean))];
}

type Parsed = {
  kind: NoticeKind;
  title: string;
  body: string | null;
  startsOn: Date;
  endsOn: Date;
  needsAck: boolean;
  legalEduSessionId: string | null;
  siteIds: string[];
};

function parseForm(formData: FormData): Parsed | string {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return "제목을 적어 주세요.";
  if (title.length > 120) return "제목이 너무 깁니다. 120자 안으로 줄여 주세요.";

  const kind = parseKind(String(formData.get("kind") ?? ""));
  const body = String(formData.get("body") ?? "").trim() || null;

  const startsOn = parseDate(String(formData.get("startsOn") ?? ""));
  if (!startsOn) return "게시 시작일을 골라 주세요.";

  const endsRaw = String(formData.get("endsOn") ?? "").trim();
  const endsOn = endsRaw ? parseDate(endsRaw) : defaultEndsOn(startsOn, DEFAULT_POST_DAYS);
  if (!endsOn) return "게시 종료일을 골라 주세요.";
  if (endsOn.getTime() < startsOn.getTime()) {
    return "게시 종료일이 시작일보다 앞섭니다.";
  }

  const sessionId = String(formData.get("legalEduSessionId") ?? "").trim();

  return {
    kind,
    title,
    body,
    startsOn,
    endsOn,
    needsAck: formData.get("needsAck") !== null,
    // 교육 회차는 일정 공지에만 잇는다. 분류를 바꿨을 때 숨은 칸에 남아 있던
    // 값이 그대로 저장되면, 지적 공지에 엉뚱한 교육 일자가 찍힌다.
    legalEduSessionId: kind === "SCHEDULE" && sessionId ? sessionId : null,
    siteIds: parseSiteIds(formData),
  };
}

/**
 * 공지를 올린다.
 *
 * 사진은 여기서 받지 않는다. 글을 먼저 저장해 id를 얻고, 그 id로 사진을
 * 올린다 — 사진을 어디에 붙일지 정해지기 전에 파일을 받으면 주인 없는 파일이
 * 남는다.
 */
export async function createNoticeAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireRole("HQ_ADMIN");

  const parsed = parseForm(formData);
  if (typeof parsed === "string") return { error: parsed };

  const { siteIds, ...fields } = parsed;
  const notice = await prisma.notice.create({
    data: {
      ...fields,
      createdById: user.id,
      sites: { create: siteIds.map((siteId) => ({ siteId })) },
    },
    select: { id: true },
  });

  revalidatePath("/admin/notices");
  revalidatePath("/c", "layout");
  return { ...OK, id: notice.id };
}

/** 올린 공지를 고친다. 사진은 따로 올리고 지운다. */
export async function updateNoticeAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "어느 공지를 고칠지 알 수 없습니다." };

  const parsed = parseForm(formData);
  if (typeof parsed === "string") return { error: parsed };

  const { siteIds, ...fields } = parsed;

  // 대상은 지우고 다시 넣는다. 늘었는지 줄었는지를 따로 셀 이유가 없다.
  await prisma.$transaction([
    prisma.noticeSite.deleteMany({ where: { noticeId: id } }),
    prisma.notice.update({
      where: { id },
      data: { ...fields, sites: { create: siteIds.map((siteId) => ({ siteId })) } },
    }),
  ]);

  revalidatePath("/admin/notices");
  revalidatePath("/c", "layout");
  return OK;
}

/**
 * 공지를 내린다.
 *
 * 행을 지우지 않고 종료일을 어제로 당긴다. 무엇을 언제 공지했는지가 증빙이고,
 * 읽음 기록도 함께 남아야 한다. 이미 지난 공지면 그대로 둔다.
 */
export async function endNoticeAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const id = String(formData.get("id") ?? "");
  const notice = await prisma.notice.findUnique({
    where: { id },
    select: { startsOn: true, endsOn: true },
  });
  if (!notice) return { error: "공지를 찾을 수 없습니다." };

  const today = kstDateOnly();
  if (!isPosted(notice, today)) return { error: "이미 게시 중이 아닙니다." };

  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  // 올린 날 바로 내리면 시작일이 종료일보다 늦어진다. 그때는 시작일에 맞춘다.
  const endsOn =
    yesterday.getTime() < notice.startsOn.getTime() ? notice.startsOn : yesterday;

  await prisma.notice.update({ where: { id }, data: { endsOn } });

  revalidatePath("/admin/notices");
  revalidatePath("/c", "layout");
  return OK;
}

/**
 * 공지를 지운다. 붙은 사진 파일까지 지운다.
 *
 * 파일을 먼저 지우고 행을 지운다. 반대로 하면 행이 없어진 뒤 파일 삭제가
 * 실패했을 때 어느 파일이 남았는지 알 길이 없다.
 */
export async function deleteNoticeAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const id = String(formData.get("id") ?? "");
  const notice = await prisma.notice.findUnique({
    where: { id },
    select: { photos: { select: { url: true } } },
  });
  if (!notice) return { error: "공지를 찾을 수 없습니다." };

  for (const p of notice.photos) await deleteStoredImage(p.url);
  // 대상·사진·읽음은 onDelete: Cascade로 함께 지워진다.
  await prisma.notice.delete({ where: { id } });

  revalidatePath("/admin/notices");
  revalidatePath("/c", "layout");
  return OK;
}

/** 공지에 붙은 사진 한 장을 지운다. */
export async function deleteNoticePhotoAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole("HQ_ADMIN");

  const photoId = String(formData.get("photoId") ?? "");
  const photo = await prisma.noticePhoto.findUnique({
    where: { id: photoId },
    select: { url: true },
  });
  if (!photo) return { error: "사진을 찾을 수 없습니다." };

  await deleteStoredImage(photo.url);
  await prisma.noticePhoto.delete({ where: { id: photoId } });

  revalidatePath("/admin/notices");
  revalidatePath("/c", "layout");
  return OK;
}

export type AckResult = { error: string | null; readAt?: string };

/**
 * 근로자가 공지를 읽었다고 찍는다.
 *
 * 이 액션만 로그인을 요구하지 않는다 — 생산직 근로자는 계정이 없다. 대신
 * 체크인 때 심어 둔 쿠키의 workerId만 믿고, 폼이 보내는 값은 믿지 않는다.
 * 남의 이름으로 읽음을 찍을 수 있으면 "알렸다"는 증빙이 아니다.
 *
 * 이미 찍혀 있으면 시각을 갱신하지 않는다. 처음 읽은 때가 증빙이다.
 */
export async function ackNoticeAction(
  _prev: AckResult,
  formData: FormData,
): Promise<AckResult> {
  const noticeId = String(formData.get("noticeId") ?? "");
  if (!noticeId) return { error: "어느 공지인지 알 수 없습니다." };

  const store = await cookies();
  const workerId = store.get(WORKER_COOKIE)?.value;
  if (!workerId) return { error: "출석 체크를 먼저 해 주세요." };

  // 쿠키가 묵어 사람이 그만둔 경우가 있다. 없는 사람으로 기록을 남기면
  // 외래키에서 터지므로 여기서 먼저 막는다.
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, active: true },
    select: { id: true },
  });
  if (!worker) return { error: "작업자 정보를 찾을 수 없습니다. 출석 체크를 다시 해 주세요." };

  const notice = await prisma.notice.findUnique({
    where: { id: noticeId },
    select: { startsOn: true, endsOn: true },
  });
  if (!notice) return { error: "공지를 찾을 수 없습니다." };
  // 게시가 끝난 공지에 읽음을 새로 찍지 않는다. 묵은 화면을 열어 둔 폰에서
  // 내려간 공지를 읽었다고 남으면 기록이 어긋난다.
  if (!isPosted(notice, kstDateOnly())) return { error: "게시가 끝난 공지입니다." };

  const existing = await prisma.noticeRead.findUnique({
    where: { noticeId_workerId: { noticeId, workerId: worker.id } },
    select: { readAt: true },
  });
  const readAt =
    existing?.readAt ??
    (
      await prisma.noticeRead.create({
        data: { noticeId, workerId: worker.id },
        select: { readAt: true },
      })
    ).readAt;

  revalidatePath("/c", "layout");
  return { error: null, readAt: dateLabel(readAt) };
}
