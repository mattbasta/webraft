'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) subClass.__proto__ = superClass; }

var _emitter = require('./emitter');

var _emitter2 = _interopRequireDefault(_emitter);

var NodeInstance = (function (_Emitter) {
    function NodeInstance(address, raft) {
        _classCallCheck(this, NodeInstance);

        _get(Object.getPrototypeOf(NodeInstance.prototype), 'constructor', this).call(this);

        this.address = address;
        this.raft = raft;

        this.activeMessageIDs = new Set();
        this.incr = 0;

        this.lastAppendEntries = 0;
    }

    _inherits(NodeInstance, _Emitter);

    _createClass(NodeInstance, [{
        key: 'rpc',
        value: function rpc(method) {
            var _this = this;

            for (var _len = arguments.length, args = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                args[_key - 1] = arguments[_key];
            }

            return new Promise(function (resolve, reject) {
                var msgID = _this.incr++;
                var cb;
                var disconnectCB;
                var timeout = null;

                var cleanup = function cleanup() {
                    _this.activeMessageIDs['delete'](msgID);
                    _this.unlisten('data', cb);
                    _this.raft.unlisten('leave', disconnectCB);
                };

                _this.activeMessageIDs.add(msgID);
                try {
                    _this.write({
                        req: [method].concat(args),
                        id: msgID,

                        term: _this.raft.currentTerm });
                } catch (e) {
                    cleanup();
                    return reject(e);
                }
                disconnectCB = function (machineID) {
                    if (machineID !== _this.address) return;
                    cleanup();
                    reject(new Error('client left'));
                };
                cb = function (payload) {
                    if (!('res' in payload) && !('err' in payload)) return;
                    if (payload.id !== msgID) return;
                    cleanup();
                    _this.raft.sawTerm(payload.term);
                    if ('err' in payload) {
                        reject(payload.err);
                    } else {
                        resolve(payload.res);
                    }
                };
                _this.listen('data', cb);
                _this.raft.listen('leave', disconnectCB);

                if (_this.messageTimeout < Infinity) {
                    timeout = setTimeout(function () {
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

            if ('res' in payload || 'err' in payload) {
                this.emit('data', payload, this.address);
                return;
            }

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
                    return err;
                });
            } else {
                this.sendResponse(payload, response);
            }
        }
    }, {
        key: 'sendResponse',
        value: function sendResponse(origMessage, response) {
            this.write({
                id: origMessage.id,
                res: typeof response === 'undefined' ? null : response,

                term: this.raft.currentTerm });
        }
    }, {
        key: 'sendErrorResponse',
        value: function sendErrorResponse(origMessage, error) {
            this.write({
                id: origMessage.id,
                err: error ? error.toString() : null,

                term: this.raft.currentTerm });
        }
    }, {
        key: 'write',
        value: function write() {
            throw new Error('Write method not implemented on raft node instance');
        }
    }, {
        key: 'messageTimeout',
        get: function () {
            return Infinity;
        }
    }]);

    return NodeInstance;
})(_emitter2['default']);

exports['default'] = NodeInstance;
;
module.exports = exports['default'];