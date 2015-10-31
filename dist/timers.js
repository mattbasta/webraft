"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports["default"] = timerMixin;

function timerMixin(base) {
    var timers = new Set();

    base.setTimeout = function (timer) {
        for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
            args[_key - 1] = arguments[_key];
        }

        var timeout = setTimeout(function () {
            timers["delete"](timeout);
            timer.apply(undefined, args);
        });
        timers.add(timeout);
        return timeout;
    };

    base.clearTimeout = function (ref) {
        if (timers.has(ref)) timers["delete"](ref);
        return clearTimeout(ref);
    };

    base.clearAllTimeouts = function () {
        timers.forEach(function (ref) {
            return clearTimeout(ref);
        });
        timers.clear();
    };
}

;
module.exports = exports["default"];