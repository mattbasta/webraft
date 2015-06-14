
export default class State {
    constructor() {
        this.currentTerm = 0;
        this.votedFor = null;
        this.log = [];

        this.commitIndex = 0;
        this.lastApplied = 0;

        // Leader state
        this.nextIndex = [];
        this.matchIndex = [];
    }
};
