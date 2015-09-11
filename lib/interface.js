import Emitter from './emitter';


const STATE_FOLLOWER = Symbol('follower');
const STATE_CANDIDATE = Symbol('candidate');
const STATE_LEADER = Symbol('leader');

const TIMER_ELECTION = Symbol('election timer');
const TIMER_HEARTBEAT = Symbol('heartbeat timer');
const TIMER_HEARTBEAT_TIMEOUT = Symbol('heartbeat timeout timer');


export default class RaftInterface extends Emitter {
    constructor() {
        super();

        this.clientId = Math.random().toString() + '::' + Date.now().toString();
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
        this.nodes.forEach(n => {
            n.rpc('AppendEntries', {
                term: this.currentTerm,
                leaderID: this.leaderID,
                prevLogIndex: this.logIndex,
                prevLogTerm: this.logTerm,
                entries: [],
                leaderCommit: this.commitIndex,
            }).then(this._appendEntriesResponse.bind(this));
        });
    }

    _appendEntriesResponse(resp) {
        //
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

        // If commitIndex > lastApplied: increment lastApplied, apply
        // log[lastApplied] to state machine (§5.3)
        if (index > this.lastApplied) {
            this.lastApplied++;
            this.emit('apply', this.logEntryAt(this.lastApplied), cb);
        }
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
        return 100;
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

        // Append any new entries not already in the log

        // If leaderCommit > commitIndex, set
        // commitIndex = min(leaderCommit, index of last new entry)
        if (args.leaderCommit > raft.commitIndex) {
            raft.setCommitIndex(args.leaderCommit);
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
            if (raft.quorum(votesReceived)) {
                raft.leaderID = raft.address;
                raft.state = STATE_LEADER;

                // Upon election: send initial empty AppendEntries RPCs
                // (heartbeat) to each server (§5.2)
                raft.sendHeartbeat();
                endElection();
            } else if (raft.quorum(votesDenied)) {
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
