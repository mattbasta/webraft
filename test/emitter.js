import * as assert from 'assert';

import Emitter from '../lib/emitter';


describe('Emitter', () => {

    var em;

    beforeEach(() => {
        em = new Emitter();
    });

    it('should emit events', done => {
        em.listen('foo', done);
        em.listen('bar', () => {
            throw new Error('sanity');
        });
        em.emit('foo');
    });

    it('should preserve args', done => {
        em.listen('foo', (x, y, z) => {
            assert.equal(x, 1);
            assert.equal(y, 2);
            assert.equal(z, 3);
            done();
        });
        em.emit('foo', 1, 2, 3);
    });

    it('should allow listeners to be unbound', () => {
        var unlistener = em.listen('foo', () => {
            throw new Error('sanity');
        });
        unlistener();
        em.emit('foo');
    });

    it('should allow listeners to be manually unbound', () => {
        var cb = () => {
            throw new Error('sanity');
        };
        em.listen('foo', cb);
        em.unlisten('foo', cb);
        em.emit('foo');
    });

    it('should allow listeners to be listened for once', () => {
        var called = 0;
        em.listenOnce('foo', () => {
            called++;
        });
        em.emit('foo');
        em.emit('foo');
        assert.equal(called, 1);
    });

    it('should allow once listeners to be unbound', () => {
        var unlistener = em.listenOnce('foo', () => {
            throw new Error('sanity');
        });
        unlistener();
        em.emit('foo');
    });

});
