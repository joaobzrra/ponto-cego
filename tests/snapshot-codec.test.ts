import assert from "node:assert/strict";
import test from "node:test";
import { compressSnapshot, decompressSnapshot, snapshotFileName } from "@/lib/snapshot-codec";

/**
 * Feeds are Brazilian Portuguese, so the codec has to survive accents, cedillas
 * and em-dashes intact. A latin1/utf8 slip here would silently corrupt the
 * provenance record — the one thing snapshots exist to guarantee.
 */
test("round-trips accented Portuguese byte-for-byte", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel><item>
<title>Ação da oposição não convenceu — avaliação é de que há impasse</title>
<description>Relatório põe pressão sobre o Congresso; críticas à condução.</description>
</item></channel></rss>`;

  const restored = decompressSnapshot(compressSnapshot(xml));

  assert.equal(restored, xml);
});

test("compression actually shrinks a feed-sized document", () => {
  // Repetitive XML is the realistic case; a codec that grew the file would be
  // worse than storing it raw.
  const xml = `<item><title>Nota oficial do governo</title></item>`.repeat(200);

  const compressed = compressSnapshot(xml);

  assert.ok(
    compressed.length < Buffer.byteLength(xml, "utf8") / 2,
    `expected >50% reduction, got ${compressed.length} from ${Buffer.byteLength(xml, "utf8")}`,
  );
});

test("snapshot filenames carry the .gz suffix", () => {
  assert.equal(snapshotFileName("2026-07-26T14-45-29-429Z", "feed_xml"), "2026-07-26T14-45-29-429Z-feed_xml.xml.gz");
});
