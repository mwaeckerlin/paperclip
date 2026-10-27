// Settings of the image and the helpers that serve Paperclip below a base path.
//
// serve.mjs, which node loads before Paperclip (--import), checks the settings
// once and installs the request handling; the upstream modules the build
// patches (bin/patch-upstream.mjs) import the helpers for the page and for
// Better Auth. Without PAPERCLIP_BASE_PATH every helper returns what upstream
// has, so Paperclip serves at the root as before.
import { readFileSync } from "node:fs";

// The placeholder the UI build writes in front of every URL of index.html;
// the server replaces it with the base path when it sends the page.
export const BASE_PATH_PLACEHOLDER = "/__PAPERCLIP_BASE_PATH__";

const SEGMENT = /^[A-Za-z0-9._~-]+$/;

export class ConfigurationError extends Error {}

// PAPERCLIP_BASE_PATH: "" for the root, otherwise "/segment[/segment...]"
// without a trailing slash.
export function parseBasePath(value) {
  const raw = (value ?? "").trim();
  if (raw === "" || raw === "/") return "";
  const trimmed = raw.replace(/\/+$/, "");
  const segments = trimmed.split("/");
  const valid =
    segments.length >= 2 &&
    segments[0] === "" &&
    segments.slice(1).every((segment) => SEGMENT.test(segment) && segment !== "." && segment !== "..");
  if (!valid) {
    throw new ConfigurationError(
      `PAPERCLIP_BASE_PATH is ${JSON.stringify(value)}; it must be a path such as /paperclip: ` +
        "a leading slash, then segments of letters, digits, '.', '_', '~' and '-'",
    );
  }
  return trimmed;
}

// With a base path, PAPERCLIP_PUBLIC_URL, when set, ends in exactly that path:
// Paperclip builds the links it hands out and the API address of its agents
// from it.
export function checkPublicUrl(basePath, publicUrl) {
  const value = (publicUrl ?? "").trim();
  if (!basePath || !value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`PAPERCLIP_PUBLIC_URL is ${JSON.stringify(publicUrl)}, which is no URL`);
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== basePath) {
    throw new ConfigurationError(
      `PAPERCLIP_PUBLIC_URL is ${value}, its path ${JSON.stringify(path || "/")} differs from ` +
        `PAPERCLIP_BASE_PATH ${JSON.stringify(basePath)}; set PAPERCLIP_PUBLIC_URL to ${url.origin}${basePath}`,
    );
  }
}

// NAME_FILE names a file whose content becomes NAME, as a Docker secret is
// handed over; NAME_FILE is removed from the environment.
export function secretFromFile(env, name) {
  const fileVariable = `${name}_FILE`;
  if (!(fileVariable in env)) return;
  const file = env[fileVariable];
  delete env[fileVariable];
  if (!file) return;
  if (env[name]) throw new ConfigurationError(`${name} and ${fileVariable} are both set; set one of them`);
  let value;
  try {
    value = readFileSync(file, "utf8").trim();
  } catch (error) {
    throw new ConfigurationError(`${fileVariable} names ${file}, which cannot be read: ${error.code ?? error.message}`);
  }
  if (!value) throw new ConfigurationError(`${fileVariable} names ${file}, which is empty`);
  env[name] = value;
}

// Where a request path lies relative to the base path:
// "inside" with the path below it, "bare" with the address of its slash form,
// "outside" unchanged. Requests outside the base path are served as at the
// root, for the clients inside the container: the health check and the
// agents Paperclip starts.
export function routeRequestUrl(url, basePath) {
  if (!basePath || typeof url !== "string" || url[0] !== "/") return { kind: "outside", url };
  const end = url.search(/[?#]/);
  const path = end < 0 ? url : url.slice(0, end);
  const rest = end < 0 ? "" : url.slice(end);
  if (path === basePath) return { kind: "bare", url: `${basePath}/${rest}` };
  if (path.startsWith(`${basePath}/`)) return { kind: "inside", url: url.slice(basePath.length) };
  return { kind: "outside", url };
}

// Upstream redirects to root-absolute addresses of its own; below the base
// path they get the base path in front. Other addresses stay as they are.
export function prefixLocation(value, basePath) {
  if (!basePath || typeof value !== "string") return value;
  if (value[0] !== "/" || value[1] === "/" || value[1] === "\\") return value;
  return basePath + value;
}

export function currentBasePath(env = process.env) {
  return parseBasePath(env.PAPERCLIP_BASE_PATH);
}

// Better Auth takes a path in its base URL as the path of its own routes,
// which upstream mounts at /api/auth below the base path; it gets the origin.
export function authBaseUrl(url, env = process.env) {
  if (!url || !currentBasePath(env)) return url;
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

// Head of the page below a base path, ahead of every URL of the page: the
// base path for the bundle and the script that puts it in front of the
// root-absolute URLs the bundle requests (paperclip-base-path.js).
export function basePathHead(env = process.env) {
  const basePath = currentBasePath(env);
  if (!basePath) return "";
  return [
    `<script>globalThis.__paperclipBasePath = ${JSON.stringify(basePath)};</script>`,
    `<script src="${basePath}/paperclip-base-path.js"></script>`,
  ].join("\n");
}

// The page as the server sends it: the placeholder of the UI build replaced
// by the base path, which is empty at the root.
export function fillBasePath(html, env = process.env) {
  return html.split(BASE_PATH_PLACEHOLDER).join(currentBasePath(env));
}
