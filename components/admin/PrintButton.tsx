"use client";

export default function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary">
      QR 인쇄하기
    </button>
  );
}
