import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedAddress } from "../src/lib/http";

test("blocks private and metadata IPv4 ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("allows ordinary public addresses", () => {
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("1.1.1.1"), false);
  // WordPress VIP (192.0.64.0/18) hosts Veja, Jovem Pan and CNN Brasil.
  assert.equal(isBlockedAddress("192.0.66.138"), false);
});

test("blocks only the reserved /24s inside 192.0.0.0/16", () => {
  assert.equal(isBlockedAddress("192.0.0.1"), true);
  assert.equal(isBlockedAddress("192.0.2.10"), true);
  assert.equal(isBlockedAddress("192.0.3.1"), false);
});

test("blocks local and unique-local IPv6 ranges", () => {
  for (const address of ["::1", "::", "fd00::1", "fe80::1"]) {
    assert.equal(isBlockedAddress(address), true, address);
  }
});

test("isHttpUrl accepts http(s) and refuses other schemes", async () => {
  const { isHttpUrl } = await import("../src/lib/http");
  assert.equal(isHttpUrl("https://www.bbc.com/portuguese/articles/x"), true);
  assert.equal(isHttpUrl("http://example.com/a?b=1"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("data:text/html,<script>1</script>"), false);
  assert.equal(isHttpUrl("//example.com/x"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl(null), false);
});

test("readBodyCapped stops a stream that exceeds the cap", async () => {
  const { readBodyCapped } = await import("../src/lib/http");
  const big = new Response(new Uint8Array(2048));
  await assert.rejects(readBodyCapped(big, 1024), /exceeds 1024 bytes/);
  const small = new Response(new Uint8Array(512));
  assert.equal((await readBodyCapped(small, 1024)).length, 512);
  const declared = new Response(new Uint8Array(10), { headers: { "content-length": "999999" } });
  await assert.rejects(readBodyCapped(declared, 1024), /declared/);
});

test("pinnedLookup answers only from validated addresses and fails closed", async () => {
  const { pinAddresses, pinnedLookup } = await import("../src/lib/http");
  pinAddresses("Example.COM", [{ address: "93.184.216.34", family: 4 }]);
  await new Promise<void>((resolve) => {
    pinnedLookup("example.com", { all: true }, (err, address) => {
      assert.equal(err, null);
      assert.deepEqual(address, [{ address: "93.184.216.34", family: 4 }]);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    pinnedLookup("example.com", (err, address, family) => {
      assert.equal(err, null);
      assert.equal(address, "93.184.216.34");
      assert.equal(family, 4);
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    pinnedLookup("never-validated.invalid", { all: true }, (err) => {
      assert.ok(err && (err as NodeJS.ErrnoException).code === "ENOTFOUND");
      resolve();
    });
  });
});
