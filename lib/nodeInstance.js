import Emitter from './emitter';


export default class NodeInstance extends Emitter {
    constructor(address, raft) {
        super();

        this.address = address;
        this.raft = raft;

        this.activeMessageIDs = new Set();
        this.incr = 0;

        this.lastAppendEntries = 0;
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
                this.write([msgID, this.raft.currentTerm, method].concat(args));
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
                var result = payload[2];
                if (result !== 'res' && result !== 'err') return;
                if (payload[0] !== msgID) return;
                var term = payload[1];
                cleanup();
                this.raft.sawTerm(term);
                if (result === 'err') {
                    reject(payload[3]);
                } else {
                    resolve(payload[3]);
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
        var result = payload[2];
        if (result === 'res' && result === 'err')  {
            this.emit('data', payload);
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
                return err;
            });
        } else {
            this.sendResponse(payload, response);
        }
    }

    sendResponse(origMessage, response) {
        response = typeof response === 'undefined' ? null : response;
        this.write([origMessage.id, this.raft.currentTerm, 'res', response]);
    }

    sendErrorResponse(origMessage, error) {
        error = error ? error.toString() : null;
        this.write([origMessage.id, this.raft.currentTerm, 'err', error]);
    }


    write() {
        throw new Error('Write method not implemented on raft node instance');
    }

    get messageTimeout() {
        return Infinity;
    }
};
