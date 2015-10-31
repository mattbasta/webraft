import * as assert from 'assert';

import timerMixin from '../lib/timers';


describe('Timers', () => {

    var foo;

    beforeEach(() => {
        timerMixin(foo = {});
    });

    it('should allow timers to be set', done => {
        foo.setTimeout(done, 0);
    });

    it('should allow timers to be cleared', () => {
        var timer = foo.setTimeout(() => {
            throw new Error('sanity');
        }, 0);
        foo.clearTimeout(timer);
    });

    it('should allow all timers to be cleared', () => {
        foo.setTimeout(() => {
            throw new Error('sanity');
        }, 0);
        foo.setTimeout(() => {
            throw new Error('sanity');
        }, 0);
        foo.clearAllTimeouts();
    });

});
