"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var LogEntry = function LogEntry(command, term) {
    _classCallCheck(this, LogEntry);

    this.command = command;
    this.term = term;
};

exports["default"] = LogEntry;
;

LogEntry.from = function from(obj) {
    return new LogEntry(obj.command, obj.term);
};
module.exports = exports["default"];