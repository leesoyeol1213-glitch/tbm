import type { NextConfig } from "next";

/**
 * sharp는 플랫폼별 .node 바이너리와 libvips 공유 라이브러리를 런타임에 찾아 연다.
 * 경로를 계산해서 열기 때문에 자동 추적이 놓치고, 빠지면 배포본에서
 * ERR_DLOPEN_FAILED(libvips-cpp.so ...)로 죽는다. next가 안고 있는 사본까지 넣는다.
 */
const SHARP_FILES = [
  "./node_modules/sharp/**",
  "./node_modules/@img/**",
  "./node_modules/next/node_modules/@img/**",
];

/** 한글 PDF를 그리는 데 필요한 파일. 빠지면 그 라우트가 통째로 500이 난다. */
const PDF_FILES = ["./assets/fonts/**", "./node_modules/harfbuzzjs/**"];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
  // 한글 폰트는 런타임에 파일로 읽는다. 자동 추적으로는 안 잡히므로 직접 포함시킨다.
  // sharp도 마찬가지다. 플랫폼별 .node 바이너리를 경로를 만들어 require하기 때문에
  // 넣어 주지 않으면 배포본에서 모듈이 안 올라온다.
  // 키는 glob으로 해석된다. "[id]"의 대괄호는 문자 클래스로 읽히므로 그 키만으로는
  // 동적 구간이 있는 경로에 안 걸릴 수 있다. 확실히 걸리는 패턴을 함께 둔다.
  outputFileTracingIncludes: {
    "/api/tbm/**": [...PDF_FILES, ...SHARP_FILES],
    "/api/tbm/[id]/pdf": [...PDF_FILES, ...SHARP_FILES],
    // 순찰일지 PDF는 사진을 넣지 않아 sharp가 필요 없다. 폰트만 있으면 된다.
    "/api/patrol/**": PDF_FILES,
    "/api/patrol/[id]/pdf": PDF_FILES,
    // 일괄 인쇄는 TBM(사진 포함)과 순찰일지를 한 파일로 합친다.
    "/api/print": [...PDF_FILES, ...SHARP_FILES],
    "/api/health": SHARP_FILES,
  },
  // subset-font는 harfbuzz WASM을 파일 경로로 읽는다.
  // 번들에 넣으면 경로가 바뀌어 못 찾으므로 그대로 두고 쓴다.
  // sharp는 네이티브 바이너리라 번들 대상이 아니다.
  serverExternalPackages: ["subset-font", "harfbuzzjs", "sharp"],
};

export default nextConfig;
