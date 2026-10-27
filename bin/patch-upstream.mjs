#!/usr/bin/env node
// Patches the Paperclip release of the upstream image so that it serves below
// PAPERCLIP_BASE_PATH (app/configuration.mjs), and verifies the result.
//
// Upstream has no setting for a base path: its interface builds every URL
// root-absolute, its router has no basename, and Better Auth takes a path in
// the public URL as its own route prefix. The patches give the interface
// build a placeholder the server fills in when it sends the page, give the
// router the base path as basename, and give Better Auth the origin. Every
// patch names the exact text it replaces and how often upstream carries it;
// when upstream changes that text, the build stops and names file and text.
//
//   patch-upstream.mjs patch  <app directory>   before the interface build
//   patch-upstream.mjs verify <app directory>   after it, and in the image test
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CONFIGURATION = "/opt/paperclip-base-path/configuration.mjs";
const PLACEHOLDER = "/__PAPERCLIP_BASE_PATH__";
const MARK = "// mwaeckerlin/paperclip:";

export class PatchError extends Error {}

const RENDER_BUILT_URL = `  ${MARK} every built URL below the base path the server fills in
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === "js") return { runtime: \`(globalThis.__paperclipBasePath || "") + \${JSON.stringify("/" + filename)}\` };
      if (hostType === "css") return { relative: true };
      return "${PLACEHOLDER}/" + filename;
    },
  },
`;

const UI_BRANDING_APPEND = `
${MARK} the base path ahead of every URL of the page
import { basePathHead as paperclipBasePathHead, fillBasePath as paperclipFillBasePath } from "${CONFIGURATION}";
export function renderRuntimeBrandingMeta(branding) {
  return [paperclipBasePathHead(), upstreamRenderRuntimeBrandingMeta(branding)].filter(Boolean).join("\\n");
}
export function applyUiBranding(html, env = process.env) {
  return paperclipFillBasePath(upstreamApplyUiBranding(html, env), env);
}
`;

const BETTER_AUTH_APPEND = `
${MARK} Better Auth routes at /api/auth below the base path
import { authBaseUrl } from "${CONFIGURATION}";
`;

// file, text upstream carries, its replacement, the counts allowed, and code
// appended to the file once the replacements are made
export const PATCHES = [
  {
    file: "ui/src/main.tsx",
    replacements: [
      [
        "<BrowserRouter>",
        '<BrowserRouter basename={(globalThis as { __paperclipBasePath?: string }).__paperclipBasePath || "/"}>',
        [1],
      ],
    ],
  },
  {
    file: "ui/vite.config.ts",
    replacements: [
      ["\n  build: {\n", `\n${RENDER_BUILT_URL}  build: {\n`, [1]],
      // the modulepreload link the release after 2026.1023 adds to index.html
      ["href: `/${issueDetail.fileName}`", `href: \`${PLACEHOLDER}/\${issueDetail.fileName}\``, [0, 1]],
    ],
  },
  {
    file: "server/dist/ui-branding.js",
    replacements: [
      ['href="/favicon', `href="${PLACEHOLDER}/favicon`, [4]],
      ["export function renderRuntimeBrandingMeta(", "function upstreamRenderRuntimeBrandingMeta(", [1]],
      ["export function applyUiBranding(", "function upstreamApplyUiBranding(", [1]],
    ],
    append: UI_BRANDING_APPEND,
  },
  {
    file: "server/dist/auth/better-auth.js",
    replacements: [["baseURL: baseUrl,", "baseURL: authBaseUrl(baseUrl),", [1]]],
    append: BETTER_AUTH_APPEND,
  },
];

const MANIFEST = "ui/public/site.webmanifest";

function count(text, original) {
  return text.split(original).length - 1;
}

export function patchText(file, text, patch) {
  if (text.includes(MARK)) throw new PatchError(`${file} is patched already`);
  for (const [original, replacement, allowed] of patch.replacements) {
    const found = count(text, original);
    if (!allowed.includes(found)) {
      throw new PatchError(
        `${file} carries ${JSON.stringify(original.trim())} ${found} times instead of ${allowed.join(" or ")}; ` +
          "upstream changed this code, check whether the patch still applies",
      );
    }
    text = text.split(original).join(replacement);
  }
  return patch.append ? text + patch.append : text;
}

// The manifest addresses its icons and its start page relative to itself, so
// they lie below the base path wherever the manifest is served.
export function relativeManifest(text) {
  const manifest = JSON.parse(text);
  const relative = (value) => (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? `.${value}` : value);
  for (const key of ["id", "start_url", "scope"]) {
    if (key in manifest) manifest[key] = relative(manifest[key]);
  }
  for (const icon of manifest.icons ?? []) icon.src = relative(icon.src);
  for (const shortcut of manifest.shortcuts ?? []) shortcut.url = relative(shortcut.url);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function rootAbsolute(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[0]).filter((url) => !url.includes(PLACEHOLDER));
}

// The checks of the built result; every finding names its file.
export function verifyBuild(app) {
  const findings = [];
  const read = (file) => fs.readFileSync(path.join(app, file), "utf8");
  const exists = (file) => fs.existsSync(path.join(app, file));
  const dist = "ui/dist";

  // upstream serves server/ui-dist before ui/dist; this build replaces ui/dist
  if (exists("server/ui-dist/index.html")) findings.push("server/ui-dist/index.html exists and would be served instead of ui/dist");
  if (!exists(`${dist}/index.html`)) return [...findings, `${dist}/index.html is missing`];

  const html = read(`${dist}/index.html`);
  if (!html.includes(`${PLACEHOLDER}/assets/`)) findings.push(`${dist}/index.html loads no asset through ${PLACEHOLDER}`);
  const htmlOutside = rootAbsolute(html, /\b(?:src|href)="\/(?!\/)[^"]*"/g);
  if (htmlOutside.length) findings.push(`${dist}/index.html names root-absolute URLs: ${htmlOutside.join(", ")}`);
  for (const marker of ["<!-- PAPERCLIP_RUNTIME_BRANDING_START -->", "<!-- PAPERCLIP_FAVICON_START -->"]) {
    if (!html.includes(marker)) findings.push(`${dist}/index.html lacks ${marker}, where the server writes the head`);
  }

  const assets = fs.readdirSync(path.join(app, dist, "assets"));
  for (const name of assets.filter((entry) => entry.endsWith(".css"))) {
    const outside = rootAbsolute(read(`${dist}/assets/${name}`), /url\(\s*["']?\/(?!\/)[^)"']*/g);
    if (outside.length) findings.push(`${dist}/assets/${name} names root-absolute URLs: ${outside.join(", ")}`);
  }
  const scripts = assets.filter((entry) => entry.endsWith(".js"));
  if (scripts.some((name) => read(`${dist}/assets/${name}`).includes(PLACEHOLDER))) {
    findings.push(`a script in ${dist}/assets carries ${PLACEHOLDER}, which the server never fills in`);
  }
  if (!scripts.some((name) => read(`${dist}/assets/${name}`).includes("__paperclipBasePath"))) {
    findings.push(`no script in ${dist}/assets reads __paperclipBasePath: the router and the asset URLs have no base path`);
  }

  const manifest = JSON.parse(read(`${dist}/site.webmanifest`));
  const manifestUrls = [manifest.id, manifest.start_url, manifest.scope, ...(manifest.icons ?? []).map((icon) => icon.src)];
  const manifestOutside = manifestUrls.filter((url) => typeof url === "string" && url.startsWith("/"));
  if (manifestOutside.length) findings.push(`${dist}/site.webmanifest names root-absolute URLs: ${manifestOutside.join(", ")}`);
  if (!exists(`${dist}/paperclip-base-path.js`)) findings.push(`${dist}/paperclip-base-path.js is missing`);

  for (const patch of PATCHES.filter((entry) => entry.file.startsWith("server/"))) {
    if (!read(patch.file).includes(MARK)) findings.push(`${patch.file} is not patched`);
  }
  if (!fs.existsSync(CONFIGURATION)) findings.push(`${CONFIGURATION} is missing`);
  return findings;
}

export function patchApp(app) {
  for (const patch of PATCHES) {
    const file = path.join(app, patch.file);
    fs.writeFileSync(file, patchText(patch.file, fs.readFileSync(file, "utf8"), patch));
  }
  const manifest = path.join(app, MANIFEST);
  fs.writeFileSync(manifest, relativeManifest(fs.readFileSync(manifest, "utf8")));
}

function main() {
  const [command, app] = process.argv.slice(2);
  try {
    if (command === "patch" && app) {
      patchApp(app);
      console.log(`patch-upstream: ${PATCHES.length} files and ${MANIFEST} patched`);
    } else if (command === "verify" && app) {
      const findings = verifyBuild(app);
      if (findings.length) throw new PatchError(findings.join("\n"));
      console.log("patch-upstream: the build serves below a base path");
    } else {
      throw new PatchError("usage: patch-upstream.mjs patch|verify <app directory>");
    }
  } catch (error) {
    if (!(error instanceof PatchError) && error.code !== "ENOENT") throw error;
    console.error(`patch-upstream: ${error.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
