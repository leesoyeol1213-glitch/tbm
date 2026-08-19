/**
 * 데모 데이터 시드.
 *   npm run db:seed
 *
 * 이미 있는 데이터는 건드리지 않고 upsert 한다. 여러 번 돌려도 안전하다.
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? "tbm1234!";

/** 매일 교육하는 안전보건교육 과정 */
const EDU_ITEMS = [
  "중대재해처벌법 / 산업안전보건법",
  "안전보건관리체계 구축 7대 핵심요소 및 요소별 구축방안",
  "위험성평가 절차 5단계 및 위험성 결정방법(3단계 판단법)",
  "위험성평가 결과 : 위험요인, 위험성 및 감소대책 수립방안",
  "위험성평가 기반 TBM 실시요령 실습 및 근로자 참여(아차사고, 제안, 면담, 설문)",
  "유해위험요인 개선 사례 및 반기 점검 사항",
];

/** 상시 위험요인 - 안전대책 (현장에 맞게 관리 화면에서 수정하면 된다) */
const HAZARDS = [
  {
    hazard: "설비 점검·정비 중 예기치 않은 기동",
    control: "전원 차단 후 잠금·표지(LOTO) 부착, 작업 완료 전까지 해제 금지",
  },
  {
    hazard: "회전체·컨베이어 끼임",
    control: "방호덮개 상태 확인, 가동 중 손 넣기 금지, 헐렁한 옷·장갑 착용 금지",
  },
  {
    hazard: "중량물 취급 시 근골격계 부담 및 낙하",
    control: "2인 1조 운반, 25kg 초과 시 보조기구 사용, 적재 높이 준수",
  },
  {
    hazard: "지게차·운반차량과의 충돌",
    control: "보행자 통로 통행, 운전자와 눈맞춤 후 이동, 후진 시 유도자 배치",
  },
  {
    hazard: "미끄러짐·전도 (바닥 유증기, 물기)",
    control: "작업 전 바닥 상태 확인 및 즉시 제거, 안전화 착용",
  },
];

async function upsertUser(args: {
  email: string;
  name: string;
  role: Role;
  siteId: string | null;
  phone?: string;
}) {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email: args.email },
    update: { name: args.name, role: args.role, siteId: args.siteId },
    create: {
      email: args.email,
      name: args.name,
      role: args.role,
      siteId: args.siteId,
      phone: args.phone,
      passwordHash,
    },
  });
}

async function main() {
  // --- 전사 공통 템플릿 ---------------------------------------------------
  const existingTemplate = await prisma.tbmTemplate.findFirst({
    where: { siteId: null, name: "전사 공통 일일 TBM" },
  });

  const template =
    existingTemplate ??
    (await prisma.tbmTemplate.create({
      data: {
        siteId: null,
        name: "전사 공통 일일 TBM",
        workDescription: "정상 생산 운전 (공정별 표준작업 준수)",
        eduItems: {
          create: EDU_ITEMS.map((content, sort) => ({ content, sort })),
        },
        hazards: {
          create: HAZARDS.map((h, sort) => ({ ...h, sort })),
        },
      },
    }));
  console.log(`템플릿: ${template.name}`);

  // --- 사업장 -------------------------------------------------------------
  const siteSpecs = [
    {
      code: "F01",
      name: "제1공장",
      address: "경기도 화성시 산업단지로 1",
      lat: 37.1996,
      lng: 126.8314,
    },
    {
      code: "F02",
      name: "제2공장",
      address: "충청북도 청주시 흥덕구 산단로 22",
      lat: 36.6424,
      lng: 127.4347,
    },
  ];

  await upsertUser({
    email: "hq@example.com",
    name: "본사 안전보건팀",
    role: Role.HQ_ADMIN,
    siteId: null,
  });

  for (const spec of siteSpecs) {
    const site = await prisma.site.upsert({
      where: { code: spec.code },
      update: { name: spec.name, address: spec.address, lat: spec.lat, lng: spec.lng },
      create: { ...spec, geofenceM: 500, dueMinute: 510 },
    });

    const manager = await upsertUser({
      email: `manager.${spec.code.toLowerCase()}@example.com`,
      name: `${spec.name} 안전관리자`,
      role: Role.SITE_MANAGER,
      siteId: site.id,
    });

    // 체크인 지점 (지문인식기 옆에 QR 부착)
    for (const pointName of ["정문 지문인식기", "생산동 지문인식기"]) {
      const exists = await prisma.checkinPoint.findFirst({
        where: { siteId: site.id, name: pointName },
      });
      if (!exists) {
        await prisma.checkinPoint.create({ data: { siteId: site.id, name: pointName } });
      }
    }

    // 작업팀 + 팀장 + 작업자
    const teamSpecs = [
      { name: "조립1반", workers: ["김성호", "박준영", "이도현", "최민수", "정우진"] },
      { name: "포장반", workers: ["한지훈", "오세영", "임현우"] },
    ];

    for (const [ti, t] of teamSpecs.entries()) {
      const leader = await upsertUser({
        email: `lead.${spec.code.toLowerCase()}.${ti + 1}@example.com`,
        name: `${t.name} 팀장`,
        role: Role.TEAM_LEAD,
        siteId: site.id,
      });

      const team = await prisma.team.upsert({
        where: { siteId_name: { siteId: site.id, name: t.name } },
        update: { leaderId: leader.id },
        create: { siteId: site.id, name: t.name, leaderId: leader.id },
      });

      for (const [wi, name] of t.workers.entries()) {
        const empNo = `${spec.code}-${String(ti + 1)}${String(wi + 1).padStart(2, "0")}`;
        await prisma.worker.upsert({
          where: { siteId_empNo: { siteId: site.id, empNo } },
          update: { name, teamId: team.id },
          create: {
            siteId: site.id,
            teamId: team.id,
            name,
            empNo,
            phone: `010-0000-${String(1000 + wi + ti * 10).slice(-4)}`,
            jobTitle: t.name === "포장반" ? "포장" : "조립",
          },
        });
      }
    }

    console.log(`사업장: ${site.name} (관리자 ${manager.email})`);
  }

  console.log("\n--- 로그인 계정 (비밀번호는 모두 동일) ---");
  console.log(`비밀번호: ${DEFAULT_PASSWORD}`);
  console.log("본사 관리자   hq@example.com");
  console.log("안전관리자    manager.f01@example.com / manager.f02@example.com");
  console.log("작업팀장      lead.f01.1@example.com / lead.f01.2@example.com ...");

  const points = await prisma.checkinPoint.findMany({ include: { site: true } });
  console.log("\n--- 출석 QR 링크 (인쇄해서 지문인식기 옆에 부착) ---");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  for (const p of points) {
    console.log(`${p.site.name} ${p.name}: ${base}/c/${p.token}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
