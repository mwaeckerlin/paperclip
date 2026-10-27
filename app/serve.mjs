// Loaded by node before Paperclip (node --import): reads the Better Auth
// secret from its Docker secret file, checks the settings, and serves every
// request below PAPERCLIP_BASE_PATH with the path Paperclip's routes expect.
//
// Paperclip runs one HTTP server for its pages, its API, its server-sent
// events and its websockets. Every request reaches that server through its
// "request" or "upgrade" event, so this is where the base path is taken off
// the request and put in front of a root-absolute redirect.
import http from "node:http";
import {
  ConfigurationError,
  checkPublicUrl,
  parseBasePath,
  prefixLocation,
  routeRequestUrl,
  secretFromFile,
} from "./configuration.mjs";

let basePath;
try {
  secretFromFile(process.env, "BETTER_AUTH_SECRET");
  basePath = parseBasePath(process.env.PAPERCLIP_BASE_PATH);
  checkPublicUrl(basePath, process.env.PAPERCLIP_PUBLIC_URL);
} catch (error) {
  if (!(error instanceof ConfigurationError)) throw error;
  console.error(`paperclip: configuration error: ${error.message}`);
  process.exit(1);
}

function prefixHeaders(headers) {
  if (Array.isArray(headers)) {
    if (Array.isArray(headers[0])) {
      return headers.map(([name, value]) => [name, String(name).toLowerCase() === "location" ? prefixLocation(value, basePath) : value]);
    }
    return headers.map((value, index) =>
      index % 2 === 1 && String(headers[index - 1]).toLowerCase() === "location" ? prefixLocation(value, basePath) : value,
    );
  }
  if (headers && typeof headers === "object") {
    const copy = { ...headers };
    for (const name of Object.keys(copy)) {
      if (name.toLowerCase() === "location") copy[name] = prefixLocation(copy[name], basePath);
    }
    return copy;
  }
  return headers;
}

function prefixRedirects(response) {
  const setHeader = response.setHeader;
  response.setHeader = function (name, value) {
    if (String(name).toLowerCase() === "location") {
      value = Array.isArray(value) ? value.map((entry) => prefixLocation(entry, basePath)) : prefixLocation(value, basePath);
    }
    return setHeader.call(this, name, value);
  };
  const writeHead = response.writeHead;
  response.writeHead = function (statusCode, ...rest) {
    const index = typeof rest[0] === "string" ? 1 : 0;
    if (rest.length > index) rest[index] = prefixHeaders(rest[index]);
    return writeHead.call(this, statusCode, ...rest);
  };
}

if (basePath) {
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function (event, ...args) {
    if (event === "request" || event === "checkContinue" || event === "checkExpectation") {
      const [request, response] = args;
      const route = routeRequestUrl(request.url, basePath);
      if (route.kind === "bare") {
        response.writeHead(308, { Location: route.url, "Content-Length": "0" });
        response.end();
        return true;
      }
      if (route.kind === "inside") {
        request.url = route.url;
        prefixRedirects(response);
      }
    } else if (event === "upgrade") {
      const [request, socket] = args;
      const route = routeRequestUrl(request.url, basePath);
      if (route.kind === "bare") {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return true;
      }
      if (route.kind === "inside") request.url = route.url;
    }
    return emit.call(this, event, ...args);
  };
  console.log(`paperclip: serving below ${basePath}/`);
}
