# WebRaft

This is a work-in-progress implementation of the Raft algorithm, built in an implementation-agnostic way.

**This library is very much a work in progress.**

- Transport-agnostic
- Persistence layer-agnostic
- Built for simplicity and ease of implementation
- Customizable


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
        this.socket = new GenericSocket(address, {port: 1234});
        // We're all friends here. We can just assume that you handle errors
        // and all of the important stuff.

        // Call `gotData()` with any data that you receive.
        // If you handle incoming messages somewhere else, you can call
        // `gotData('from address', payload)` on the RaftInterface.
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

Next, if you want data to be persisted, you must implement a handler for the `apply` event on your instance. This can be done on the instance itself or externally.

```js
var inst = new MyRaftInterface();
inst.listen('apply', (data, cb) => {
    var update = () => db.update('key', data.command).then(cb, update);
});

// or on the instance itself

class MyGreatRaftInterface extends RaftInterface {
    constructor(address) {
        super(address);

        this.listen('apply', (data, cb) => {
            window.localStorage.setItem('my data', data.command);
            cb();
        });
    }
    createInstance(address) {
        // ...
    }
}

```

Once persistence is in place, use the `propose()` method on the `RaftInterface` instance to propose changes across the cluster.

```js
instance.propose({key: 'value'})
    .then(() => alert('Committed!'), err => console.error(err));
```

When a command has been committed, each `RaftInterface` instance on all machines in the cluster will emit an `updated` event.

```js
inst.listen('updated', () => this.setState({dataFromRaft: myDataStore.state}));
```



### Events

Events can be listened for using the `listen(type, handler)` method (`unlisten(type, handler)` is available).

```js
var instance = new MyRaftInstance();
instance.listen('type', (arg1, arg2) => console.log(arg1, arg2));
```


- `join`: Emitted with an address when a node joins the cluster.
- `leave`: Emitted with an address when a node leaves the cluster.
- `leader`: Emitted when the node becomes the leader of the cluster.
- `candidate`: Emitted when the node becomes a leader candidate.
- `follower`: Emitted when the node becomes a follower.
- `state changed`: Emitted when the node changes state.
- `heartbeat timeout`: Emitted when the leader hasn't been heard from in `heartbeatTimeout` milliseconds.
- `start election`: Emitted when an election is started (generally this is fired immediately after `heartbeat timeout`).
- `apply`: Emitted with the log entry to commit to the persistency layer and a callback parameter. The callback parameter should only be called after the data has been fully committed.
- `updated`: Emitted when a log is committed to the state machine. This fires after `apply` has fired and the callback has been called without an error.


### Timeouts and constants

You can fiddle with the various numerical values that Raft depends on by overriding some getters on the `RaftInterface`.

```js
class MyRaftInstance extends RaftInterface {
    createInstance(address) {
        // ...
    }

    /**
     * Returns the timeout for an election in ms.
     * Defaults to 150 to 300ms.
     * This should be greater than `heartbeatTimeout`.
     * @return {int} Milliseconds an election should time out in
     */
    get electionTimeout() {
        return Math.random() * 150 + 150;
    }

    /**
     * Returns how often the leader should send a heartbeat in ms.
     * @return {int} Milliseconds between each heartbeat sent
     */
    get heartbeatFrequency() {
        return 100;
    }

    /**
     * Returns how long the client should wait before starting an election
     * because the leader disappeared in ms.
     * If this is not greater than what's returned by `heartbeatFrequency`,
     * you're going to have a bad time.
     * @return {int} Milliseconds to wait for a heartbeat
     */
    get heartbeatTimeout() {
        return 200;
    }
}
```


## Assumptions

- WebRaft assumes that message delivery is guaranteed. If your transport doesn't make that guarantee, you must implement your own means of retrying messages and verifying delivery.
- If the callback to the `apply` event is called with an error, the same `apply` event will be called again when the next log is to be committed. If the nature of your implementation requires that a log entry not just be marked as committed but rather be applied to the state machine on a majority of nodees, you should implement your own means of retrying indefinitely rather than calling the callback with an error.
