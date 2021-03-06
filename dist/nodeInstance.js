'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; desc = parent = undefined; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _emitter = require('./emitter');

var _emitter2 = _interopRequireDefault(_emitter);

var _timers = require('./timers');

var _timers2 = _interopRequireDefault(_timers);

var NodeInstance = (function (_Emitter) {
    _inherits(NodeInstance, _Emitter);

    function NodeInstance(address, raft) {
        _classCallCheck(this, NodeInstance);

        _get(Object.getPrototypeOf(NodeInstance.prototype), 'constructor', this).call(this);
        (0, _timers2['default'])(this);

        this.address = address;
        this.raft = raft;

        this.incr = 0;

        this.lastAppendEntries = 0;
    }

    _createClass(NodeInstance, [{
        key: 'end',
        value: function end() {
            this.clearAllTimeouts();
        }
    }, {
        key: 'rpc',
        value: function rpc(method) {
            var _this = this;

            for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
            }

            return new Promise(function (resolve, reject) {
                var msgID = _this.incr++;
                var timeout = null;

                var dataUnlistener;
                var leaveUnlistener;

                var cleanup = function cleanup() {
                    _this.clearTimeout(timeout);
                    dataUnlistener();
                    leaveUnlistener();
                };

                try {
                    _this.write([msgID, _this.raft.currentTerm, 'req', method].concat(args));
                } catch (e) {
                    cleanup();
                    return reject(e);
                }

                dataUnlistener = _this.listen('data', function (payload) {
                    var result = payload[2];
                    if (result !== 'res' && result !== 'err') return;
                    if (payload[0] !== msgID) return;
                    var term = payload[1];
                    cleanup();
                    _this.raft.emit('saw term', term);
                    if (result === 'err') {
                        reject(payload[3]);
                    } else {
                        resolve(payload[3]);
                    }
                });
                leaveUnlistener = _this.raft.listen('leave', function (machineID) {
                    if (machineID !== _this.address) return;
                    cleanup();
                    reject(new Error('client left'));
                });

                if (_this.messageTimeout < Infinity) {
                    timeout = _this.setTimeout(function () {
                        cleanup();
                        reject(new Error('timeout'));
                    }, _this.messageTimeout);
                }
            });
        }
    }, {
        key: 'gotData',
        value: function gotData(payload) {
            var _this2 = this;

            var result = payload[2];
            if (result === 'res' || result === 'err') {
                this.emit('data', payload);
                return;
            }

            this.raft.emit('saw term', payload[1]);

            var response;
            try {
                response = this.raft.rpc(payload, this.address);
            } catch (e) {
                this.sendErrorResponse(payload, e);
                throw e;
            }
            if (response instanceof Promise) {
                response.then(function (response) {
                    _this2.sendResponse(payload, response);
                }, function (err) {
                    _this2.sendErrorResponse(payload, err);
                    return err; // to allow internal error reporting
                });
            } else {
                    this.sendResponse(payload, response);
                }
        }
    }, {
        key: 'sendResponse',
        value: function sendResponse(origMessage, response) {
            response = typeof response === 'undefined' ? null : response;
            this.write([origMessage.id, this.raft.currentTerm, 'res', response]);
        }
    }, {
        key: 'sendErrorResponse',
        value: function sendErrorResponse(origMessage, error) {
            error = error ? error.toString() : null;
            this.write([origMessage.id, this.raft.currentTerm, 'err', error]);
        }
    }, {
        key: 'write',
        value: function write() {
            throw new Error('Write method not implemented on raft node instance');
        }
    }, {
        key: 'messageTimeout',
        get: function get() {
            return Infinity;
        }
    }]);

    return NodeInstance;
})(_emitter2['default']);

exports['default'] = NodeInstance;
;
module.exports = exports['default'];