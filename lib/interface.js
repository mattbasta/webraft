import Emitter from './emitter';
import LogEntry from './LogEntry';


const STATE_FOLLOWER = Symbol('follower');
const STATE_CANDIDATE = Symbol('candidate');
const STATE_LEADER = Symbol('leader');

const TIMER_ELECTION = Symbol('election timer');
const TIMER_HEARTBEAT = Symbol('heartbeat timer');
const TIMER_HEARTBEAT_TIMEOUT = Symbol('heartbeat timeout timer');

const FN_APPLY_COMMITS = Symbol('apply commits');
const APPLYING = Symbol();


export default class RaftInterface extends Emitter {
    constructor(address) {
        super();

        this.address = address || Math.random().toString() + '::' + Date.now().toString();
        this.nodes = new Map();
        this.rpcHandlers = new Map();

        this.currentTerm = 0;
        this.leaderID = null;


        this.votedFor = null;

        this.log = [];

        this.commitIndex = 0;
        this.lastApplied = 0;

        // Leader state
        this.nextIndex = [];
        this.matchIndex = [];

        this.innerState = STATE_FOLLOWER;

        bindAll(this);
        bindRPC(this);

        this.heartbeat();
    }

    join(address) {
        var inst = this.createInstance(address);
        this.nodes.set(address, inst);
        this.emit('join', address);
    }

    leave(address) {
        if (!this.nodes.has(address)) return;
        this.nodes.delete(address);
        this.emit('leave', address);
    }

    gotData(fromAddress, payload) {
        if (!this.nodes.has(fromAddress)) throw new Error('Got data for unrecognized address');
        this.nodes.get(fromAddress).gotData(payload);
    }

    propose(command) {
        if (this.state === STATE_LEADER) {
            return distributeAndCommit(command);
        }

        var me = this;
        return new Promise((resolve, reject) => {
            this.listen('state change', stateChange);

            this.nodes.get(this.leaderID).rpc('Propose', command)
                .then(resolve, reject)
                .then(() => this.unlisten('state change', stateChange));

            function stateChange() {
                me.unlisten('state change', stateChange);
                reject(new Error('State changed while waiting for leader'));
            }
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
            var appliedCount = 1; // me
            this.nodes.forEach(n => {
                n.sendAppendEntries(n, [entry], logIndex, logTerm).then(() => {
                    appliedCount += 1;
                    // When the entry has been safely replicated, the leader
                    // applies the entry to its state machine and returns the
                    // result of that execution to the client.
                    if (this.quorum(appliedCount)) {
                        this.setCommitIndex(newIndex).then(resolve);
                    }
                }, reject); // Propagate client errors

                // TODO: Client errors probably shouldn't propagate, but the
                // spec doesn't give much direction here. One bad node could
                // just throw errors and completely wreck all persistence.
            });
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

    rpc(payload) {
        if (!this.rpcHandlers.has(payload.method)) {
            throw new Error('Method not accepted: ' + payload.method);
        }
        this.sawTerm(payload.term);
        return this.rpcHandlers.get(payload.method)(...payload.args);
    }

    heartbeat() {
        if (this.state === STATE_CANDIDATE) {
            if (this[TIMER_HEARTBEAT_TIMEOUT]) {
                clearTimeout(this[TIMER_HEARTBEAT_TIMEOUT]);
                this[TIMER_HEARTBEAT_TIMEOUT] = null;
            }
            if (this[TIMER_HEARTBEAT]) {
                clearTimeout(this[TIMER_HEARTBEAT]);
                this[TIMER_HEARTBEAT] = null;
            }
            return;
        }

        if (this[TIMER_ELECTION]) {
            clearTimeout(this[TIMER_ELECTION]);
            this[TIMER_ELECTION] = null;
        }

        if (this[TIMER_HEARTBEAT_TIMEOUT]) {
            clearTimeout(this[TIMER_HEARTBEAT_TIMEOUT]);
            this[TIMER_HEARTBEAT_TIMEOUT] = null;
        }

        if (this.state === STATE_LEADER) {
            if (this[TIMER_HEARTBEAT]) return;
            this[TIMER_HEARTBEAT] = setTimeout(() => {
                this[TIMER_HEARTBEAT] = null;
                this.sendHeartbeat();
                this.heartbeat();
            }, this.heartbeatFrequency);
        } else {
            if (this[TIMER_HEARTBEAT]) {
                clearTimeout(this[TIMER_HEARTBEAT]);
                this[TIMER_HEARTBEAT] = null;
            }
            this[TIMER_HEARTBEAT_TIMEOUT] = setTimeout(() => {
                this[TIMER_HEARTBEAT_TIMEOUT] = null;
                this.emit('heartbeat timeout');
                this.heartbeat();
            }, this.heartbeatTimeout);
        }
    }

    sendHeartbeat() {
        this.nodes.forEach(n => this.sendAppendEntries(n, []));
    }

    sendAppendEntries(node, entries, prevLogIndex, prevLogTerm) {
        var logIndex = prevLogIndex || this.logIndex;
        var logTerm = prevLogTerm || this.logTerm;

        // TODO: Should there be some sort of locking to prevent new entries
        // from being appended while old ones are being retried?
        //
        // The spec is fine without this, but it means if a node is already
        // behind/failing/crashing/etc., all subsequent AppendEntries will
        // only fail anyway and get retried. Having only one AppendEntries
        // chugging along at a time will prevent nodes in a less-than-ideal
        // state from getting even more less-than-idea until they catch up.
        return new Promise((resolve, reject) => {
            var sendRPC = () => node.rpc('AppendEntries', {
                term: this.currentTerm,
                leaderID: this.leaderID,
                prevLogIndex: logIndex,
                prevLogTerm: logTerm,
                entries: [],
                leaderCommit: this.commitIndex,
            });

            var rpcCall = sendRPC();
            bindRPC();

            function bindRPC() {
                rpcCall.then(success => {
                    if (success) return resolve();

                    rpcCall = sendRPC();
                    bindRPC();
                }, reject);
            }
        });
    }


    sawTerm(term) {
        // If RPC request or response contains term T > currentTerm:
        // set currentTerm = T, convert to follower (§5.1)
        if (term > this.currentTerm) {
            this.currentTerm = term;
            this.state = STATE_FOLLOWER;
        }
    }
    setCommitIndex(index, cb) {
        cb = cb || () => {};
        this.commitIndex = index;

        this[FN_APPLY_COMMITS]().then(cb);
    }

    [FN_APPLY_COMMITS]() {
        if (this[APPLYING]) {
            return this[APPLYING];
        }
        return this[APPLYING] = new Promise(resolve => {
            // If commitIndex > lastApplied: increment lastApplied, apply
            // log[lastApplied] to state machine (§5.3)
            if (this.commitIndex <= this.lastApplied) {
                resolve();
                return;
            }


            // We do this a bit differently to prevent data loss. We apply the
            // log entry at the prescribed index, but we don't increment
            // lastApplied until we are sure that the entry was properly persisted.
            // If we followed the spec to the letter, a database error could lead
            // to "committed" data never ending up in persistent storage.
            this.emit(
                'apply',
                this.logEntryAt(this.lastApplied + 1),
                () => {
                    this[APPLYING] = null;

                    // *now* we update lastApplied.
                    this.lastApplied++;
                    this.emit('updated', this.lastApplied);

                    // If there's more work to be done, run again. Otherwise
                    // fire the callback.
                    if (this.commitIndex > this.lastApplied) {
                        // We call ourselves, which creates a new promise, then
                        // make that one resolve/reject this one.
                        this[FN_APPLY_COMMITS]().then(resolve);
                    } else {
                        resolve();
                    }
                }
            );

        });

    }

    deleteLogAtAndAfter(index) {
        this.log = this.log.slice(0, index);
    }

    logEntryAt(index) {
        return this.log[index];
    }

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
        return 200;
    }

};


function bindRPC(raft) {
    raft.rpcHandlers.set('AppendEntries', args => {
        if (args.leaderID) {
            raft.leaderID = args.leaderID;
        }

        if (raft.state === STATE_CANDIDATE) {
            raft.state = STATE_FOLLOWER;
        }

        if (raft.state === STATE_LEADER) {
            // This is just crazy. Panic!
            return false;
        }

        // Make sure that followers count any AppendEntries call as a heartbeat.
        raft.heartbeat();

        var response = true;

        // Reply false if term < currentTerm (§5.1)
        if (args.term < raft.term) {
            response = false;
        }

        // Reply false if log doesn’t contain an entry at prevLogIndex
        // whose term matches prevLogTerm (§5.3)
        else if (!raft.log[args.prevLogIndex] || raft.log[args.prevLogIndex].term !== args.prevLogTerm) {
            response = false;
        }

        // If an existing entry conflicts with a new one (same index
        // but different terms), delete the existing entry and all that
        // follow it (§5.3)
        var entryAtIndex = raft.logEntryAt(args.prevLogIndex);
        if (entryAtIndex && entryAtIndex.term !== args.prevLogTerm) {
            raft.deleteLogAtAndAfter(args.prevLogIndex);
            response = false;
        }

        // Append any new entries not already in the log
        entries.forEach((e, i) => {
            var presumedIndex = args.prevLogIndex + 1 + i;
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
        if (args.leaderCommit > raft.commitIndex) {
            raft.setCommitIndex(
                Math.min(args.leaderCommit, args.prevLogIndex + entries.length)
            );
        }

        return response;
    });

    raft.rpcHandlers.set('RequestVote', (term, candidateID, lastLogIndex, lastLogTerm) => {
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

    raft.rpcHandlers.set('Propose', command => {
        return raft.distributeAndCommit(command);
    });

}


function bindAll(raft) {

    raft.listen('term change', () => {
        // Reset our vote as we're starting a new term. Votes only last one term.
        raft.votedFor = null;
    });

    raft.listen('state change', state => {
        if (raft[TIMER_ELECTION]) {
            clearTimeout(raft[TIMER_ELECTION]);
            raft[TIMER_ELECTION] = null;
        }
        raft.heartbeat();
        raft.emit({
            [STATE_FOLLOWER]: 'follower',
            [STATE_CANDIDATE]: 'candidate',
            [STATE_LEADER]: 'leader',
        }[state]);
    });

    raft.listen('heartbeat timeout', () => {
        raft.emit('start election');
    });

    raft.listen('start election', () => {
        raft.currentTerm++;
        raft.leaderID = null;
        raft.votedFor = raft.address;
        raft.state = STATE_CANDIDATE;

        var votesReceived = 1; // me!
        var votesDenied = 0;
        var electionOngoing = true;
        var electionTimeout;

        raft.nodes.forEach(n => {
            n.rpc(
                'RequestVote',
                raft.currentTerm,
                raft.address,
                raft.logIndex,
                raft.logTerm
            ).then(granted => {
                if (!electionOngoing || raft.state !== STATE_CANDIDATE) return;
                if (granted) {
                    votesReceived++;
                } else {
                    votesDenied++;
                }
                gotVote();
            });
        });


        function gotVote() {
            if (!electionOngoing) return;

            if (raft.quorum(votesReceived)) {
                raft.leaderID = raft.address;
                raft.state = STATE_LEADER;

                // Upon election: send initial empty AppendEntries RPCs
                // (heartbeat) to each server (§5.2)
                raft.sendHeartbeat();
                endElection();
            } else if (raft.quorum(votesDenied)) {
                // This isn't covered by the spec, but it's worth doing.
                // If the candidate has received a quorum of negative votes,
                // become a follower.
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

        electionTimeout = setTimeout(() => {
            var origElectionOngoing = electionOngoing;
            endElection();
            if (origElectionOngoing) {
                raft.emit('start election');
            }
        }, raft.electionTimeout);

        function endElection() {
            if (!electionOngoing) return;
            clearTimeout(electionTimeout);
            electionOngoing = false;
        }

    });

}
