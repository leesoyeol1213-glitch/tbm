import { cache } from "react";
import { prisma } from "@/lib/db";
import { daysAgo, kstDateOnly, parseYmd, ymd } from "@/lib/kst";
import { normalizeAddress } from "@/lib/siteGroup";
import { buildDigest, type DailyDigest, type DigestInput } from "@/lib/dailyDigest";

/**
 * 전일 공유 요약본을 DB에서 모아 온다.
 *
 * 묶음 기준은 공장(주소)이다. 법인이 아니다 — 진천은 법인 넷이 한 공장에
 * 들어가 있고, 옆 법인에서 난 사고도 물리적으로는 같은 건물 일이다. 지게차는
 * 법인 경계를 보지 않는다. 교육 내용으로서도 "최근 이슈나 사고"에 더 맞다.
 *
 * 순찰일지는 Site가 아니라 Plant에 매여 있다. 두 표의 주소가 같은 글자라서
 * (2026-11-19 실측: 다섯 공장 전부 일치) 같은 열쇠로 묶을 수 있다. 진천은
 * Plant가 1공장·2공장 둘이라 양쪽 순찰 지적이 다 올라온다.
 *
 * 한 요청 안에서는 같은 결과를 다시 묻지 않는다(cache). 일괄 인쇄는 한 번에
 * TBM 수백 건을 도는데, 같은 공장 같은 날 요약본을 건마다 다시 세면 무료
 * 한도 안에서 쿼리가 수백 번 더 나간다. 공장 넷에 날짜 스물두 개면 실제로
 * 서로 다른 요약본은 여든여덟 개뿐이다.
 */

/**
 * 며칠까지 거슬러 볼지.
 *
 * 열흘. 추석·설 연휴가 끼면 엿새가 비고, 그 뒤 첫 작업일 아침에 "공유할 것
 * 없음"이 뜨면 연휴 전에 올라온 사고가 그대로 묻힌다.
 */
const LOOKBACK_DAYS = 10;

export async function loadDailyDigest(
  site: { address: string | null },
  now: Date = new Date(),
): Promise<DailyDigest | null> {
  const key = normalizeAddress(site.address);
  // 주소가 비면 묶지 않는다. 빈 주소끼리 한 덩어리가 되면 엉뚱한 공장 사고가
  // 올라온다.
  if (!key) return null;

  // cache()는 인수를 같은 값인지로 본다. Date는 건마다 새 객체라 안 맞으므로
  // 날짜를 글자로 바꿔 넘긴다.
  return digestFor(key, ymd(kstDateOnly(now)));
}

/** 같은 공장(주소)을 쓰는 사업장·순찰공장 목록. 한 요청에 한 번만 묻는다. */
const factoryIds = cache(async (key: string) => {
  // 주소 정규화는 SQL로 못 하므로 목록을 받아 와 걸러낸다. 사업장 10곳,
  // 공장 5곳이라 값이 싸다.
  const [sites, plants] = await Promise.all([
    prisma.site.findMany({ select: { id: true, address: true } }),
    prisma.plant.findMany({ select: { id: true, address: true } }),
  ]);
  return {
    siteIds: sites.filter((s) => normalizeAddress(s.address) === key).map((s) => s.id),
    plantIds: plants.filter((p) => normalizeAddress(p.address) === key).map((p) => p.id),
  };
});

const digestFor = cache(
  async (key: string, beforeYmd: string): Promise<DailyDigest | null> => {
    const before = parseYmd(beforeYmd);
    const from = daysAgo(LOOKBACK_DAYS, before);

    const { siteIds, plantIds } = await factoryIds(key);
    if (siteIds.length === 0 && plantIds.length === 0) return null;

    const dateWhere = { gte: from, lt: before };

    /*
      결재 상태로 거르지 않는다.

      상신·결재 적체가 이 시스템의 실제 병목이다. 어제 난 사고가 아직 작성중
      이라고 요약본에서 빠지면, 하필 제일 공유해야 할 것이 빠진다. 반려된
      기록도 내용은 내용이라 싣는다.
    */
    const [tbms, checks, rounds] = await Promise.all([
      siteIds.length > 0
        ? prisma.tbm.findMany({
            where: { siteId: { in: siteIds }, workDate: dateWhere, remarks: { not: null } },
            select: {
              id: true,
              workDate: true,
              remarks: true,
              site: { select: { name: true } },
              team: { select: { name: true } },
            },
          })
        : [],
      plantIds.length > 0
        ? prisma.patrolCheck.findMany({
            where: {
              state: { not: "GOOD" },
              patrol: { plantId: { in: plantIds }, patrolDate: dateWhere },
            },
            select: {
              content: true,
              action: true,
              patrol: {
                select: { id: true, patrolDate: true, plant: { select: { name: true } } },
              },
            },
          })
        : [],
      plantIds.length > 0
        ? prisma.patrolRound.findMany({
            where: {
              state: { not: "GOOD" },
              patrol: { plantId: { in: plantIds }, patrolDate: dateWhere },
            },
            select: {
              place: true,
              content: true,
              note: true,
              patrol: {
                select: { id: true, patrolDate: true, plant: { select: { name: true } } },
              },
            },
          })
        : [],
    ]);

    const inputs: DigestInput[] = [];

    for (const t of tbms) {
      inputs.push({
        source: "TBM",
        docId: t.id,
        date: t.workDate,
        where: t.site.name,
        detail: t.team.name,
        remarks: t.remarks,
      });
    }

    /*
      순찰 점검은 조치사항이 본문이다. 점검 항목("크레인 사용 안전작업
      시행여부")은 양식에서 온 말이라 그것만으로는 무엇이 있었는지 알 수 없다.

      조치·비고가 비어 있으면 "불량"이라고만 적고 thin으로 표시해 뒤로 미룬다.
      버리지 않는 이유는 불량 판정 자체가 사실이기 때문이고, 앞에 두지 않는
      이유는 "설비별 안전순회 — 불량"을 읽어도 할 일이 떠오르지 않기 때문이다.
      (2026-11-19 실측: 음성공장의 유일한 지적이 바로 이 모양이었다.)
    */
    for (const c of checks) {
      const action = c.action?.trim();
      inputs.push({
        source: "PATROL",
        docId: c.patrol.id,
        date: c.patrol.patrolDate,
        where: c.patrol.plant.name,
        detail: c.content,
        text: action || `${c.content.trim()} — 불량`,
        thin: !action,
      });
    }
    for (const r of rounds) {
      const note = r.note?.trim();
      inputs.push({
        source: "PATROL",
        docId: r.patrol.id,
        date: r.patrol.patrolDate,
        where: r.patrol.plant.name,
        detail: r.place,
        text: note || `${r.content.trim()} — 불량`,
        thin: !note,
      });
    }

    return buildDigest(inputs, before);
  },
);
