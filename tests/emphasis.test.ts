import assert from "node:assert/strict";
import test from "node:test";
import { emphasiseKeywords } from "@/lib/emphasis";

test("bolds the chip phrase, longest match first, keeps the rest plain", () => {
  const segs = emphasiseKeywords(
    "CCJ do Senado analisa fim da escala 6×1 e PEC da Segurança",
    ["senado", "ccj do senado", "escala 6×1"],
  );
  assert.deepEqual(segs, [
    { text: "CCJ do Senado", strong: true },
    { text: " analisa fim da ", strong: false },
    { text: "escala 6×1", strong: true },
    { text: " e PEC da Segurança", strong: false },
  ]);
});

test("is accent- and case-insensitive but returns the original text", () => {
  const segs = emphasiseKeywords("Mendonça diz que recebeu Vorcaro", ["mendonca"]);
  assert.deepEqual(segs, [
    { text: "Mendonça", strong: true },
    { text: " diz que recebeu Vorcaro", strong: false },
  ]);
});

test("matches whole words only and returns one plain segment when nothing matches", () => {
  assert.deepEqual(emphasiseKeywords("Lulao fala de tudo", ["lula"]), [
    { text: "Lulao fala de tudo", strong: false },
  ]);
});
