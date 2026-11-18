"use client";

import { useId, useSyncExternalStore } from "react";
import { telHref, type EmergencyBoard } from "@/lib/emergency";

/*
  접힘 여부는 브라우저에 저장한다. 서버는 그 값을 알 수 없으므로 서버 그림과
  첫 그림을 "펼침"으로 맞추고(getServerSnapshot), 붙은 뒤에 저장값으로 바꾼다.
  useState + useEffect 로 하면 서버와 첫 그림이 어긋난다.

  같은 탭에서 누른 것은 storage 이벤트가 오지 않으므로 직접 알린다.
*/
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readCollapsed(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    // 사생활 보호 모드 등에서 막힌다. 그 기기에서는 늘 펼쳐 보인다.
    return false;
  }
}

function writeCollapsed(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    // 저장이 막힌 기기에서는 접힌 상태가 남지 않는다. 기능은 그대로 쓴다.
  }
  for (const l of [...listeners]) l();
}

/**
 * 비상연락망 카드.
 *
 * 번호를 눌러 바로 걸 수 있게 tel: 링크로 둔다. 현장에서 꺼내는 것은 거의
 * 휴대전화이고, 급할 때 번호를 옮겨 적게 하면 쓰이지 않는다.
 *
 * 주소를 번호보다 앞에 둔 이유: 119가 제일 먼저 묻는 것이 주소다.
 *
 * 처음 보는 사람에게는 펼쳐 둔다. 접는 것은 본 사람이 고르는 일이지,
 * 처음부터 숨겨 두면 있는 줄도 모르고 지나간다. 한 번 접으면 그 기기에서는
 * 접힌 채로 둔다 — 매일 아침 출석 화면에서 같은 것을 다시 펼쳐 보게 할 이유가
 * 없다.
 */
export default function EmergencyCard({ board }: { board: EmergencyBoard }) {
  const [urgent, ...rest] = board.groups;
  const bodyId = useId();

  /*
    연락망이 개정되면(시행일이 바뀌면) 열쇠가 달라져 다시 펼쳐진다.
    번호가 바뀌었는데 접힌 채로 지나가는 것이 제일 나쁘다.
  */
  const storageKey = `emergency-collapsed:${board.factory}:${board.effectiveFrom}`;

  const collapsed = useSyncExternalStore(
    subscribe,
    () => readCollapsed(storageKey),
    () => false,
  );

  return (
    <section className="card bg-rose-50/40 ring-rose-200">
      <button
        type="button"
        onClick={() => writeCollapsed(storageKey, !collapsed)}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <h2 className="font-bold text-slate-900">비상연락망</h2>
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500">
          {collapsed ? "펼치기" : "접기"}
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className={`size-4 transition-transform ${collapsed ? "" : "rotate-180"}`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </button>

      {!collapsed && (
        <div id={bodyId} className="mt-3">
          <p className="text-xs text-slate-500">
            {board.factory} · 시행 {board.effectiveFrom}
          </p>

          <div className="mt-2 mb-3 rounded-lg bg-white px-3 py-2.5 ring-1 ring-slate-200">
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
        </div>
      )}
    </section>
  );
}
