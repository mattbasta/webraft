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

Next, if you want data to be persisted, you must implement a handler for the `apply` and `refresh` events on your instance. Both can be done on the instance itself or externally.

```js
var inst = new MyRaftInterface();
inst.listen('apply', (entry, index, cb) => {
    var update = () => {
        Promise.all([
            snapshot.applyCommand(entry.command),
            snapshot.set('term', entry.term),
            snapshot.set('index', index),
        ]).then(cb, update);
    };
    update();
});
inst.listen('refresh', cb => {
    var refresh = () => fetch('https://host/snapshot').then(content => {
        snapshot = content;
        cb();
    }, refresh);
    refresh();
});

// or on the instance itself

class MyGreatRaftInterface extends RaftInterface {
    constructor(address) {
        super(address);

        this.listen('apply', (entry, index, cb) => {
            var state = JSON.parse(localStorage.getItem('data'));
            jsonPatch.apply(state, data.command);
            localStorage.setItem('data', JSON.stringify(state));
            localStorage.setItem('term', entry.term);
            localStorage.setItem('index', index);
            // ... code to push to server, if needed ...
            cb();
        });
        this.listen('refresh', cb => {
            var refresh = () => fetch('https://host/api/latest').then(resp => {
                var parsed = JSON.parse(resp);
                window.localStorage.setItem('data', parsed.state);
                window.localStorage.setItem('term', parsed.term);
                window.localStorage.setItem('index', parsed.index);
                cb(parsed.term, parsed.index);
            }, refresh);
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
- `apply`: Emitted with the log entry to commit to the persistency layer, an index, and a callback parameter. The callback parameter should only be called after all of the data has been fully committed.
- `updated`: Emitted when a log is committed to the state machine. This fires after `apply` has fired and the callback has been called without an error.
- `refresh`: Emitted with a callback when the node contains a state that's too old to be used with the cluster. This can happen if the node has a state that's older than the oldest online peer, or the node is severely lagged and has missed more than one log compaction cycle. When this is fired, the node MUST update its state from persistent storage and call the callback after the state has been updated. The callback should be called with the last applied entry's term and index.


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
- The callback for the `apply` event should ONLY be called after the log entry has been fully committed. Calling it before the data has been fully persisted can result in data loss in certain edge cases, and nobody wants that.
- The callback for the `refresh` event should ONLY be called after the state has been fully fetched an populated from persistent storage. Do not use a cached version of the state. If you call the callback too early, it can cause race conditions that may overwrite state and cause data loss.
