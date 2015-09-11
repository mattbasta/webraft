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

        this.term = 0;
        this.leaderID = null;


        this.votedFor = null;
        this.votesReceived = 0;

        this.log = [];

        this.commitIndex = 0;
        this.lastApplied = 0;

        // Leader state
        this.nextIndex = [];
        this.matchIndex = [];

        this.state = STATE_FOLLOWER;

        bindAll(this);
        bindRPC(this);
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

    rpc(payload) {
        if (!this.rpcHandlers.has(payload.method)) {
            throw new Error('Method not accepted: ' + payload.method);
        }
        return this.rpcHandlers.get(payload.method)(...payload.args);
    }

    heartbeat() {
        if (this.state === STATE_LEADER) {
            if (this[TIMER_HEARTBEAT]) return;
            if (this[TIMER_HEARTBEAT_TIMEOUT]) {
                clearTimeout(this[TIMER_HEARTBEAT_TIMEOUT]);
                this[TIMER_HEARTBEAT_TIMEOUT] = null;
            }
            this[TIMER_HEARTBEAT] = setTimeout(() => {
                this[TIMER_HEARTBEAT] = null;
                this.sendHeartbeat();
                this.heartbeat();
            }, this.heartbeatFrequency);
        } else {
            if (this[TIMER_HEARTBEAT_TIMEOUT]) return;
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
                term: this.term,
                leaderID: this.leaderID,
                prevLogIndex: this.logIndex,
                prevLogTerm: this.logTerm,
                entries: [],
                leaderCommit: this.commitIndex,
            }).then();
        });
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
        var response = {success: true, term: raft.term};

        // Reply false if term < currentTerm (§5.1)
        if (args.term < raft.term) {
            response = {success: false, term: raft.term};
        }

        // Reply false if log doesn’t contain an entry at prevLogIndex
        // whose term matches prevLogTerm (§5.3)
        else if (!raft.log[args.prevLogIndex] || raft.log[args.prevLogIndex].term !== args.prevLogTerm) {
            response = {success: false, term: raft.term};
        }

        // If an existing entry conflicts with a new one (same index
        // but different terms), delete the existing entry and all that
        // follow it (§5.3)


        // Append any new entries not already in the log

        // If leaderCommit > commitIndex, set commitIndex =
        // min(leaderCommit, index of last new entry)
    });
}


function bindAll(raft) {

    //
    // Reset our vote as we're starting a new term. Votes only last one term.
    //
    raft.listen('term change', () => {
        raft.votedFor = null;
        raft.votesReceived = 0;
    });

    raft.listen('state change', state => {
        if (raft[TIMER_ELECTION])
        raft.heartbeat();
        raft.emit({
            [STATE_FOLLOWER]: 'follower',
            [STATE_CANDIDATE]: 'candidate',
            [STATE_LEADER]: 'leader',
        }[state]);
    });

//
// Reset our times and start the heartbeat again. If we're promoted to leader
// the heartbeat will automatically be broadcasted to users as well.
//
raft.on('state change', function change(state) {
raft.timers.clear('heartbeat, election');
raft.heartbeat(Raft.LEADER === raft.state ? raft.beat : raft.timeout());
raft.emit(Raft.states[state].toLowerCase());
});

//
// Receive incoming messages and process them.
//
raft.on('data', function incoming(packet, write) {
write = write || nope;
var reason;

if ('object' !== raft.type(packet)) {
reason = 'Invalid packet received';
raft.emit('error', new Error(reason));

return write(raft.packet('error', reason));
}

//
// Raft §5.1:
//
// Applies to all states. If a response contains a higher term then our
// current term need to change our state to FOLLOWER and set the received
// term.
//
// If the raft receives a request with a stale term number it should be
// rejected.
//
if (packet.term > raft.term) {
raft.change({
leader: Raft.LEADER === packet.state ? packet.address : packet.leader || raft.leader,
state: Raft.FOLLOWER,
term: packet.term
});
} else if (packet.term < raft.term) {
reason = 'Stale term detected, received `'+ packet.term +'` we are at '+ raft.term;
raft.emit('error', new Error(reason));

return write(raft.packet('error', reason));
}

//
// Raft §5.2:
//
// If we receive a message from someone who claims to be leader and shares
// our same term while we're in candidate mode we will recognize their
// leadership and return as follower.
//
// If we got this far we already know that our terms are the same as it
// would be changed or prevented above..
//
if (Raft.LEADER === packet.state) {
if (Raft.FOLLOWER !== raft.state) raft.change({ state: Raft.FOLLOWER });
if (packet.address !== raft.leader) raft.change({ leader: packet.address });

//
// Always when we receive an message from the Leader we need to reset our
// heartbeat.
//
raft.heartbeat(raft.timeout());
}

switch (packet.type) {
//
// Raft §5.2:
// Raft §5.4:
//
// A raft asked us to vote on them. We can only vote to them if they
// represent a higher term (and last log term, last log index).
//
case 'vote':
//
// The term of the vote is bigger then ours so we need to update it. If
// it's the same and we already voted, we need to deny the vote.
//
if (raft.votes.for && raft.votes.for !== packet.address) {
raft.emit('vote', packet, false);

return write(raft.packet('voted', { granted: false }));
}

//
// If we maintain a log, check if the candidates log is as up to date as
// ours.
//
// @TODO point to index of last commit entry.
// @TODO point to term of last commit entry.
//
if (raft.log && packet.last && (
raft.log.index > packet.last.index
|| raft.term > packet.last.term
)) {
raft.emit('vote', packet, false);

return write(raft.packet('voted', { granted: false }));
}

//
// We've made our decision, we haven't voted for this term yet and this
// candidate came in first so it gets our vote as all requirements are
// met.
//
raft.votes.for = packet.address;
raft.emit('vote', packet, true);
raft.change({ leader: packet.address, term: packet.term });
write(raft.packet('voted', { granted: true }));

//
// We've accepted someone as potential new leader, so we should reset
// our heartbeat to prevent this raft from timing out after voting.
// Which would again increment the term causing us to be next CANDIDATE
// and invalidates the request we just got, so that's silly willy.
//
raft.heartbeat(raft.timeout());
break;

//
// A new incoming vote.
//
case 'voted':
//
// Only accepts votes while we're still in a CANDIDATE state.
//
if (Raft.CANDIDATE !== raft.state) {
return write(raft.packet('error', 'No longer a candidate, ignoring vote'));
}

//
// Increment our received votes when our voting request has been
// granted by the raft that received the data.
//
if (packet.data.granted) {
raft.votes.granted++;
}

//
// Check if we've received the minimal amount of votes required for this
// current voting round to be considered valid.
//
if (raft.quorum(raft.votes.granted)) {
raft.change({ leader: raft.address, state: Raft.LEADER });

//
// Send a heartbeat message to all connected clients.
//
raft.message(Raft.FOLLOWER, raft.packet('append'));
}

//
// Empty write, nothing to do.
//
write();
break;

case 'error':
raft.emit('error', new Error(packet.data));
break;

//
// Remark: Are we assuming we are getting an appendEntries from the
// leader and comparing and appending our log?
//
case 'append':
break;

//
// Remark: So does this get emit when we need to write our OWN log?
//
case 'log':
break;

//
// RPC command
//
case 'exec':
break;

//
// Unknown event, we have no idea how to process this so we're going to
// return an error.
//
default:
if (raft.listeners('rpc').length) {
raft.emit('rpc', packet, write);
} else {
write(raft.packet('error', 'Unknown message type: '+ packet.type));
}
}
});

//
// We do not need to execute the rest of the functionality below as we're
// currently running as "child" raft of the cluster not as the "root" raft.
//
if (Raft.CHILD === raft.state) return raft.emit('initialize');

//
// Setup the log & appends. Assume that if we're given a function log that it
// needs to be initialized as it requires access to our raft instance so it
// can read our information like our leader, state, term etc.
//
if ('function' === raft.type(raft.Log)) {
raft.log = new raft.Log(raft, options);
}

/**
* The raft is now listening to events so we can start our heartbeat timeout.
* So that if we don't hear anything from a leader we can promote our selfs to
* a candidate state.
*
* Start listening listening for heartbeats when implementors are also ready
* with setting up their code.
*
* @api private
*/
function initialize(err) {
if (err) return raft.emit('error', err);

raft.emit('initialize');
raft.heartbeat(raft.timeout());
}

if ('function' === raft.type(raft.initialize)) {
if (raft.initialize.length === 2) return raft.initialize(options, initialize);
raft.initialize(options);
}

initialize();
}
