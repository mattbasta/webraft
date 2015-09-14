import Emitter from './emitter';


export default class NodeInstance extends Emitter {
    constructor(address, raft) {
        super();

        this.address = address;
        this.raft = raft;

        this.activeMessageIDs = new Set();
        this.incr = 0;
    }

    rpc(method, ...args) {
        return new Promise((resolve, reject) => {
            var msgID = this.incr++;
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
                    req: [method].concat(args),
                    id: msgID,

                    term: this.raft.currentTerm,
                });
            } catch (e) {
                cleanup();
                return reject(e);
            }
            disconnectCB = machineID => {
                if (machineID !== this.address) return;
                cleanup();
                reject(new Error('client left'));
            };
            cb = payload => {
                if (!payload.res) return;
                if (payload.id !== msgID) return;
                cleanup();
                this.raft.sawTerm(payload.term);
                if (payload.error) {
                    reject(payload.error);
                } else {
                    resolve(payload.payload);
                }
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
            response.then(response => {
                this.sendResponse(payload, response);
            }, err => {
                this.sendErrorResponse(payload, err);
                console.error(err);
            });
        } else {
            this.sendResponse(payload, response);
        }
    }

    sendResponse(origMessage, response) {
        this.write({
            id: origMessage.id,
            res: response || null,

            term: this.raft.currentTerm,
        });
    }

    sendErrorResponse(origMessage, error) {
        this.write({
            id: origMessage.id,
            err: error ? error.toString() : null,

            term: this.raft.currentTerm,
        });
    }


    write() {
        throw new Error('Write method not implemented on raft node instance');
    }

    get messageTimeout() {
        return Infinity;
    }
};
