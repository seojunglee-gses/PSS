// Runs in the document head before page modules. Keep this payload ES5-compatible.
export const browserCompatibilityScript = String.raw`
(function () {
  "use strict";
  function install(object, name, implementation) {
    if (typeof object[name] !== "function") Object.defineProperty(object, name, {value: implementation, configurable: true, writable: true});
  }
  function at(index) {
    if (this == null) throw new TypeError("Invalid receiver");
    var object = Object(this), length = Math.min(Math.max(Math.floor(Number(object.length)) || 0, 0), 9007199254740991);
    var number = Number(index) || 0, position = number < 0 ? Math.ceil(number) : Math.floor(number);
    if (position < 0) position += length;
    return position < 0 || position >= length ? undefined : object[position];
  }
  install(Array.prototype, "at", at);
  install(String.prototype, "at", at);
  install(String.prototype, "replaceAll", function (search, replacement) {
    if (this == null) throw new TypeError("Invalid receiver");
    if (Object.prototype.toString.call(search) === "[object RegExp]") {
      if (!search.global) throw new TypeError("replaceAll requires a global RegExp");
      return String(this).replace(search, replacement);
    }
    var escaped = String(search).replace(/[.*+?^{}$()|[\]\\]/g, "\\$&");
    return String(this).replace(new RegExp(escaped, "g"), replacement);
  });
  if (window.crypto && window.crypto.getRandomValues) install(window.crypto, "randomUUID", function () {
    var bytes = new Uint8Array(16), result = "";
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    for (var i = 0; i < bytes.length; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) result += "-";
      result += ("0" + bytes[i].toString(16)).slice(-2);
    }
    return result;
  });
  if (window.AbortController && window.AbortSignal) {
    install(window.AbortSignal, "timeout", function (delay) {
      if (!isFinite(delay) || delay < 0) throw new RangeError("Invalid timeout");
      var controller = new window.AbortController();
      var timer = setTimeout(function () { controller.abort(new DOMException("Timed out", "TimeoutError")); }, delay);
      controller.signal.addEventListener("abort", function () { clearTimeout(timer); }, {once: true});
      return controller.signal;
    });
    install(window.AbortSignal, "any", function (input) {
      var signals = Array.from(input), controller = new window.AbortController();
      function clean() { signals.forEach(function (signal) { if (signal && signal.removeEventListener) signal.removeEventListener("abort", abort); }); }
      function abort(event) { controller.abort(event.target.reason); clean(); }
      for (var i = 0; i < signals.length; i++) {
        if (!signals[i] || typeof signals[i].addEventListener !== "function") { clean(); throw new TypeError("Invalid signal"); }
        if (signals[i].aborted) { controller.abort(signals[i].reason); clean(); break; }
        signals[i].addEventListener("abort", abort, {once: true});
      }
      return controller.signal;
    });
  }
  var probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;";
  probe.appendChild(document.createElement("div")); probe.appendChild(document.createElement("div"));
  document.documentElement.appendChild(probe);
  if (probe.scrollHeight !== 1) document.documentElement.classList.add("no-flex-gap");
  probe.remove();
})();
`;
