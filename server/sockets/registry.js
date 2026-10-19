// Global Socket.IO registry.
// Set by attachSocketIO() whenever a server is created.
// Read by routes that need to emit. No Express internals involved.

let _io = null;

export function setIO(io) { _io = io; }
export function getIO() { return _io; }
