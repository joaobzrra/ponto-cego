import assert from "node:assert/strict";
import test from "node:test";
// topics.ts transitively imports the DB module, which throws without a URL.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:1/test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pickRotatingCategory, rotatingCategoryOrder } = require("@/lib/topics") as typeof import("@/lib/topics");

test("rotation picks the thin category with the strongest cluster, ties by articles", () => {
  assert.equal(
    pickRotatingCategory([
      { category: "Saúde", topOutlets: 3, topArts: 5, clusters: 4 },
      { category: "Cultura", topOutlets: 3, topArts: 9, clusters: 2 },
      { category: "Educação", topOutlets: 2, topArts: 20, clusters: 6 },
    ]),
    "Cultura",
  );
});

test("rotation ignores categories that are not in the rotating list and empties", () => {
  assert.equal(
    pickRotatingCategory([
      { category: "Política Nacional", topOutlets: 30, topArts: 90, clusters: 40 },
      { category: "Economia", topOutlets: 12, topArts: 40, clusters: 20 },
      { category: "Meio Ambiente", topOutlets: 0, topArts: 0, clusters: 0 },
    ]),
    null,
  );
});

test("the rotation order is the full fallback list, best first", () => {
  assert.deepEqual(
    rotatingCategoryOrder([
      { category: "Saúde", topOutlets: 3, topArts: 5, clusters: 4 },
      { category: "Política Nacional", topOutlets: 30, topArts: 90, clusters: 40 },
      { category: "Cultura", topOutlets: 3, topArts: 9, clusters: 2 },
      { category: "Educação", topOutlets: 2, topArts: 20, clusters: 6 },
      { category: "Meio Ambiente", topOutlets: 0, topArts: 0, clusters: 0 },
    ]),
    ["Cultura", "Saúde", "Educação"],
  );
});

test("pickRotatingCategory is the head of that order", () => {
  const stats = [
    { category: "Educação", topOutlets: 2, topArts: 20, clusters: 6 },
    { category: "Saúde", topOutlets: 3, topArts: 5, clusters: 4 },
  ];
  assert.equal(pickRotatingCategory(stats), rotatingCategoryOrder(stats)[0]);
});
