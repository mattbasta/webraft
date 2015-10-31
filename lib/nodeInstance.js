import Emitter from './emitter';
import timerMixin from './timers';


export default class NodeInstance extends Emitter {
    constructor(address, raft) {
        super();
        timerMixin(this);

        this.address = address;
        this.raft = raft;

        this.activeMessageIDs = new Set();
        this.incr = 0;

        this.lastAppendEntries = 0;
    }

    end() {
        this.clearAllTimeouts();
    }

    rpc(method, ...args) {
        return new Promise((resolve, reject) => {
            var msgID = this.incr++;
            var timeout = null;

            var dataUnlistener;
            var leaveUnlistener;

            var cleanup = () => {
                this.clearTimeout(timeout);
                this.activeMessageIDs.delete(msgID);
                dataUnlistener();
                leaveUnlistener();
            };

            this.activeMessageIDs.add(msgID);
            try {
                this.write([msgID, this.raft.currentTerm, 'req', method].concat(args));
            } catch (e) {
                cleanup();
                return reject(e);
            }

            dataUnlistener = this.listen('data', payload => {
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
            });
            leaveUnlistener = this.raft.listen('leave', machineID => {
                if (machineID !== this.address) return;
                cleanup();
                reject(new Error('client left'));
            });

            if (this.messageTimeout < Infinity) {
                timeout = this.setTimeout(() => {
                    cleanup();
                    reject(new Error('timeout'));
                }, this.messageTimeout);
            }
        });

    }

    gotData(payload) {
        var result = payload[2];
        if (result === 'res' || result === 'err')  {
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
                return err; // to allow internal error reporting
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
