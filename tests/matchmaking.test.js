// tests/matchmaking.test.js
const state = require('../src/state');
const matchmaking = require('../src/matchmaking');

describe('Matchmaking Queue Logic', () => {
    beforeEach(() => {
        // Reset state before each test
        state.waiting.length = 0;
        state.paused.clear();
    });

    test('joinQueue adds user to waiting list', () => {
        matchmaking.joinQueue('socket_1');
        expect(state.waiting).toContain('socket_1');
        expect(state.waiting.length).toBe(1);
    });

    test('joinQueue does not add paused users', () => {
        state.paused.add('socket_1');
        matchmaking.joinQueue('socket_1');
        expect(state.waiting).not.toContain('socket_1');
    });

    test('joinQueue does not add duplicates', () => {
        state.waiting.push('socket_1');
        matchmaking.joinQueue('socket_1');
        expect(state.waiting.length).toBe(1);
    });

    test('leaveQueue removes user from waiting list', () => {
        state.waiting.push('socket_1', 'socket_2');
        matchmaking.leaveQueue('socket_1');
        expect(state.waiting).not.toContain('socket_1');
        expect(state.waiting).toContain('socket_2');
        expect(state.waiting.length).toBe(1);
    });
});
