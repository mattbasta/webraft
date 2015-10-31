import * as assert from 'assert';

import * as sinon from 'sinon';

import NodeInstance from '../lib/nodeInstance';


describe('Node Instances', () => {

    var raft;
    var foo;
    var sandbox;

    var timeout;

    class FooInstance extends NodeInstance {
        get messageTimeout() {
            return timeout;
        }
    }

    beforeEach(() => {
        timeout = Infinity;
        raft = {
            listen: () => () => {},
            sawTerm: () => {},
            rpc: () => {},
        };
        foo = new FooInstance('address', raft);
        sandbox = sinon.sandbox.create();
    });

    afterEach(() => {
        sandbox.verifyAndRestore();
    });

    it('should implement basic RPC', done => {
        raft.currentTerm = 123;

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();
        sandbox.mock(raft)
            .expects('sawTerm')
            .withArgs(456)
            .once();

        foo.rpc('method', 'x', 'y').then(done);

        foo.gotData([0, 456, 'res', null]);
    });

    it('should implement basic RPC return values', done => {
        raft.currentTerm = 123;

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();
        sandbox.mock(raft)
            .expects('sawTerm')
            .withArgs(456)
            .once();

        foo.rpc('method', 'x', 'y').then(val => {
            assert.equal(val, 'foo');
            done();
        });

        foo.gotData([0, 456, 'res', 'foo']);
    });

    it('should implement basic RPC error handling', done => {
        raft.currentTerm = 123;

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();
        sandbox.mock(raft)
            .expects('sawTerm')
            .withArgs(456)
            .once();

        foo.rpc('method', 'x', 'y').then(null, err => {
            assert.equal(err, 'foo');
            done();
        });

        foo.gotData([0, 456, 'err', 'foo']);
    });

    it('should ignore RPC messages with unknown IDs', done => {
        raft.currentTerm = 123;

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();
        sandbox.mock(raft)
            .expects('sawTerm')
            .withArgs(456)
            .once();

        foo.rpc('method', 'x', 'y').then(done);

        // some random term to indicate that we got it right
        foo.gotData([1, 987, 'res', null]);
        foo.gotData([0, 456, 'res', null]);
    });

    it('should cancel the rpc if the remote node leaves', done => {
        raft.currentTerm = 123;
        var listener;
        raft.listen = (type, cb) => {
            if (type !== 'leave') return () => {};
            listener = cb;
            return sandbox.mock().once();
        };

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();

        foo.rpc('method', 'x', 'y').then(null, () => done());
        listener('address');
    });

    it('should allow timeouts', done => {
        timeout = 100;
        raft.currentTerm = 123;

        foo.setTimeout = (handler, timeout) => {
            assert.equal(timeout, 100);
            setImmediate(handler);
        };

        sandbox.mock(foo)
            .expects('write')
            .withArgs([0, 123, 'req', 'method', 'x', 'y'])
            .once();

        foo.rpc('method', 'x', 'y').then(sandbox.mock().never(), () => done());

    });

    // The following is commented out because `new Error()` causes test failures in node 0.12.7

    // it('should respond with an error if there is an error calling the method', () => {
    //     var payload = [0, 123, 'req', 'method'];
    //     var err = new Error();
    //     sandbox.mock(raft).expects('rpc').withArgs(payload, 'address').throws(err);
    //     sandbox.mock(foo).expects('sendErrorResponse').withArgs(payload, err).once();
    //     foo.gotData(payload);

    // });

    it('should pipe responses to the output', () => {
        var payload = [0, 123, 'req', 'method'];

        sandbox.mock(raft)
            .expects('rpc')
            .withArgs(payload, 'address')
            .returns('result');

        sandbox.mock(foo).expects('sendResponse').withArgs(payload, 'result').once();
        foo.gotData(payload);

    });

    it('should pipe promise resolutions to the output', () => {
        var payload = [0, 123, 'req', 'method'];

        var mockProm = Promise.resolve();
        mockProm.then = cb => cb('result');
        sandbox.mock(raft)
            .expects('rpc')
            .withArgs(payload, 'address')
            .returns(mockProm);

        sandbox.mock(foo).expects('sendResponse').withArgs(payload, 'result').once();
        foo.gotData(payload);

    });

    it('should pipe promise rejections to the output', () => {
        var payload = [0, 123, 'req', 'method'];

        var mockProm = Promise.reject('failure');
        mockProm.then = (_, cb) => cb('failure');
        sandbox.mock(raft)
            .expects('rpc')
            .withArgs(payload, 'address')
            .returns(mockProm);

        sandbox.mock(foo).expects('sendErrorResponse').withArgs(payload, 'failure').once();
        foo.gotData(payload);

    });

});
