// Loaded by the page below a base path, before the Paperclip bundle; the server
// writes the base path into globalThis.__paperclipBasePath just ahead of it.
//
// The bundle addresses its server with root-absolute URLs (`/api/...`,
// `/sw.js`, `/brands/...`), and so do addresses in the answers of the server.
// This script puts the base path in front of every root-absolute URL of this
// origin the page requests: fetch, XMLHttpRequest, WebSocket, EventSource,
// workers, the service worker, window.open, sendBeacon, the history, the src,
// href and action of every element, and a document navigation. A relative,
// foreign or already prefixed URL stays as it is.
(function () {
  "use strict";
  var base = String(globalThis.__paperclipBasePath || "").replace(/\/+$/, "");
  if (!base) return;
  var prefix = base + "/";
  var origins = [location.origin, location.origin.replace(/^http/, "ws")];

  function rebasePath(path) {
    if (path === base || path.indexOf(prefix) === 0) return path;
    var next = path.charAt(base.length);
    if (path.indexOf(base) === 0 && (next === "?" || next === "#")) return path;
    return base + path;
  }

  function rebase(value) {
    if (value instanceof URL) {
      var href = rebase(value.href);
      return href === value.href ? value : new URL(href);
    }
    if (typeof value !== "string") return value;
    if (value.charAt(0) === "/") {
      var second = value.charAt(1);
      return second === "/" || second === "\\" ? value : rebasePath(value);
    }
    for (var i = 0; i < origins.length; i++) {
      var origin = origins[i];
      if (value.slice(0, origin.length + 1).toLowerCase() === (origin + "/").toLowerCase()) {
        return value.slice(0, origin.length) + rebasePath(value.slice(origin.length));
      }
    }
    return value;
  }
  globalThis.__paperclipRebase = rebase;

  var slice = Array.prototype.slice;

  var nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    if (typeof Request !== "undefined" && input instanceof Request) {
      var target = rebase(input.url);
      if (target !== input.url) input = new Request(target, input);
      return nativeFetch.call(window, input, init);
    }
    return nativeFetch.call(window, rebase(input), init);
  };

  var nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    var args = slice.call(arguments);
    args[1] = rebase(args[1]);
    return nativeOpen.apply(this, args);
  };

  ["WebSocket", "EventSource", "Worker", "SharedWorker"].forEach(function (name) {
    var Native = window[name];
    if (typeof Native !== "function") return;
    var Rebased = function () {
      var args = slice.call(arguments);
      args[0] = rebase(args[0]);
      return Reflect.construct(Native, args, new.target || Native);
    };
    Rebased.prototype = Native.prototype;
    Object.setPrototypeOf(Rebased, Native);
    window[name] = Rebased;
  });

  var nativeWindowOpen = window.open;
  window.open = function () {
    var args = slice.call(arguments);
    args[0] = rebase(args[0]);
    return nativeWindowOpen.apply(this, args);
  };

  if (navigator.sendBeacon) {
    var nativeSendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function (url, data) {
      return nativeSendBeacon.call(navigator, rebase(url), data);
    };
  }

  if (navigator.serviceWorker && navigator.serviceWorker.register) {
    var container = navigator.serviceWorker;
    var nativeRegister = container.register;
    container.register = function (url, options) {
      var rebasedOptions = options ? Object.assign({}, options) : undefined;
      if (rebasedOptions && rebasedOptions.scope) rebasedOptions.scope = rebase(rebasedOptions.scope);
      return nativeRegister.call(container, rebase(url), rebasedOptions);
    };
  }

  ["pushState", "replaceState"].forEach(function (name) {
    var native = History.prototype[name];
    History.prototype[name] = function () {
      var args = slice.call(arguments);
      if (args.length > 2 && args[2] !== undefined && args[2] !== null) args[2] = rebase(args[2]);
      return native.apply(this, args);
    };
  });

  // Element URLs: React writes src and href through setAttribute or through
  // the property, so both carry the base path.
  var URL_ATTRIBUTES = { src: true, href: true, poster: true, action: true, formaction: true };
  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (URL_ATTRIBUTES[String(name).toLowerCase()] && typeof value === "string") value = rebase(value);
    return nativeSetAttribute.call(this, name, value);
  };
  [
    ["HTMLImageElement", "src"], ["HTMLMediaElement", "src"], ["HTMLSourceElement", "src"],
    ["HTMLScriptElement", "src"], ["HTMLIFrameElement", "src"], ["HTMLTrackElement", "src"],
    ["HTMLEmbedElement", "src"], ["HTMLInputElement", "src"], ["HTMLVideoElement", "poster"],
    ["HTMLAnchorElement", "href"], ["HTMLAreaElement", "href"], ["HTMLLinkElement", "href"],
    ["HTMLFormElement", "action"], ["HTMLButtonElement", "formAction"], ["HTMLInputElement", "formAction"],
  ].forEach(function (entry) {
    var Type = window[entry[0]];
    if (!Type) return;
    var descriptor = Object.getOwnPropertyDescriptor(Type.prototype, entry[1]);
    if (!descriptor || !descriptor.set) return;
    Object.defineProperty(Type.prototype, entry[1], {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set: function (value) { descriptor.set.call(this, typeof value === "string" ? rebase(value) : value); },
    });
  });

  // A document navigation to a root-absolute address of this origin, such as
  // `location.href = "/auth"`, which no setter above sees: where the browser
  // has the Navigation API, it goes to the same address below the base path.
  if (window.navigation && typeof window.navigation.addEventListener === "function") {
    window.navigation.addEventListener("navigate", function (event) {
      if (!event.cancelable || event.navigationType === "traverse" || event.hashChange) return;
      if (event.downloadRequest != null || event.formData) return;
      var url = new URL(event.destination.url);
      if (url.origin !== location.origin) return;
      var path = rebasePath(url.pathname);
      if (path === url.pathname) return;
      event.preventDefault();
      location.assign(path + url.search + url.hash);
    });
  }

  // The elements the parser created from the page itself.
  function rebaseDocument() {
    var elements = document.querySelectorAll("[src],[href],[poster],[action]");
    for (var i = 0; i < elements.length; i++) {
      ["src", "href", "poster", "action"].forEach(function (name) {
        var value = elements[i].getAttribute(name);
        if (value !== null && rebase(value) !== value) nativeSetAttribute.call(elements[i], name, rebase(value));
      });
    }
  }
  rebaseDocument();
  document.addEventListener("DOMContentLoaded", rebaseDocument);
})();
