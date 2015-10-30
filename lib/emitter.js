export default class Emitter {
    constructor() {
        this.listeners = new Map();
    }

    emit(type, ...args) {
        if (!this.listeners.has(type)) return;
        this.listeners.get(type).forEach(h => h(...args));
    }

    listen(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(handler);

        return () => {
            this.unlisten(type, handler);
        };
    }

    listenOnce(type, handler) {
        var unlistener = this.listen(type, function(...args) {
            unlistener();
            handler(...args);
        });
        return unlistener;
    }

    unlisten(type, handler) {
        if (!this.listeners.has(type)) return;
        this.listeners.get(type).delete(handler);
    }

};
