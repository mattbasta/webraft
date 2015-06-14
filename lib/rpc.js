/**
 * Invoked by leader to replicate log entries
 * Also used as heartbeat
 * @param  {RaftInterface} ctx
 * @param  {int} term Leader's term
 * @param  {string} leaderId ID of the leader so followers can redirect clients
 * @param  {int} prevLogIndex Index of log entry immediately preceding new ones
 * @param  {int} prevLogTerm Term of previous log entry
 * @param  {LogEntry[]} entries Log entries to store, empty for heartbeat
 * @param  {int} leaderCommit Leader's commit index
 * @return {object} Object containing term and success (term: currentTerm for
 *                  leader to update itself, success: true if follower contained
 *                  entry matching prevLogIndex and prevLogTerm)
 */
export function appendEntries(ctx, term, leaderId, prevLogIndex, prevLogTerm, entries, leaderCommit) {
    if (term < ctx.state.currentTerm) {
        return {term: ctx.state.currentTerm, success: false};
    }

    var entryAtIndex = ctx.state.log[prevLogIndex];
    if (!entryAtIndex || entryAtIndex.term !== prevLogTerm) {

        if (entryAtIndex) {
            ctx.state.log = ctx.state.log.slice(0, prevLogIndex);
        }

        return {term: ctx.state.currentTerm, success: false};
    }

    entries.forEach((e, i) => {
        var presumedIndex = prevLogIndex + 1 + i;
        if (ctx.state.log[i]) {
            if (ctx.state.log[i].term === e.term) {
                return;
            }

            ctx.state.log = ctx.state.log.slice(0, presumedIndex);
        }

        ctx.state.log.push(e);
    });


    if (leaderCommit > ctx.state.commitIndex) {
        ctx.state.commitIndex = Math.min(leaderCommit, prevLogIndex + entries.length);
    }

};


/**
 * Invoked by candidates to gather votes
 * @param  {RaftInterface} ctx
 * @param  {int} term Candidate's term
 * @param  {string} term Candidate requesting vote
 * @param  {int} lastLogIndex Index of candidate's last log entry
 * @param  {int} lastLogTerm Term of candidate's last log entry
 * @return {object} Object containing term and voteGranted (term: candidate's
 *                  term, voteGranted: true means candidate received vote)
 */
export function requestVote(ctx, term, candidateId, lastLogIndex, lastLogTerm) {
    if (term < ctx.state.currentTerm) {
        return {term: ctx.state.currentTerm, voteGranted: false};
    }

    if ((ctx.state.votedFor === null || ctx.state.votedFor === candidateId) && lastLogIndex >= ctx.state.log.length - 1) {
        return {
            term: ctx.state.currentTerm,
            voteGranted:
                lastLogIndex !== ctx.state.log.length - 1 || ctx.state.log[ctx.state.log.length - 1].term === lastLogTerm,
        };
    }

    return {term: ctx.state.currentTerm, voteGranted: false};
};
