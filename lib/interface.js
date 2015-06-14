import State from './state';


export default class RaftInterface {
    constructor() {
        this.clientId = (Math.random() * 1000000).toString();
        this.listeners = new Set();

        this.state = new State();
        this.timeout = 5000;
    }

    pipeToConnection(cb) {
        this.listeners.add(cb);
    }

    _writeToConnections(message) {
        this.listeners.forEach(L => L(message));
    }

    ingest(message) {}

    command(payload) {}


};
