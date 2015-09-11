export default class LogEntry {
    constructor(command, term) {
        this.command = command;
        this.term = term;
    }
};

LogEntry.from = function from(obj) {
    return new LogEntry(obj.command, obj.term);
};
