import assert from "node:assert/strict";
import test from "node:test";
import { captionText } from "@/components/home/caption-arrow";

test("caption counts outlets and names the window", () => {
  assert.equal(captionText(12), "(12 veículos · hoje)");
  assert.equal(captionText(1, 24), "(1 veículo · hoje)");
  assert.equal(captionText(7, 48), "(7 veículos · 48h)");
});
