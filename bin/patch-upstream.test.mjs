// Unit tests of bin/patch-upstream.mjs on the files of the upstream release
// v2026.1023.0 in bin/fixtures (better-auth.ts is the function the patch
// touches), and of the checks of the built result on a built tree in a
// temporary directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { PATCHES, patchText, relativeManifest, verifyBuild } from "./patch-upstream.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const patchOf = (file) => PATCHES.find((patch) => patch.file === file);

test("the router of the interface takes the base path as basename", () => {
  const patched = patchText("ui/src/main.tsx", fixture("main.tsx"), patchOf("ui/src/main.tsx"));
  assert.match(patched, /<BrowserRouter basename=\{\(globalThis as \{ __paperclipBasePath\?: string \}\)\.__paperclipBasePath \|\| "\/"\}>/);
  assert.doesNotMatch(patched, /<BrowserRouter>/);
});

test("the interface build writes the placeholder into the page, a runtime base path into scripts, relative URLs into stylesheets", () => {
  const patched = patchText("ui/vite.config.ts", fixture("vite.config.ts"), patchOf("ui/vite.config.ts"));
  assert.match(patched, /\n {2}experimental: \{\n {4}renderBuiltUrl\(filename, \{ hostType \}\) \{\n/);
  assert.match(patched, /if \(hostType === "js"\) return \{ runtime: `\(globalThis\.__paperclipBasePath \|\| ""\) \+ \$\{JSON\.stringify\("\/" \+ filename\)\}` \};/);
  assert.match(patched, /if \(hostType === "css"\) return \{ relative: true \};/);
  assert.match(patched, /return "\/__PAPERCLIP_BASE_PATH__\/" \+ filename;/);
  assert.equal(patched.split("\n  build: {\n").length - 1, 1);
});

test("the modulepreload link of later releases gets the placeholder", () => {
  // the plugin line of upstream master after v2026.1023.0
  const later = fixture("vite.config.ts").replace(
    "export default",
    'const tag = { tag: "link", attrs: { rel: "modulepreload", href: `/${issueDetail.fileName}`, crossorigin: "" }, injectTo: "head" };\nexport default',
  );
  const patched = patchText("ui/vite.config.ts", later, patchOf("ui/vite.config.ts"));
  assert.match(patched, /href: `\/__PAPERCLIP_BASE_PATH__\/\$\{issueDetail\.fileName\}`/);
});

test("the page of the server gets the base path ahead of its URLs and the placeholder filled in", () => {
  const patched = patchText("server/dist/ui-branding.js", fixture("ui-branding.ts"), patchOf("server/dist/ui-branding.js"));
  assert.equal(patched.split('href="/__PAPERCLIP_BASE_PATH__/favicon').length - 1, 4);
  assert.doesNotMatch(patched, /href="\/favicon/);
  assert.match(patched, /\nfunction upstreamRenderRuntimeBrandingMeta\(branding: WorktreeUiBranding\)/);
  assert.match(patched, /\nfunction upstreamApplyUiBranding\(html: string/);
  assert.match(patched, /import \{ basePathHead as paperclipBasePathHead, fillBasePath as paperclipFillBasePath \} from "\/opt\/paperclip-base-path\/configuration\.mjs";/);
  assert.match(patched, /export function renderRuntimeBrandingMeta\(branding\) \{\n {2}return \[paperclipBasePathHead\(\), upstreamRenderRuntimeBrandingMeta\(branding\)\]\.filter\(Boolean\)\.join\("\\n"\);\n\}/);
  assert.match(patched, /export function applyUiBranding\(html, env = process\.env\) \{\n {2}return paperclipFillBasePath\(upstreamApplyUiBranding\(html, env\), env\);\n\}/);
});

test("Better Auth gets its base URL through authBaseUrl", () => {
  const patched = patchText("server/dist/auth/better-auth.js", fixture("better-auth.ts"), patchOf("server/dist/auth/better-auth.js"));
  assert.match(patched, /baseURL: authBaseUrl\(baseUrl\),/);
  assert.match(patched, /import \{ authBaseUrl \} from "\/opt\/paperclip-base-path\/configuration\.mjs";/);
});

test("code upstream changed stops the build and names file and text", () => {
  assert.throws(() => patchText("ui/src/main.tsx", fixture("main.tsx").replace("<BrowserRouter>", "<BrowserRouter future={{}}>"), patchOf("ui/src/main.tsx")),
    /ui\/src\/main\.tsx carries "<BrowserRouter>" 0 times instead of 1; upstream changed this code/);
  assert.throws(() => patchText("server/dist/ui-branding.js", fixture("ui-branding.ts").replace('href="/favicon.ico"', 'href="/icon.ico"'), patchOf("server/dist/ui-branding.js")),
    /carries "href=\\"\/favicon" 3 times instead of 4/);
  const ui = patchOf("server/dist/ui-branding.js");
  assert.throws(() => patchText("server/dist/ui-branding.js", patchText("server/dist/ui-branding.js", fixture("ui-branding.ts"), ui), ui), /is patched already/);
});

test("the manifest addresses its icons and its start page relative to itself", () => {
  const manifest = JSON.parse(relativeManifest(fixture("site.webmanifest")));
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.src), ["./android-chrome-192x192.png", "./android-chrome-512x512.png", "./android-chrome-512x512.png"]);
  assert.equal(manifest.name, "Paperclip");
});

function builtTree(t, change = () => {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-build-"));
  t.after(() => fs.rmSync(app, { recursive: true }));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), text);
  };
  write("ui/dist/index.html", [
    "<head>",
    "<!-- PAPERCLIP_RUNTIME_BRANDING_START --><!-- PAPERCLIP_RUNTIME_BRANDING_END -->",
    '<!-- PAPERCLIP_FAVICON_START --><link rel="icon" href="/__PAPERCLIP_BASE_PATH__/favicon.ico" /><!-- PAPERCLIP_FAVICON_END -->',
    '<link rel="manifest" href="/__PAPERCLIP_BASE_PATH__/site.webmanifest" crossorigin="use-credentials" />',
    '<script type="module" crossorigin src="/__PAPERCLIP_BASE_PATH__/assets/index-abc.js"></script>',
    "</head>",
  ].join("\n"));
  write("ui/dist/assets/index-abc.js", 'const u=(globalThis.__paperclipBasePath||"")+"/assets/logo-abc.svg";');
  write("ui/dist/assets/index-abc.css", '@font-face{src:url(../fonts/InterVariable.woff2)}');
  write("ui/dist/site.webmanifest", relativeManifest(fixture("site.webmanifest")));
  write("ui/dist/paperclip-base-path.js", "");
  write("server/dist/ui-branding.js", "// mwaeckerlin/paperclip: patched");
  write("server/dist/auth/better-auth.js", "// mwaeckerlin/paperclip: patched");
  change(write, app);
  return app;
}

// verifyBuild also checks /opt/paperclip-base-path/configuration.mjs, which
// exists in the image only
const inTree = (findings) => findings.filter((finding) => !finding.startsWith("/opt/paperclip-base-path/"));

test("a build below the base path passes the checks", (t) => {
  assert.deepEqual(inTree(verifyBuild(builtTree(t))), []);
});

test("every URL outside the base path in the built result is a finding that names its file", (t) => {
  const app = builtTree(t, (write) => {
    write("ui/dist/index.html", '<head><link rel="modulepreload" href="/assets/IssueDetail-abc.js"><script type="module" src="/__PAPERCLIP_BASE_PATH__/assets/index-abc.js"></script></head>');
    write("ui/dist/assets/index-abc.css", '@font-face{src:url("/fonts/InterVariable.woff2")}');
    write("ui/dist/assets/chunk-abc.js", 'fetch("/__PAPERCLIP_BASE_PATH__/x")');
    write("ui/dist/site.webmanifest", fixture("site.webmanifest"));
    write("server/ui-dist/index.html", "");
    write("server/dist/auth/better-auth.js", "");
  });
  const findings = inTree(verifyBuild(app)).join("\n");
  assert.match(findings, /server\/ui-dist\/index\.html exists and would be served instead of ui\/dist/);
  assert.match(findings, /ui\/dist\/index\.html names root-absolute URLs: href="\/assets\/IssueDetail-abc\.js"/);
  assert.match(findings, /ui\/dist\/index\.html lacks <!-- PAPERCLIP_RUNTIME_BRANDING_START -->/);
  assert.match(findings, /ui\/dist\/assets\/index-abc\.css names root-absolute URLs: url\("\/fonts\/InterVariable\.woff2/);
  assert.match(findings, /a script in ui\/dist\/assets carries \/__PAPERCLIP_BASE_PATH__/);
  assert.match(findings, /ui\/dist\/site\.webmanifest names root-absolute URLs: \/, \/, \/, \/android-chrome-192x192\.png/);
  assert.match(findings, /server\/dist\/auth\/better-auth\.js is not patched/);
});
