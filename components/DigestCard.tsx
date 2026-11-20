import Link from "next/link";
import { dateLabel } from "@/lib/kst";
import {
  digestIntro,
  digestTitle,
  lineLabel,
  type DailyDigest,
  type DigestLine,
} from "@/lib/dailyDigest";
import type { NoteKind } from "@/lib/hazardLog";

/**
 * 전일 공유 카드.
 *
 * 접지 않는다. 비상연락망은 평소에 쓸 일이 없어 접어 두는 것이 맞지만, 이것은
 * 오늘 아침 읽어야 할 내용 자체다. 접히면 읽히지 않고, 읽히지 않으면 공유한
 * 것이 아니다. 대신 다섯 줄로 묶어 접을 필요가 없게 둔다.
 *
 * 사고를 붉게 둔다 — 어제 사람이 다쳤다는 말과 소화기 압력이 낮다는 말이
 * 같은 색이면 둘 다 안 보인다.
 */
const KIND_STYLE: Record<NoteKind, string> = {
  ACCIDENT: "bg-rose-100 text-rose-900 ring-rose-300",
  NEAR_MISS: "bg-amber-100 text-amber-900 ring-amber-300",
  HAZARD: "bg-slate-100 text-slate-700 ring-slate-300",
  SHARED: "bg-sky-50 text-sky-800 ring-sky-200",
  ADMIN: "bg-slate-50 text-slate-500 ring-slate-200",
};

export default function DigestCard({
  digest,
  linkToSource = false,
}: {
  digest: DailyDigest;
  /** 원본 문서로 가는 링크를 붙일지. 계정 없는 근로자 화면에서는 끈다. */
  linkToSource?: boolean;
}) {
  const hasAccident = digest.lines.some((l) => l.kind === "ACCIDENT");

  return (
    <section
      className={`card border-l-4 ${
        hasAccident ? "border-l-rose-500 bg-rose-50/30" : "border-l-slate-400"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-bold text-slate-900">{digestTitle(digest)}</h2>
        <p className="text-xs text-slate-500">{dateLabel(digest.date)} 기록</p>
      </div>
      <p className="mt-0.5 text-xs text-slate-600">{digestIntro(digest)}</p>

      <ul className="mt-3 space-y-2">
        {digest.lines.map((line, i) => (
          <Row key={`${line.docId}-${i}`} line={line} linkToSource={linkToSource} />
        ))}
      </ul>

      {digest.omitted > 0 && (
        <p className="mt-2.5 text-xs text-slate-500">
          이 밖에 {digest.omitted}건이 더 올라왔습니다.
          {linkToSource && (
            <Link
              href="/hazards"
              className="ml-1.5 font-semibold text-slate-700 underline underline-offset-2"
            >
              위험요인 모음에서 보기
            </Link>
          )}
        </p>
      )}
    </section>
  );
}

function Row({ line, linkToSource }: { line: DigestLine; linkToSource: boolean }) {
  const href = line.source === "TBM" ? `/tbm/${line.docId}` : `/patrol/${line.docId}`;

  return (
    <li className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            // 당부한 말은 꼬리표도 옅게 둔다. 매일 할 수 있는 말이 어제만의
            // 일과 같은 무게로 보이면 안 된다.
            line.urging && line.kind === "HAZARD"
              ? "bg-slate-50 text-slate-500 ring-slate-200"
              : KIND_STYLE[line.kind]
          }`}
        >
          {lineLabel(line)}
        </span>
        <span className="min-w-0 truncate text-xs text-slate-500">
          {line.where}
          {line.detail && ` · ${line.detail}`}
        </span>
        {linkToSource && (
          <Link
            href={href}
            className="ml-auto shrink-0 text-xs text-slate-600 underline underline-offset-2"
          >
            원본
          </Link>
        )}
      </div>
      {/* 개조식으로 줄인 본문. 원문은 title에 남겨 둔다 — 뜻이 바뀌었는지
          확인하려는 사람은 원본 문서를 열면 된다. */}
      <p className="mt-1 text-sm text-slate-900" title={line.raw}>
        {line.text}
      </p>
    </li>
  );
}
