import { telHref, type EmergencyBoard } from "@/lib/emergency";

/**
 * 비상연락망 카드.
 *
 * 번호를 눌러 바로 걸 수 있게 tel: 링크로 둔다. 현장에서 꺼내는 것은 거의
 * 휴대전화이고, 급할 때 번호를 옮겨 적게 하면 쓰이지 않는다.
 *
 * 주소를 맨 위 큰 글씨로 둔 이유: 119가 제일 먼저 묻는 것이 주소다.
 */
export default function EmergencyCard({ board }: { board: EmergencyBoard }) {
  const [urgent, ...rest] = board.groups;

  return (
    <section className="card bg-rose-50/40 ring-rose-200">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-bold text-slate-900">비상연락망</h2>
        <p className="text-xs text-slate-500">
          {board.factory} · 시행 {board.effectiveFrom}
        </p>
      </div>

      <div className="mb-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
        <p className="text-xs text-slate-500">신고 위치</p>
        <p className="text-sm font-semibold text-slate-900">{board.address}</p>
      </div>

      {/* 119·112는 눌러서 바로 걸 수 있게 크게 둔다. */}
      <div className="mb-3">
        <div className="flex flex-wrap gap-2">
          {urgent.contacts.map((c) => (
            <a
              key={c.phone}
              href={telHref(c.phone)}
              className="flex-1 rounded-lg bg-rose-600 px-3 py-2.5 text-center text-white"
            >
              <span className="block text-lg font-bold tabular-nums">{c.phone}</span>
              <span className="block text-xs opacity-90">{c.role}</span>
            </a>
          ))}
        </div>
        {urgent.note && <p className="mt-1.5 text-xs text-slate-600">{urgent.note}</p>}
      </div>

      {rest.length > 0 && (
        <ul className="space-y-3">
          {rest.map((g) => (
            <li key={g.title}>
              <p className="text-sm font-semibold text-slate-900">{g.title}</p>
              {g.note && <p className="mt-0.5 text-xs text-slate-500">{g.note}</p>}
              <ul className="mt-1.5 space-y-1">
                {g.contacts.map((c, i) => (
                  <li
                    key={`${c.phone}-${i}`}
                    className="flex items-baseline justify-between gap-3 rounded-md bg-white px-2.5 py-1.5 ring-1 ring-slate-200"
                  >
                    <span className="min-w-0 truncate text-sm text-slate-700">
                      <span className="text-slate-500">{c.role}</span>
                      {c.name && <span className="ml-1.5 font-medium">{c.name}</span>}
                    </span>
                    <a
                      href={telHref(c.phone)}
                      className="shrink-0 text-sm font-semibold tabular-nums text-rose-700 underline underline-offset-2"
                    >
                      {c.phone}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {/*
        종이 연락망이 원본이다. 여기 적힌 것이 다르면 종이를 따른다 —
        번호가 바뀐 줄 모르고 화면만 믿게 두면 안 된다.
      */}
      <p className="mt-3 text-xs text-slate-400">
        공장에 게시된 연락망을 옮긴 것입니다. 번호가 바뀌면 안전관리자에게 알려 주세요.
      </p>
    </section>
  );
}
