"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Emitter = (function () {
    function Emitter() {
        _classCallCheck(this, Emitter);

        this.listeners = new Map();
    }

    _createClass(Emitter, [{
        key: "emit",
        value: function emit(type) {
            for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
            }

            if (!this.listeners.has(type)) return;
            this.listeners.get(type).forEach(function (h) {
                return h.apply(undefined, args);
            });
        }
    }, {
        key: "listen",
        value: function listen(type, handler) {
            var _this = this;

            if (!this.listeners.has(type)) this.listeners.set(type, new Set());
            this.listeners.get(type).add(handler);

            return function () {
                _this.unlisten(type, handler);
            };
        }
    }, {
        key: "listenOnce",
        value: function listenOnce(type, handler) {
            var unlistener = this.listen(type, function () {
                unlistener();
                handler.apply(undefined, arguments);
            });
            return unlistener;
        }
    }, {
        key: "unlisten",
        value: function unlisten(type, handler) {
            if (!this.listeners.has(type)) return;
            this.listeners.get(type)["delete"](handler);
        }
    }]);

    return Emitter;
})();

exports["default"] = Emitter;
;
module.exports = exports["default"];