import Emitter from './emitter';
import LogEntry from './LogEntry';
import timerMixin from './timers';


const STATE_FOLLOWER = Symbol('follower');
const STATE_CANDIDATE = Symbol('candidate');
const STATE_LEADER = Symbol('leader');

const TIMER_ELECTION = Symbol('election timer');
const TIMER_HEARTBEAT = Symbol('heartbeat timer');
const TIMER_HEARTBEAT_TIMEOUT = Symbol('heartbeat timeout timer');

const FN_APPLY_COMMITS = Symbol('apply commits');
const APPLYING = Symbol();

const REFRESHING = Symbol();
const NOOP_COMMAND = Symbol('symbol used to represent a command for a placeholder log entry');


export default class RaftInterface extends Emitter {
    constructor(address) {
        super();
        timerMixin(this);

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

    join(address) {
        if (this.nodes.has(address)) throw new Error('Already have connection to that node');
        var inst = this.createInstance(address);
        this.nodes.set(address, inst);
        this.emit('join', address);
        if (this.nextIndices) {
            this.nextIndices.set(address, this.logIndex);
            this.matchIndices.set(address, this.minimumIndex);
        }
    }

    leave(address) {
        if (!this.nodes.has(address)) return;
        this.nodes.get(address).end();
        this.nodes.delete(address);
        this.emit('leave', address);
    }

    end() {
        this.nodes.forEach(node => node.end());
        this.clearAllTimeouts();
    }

    gotData(fromAddress, payload) {
        if (!this.nodes.has(fromAddress)) {
            this.emit('debug', `Got data for unrecognized address ${fromAddress}`);
            return;
        }
        this.nodes.get(fromAddress).gotData(payload);
    }

    propose(command) {
        if (this.state === STATE_LEADER) {
            return this.distributeAndCommit(command);
        }

        return new Promise((resolve, reject) => {
            var unlistener = this.listenOnce('state changed', () => {
                reject(new Error('State changed while waiting for leader'));
            });

            this.nodes.get(this.leaderID).rpc('Propose', command)
                .then(resolve, reject)
                .then(unlistener); // This one runs regardless because promises

        });
    }

    distributeAndCommit(command) {
        return new Promise((resolve, reject) => {
            var entry = new LogEntry(command, this.currentTerm);

            var logIndex = this.logIndex;
            var logTerm = this.logTerm;

            // The leader appends the command to its log as a new entry...
            this.log.push(entry);
            var newIndex = this.log.length - 1;

            // ... then issues AppendEntries RPCs in parallel to each of the
            // other servers to replicate the entry.
            this.nodes.forEach(n => {
                this.sendAppendEntries(n, logIndex).catch(reject); // Propagate client errors

                // TODO: Client errors probably shouldn't propagate, but the
                // spec doesn't give much direction here. One bad node could
                // just throw errors and completely wreck all persistence.
            });

            // Wait for the log to be replicated and applied
            var unlistener = this.listen('updated', index => {
                if (index < newIndex) return;
                unlistener();
                resolve();
            });

            // TODO: Listen for state changes and abort
        });
    }


    quorum(responses) {
        if (!this.nodes.size || !responses) return false;
        return responses >= this.majority;
    }

    get majority() {
        return Math.ceil(this.nodes.size / 2) + 1;
    }

    get logIndex() {
        if (!this.log.length) return -1;
        return this.log.length - 1;
    }
    get logTerm() {
        if (!this.log.length) return -1;
        return this.log[this.log.length - 1].term;
    }
    get state() {
        return this.innerState;
    }
    set state(newState) {
        if (newState === this.innerState) return;
        if (newState !== STATE_FOLLOWER &&
            newState !== STATE_CANDIDATE &&
            newState !== STATE_LEADER) {
            throw new Error('Unknown state');
        }

        this.innerState = newState;
        this.emit('state changed');
    }

    get isLeader() {
        return this.state === STATE_LEADER;
    }

    rpc(payload, sender) {
        var term = payload[1];
        var method = payload[3];
        if (!this.rpcHandlers.has(method)) {
            throw new Error('Method not accepted: ' + method);
        }
        return this.rpcHandlers.get(method)(...payload.slice(4), sender, term);
    }

    heartbeat() {
        var clear = name => {
            if (!this[name]) return;
            this.clearTimeout(this[name]);
            this[name] = null;
        };

        clear(TIMER_HEARTBEAT_TIMEOUT);

        if (this.state === STATE_CANDIDATE) {
            clear(TIMER_HEARTBEAT);
            return;
        }

        clear(TIMER_ELECTION);

        if (this.state === STATE_LEADER) {
            if (this[TIMER_HEARTBEAT]) return;
            this[TIMER_HEARTBEAT] = this.setTimeout(() => {
                this[TIMER_HEARTBEAT] = null;
                this.sendHeartbeat();
                this.heartbeat();
            }, this.heartbeatFrequency);
            return;
        }

        clear(TIMER_HEARTBEAT);
        this[TIMER_HEARTBEAT_TIMEOUT] = this.setTimeout(() => {
            this[TIMER_HEARTBEAT_TIMEOUT] = null;
            this.emit('heartbeat timeout');
            this.heartbeat();
        }, this.heartbeatTimeout);
    }

    sendHeartbeat() {
        this.nodes.forEach(n => {
            // If we've already sent an AppendEntries to this node recently,
            // don't flood them with needless spam. This helps prevent nodes
            // from dealing with multiple rounds of log replication all at
            // once.
            if (Date.now() - n.lastAppendEntries < 0.9 * this.heartbeatFrequency) return;

            this.sendAppendEntries(n);
        });
    }

    sendAppendEntries(node, prevLogIndex) {
        // Choose the index to update the follower from.
        var logIndex = Math.min(
            // If an index was specified, use that. Otherwise, use the latest
            // index.
            prevLogIndex || this.logIndex,
            // If the follower's known next index is lower than the one that
            // was passed, the RPC will fail unless we start from that point,
            // so use that value.
            this.nextIndices.get(node.address)
        );
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
        return new Promise((resolve, reject) => {
            var sendRPC = () => {
                node.lastAppendEntries = Date.now();
                return node.rpc(
                    'AppendEntries',
                    // prevLogIndex
                    logIndex,
                    // prevLogTerm
                    this.logEntryAt(logIndex) ? this.logEntryAt(logIndex).term : -1,
                    // entries
                    this.getEntrySlice(logIndex + 1),
                    // leaderCommit
                    this.commitIndex
                    // // minimumIndex
                    // this.minimumIndex
                );
            };

            var bindRPC = () => {
                rpcCall.then(success => {
                    if (success) return resolve();
                    if (this.state !== STATE_LEADER) return reject();

                    // If a follower’s log is inconsistent with the leader’s,
                    // the AppendEntries consistency check will fail in the
                    // next AppendEntries RPC.
                    //
                    // After a rejection, the leader decrements nextIndex and
                    // retries the AppendEntries RPC.
                    logIndex--;

                    if (logIndex < this.minimumIndex - 1) logIndex = this.minimumIndex - 1; // Set reasonable bounds
                    if (logIndex > this.logIndex) logIndex = this.logIndex;

                    this.nextIndices.set(node.address, logIndex);
                    rpcCall = sendRPC();
                    bindRPC();
                }, reject);
            };

            var rpcCall = sendRPC();
            bindRPC();

        }).then(() => {
            // When the AppendEntries call finally succeeds, we want to update
            // our list of indices.
            this.matchIndices.set(node.address, this.logIndex);
            this.emit('check replication and commit');
        }, Promise.reject.bind(Promise));
    }

    getEntrySlice(startIndex) {
        if (startIndex === -1) return this.log;
        return this.log.slice(startIndex + this.minimumIndex);
    }

    setCommitIndex(index) {
        this.emit('debug', 'Setting commit index: ' + index);
        this.commitIndex = index;

        this[FN_APPLY_COMMITS]();
    }

    [FN_APPLY_COMMITS]() {
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
        this.emit(
            'apply',
            this.logEntryAt(this.lastApplied + 1),
            this.lastApplied + 1,
            () => {
                this.emit('debug', 'commit successfully applied ' + (this.lastApplied + 1));
                this[APPLYING] = false;

                // *now* we update lastApplied.
                this.lastApplied++;
                var indexToEmit = this.lastApplied;

                // If there's more work to be done, run again. Otherwise
                // fire the callback.
                if (this.commitIndex > this.lastApplied) {
                    // We call ourselves, which creates a new promise, then
                    // make that one resolve/reject this one.
                    this[FN_APPLY_COMMITS]();
                }
                this.emit('updated', indexToEmit);
            }
        );
    }

    deleteLogAtAndAfter(index) {
        this.log = this.log.slice(0, index);
    }

    logEntryAt(index) {
        if (!this.log[index]) return null;
        return this.log[index];
    }

    // Stuff that can be overridden

    createInstance(address) {
        throw new Error('Raft instance factory not implemented');
    }

    get electionTimeout() {
        return Math.random() * 150 + 150;
    }

    get heartbeatFrequency() {
        return 100;
    }

    get heartbeatTimeout() {
        return 200 + Math.random() * 50;
    }

};


function bindRPC(raft) {
    raft.rpcHandlers.set('AppendEntries', (prevLogIndex, prevLogTerm, entries, leaderCommit, /* minimumIndex,*/ leaderID, term) => {
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
            return raft[REFRESHING] = new Promise(resolve => {
                // Emit `refresh` and wait for the callback. When it comes,
                // resolve with `false` to say that there was a failure. The
                // leader will try again and try to enunciate its words better.
                raft.emit('refresh', (term, index) => {
                    // TODO: set term and index
                    console.error('omg not implemented');

                    raft[REFRESHING] = null; // clean up
                    resolve(false); // `false` because we want the server to recognize that we failed.
                });
            });
        }


        // Reply false if log doesn’t contain an entry at prevLogIndex
        // whose term matches prevLogTerm (§5.3)
        else if (
            prevLogIndex !== -1 && // Ignore non-existant logs that don't exist
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
        entries.forEach((e, i) => {
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

            raft.log.push(LogEntry.from(e));
        });


        // If leaderCommit > commitIndex, set
        // commitIndex = min(leaderCommit, index of last new entry)
        if (leaderCommit > raft.commitIndex) {
            raft.setCommitIndex(
                Math.min(leaderCommit, prevLogIndex + entries.length)
            );
        }

        return true;
    });

    // The spec passes term and candidate ID as a param, but we already know it so we save the few bytes.
    raft.rpcHandlers.set('RequestVote', (/*term, candidateID,*/ lastLogIndex, lastLogTerm, candidateID, term) => {
        // Reply false if term < currentTerm (§5.1)
        if (term < raft.currentTerm) return false;

        // If votedFor is null or candidateId, and candidate’s log is at
        // least as up-to-date as receiver’s log, grant vote (§5.2, §5.4)
        if (raft.votedFor !== null && raft.votedFor !== candidateID) {
            return false;
        }
        if (lastLogIndex < raft.logIndex ||
            lastLogTerm < raft.logTerm) {
            return false;
        }

        raft.votedFor = candidateID;
        raft.heartbeat();
        return true;
    });

    raft.rpcHandlers.set('Propose', command => raft.distributeAndCommit(command));

}


function bindAll(raft) {

    raft.listen('term change', () => {
        // Reset our vote as we're starting a new term. Votes only last one term.
        raft.votedFor = null;
    });

    raft.listen('saw term', term => {
        // If RPC request or response contains term T > currentTerm:
        // set currentTerm = T, convert to follower (§5.1)
        if (term > raft.currentTerm) {
            raft.currentTerm = term;
            raft.state = STATE_FOLLOWER;
            raft.emit('term change');
        }
    });

    raft.listen('state changed', () => {
        raft.nextIndices = null;
        raft.matchIndices = null;
        raft.heartbeat();
        raft.emit({
            [STATE_FOLLOWER]: 'follower',
            [STATE_CANDIDATE]: 'candidate',
            [STATE_LEADER]: 'leader',
        }[raft.state]);
    });

    raft.listen('heartbeat timeout', () => {
        raft.emit('start election');
    });

    raft.listen('check replication and commit', () => {
        var valueMap = new Map(); // index -> [index, count]
        valueMap.set(raft.logIndex, [raft.logIndex, 1]);

        // Tally up each index that we know each follower is caught up to.
        raft.matchIndices.forEach(value => {
            if (value <= raft.commitIndex) return;

            var count = 1;
            if (valueMap.has(value)) {
                count = valueMap.get(value)[1] + 1;
            }

            valueMap.set(value, [value, count])

            // Increment all seen indices lower than the current one.
            for (var key of valueMap) {
                if (key < value) {
                    valueMap.set(key, [key, valueMap.get(key)[1] + 1]);
                }
            }
        });

        // Sort the indices by their count.
        var sorted = [];
        valueMap.forEach(v => sorted.push(v));
        sorted.sort((a, b) => a[1] - b[1]);
        var topIndex = raft.commitIndex;
        sorted.forEach(v => {
            var [index, count] = v;
            if (raft.quorum(count) && index > topIndex) {
                topIndex = index;
            }
        });
        if (topIndex > raft.logIndex) topIndex = raft.logIndex;
        if (topIndex === raft.commitIndex) return;
        raft.setCommitIndex(topIndex);
    });

    raft.listen('start election', newElection => {
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

        raft.nodes.forEach(n => {
            n.rpc(
                'RequestVote',
                // The following two are already known: the term is passed on
                // every request and the address is known from which socket the
                // message arrives on.
                    // raft.currentTerm,
                    // raft.address,
                raft.logIndex,
                raft.logTerm
            ).then(granted => {
                if (!electionOngoing || raft.state !== STATE_CANDIDATE) return;
                raft.emit('debug', `got vote ${granted} from ${n.address}`);
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
                for (let address of raft.nodes.keys()) {
                    raft.nextIndices.set(address, raft.logIndex + 1);
                    raft.matchIndices.set(address, raft.minimumIndex);
                }

                // Upon election: send initial empty AppendEntries RPCs
                // (heartbeat) to each server (§5.2)
                raft.sendHeartbeat();
                endElection();
            } else if (
                raft.quorum(votesDenied) ||
                !raft.quorum(votesReceived + (raft.nodes.size + 1 - votesDenied - votesReceived))
                ) {
                raft.emit('debug', `did not get elected leader: ${votesDenied}, ${votesReceived}`);
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

        raft[TIMER_ELECTION] = electionTimeout = raft.setTimeout(() => {
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
