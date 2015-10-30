'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

var _slicedToArray = (function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i['return']) _i['return'](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError('Invalid attempt to destructure non-iterable instance'); } }; })();

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; desc = parent = undefined; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _emitter = require('./emitter');

var _emitter2 = _interopRequireDefault(_emitter);

var _LogEntry = require('./LogEntry');

var _LogEntry2 = _interopRequireDefault(_LogEntry);

var _timers = require('./timers');

var _timers2 = _interopRequireDefault(_timers);

var STATE_FOLLOWER = Symbol('follower');
var STATE_CANDIDATE = Symbol('candidate');
var STATE_LEADER = Symbol('leader');

var TIMER_ELECTION = Symbol('election timer');
var TIMER_HEARTBEAT = Symbol('heartbeat timer');
var TIMER_HEARTBEAT_TIMEOUT = Symbol('heartbeat timeout timer');

var FN_APPLY_COMMITS = Symbol('apply commits');
var APPLYING = Symbol();

var REFRESHING = Symbol();
var NOOP_COMMAND = Symbol('symbol used to represent a command for a placeholder log entry');

var RaftInterface = (function (_Emitter) {
    _inherits(RaftInterface, _Emitter);

    function RaftInterface(address) {
        _classCallCheck(this, RaftInterface);

        _get(Object.getPrototypeOf(RaftInterface.prototype), 'constructor', this).call(this);
        (0, _timers2['default'])(this);

        this.address = address || Math.random().toString() + '::' + Date.now().toString();
        this.nodes = new Map();
        this.rpcHandlers = new Map();

        this.currentTerm = 0;
        this.leaderID = null;

        this.votedFor = null;

        this.log = [];

        this.minimumIndex = 0;
        this.commitIndex = -1;
        this.lastApplied = -1;
        this.nextIndices = null;
        this.matchIndices = null;

        this.innerState = STATE_FOLLOWER;

        bindAll(this);
        bindRPC(this);

        this.heartbeat();
    }

    _createClass(RaftInterface, [{
        key: 'join',
        value: function join(address) {
            if (this.nodes.has(address)) throw new Error('Already have connection to that node');
            var inst = this.createInstance(address);
            this.nodes.set(address, inst);
            this.emit('join', address);
            if (this.nextIndices) {
                this.nextIndices.set(address, this.logIndex);
                this.matchIndices.set(address, this.minimumIndex);
            }
        }
    }, {
        key: 'leave',
        value: function leave(address) {
            if (!this.nodes.has(address)) return;
            this.nodes.get(address).end();
            this.nodes['delete'](address);
            this.emit('leave', address);
        }
    }, {
        key: 'end',
        value: function end() {
            this.nodes.forEach(function (node) {
                return node.end();
            });
            this.clearAllTimeouts();
        }
    }, {
        key: 'gotData',
        value: function gotData(fromAddress, payload) {
            if (!this.nodes.has(fromAddress)) {
                this.emit('debug', 'Got data for unrecognized address ' + fromAddress);
                return;
            }
            this.nodes.get(fromAddress).gotData(payload);
        }
    }, {
        key: 'propose',
        value: function propose(command) {
            var _this = this;

            if (this.state === STATE_LEADER) {
                return this.distributeAndCommit(command);
            }

            return new Promise(function (resolve, reject) {
                var unlistener = _this.listenOnce('state changed', function () {
                    reject(new Error('State changed while waiting for leader'));
                });

                _this.nodes.get(_this.leaderID).rpc('Propose', command).then(resolve, reject).then(unlistener); // This one runs regardless because promises
            });
        }
    }, {
        key: 'distributeAndCommit',
        value: function distributeAndCommit(command) {
            var _this2 = this;

            return new Promise(function (resolve, reject) {
                var entry = new _LogEntry2['default'](command, _this2.currentTerm);

                var logIndex = _this2.logIndex;
                var logTerm = _this2.logTerm;

                // The leader appends the command to its log as a new entry...
                _this2.log.push(entry);
                var newIndex = _this2.log.length - 1;

                // ... then issues AppendEntries RPCs in parallel to each of the
                // other servers to replicate the entry.
                _this2.nodes.forEach(function (n) {
                    _this2.sendAppendEntries(n, logIndex)['catch'](reject); // Propagate client errors

                    // TODO: Client errors probably shouldn't propagate, but the
                    // spec doesn't give much direction here. One bad node could
                    // just throw errors and completely wreck all persistence.
                });

                // Wait for the log to be replicated and applied
                var unlistener = _this2.listen('updated', function (index) {
                    if (index < newIndex) return;
                    unlistener();
                    resolve();
                });

                // TODO: Listen for state changes and abort
            });
        }
    }, {
        key: 'quorum',
        value: function quorum(responses) {
            if (!this.nodes.size || !responses) return false;
            return responses >= this.majority;
        }
    }, {
        key: 'rpc',
        value: function rpc(payload, sender) {
            var term = payload[1];
            var method = payload[3];
            if (!this.rpcHandlers.has(method)) {
                throw new Error('Method not accepted: ' + method);
            }
            this.sawTerm(term);
            return this.rpcHandlers.get(method).apply(undefined, _toConsumableArray(payload.slice(4)).concat([sender, term]));
        }
    }, {
        key: 'heartbeat',
        value: function heartbeat() {
            var _this3 = this;

            var clear = function clear(name) {
                if (!_this3[name]) return;
                _this3.clearTimeout(_this3[name]);
                _this3[name] = null;
            };

            clear(TIMER_HEARTBEAT_TIMEOUT);

            if (this.state === STATE_CANDIDATE) {
                clear(TIMER_HEARTBEAT);
                return;
            }

            clear(TIMER_ELECTION);

            if (this.state === STATE_LEADER) {
                if (this[TIMER_HEARTBEAT]) return;
                this[TIMER_HEARTBEAT] = this.setTimeout(function () {
                    _this3[TIMER_HEARTBEAT] = null;
                    _this3.sendHeartbeat();
                    _this3.heartbeat();
                }, this.heartbeatFrequency);
                return;
            }

            clear(TIMER_HEARTBEAT);
            this[TIMER_HEARTBEAT_TIMEOUT] = this.setTimeout(function () {
                _this3[TIMER_HEARTBEAT_TIMEOUT] = null;
                _this3.emit('heartbeat timeout');
                _this3.heartbeat();
            }, this.heartbeatTimeout);
        }
    }, {
        key: 'sendHeartbeat',
        value: function sendHeartbeat() {
            var _this4 = this;

            this.nodes.forEach(function (n) {
                // If we've already sent an AppendEntries to this node recently,
                // don't flood them with needless spam. This helps prevent nodes
                // from dealing with multiple rounds of log replication all at
                // once.
                if (Date.now() - n.lastAppendEntries < 0.9 * _this4.heartbeatFrequency) return;

                _this4.sendAppendEntries(n);
            });
        }
    }, {
        key: 'sendAppendEntries',
        value: function sendAppendEntries(node, prevLogIndex) {
            var _this5 = this;

            // Choose the index to update the follower from.
            var logIndex = Math.min(
            // If an index was specified, use that. Otherwise, use the latest
            // index.
            prevLogIndex || this.logIndex,
            // If the follower's known next index is lower than the one that
            // was passed, the RPC will fail unless we start from that point,
            // so use that value.
            this.nextIndices.get(node.address));
            // If there's a hard limit on the index that we can provide, use
            // that one.
            if (logIndex > this.minimumIndex - 1) logIndex = this.minimumIndex - 1;
            if (logIndex < this.logIndex) logIndex = this.logIndex;

            // TODO: Should there be some sort of locking to prevent new entries
            // from being appended while old ones are being retried?
            //
            // The spec is fine without this, but it means if a node is already
            // behind/failing/crashing/etc., all subsequent AppendEntries will
            // only fail anyway and get retried. Having only one AppendEntries
            // chugging along at a time will prevent nodes in a less-than-ideal
            // state from getting even more less-than-idea until they catch up.
            return new Promise(function (resolve, reject) {
                var sendRPC = function sendRPC() {
                    node.lastAppendEntries = Date.now();
                    return node.rpc('AppendEntries',
                    // prevLogIndex
                    logIndex,
                    // prevLogTerm
                    _this5.logEntryAt(logIndex) ? _this5.logEntryAt(logIndex).term : -1,
                    // entries
                    _this5.getEntrySlice(logIndex + 1),
                    // leaderCommit
                    _this5.commitIndex
                    // // minimumIndex
                    // this.minimumIndex
                    );
                };

                var bindRPC = function bindRPC() {
                    rpcCall.then(function (success) {
                        if (success) return resolve();
                        if (_this5.state !== STATE_LEADER) return reject();

                        // If a follower’s log is inconsistent with the leader’s,
                        // the AppendEntries consistency check will fail in the
                        // next AppendEntries RPC.
                        //
                        // After a rejection, the leader decrements nextIndex and
                        // retries the AppendEntries RPC.
                        logIndex--;

                        if (logIndex < _this5.minimumIndex - 1) logIndex = _this5.minimumIndex - 1; // Set reasonable bounds
                        if (logIndex > _this5.logIndex) logIndex = _this5.logIndex;

                        _this5.nextIndices.set(node.address, logIndex);
                        rpcCall = sendRPC();
                        bindRPC();
                    }, reject);
                };

                var rpcCall = sendRPC();
                bindRPC();
            }).then(function () {
                // When the AppendEntries call finally succeeds, we want to update
                // our list of indices.
                _this5.matchIndices.set(node.address, _this5.logIndex);
                _this5.checkReplicationAndCommit();
            }, Promise.reject.bind(Promise));
        }
    }, {
        key: 'getEntrySlice',
        value: function getEntrySlice(startIndex) {
            if (startIndex === -1) return this.log;
            return this.log.slice(startIndex + this.minimumIndex);
        }
    }, {
        key: 'checkReplicationAndCommit',
        value: function checkReplicationAndCommit() {
            var _this6 = this;

            var valueMap = new Map(); // index -> [index, count]
            valueMap.set(this.logIndex, [this.logIndex, 1]);

            // Tally up each index that we know each follower is caught up to.
            this.matchIndices.forEach(function (value) {
                if (value <= _this6.commitIndex) return;

                var count = 1;
                if (valueMap.has(value)) {
                    count = valueMap.get(value)[1] + 1;
                }

                valueMap.set(value, [value, count]);

                // Increment all seen indices lower than the current one.
                var _iteratorNormalCompletion = true;
                var _didIteratorError = false;
                var _iteratorError = undefined;

                try {
                    for (var _iterator = valueMap[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
                        var key = _step.value;

                        if (key < value) {
                            valueMap.set(key, [key, valueMap.get(key)[1] + 1]);
                        }
                    }
                } catch (err) {
                    _didIteratorError = true;
                    _iteratorError = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion && _iterator['return']) {
                            _iterator['return']();
                        }
                    } finally {
                        if (_didIteratorError) {
                            throw _iteratorError;
                        }
                    }
                }
            });

            // Sort the indices by their count.
            var sorted = [];
            valueMap.forEach(function (v) {
                return sorted.push(v);
            });
            sorted.sort(function (a, b) {
                return a[1] - b[1];
            });
            var topIndex = this.commitIndex;
            sorted.forEach(function (v) {
                var _v = _slicedToArray(v, 2);

                var index = _v[0];
                var count = _v[1];

                if (_this6.quorum(count) && index > topIndex) {
                    topIndex = index;
                }
            });
            if (topIndex > this.logIndex) topIndex = this.logIndex;
            if (topIndex === this.commitIndex) return;
            this.setCommitIndex(topIndex);
        }
    }, {
        key: 'sawTerm',
        value: function sawTerm(term) {
            // If RPC request or response contains term T > currentTerm:
            // set currentTerm = T, convert to follower (§5.1)
            if (term > this.currentTerm) {
                this.currentTerm = term;
                this.state = STATE_FOLLOWER;
                this.emit('term change');
            }
        }
    }, {
        key: 'setCommitIndex',
        value: function setCommitIndex(index) {
            this.emit('debug', 'Setting commit index: ' + index);
            this.commitIndex = index;

            this[FN_APPLY_COMMITS]();
        }
    }, {
        key: FN_APPLY_COMMITS,
        value: function value() {
            var _this7 = this;

            if (this.commitIndex <= this.lastApplied) {
                return;
            }
            if (this[APPLYING]) {
                return;
            }
            this[APPLYING] = true;

            // If commitIndex > lastApplied: increment lastApplied, apply
            // log[lastApplied] to state machine (§5.3)

            this.emit('debug', 'starting to apply commit ' + (this.lastApplied + 1));

            // We do this a bit differently to prevent data loss. We apply the
            // log entry at the prescribed index, but we don't increment
            // lastApplied until we are sure that the entry was properly persisted.
            // If we followed the spec to the letter, a database error could lead
            // to "committed" data never ending up in persistent storage.
            this.emit('apply', this.logEntryAt(this.lastApplied + 1), this.lastApplied + 1, function () {
                _this7.emit('debug', 'commit successfully applied ' + (_this7.lastApplied + 1));
                _this7[APPLYING] = false;

                // *now* we update lastApplied.
                _this7.lastApplied++;
                var indexToEmit = _this7.lastApplied;

                // If there's more work to be done, run again. Otherwise
                // fire the callback.
                if (_this7.commitIndex > _this7.lastApplied) {
                    // We call ourselves, which creates a new promise, then
                    // make that one resolve/reject this one.
                    _this7[FN_APPLY_COMMITS]();
                }
                _this7.emit('updated', indexToEmit);
            });
        }
    }, {
        key: 'deleteLogAtAndAfter',
        value: function deleteLogAtAndAfter(index) {
            this.log = this.log.slice(0, index);
        }
    }, {
        key: 'logEntryAt',
        value: function logEntryAt(index) {
            if (!this.log[index]) return null;
            return this.log[index];
        }

        // Stuff that can be overridden

    }, {
        key: 'createInstance',
        value: function createInstance(address) {
            throw new Error('Raft instance factory not implemented');
        }
    }, {
        key: 'majority',
        get: function get() {
            return Math.ceil(this.nodes.size / 2) + 1;
        }
    }, {
        key: 'logIndex',
        get: function get() {
            if (!this.log.length) return -1;
            return this.log.length - 1;
        }
    }, {
        key: 'logTerm',
        get: function get() {
            if (!this.log.length) return -1;
            return this.log[this.log.length - 1].term;
        }
    }, {
        key: 'state',
        get: function get() {
            return this.innerState;
        },
        set: function set(newState) {
            if (newState === this.innerState) return;
            if (newState !== STATE_FOLLOWER && newState !== STATE_CANDIDATE && newState !== STATE_LEADER) {
                throw new Error('Unknown state');
            }

            this.innerState = newState;
            this.emit('state changed');
        }
    }, {
        key: 'isLeader',
        get: function get() {
            return this.state === STATE_LEADER;
        }
    }, {
        key: 'electionTimeout',
        get: function get() {
            return Math.random() * 150 + 150;
        }
    }, {
        key: 'heartbeatFrequency',
        get: function get() {
            return 100;
        }
    }, {
        key: 'heartbeatTimeout',
        get: function get() {
            return 200 + Math.random() * 50;
        }
    }]);

    return RaftInterface;
})(_emitter2['default']);

exports['default'] = RaftInterface;
;

function bindRPC(raft) {
    raft.rpcHandlers.set('AppendEntries', function (prevLogIndex, prevLogTerm, entries, leaderCommit, /* minimumIndex,*/leaderID, term) {
        raft.leaderID = leaderID;

        if (raft.state === STATE_CANDIDATE) {
            // If the term in the RPC is smaller than the candidate’s current
            // term, then the candidate rejects the RPC and continues in
            // candidate state.
            if (term < raft.currentTerm) {
                return false;
            }
            raft.state = STATE_FOLLOWER;
        }

        if (raft.state === STATE_LEADER) {
            // Maybe we're the crazy ones.
            if (term >= raft.currentTerm) {
                raft.state = STATE_FOLLOWER;
            }
            // Nope, they cray.
            return false;
        }

        // Reply false if term < currentTerm (§5.1)
        if (term < raft.currentTerm) {
            return false;
        }

        // Make sure that followers count any AppendEntries call as a heartbeat.
        raft.heartbeat();

        // If we're at the edge of our log because of compaction, force a
        // refresh.
        //
        // Note that this is non-standard. We include it because Raft's log
        // compaction is basically "roll your own".
        if (prevLogIndex !== -1 && prevLogIndex < raft.minimumIndex) {
            // Some caching
            if (raft[REFRESHING]) return raft[REFRESHING];

            // Return a promise to make this RPC async
            return raft[REFRESHING] = new Promise(function (resolve) {
                // Emit `refresh` and wait for the callback. When it comes,
                // resolve with `false` to say that there was a failure. The
                // leader will try again and try to enunciate its words better.
                raft.emit('refresh', function (term, index) {
                    // TODO: set term and index
                    console.error('omg not implemented');

                    raft[REFRESHING] = null; // clean up
                    resolve(false); // `false` because we want the server to recognize that we failed.
                });
            });
        }

        // Reply false if log doesn’t contain an entry at prevLogIndex
        // whose term matches prevLogTerm (§5.3)
        else if (prevLogIndex !== -1 && // Ignore non-existant logs that don't exist
            !raft.logEntryAt(prevLogIndex)) {
                return false;
            }
        var entryAtIndex = raft.logEntryAt(prevLogIndex);
        if (entryAtIndex && entryAtIndex.term !== prevLogTerm) {
            raft.deleteLogAtAndAfter(prevLogIndex);
            return false;
        }

        // If an existing entry conflicts with a new one (same index
        // but different terms), delete the existing entry and all that
        // follow it (§5.3)
        //
        // Append any new entries not already in the log
        entries.forEach(function (e, i) {
            var presumedIndex = prevLogIndex + 1 + i;
            var correspondingEntry = raft.logEntryAt(presumedIndex);

            // If there's already an entry there, check that it's up-to-date.
            if (correspondingEntry) {
                // If it's up-to-date, just ignore it.
                if (correspondingEntry.term === e.term) {
                    return;
                }

                // If it's not up-to-date, delete it and everything after it.
                raft.deleteLogAtAndAfter(presumedIndex);
            }

            raft.log.push(_LogEntry2['default'].from(e));
        });

        // If leaderCommit > commitIndex, set
        // commitIndex = min(leaderCommit, index of last new entry)
        if (leaderCommit > raft.commitIndex) {
            raft.setCommitIndex(Math.min(leaderCommit, prevLogIndex + entries.length));
        }

        return true;
    });

    // The spec passes term and candidate ID as a param, but we already know it so we save the few bytes.
    raft.rpcHandlers.set('RequestVote', function ( /*term, candidateID,*/lastLogIndex, lastLogTerm, candidateID, term) {
        // Reply false if term < currentTerm (§5.1)
        if (term < raft.currentTerm) return false;

        // If votedFor is null or candidateId, and candidate’s log is at
        // least as up-to-date as receiver’s log, grant vote (§5.2, §5.4)
        if (raft.votedFor !== null && raft.votedFor !== candidateID) {
            return false;
        }
        if (lastLogIndex < raft.logIndex || lastLogTerm < raft.logTerm) {
            return false;
        }

        raft.votedFor = candidateID;
        raft.heartbeat();
        return true;
    });

    raft.rpcHandlers.set('Propose', function (command) {
        return raft.distributeAndCommit(command);
    });
}

function bindAll(raft) {

    raft.listen('term change', function () {
        // Reset our vote as we're starting a new term. Votes only last one term.
        raft.votedFor = null;
    });

    raft.listen('state changed', function () {
        var _STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state;

        raft.nextIndices = null;
        raft.matchIndices = null;
        raft.heartbeat();
        raft.emit((_STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state = {}, _defineProperty(_STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state, STATE_FOLLOWER, 'follower'), _defineProperty(_STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state, STATE_CANDIDATE, 'candidate'), _defineProperty(_STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state, STATE_LEADER, 'leader'), _STATE_FOLLOWER$STATE_CANDIDATE$STATE_LEADER$raft$state)[raft.state]);
    });

    raft.listen('heartbeat timeout', function () {
        raft.emit('start election');
    });

    raft.listen('start election', function (newElection) {
        if (raft.state === STATE_CANDIDATE && !newElection) {
            throw new Error('Election started during an already-ongoing election');
        }
        if (newElection && raft.nodes.size === 0) {
            // If we're starting a new election due to a previous election
            // timeout and there's nobody else online, just elect ourselves and
            // call it a day.
            raft.state = STATE_LEADER;
            return;
        }

        raft.currentTerm++;
        raft.emit('term change');
        raft.leaderID = null;
        raft.votedFor = raft.address;
        raft.state = STATE_CANDIDATE;

        // TODO: listen for nodes leaving and redact their votes

        var votesReceived = 1; // me!
        var votesDenied = 0;
        var electionOngoing = true;
        var electionTimeout;

        raft.nodes.forEach(function (n) {
            n.rpc('RequestVote',
            // The following two are already known: the term is passed on
            // every request and the address is known from which socket the
            // message arrives on.
            // raft.currentTerm,
            // raft.address,
            raft.logIndex, raft.logTerm).then(function (granted) {
                if (!electionOngoing || raft.state !== STATE_CANDIDATE) return;
                raft.emit('debug', 'got vote ' + granted + ' from ' + n.address);
                if (granted) {
                    votesReceived++;
                } else {
                    votesDenied++;
                }
                gotVote();
            });
        });

        gotVote(); // our own!
        raft.heartbeat();

        function gotVote() {
            if (!electionOngoing) return;

            if (raft.quorum(votesReceived)) {
                raft.emit('debug', 'got elected leader');
                raft.leaderID = raft.address;
                raft.state = STATE_LEADER;

                // The leader maintains a nextIndex for each follower, which is
                // the index of the next log entry the leader will send to that
                // follower.
                raft.nextIndices = new Map();
                raft.matchIndices = new Map();
                // When a leader first comes to power, it initializes all
                // nextIndex values to the index just after the last one in its
                // log
                var _iteratorNormalCompletion2 = true;
                var _didIteratorError2 = false;
                var _iteratorError2 = undefined;

                try {
                    for (var _iterator2 = raft.nodes.keys()[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
                        var address = _step2.value;

                        raft.nextIndices.set(address, raft.logIndex + 1);
                        raft.matchIndices.set(address, raft.minimumIndex);
                    }

                    // Upon election: send initial empty AppendEntries RPCs
                    // (heartbeat) to each server (§5.2)
                } catch (err) {
                    _didIteratorError2 = true;
                    _iteratorError2 = err;
                } finally {
                    try {
                        if (!_iteratorNormalCompletion2 && _iterator2['return']) {
                            _iterator2['return']();
                        }
                    } finally {
                        if (_didIteratorError2) {
                            throw _iteratorError2;
                        }
                    }
                }

                raft.sendHeartbeat();
                endElection();
            } else if (raft.quorum(votesDenied) || !raft.quorum(votesReceived + (raft.nodes.size + 1 - votesDenied - votesReceived))) {
                raft.emit('debug', 'did not get elected leader: ' + votesDenied + ', ' + votesReceived);
                // This isn't covered by the spec, but it's worth doing.
                // If the candidate has received a quorum of negative votes,
                // become a follower. Alternatively, if the number of votes
                // I've gotten plus the number of votes yet to be received
                // doesn't yield a quorum, it's not possible for me to be
                // elected.
                //
                // TODO: I'm not 100% sure this is the correct behavior. If the
                // candidate's log is behind, becoming a follower is correct.
                // If all of the other nodes have voted for a better-qualified
                // candidate, becoming a follower is also correct. However, if
                // all of the other nodes have just voted for themselves, the
                // result of becoming a follower is unknown. Converting to a
                // follower may prevent deadlock (where all nodes get stuck
                // voting for themselves), but it also may just cause hella
                // lag.
                raft.state = STATE_FOLLOWER;
                endElection();
            }
        }

        raft[TIMER_ELECTION] = electionTimeout = raft.setTimeout(function () {
            // Check the numbers one last time.
            // TODO: Remove this one join/leave support is added.
            gotVote();

            var origElectionOngoing = electionOngoing;
            endElection();
            if (origElectionOngoing) {
                raft.emit('start election', true);
            }
        }, raft.electionTimeout);

        function endElection() {
            if (!electionOngoing) return;
            raft.clearTimeout(electionTimeout);
            electionOngoing = false;
        }
    });
}
module.exports = exports['default'];