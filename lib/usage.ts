import { prisma } from "@/lib/db";
import { pruneCutoff } from "@/lib/photoRetention";

/**
 * 무료 요금제에서 실제로 얼마나 쓰고 있는지 잰다.
 *
 * 추정하지 않고 잰다. 사진은 저장소에 직접 물어보고, DB는 Postgres가 말하는
 * 크기를 그대로 쓴다. 장당 평균으로 어림하면 큰 사진 몇 장에 어긋나고,
 * 무엇보다 "지웠는데 파일만 남은 것"이 안 잡힌다.
 */

/** Neon 무료: 0.5GB */
export const DB_LIMIT_BYTES = 512 * 1024 * 1024;

/** Vercel Blob 무료: 1GB */
export const BLOB_LIMIT_BYTES = 1024 * 1024 * 1024;

export type Usage = {
  db: { bytes: number; limit: number };
  blob: {
    /** 저장소에 실제로 있는 파일 크기 합계. 못 재면 null. */
    bytes: number | null;
    limit: number;
    files: number;
    /** 아무 기록도 가리키지 않는 파일. 지운 사진이 남긴 것이다. */
    orphanBytes: number;
    orphanFiles: number;
    /** 보관 기간이 지나 정리할 수 있는 사진의 크기. */
    prunableBytes: number;
    prunableFiles: number;
    /** 최근 30일 동안 늘어난 크기. 남은 기간을 가늠하는 데 쓴다. */
    recentBytes: number;
  };
  photos: { live: number; archived: number };
};

/** 사람이 읽는 크기. 작은 값도 0.0MB로 뭉개지지 않게 KB까지 내려간다. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

export function percent(bytes: number, limit: number): number {
  return Math.min(100, Math.round((bytes / limit) * 1000) / 10);
}

/**
 * 이 속도면 며칠 더 쓸 수 있는지. 최근 증가량이 없으면 null.
 *
 * 사진을 정리하지 않고 그대로 쌓았을 때의 값이다. 두 달마다 정리하면
 * 이 숫자는 의미가 없어진다 — 그래서 화면에서도 참고로만 보여 준다.
 */
export function daysLeft(usedBytes: number, limitBytes: number, per30Days: number) {
  if (per30Days <= 0) return null;
  const perDay = per30Days / 30;
  return Math.max(0, Math.floor((limitBytes - usedBytes) / perDay));
}

/**
 * 남은 기간을 읽히는 말로.
 *
 * "33,913일치"는 숫자로는 맞지만 아무 뜻도 전하지 못한다. 몇 년 뒤 이야기는
 * 자릿수까지 셀 이유가 없고, 정작 급할 때 눈에 띄어야 한다.
 */
export function capacityLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days < 60) return `이대로면 약 ${days}일치`;
  if (days < 365 * 3) return `이대로면 약 ${Math.round(days / 30)}개월치`;
  return "몇 년 치 여유";
}

async function readDbBytes(): Promise<number> {
  const rows = await prisma.$queryRaw<{ bytes: bigint }[]>`
    SELECT pg_database_size(current_database())::bigint AS bytes
  `;
  return Number(rows[0]?.bytes ?? 0);
}

type BlobFile = { pathname: string; size: number; uploadedAt: Date };

/** 저장소 파일 목록. 못 읽으면 null — 용량 칸만 비고 나머지는 그대로 뜬다. */
async function readBlobs(token: string): Promise<BlobFile[] | null> {
  try {
    const { list } = await import("@vercel/blob");
    const blobs: BlobFile[] = [];
    let cursor: string | undefined;
    do {
      const res = await list({ cursor, limit: 1000, token });
      blobs.push(...res.blobs);
      cursor = res.cursor;
      // 파일이 아주 많아지면 화면이 느려진다. 그때는 어차피 정리할 때다.
    } while (cursor && blobs.length < 5000);
    return blobs;
  } catch {
    return null;
  }
}

export async function readUsage(): Promise<Usage> {
  const cutoff = pruneCutoff();

  // 저장소 조회가 가장 오래 걸린다. DB를 기다렸다 시작하면 그만큼 더 늦다.
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const blobsPromise = token ? readBlobs(token) : Promise.resolve(null);

  const [dbBytes, rows, archived] = await Promise.all([
    readDbBytes(),
    prisma.tbmPhoto.findMany({
      where: { archivedAt: null },
      select: {
        pathname: true,
        uploadedAt: true,
        tbm: { select: { workDate: true } },
      },
    }),
    prisma.tbmPhoto.count({ where: { archivedAt: { not: null } } }),
  ]);

  // 합동 TBM 사본은 파일을 다시 저장하지 않고 같은 것을 가리킨다.
  // 행 수로 세면 같은 파일을 네 번 세게 된다.
  const live = new Map<string, { uploadedAt: Date; workDate: Date }>();
  for (const r of rows) {
    const prev = live.get(r.pathname);
    if (!prev || r.uploadedAt < prev.uploadedAt) {
      live.set(r.pathname, { uploadedAt: r.uploadedAt, workDate: r.tbm.workDate });
    }
  }

  const blank: Usage["blob"] = {
    bytes: null,
    limit: BLOB_LIMIT_BYTES,
    files: live.size,
    orphanBytes: 0,
    orphanFiles: 0,
    prunableBytes: 0,
    prunableFiles: 0,
    recentBytes: 0,
  };

  const blobs = await blobsPromise;
  const done = { db: { bytes: dbBytes, limit: DB_LIMIT_BYTES }, photos: { live: live.size, archived } };

  // 저장소를 못 읽어도 DB 쪽은 보여 준다. 용량 칸 하나 때문에 대시보드가
  // 통째로 멈추면 안 된다.
  if (!blobs) return { ...done, blob: blank };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let bytes = 0;
  let orphanBytes = 0;
  let orphanFiles = 0;
  let prunableBytes = 0;
  let prunableFiles = 0;
  let recentBytes = 0;

  for (const b of blobs) {
    bytes += b.size;
    const used = live.get(b.pathname);
    if (!used) {
      orphanBytes += b.size;
      orphanFiles += 1;
      continue;
    }
    if (used.workDate < cutoff) {
      prunableBytes += b.size;
      prunableFiles += 1;
    }
    if (b.uploadedAt >= since) recentBytes += b.size;
  }

  return {
    ...done,
    blob: {
      bytes,
      limit: BLOB_LIMIT_BYTES,
      files: blobs.length,
      orphanBytes,
      orphanFiles,
      prunableBytes,
      prunableFiles,
      recentBytes,
    },
  };
}
