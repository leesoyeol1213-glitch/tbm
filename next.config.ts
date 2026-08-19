import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
  // 한글 폰트는 런타임에 파일로 읽는다. 자동 추적으로는 안 잡히므로 직접 포함시킨다.
  outputFileTracingIncludes: {
    "/api/tbm/[id]/pdf": ["./assets/fonts/**", "./node_modules/harfbuzzjs/**"],
  },
  // subset-font는 harfbuzz WASM을 파일 경로로 읽는다.
  // 번들에 넣으면 경로가 바뀌어 못 찾으므로 그대로 두고 쓴다.
  serverExternalPackages: ["subset-font", "harfbuzzjs"],
};

export default nextConfig;
