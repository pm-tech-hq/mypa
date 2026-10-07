/* SPDX-License-Identifier: MIT
 * (MIT, like packages/widget-sdk: widgets load this file, so it never affects how they are licensed.) */
/*
 * myPA widget runtime, served to every widget at /__mypa/sdk.js.
 *
 *   <script src="/__mypa/sdk.js"></script>
 *   <script>
 *     mypa.ready.then(({ settings }) => { ... });
 *   </script>
 *
 * The widget runs in a sandboxed iframe with an opaque origin: no network,
 * no cookies, no access to the app. Everything goes through `mypa.*`, which
 * the host checks against the permissions approved at install time.
 */
(function () {
  "use strict";
  if (window.mypa) return;

  var pending = new Map();
  var nextId = 1;
  var listeners = { settings: [], theme: [], tasks: [], calendar: [] };
  var resolveReady;
  var ready = new Promise(function (r) {
    resolveReady = r;
  });

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending.set(id, { resolve: resolve, reject: reject });
      window.parent.postMessage({ mypa: 1, id: id, method: method, params: params }, "*");
    });
  }

  function emit(event, data) {
    (listeners[event] || []).forEach(function (cb) {
      try {
        cb(data);
      } catch (err) {
        console.error(err);
      }
    });
  }

  function applyTheme(theme) {
    if (!theme || !theme.vars) return;
    var root = document.documentElement;
    Object.keys(theme.vars).forEach(function (k) {
      root.style.setProperty(k, theme.vars[k]);
    });
  }

  window.addEventListener("message", function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || msg.mypa !== 1) return;
    if (typeof msg.id === "number" && pending.has(msg.id)) {
      var p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "Request failed"));
      return;
    }
    if (msg.event) {
      if (msg.event === "settings") api.settings = msg.data;
      if (msg.event === "theme") applyTheme(msg.data);
      emit(msg.event, msg.data);
    }
  });

  function on(event) {
    return function (cb) {
      listeners[event].push(cb);
      return function () {
        listeners[event] = listeners[event].filter(function (x) {
          return x !== cb;
        });
      };
    };
  }

  var api = {
    /** Resolves once the host has connected: { widget, instanceId, settings, permissions, theme }. */
    ready: ready,
    /** Current values of the manifest's settings fields. */
    settings: {},
    onSettings: on("settings"),
    onTheme: on("theme"),
    /** Private key-value storage for this widget instance (persisted by myPA). */
    storage: {
      get: function (key) {
        return call("storage.get", { key: key });
      },
      set: function (key, value) {
        return call("storage.set", { key: key, value: value });
      },
      remove: function (key) {
        return call("storage.remove", { key: key });
      },
    },
    /** Needs "tasks:read" (list, onChange) / "tasks:write" (create). */
    tasks: {
      list: function () {
        return call("tasks.list");
      },
      create: function (task) {
        return call("tasks.create", task);
      },
      /** Ticks a task off (done: true) or back on (done: false). Needs "tasks:write". */
      setDone: function (id, done) {
        return call("tasks.setDone", { id: String(id), done: done !== false });
      },
      onChange: on("tasks"),
    },
    /** Needs "calendar:read". */
    calendar: {
      list: function (opts) {
        return call("calendar.list", opts || {});
      },
      onChange: on("calendar"),
    },
    /** Needs a matching "net:<host>" permission. https only. */
    fetch: function (url, init) {
      return call("net.fetch", { url: String(url), init: init || {} }).then(function (r) {
        return {
          ok: r.status >= 200 && r.status < 300,
          status: r.status,
          headers: r.headers,
          text: function () {
            return Promise.resolve(r.body);
          },
          json: function () {
            return Promise.resolve(JSON.parse(r.body));
          },
        };
      });
    },
    /** Needs "notify". */
    notify: function (title, body) {
      return call("notify", { title: String(title), body: body ? String(body) : "" });
    },
    /** Opens an https link in the user's browser. */
    openUrl: function (url) {
      return call("openUrl", { url: String(url) });
    },
  };

  window.mypa = api;

  function connect() {
    call("ready").then(function (init) {
      api.settings = init.settings || {};
      applyTheme(init.theme);
      resolveReady(init);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connect);
  else connect();
})();
