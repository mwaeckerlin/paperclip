// Unit tests of app/configuration.mjs: the settings and the helpers the server
// and the patched upstream modules use.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  authBaseUrl,
  basePathHead,
  checkPublicUrl,
  fillBasePath,
  parseBasePath,
  prefixLocation,
  routeRequestUrl,
  secretFromFile,
} from "./configuration.mjs";

test("the base path is a path, unset or / is the root", () => {
  assert.equal(parseBasePath(undefined), "");
  assert.equal(parseBasePath(""), "");
  assert.equal(parseBasePath("/"), "");
  assert.equal(parseBasePath("/paperclip"), "/paperclip");
  assert.equal(parseBasePath("/paperclip/"), "/paperclip");
  assert.equal(parseBasePath(" /tools/paper-clip_1.x~ "), "/tools/paper-clip_1.x~");
});

test("a base path that is no path stops the start and names the variable", () => {
  for (const value of ["paperclip", "/a b", "//evil.example", "/x/../y", "/x/./y", "/a<script>", "https://host/paperclip", "/%2e%2e"]) {
    assert.throws(() => parseBasePath(value), /PAPERCLIP_BASE_PATH is .* it must be a path such as \/paperclip/, value);
  }
});

test("the public URL ends in the base path", () => {
  checkPublicUrl("/paperclip", "https://swarm-01/paperclip");
  checkPublicUrl("/paperclip", "https://swarm-01/paperclip/");
  checkPublicUrl("/paperclip", "");
  checkPublicUrl("/paperclip", undefined);
  checkPublicUrl("", "https://swarm-01/anything");
  assert.throws(() => checkPublicUrl("/paperclip", "https://swarm-01"),
    /PAPERCLIP_PUBLIC_URL is https:\/\/swarm-01, its path "\/" differs from PAPERCLIP_BASE_PATH "\/paperclip"; set PAPERCLIP_PUBLIC_URL to https:\/\/swarm-01\/paperclip/);
  assert.throws(() => checkPublicUrl("/paperclip", "https://swarm-01/other"), /its path "\/other" differs/);
  assert.throws(() => checkPublicUrl("/paperclip", "swarm-01/paperclip"), /PAPERCLIP_PUBLIC_URL is "swarm-01\/paperclip", which is no URL/);
});

test("the secret comes from its file and leaves the file variable out of the environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-secret-"));
  const file = path.join(directory, "secret");
  fs.writeFileSync(file, "a-secret-of-the-unit-test\n");
  const env = { BETTER_AUTH_SECRET_FILE: file };
  secretFromFile(env, "BETTER_AUTH_SECRET");
  assert.deepEqual(env, { BETTER_AUTH_SECRET: "a-secret-of-the-unit-test" });

  const empty = path.join(directory, "empty");
  fs.writeFileSync(empty, "\n");
  assert.throws(() => secretFromFile({ BETTER_AUTH_SECRET_FILE: empty }, "BETTER_AUTH_SECRET"), /BETTER_AUTH_SECRET_FILE names .*empty, which is empty/);
  assert.throws(() => secretFromFile({ BETTER_AUTH_SECRET_FILE: path.join(directory, "missing") }, "BETTER_AUTH_SECRET"),
    /BETTER_AUTH_SECRET_FILE names .*missing, which cannot be read: ENOENT/);
  assert.throws(() => secretFromFile({ BETTER_AUTH_SECRET: "x", BETTER_AUTH_SECRET_FILE: file }, "BETTER_AUTH_SECRET"),
    /BETTER_AUTH_SECRET and BETTER_AUTH_SECRET_FILE are both set; set one of them/);

  const direct = { BETTER_AUTH_SECRET: "direct" };
  secretFromFile(direct, "BETTER_AUTH_SECRET");
  assert.deepEqual(direct, { BETTER_AUTH_SECRET: "direct" });
  const unset = { BETTER_AUTH_SECRET_FILE: "" };
  secretFromFile(unset, "BETTER_AUTH_SECRET");
  assert.deepEqual(unset, {});
  fs.rmSync(directory, { recursive: true });
});

test("a request below the base path loses the base path, the bare base path goes to its slash form", () => {
  assert.deepEqual(routeRequestUrl("/paperclip/api/health?x=1", "/paperclip"), { kind: "inside", url: "/api/health?x=1" });
  assert.deepEqual(routeRequestUrl("/paperclip/", "/paperclip"), { kind: "inside", url: "/" });
  assert.deepEqual(routeRequestUrl("/paperclip", "/paperclip"), { kind: "bare", url: "/paperclip/" });
  assert.deepEqual(routeRequestUrl("/paperclip?next=%2F", "/paperclip"), { kind: "bare", url: "/paperclip/?next=%2F" });
  assert.deepEqual(routeRequestUrl("/paperclipx/api", "/paperclip"), { kind: "outside", url: "/paperclipx/api" });
  assert.deepEqual(routeRequestUrl("/api/health", "/paperclip"), { kind: "outside", url: "/api/health" });
  assert.deepEqual(routeRequestUrl("/paperclip/api", ""), { kind: "outside", url: "/paperclip/api" });
  assert.deepEqual(routeRequestUrl("http://host/paperclip/api", "/paperclip"), { kind: "outside", url: "http://host/paperclip/api" });
});

test("a root-absolute redirect gets the base path, any other stays", () => {
  assert.equal(prefixLocation("/auth?next=%2F", "/paperclip"), "/paperclip/auth?next=%2F");
  assert.equal(prefixLocation("/", "/paperclip"), "/paperclip/");
  assert.equal(prefixLocation("https://github.com/login", "/paperclip"), "https://github.com/login");
  assert.equal(prefixLocation("//cdn.example.org/x", "/paperclip"), "//cdn.example.org/x");
  assert.equal(prefixLocation("/\\evil.example", "/paperclip"), "/\\evil.example");
  assert.equal(prefixLocation("relative", "/paperclip"), "relative");
  assert.equal(prefixLocation("/auth", ""), "/auth");
});

test("Better Auth gets the origin below a base path, upstream's URL at the root", () => {
  assert.equal(authBaseUrl("https://swarm-01/paperclip", { PAPERCLIP_BASE_PATH: "/paperclip" }), "https://swarm-01");
  assert.equal(authBaseUrl("http://proxy:8080/paperclip", { PAPERCLIP_BASE_PATH: "/paperclip" }), "http://proxy:8080");
  assert.equal(authBaseUrl("https://swarm-01/paperclip", {}), "https://swarm-01/paperclip");
  assert.equal(authBaseUrl(undefined, { PAPERCLIP_BASE_PATH: "/paperclip" }), undefined);
});

test("the page names the base path ahead of the bundle, and nothing at the root", () => {
  assert.equal(basePathHead({}), "");
  assert.equal(basePathHead({ PAPERCLIP_BASE_PATH: "/paperclip" }),
    '<script>globalThis.__paperclipBasePath = "/paperclip";</script>\n<script src="/paperclip/paperclip-base-path.js"></script>');
});

test("the placeholder of the build becomes the base path, and nothing at the root", () => {
  const html = '<script type="module" src="/__PAPERCLIP_BASE_PATH__/assets/index.js"></script><link href="/__PAPERCLIP_BASE_PATH__/favicon.ico">';
  assert.equal(fillBasePath(html, { PAPERCLIP_BASE_PATH: "/paperclip" }),
    '<script type="module" src="/paperclip/assets/index.js"></script><link href="/paperclip/favicon.ico">');
  assert.equal(fillBasePath(html, {}), '<script type="module" src="/assets/index.js"></script><link href="/favicon.ico">');
});
