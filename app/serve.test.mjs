// Tests of app/serve.mjs on a real HTTP server of node, loaded the way the
// image loads it (node --import): requests and websocket upgrades below the
// base path, the bare base path, redirects, the root, and the start checks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SERVE = fileURLToPath(new URL("./serve.mjs", import.meta.url));

// The server answers with the path it sees; /redirect answers like a static
// directory, /redirect-head like a redirect written with writeHead, and an
// upgrade answers with the path it sees.
const SERVER = `
import http from "node:http";
const server = http.createServer((request, response) => {
  if (request.url === "/redirect") { response.statusCode = 301; response.setHeader("Location", "/fonts/"); response.end(); return; }
  if (request.url === "/redirect-head") { response.writeHead(302, { Location: "/auth?next=%2F" }); response.end(); return; }
  if (request.url === "/redirect-away") { response.writeHead(302, "Found", ["Location", "https://github.com/login"]); response.end(); return; }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ url: request.url, secret: process.env.BETTER_AUTH_SECRET ?? null, file: process.env.BETTER_AUTH_SECRET_FILE ?? null }));
});
server.on("upgrade", (request, socket) => socket.end("HTTP/1.1 403 Forbidden\\r\\nX-Path: " + request.url + "\\r\\nContent-Length: 0\\r\\n\\r\\n"));
server.listen(0, "127.0.0.1", () => console.log("port " + server.address().port));
`;

function start(env) {
  const child = spawn(process.execPath, ["--import", SERVE, "--input-type=module", "-e", SERVER], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no server within 10s: ${output}`)), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/port (\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`exit ${code}: ${output}`));
    });
  });
  return { child, ready, output: () => output };
}

function exited(env) {
  const child = spawn(process.execPath, ["--import", SERVE, "--input-type=module", "-e", SERVER], {
    env: { PATH: process.env.PATH, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), 10000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

function upgrade(port, requestPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n` +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
    });
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
  });
}

test("below the base path the server sees the path of its own routes", async (t) => {
  const server = start({ PAPERCLIP_BASE_PATH: "/paperclip" });
  t.after(() => server.child.kill());
  const port = await server.ready;
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(`${base}/paperclip/api/health?x=1`)).json()).url, "/api/health?x=1");
  assert.equal((await (await fetch(`${base}/paperclip/`)).json()).url, "/");
  // the root stays served, for the health check and the agents in the container
  assert.equal((await (await fetch(`${base}/api/health`)).json()).url, "/api/health");
  assert.equal((await (await fetch(`${base}/paperclipx`)).json()).url, "/paperclipx");
  assert.match(server.output(), /paperclip: serving below \/paperclip\//);
});

test("the bare base path redirects to its slash form, with the query", async (t) => {
  const server = start({ PAPERCLIP_BASE_PATH: "/paperclip" });
  t.after(() => server.child.kill());
  const port = await server.ready;
  for (const [request, location] of [["/paperclip", "/paperclip/"], ["/paperclip?next=%2Fauth", "/paperclip/?next=%2Fauth"]]) {
    const response = await fetch(`http://127.0.0.1:${port}${request}`, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), location);
  }
  const post = await fetch(`http://127.0.0.1:${port}/paperclip`, { method: "POST", body: "x", redirect: "manual" });
  assert.equal(post.status, 308);
});

test("a root-absolute redirect below the base path keeps the base path, a foreign one stays", async (t) => {
  const server = start({ PAPERCLIP_BASE_PATH: "/paperclip" });
  t.after(() => server.child.kill());
  const port = await server.ready;
  const location = async (request) => (await fetch(`http://127.0.0.1:${port}${request}`, { redirect: "manual" })).headers.get("location");
  assert.equal(await location("/paperclip/redirect"), "/paperclip/fonts/");
  assert.equal(await location("/paperclip/redirect-head"), "/paperclip/auth?next=%2F");
  assert.equal(await location("/paperclip/redirect-away"), "https://github.com/login");
  // a request at the root gets upstream's redirect unchanged
  assert.equal(await location("/redirect"), "/fonts/");
});

test("a websocket upgrade below the base path reaches the server with the path of its routes", async (t) => {
  const server = start({ PAPERCLIP_BASE_PATH: "/paperclip" });
  t.after(() => server.child.kill());
  const port = await server.ready;
  assert.match(await upgrade(port, "/paperclip/api/companies/x/events/ws?token=1"), /^HTTP\/1\.1 403 Forbidden\r\nX-Path: \/api\/companies\/x\/events\/ws\?token=1\r\n/);
  assert.match(await upgrade(port, "/api/companies/x/events/ws"), /X-Path: \/api\/companies\/x\/events\/ws\r\n/);
  assert.match(await upgrade(port, "/paperclip"), /^HTTP\/1\.1 404 Not Found\r\n/);
});

test("without a base path every request reaches the server as it is", async (t) => {
  const server = start({});
  t.after(() => server.child.kill());
  const port = await server.ready;
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/paperclip/api`)).json()).url, "/paperclip/api");
  assert.equal((await fetch(`http://127.0.0.1:${port}/redirect`, { redirect: "manual" })).headers.get("location"), "/fonts/");
  assert.doesNotMatch(server.output(), /serving below/);
});

test("the Better Auth secret comes from its file, and the file variable is gone", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-serve-"));
  t.after(() => fs.rmSync(directory, { recursive: true }));
  const file = path.join(directory, "better_auth_secret");
  fs.writeFileSync(file, "secret-of-the-unit-test\n");
  const server = start({ BETTER_AUTH_SECRET_FILE: file });
  t.after(() => server.child.kill());
  const port = await server.ready;
  assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/x`)).json(), { url: "/x", secret: "secret-of-the-unit-test", file: null });
});

test("a wrong setting stops the start with a message that names it", async () => {
  for (const [env, message] of [
    [{ PAPERCLIP_BASE_PATH: "paperclip" }, /paperclip: configuration error: PAPERCLIP_BASE_PATH is "paperclip"/],
    [{ PAPERCLIP_BASE_PATH: "/paperclip", PAPERCLIP_PUBLIC_URL: "https://swarm-01/other" }, /PAPERCLIP_PUBLIC_URL is https:\/\/swarm-01\/other, its path "\/other" differs/],
    [{ BETTER_AUTH_SECRET_FILE: "/nonexistent/better_auth_secret" }, /BETTER_AUTH_SECRET_FILE names \/nonexistent\/better_auth_secret, which cannot be read: ENOENT/],
  ]) {
    const { code, output } = await exited(env);
    assert.equal(code, 1, output);
    assert.match(output, message);
    assert.doesNotMatch(output, /port \d+/);
  }
});
