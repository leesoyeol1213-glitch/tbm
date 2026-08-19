declare module "subset-font" {
  /**
   * harfbuzz(WASM)로 폰트에서 필요한 글자만 남긴다.
   * pdf-lib의 subset 옵션과 달리 cmap을 유지해 한글이 깨지지 않는다.
   */
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: {
      targetFormat?: "sfnt" | "woff" | "woff2" | "truetype";
      preserveNameIds?: number[];
      variationAxes?: Record<string, number | { min?: number; max?: number }>;
    },
  ): Promise<Buffer>;
}
