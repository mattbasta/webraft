import Emitter from './emitter';


export default class NodeInstance extends Emitter {
    constructor(address, raft) {
        super();

        this.address = address;
        this.raft = raft;

        this.activeMessageIDs = new Set();
    }

    rpc(method, ...args) {
        return new Promise((resolve, reject) => {
            var msgID = Date.now().toString() + ':' + Math.random().toString();
            var cb;
            var disconnectCB;
            var timeout = null;

            var cleanup = () => {
                this.activeMessageIDs.delete(msgID);
                this.unlisten('data', cb);
                this.raft.unlisten('leave', disconnectCB);
            };

            this.activeMessageIDs.add(msgID);
            try {
                this.write({
                    type: 'req',
                    replyID: msgID,
                    method: method,
                    args: args,

                    term: this.raft.currentTerm,
                });
            } catch (e) {
                return reject(e);
            }
            disconnectCB = machineID => {
                if (machineID !== this.address) return;
                cleanup();
                reject(new Error('client left'));
            };
            cb = payload => {
                if (payload.type !== 'res') return;
                if (payload.replyID !== msgID) return;
                cleanup();
                this.raft.sawTerm(payload.term);
                resolve(payload.payload);
            };
            this.listen('data', cb);
            this.raft.listen('leave', disconnectCB);

            if (this.messageTimeout < Infinity) {
                timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('timeout'));
                }, this.messageTimeout);
            }
        });

    }

    gotData(payload) {
        if (payload.type === 'req') {
            let response = this.raft.rpc(payload);
            this.write({
                type: 'res',
                replyID: payload.replyID,
                payload: response,

                term: this.raft.currentTerm,
            });
        } else {
            this.emit('data', payload, this.address);
        }
    }


    write() {
        throw new Error('Write method not implemented on raft node instance');
    }

    get messageTimeout() {
        return Infinity;
    }
};
