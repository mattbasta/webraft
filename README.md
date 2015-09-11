# WebRaft

This is a work-in-progress implementation of the Raft algorithm, built in an implementation-agnostic way.

## API

First, you must extend the `RaftInterface` and `NodeInstance` classes.

```js
import {RaftInterface, NodeInstance} from 'webraft';

class FooRaftNode extends NodeInstance {
    constructor(address, raft) {
        // If you define a custom constructor, you must call `super()` and pass
        // all parameters: address and raft
        super(address, raft);
        // Perform your means of setting up the connection, or linking to an
        // existing connection.
        this.socket = new TCPSocket(address, {port: 123});
        // We're all friends here. We can just assume that you handle errors
        // and all of the important stuff.

        // Call `gotData()` with any data that you receive.
        this.socket.on('message', payload => this.gotData(JSON.parse(payload)));
        this.socket.on('close', () => this.raft.leave(this.address));
    }

    // Implement a `write()` method. It will be given a single parameter,
    // which contains a JSON-serializable object. Serialization is left up to
    // you, because who am I to tell you how to serialize your data.
    write(payload) {
        this.socket.write(JSON.stringify(payload));
    }
}

class FooRaft extends RaftInterface {
    // Just define a `createInstance()` method that returns your custom
    // NodeInstance objects. You can even use class expressions if you want.
    createInstance(address) {
        return new FooRaftNode(address, this);
    }

    // You can add a custom constructor to this object, but remember to
    // call `super()`!
}

```

When you wish to add a node to the cluster, call `join('node address')` on an instance of your `RaftInterface` implementation. When a node leaves the cluster, call `leave('node address')`.

When data becomes available, you can either call `gotData(payload)` on the appropriate `NodeInstance` implementation, or `gotData('from address', payload)` on the `RaftInterface` instance. Either works.
