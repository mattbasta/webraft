export default function timerMixin(base) {
    var timers = new Set();

    base.setTimeout = function(timer, ...args) {
        var timeout = setTimeout(function() {
            timers.delete(timeout);
            timer(...args);
        });
        timers.add(timeout);
        return timeout;
    };

    base.clearTimeout = function(ref) {
        if (timers.has(ref)) timers.delete(ref);
        return clearTimeout(ref);
    };

    base.clearAllTimeouts = function() {
        this.timers.forEach(ref => clearTimeout(ref));
        this.timers.clear();
    };
};
