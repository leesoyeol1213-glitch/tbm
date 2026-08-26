"use client";

import { useEffect } from "react";

/**
 * 머리글의 실제 높이를 --header-h 에 적어 둔다.
 *
 * 목록 화면의 고정 막대가 머리글 바로 아래에 붙어야 하는데, 그 값을 숫자로
 * 박아 두었더니 세 군데에 흩어진 채로 실제 높이와 어긋나 있었다. 로고 한 줄만
 * 넣어도 셋 다 고쳐야 했다.
 *
 * 그래서 머리글이 스스로 알린다. 글꼴 크기나 확대 배율이 바뀌어 높이가
 * 달라져도 따라간다. 처음 그려질 때는 globals.css 의 기본값이 쓰인다.
 */
export default function HeaderHeight() {
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;

    const apply = () => {
      document.documentElement.style.setProperty(
        "--header-h",
        `${Math.round(header.getBoundingClientRect().height)}px`,
      );
    };
    apply();

    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return null;
}
