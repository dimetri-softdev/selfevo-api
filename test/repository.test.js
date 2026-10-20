const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRepository } = require('../repository');

function createFakePool() {
    const state = {
        card: {
            user_id: 'user-1',
            player_name: 'Player',
            pace: 50,
            shooting: 50,
            passing: 50,
            skill: 50,
            defending: 50,
            physical: 50
        },
        completions: new Set()
    };

    return {
        state,
        async connect() {
            return {
                async query(sql, params = []) {
                    if (sql === 'SELECT 1 FROM habits WHERE user_id = $1 LIMIT 1') {
                        return { rowCount: 1, rows: [{}] };
                    }
                    if (sql.startsWith('SELECT attribute_type FROM habits')) {
                        return params[0] === 'user-1' && params[1] === 'habit-1'
                            ? { rowCount: 1, rows: [{ attribute_type: 'PACE' }] }
                            : { rowCount: 0, rows: [] };
                    }
                    if (sql.startsWith('INSERT INTO habit_completions')) {
                        const key = params.join(':');
                        if (state.completions.has(key)) return { rowCount: 0, rows: [] };
                        state.completions.add(key);
                        return { rowCount: 1, rows: [] };
                    }
                    if (sql.startsWith('UPDATE player_cards SET')) {
                        state.card.pace = Math.min(99, state.card.pace + 2);
                        return { rowCount: 1, rows: [] };
                    }
                    if (sql === 'SELECT * FROM player_cards WHERE user_id = $1') {
                        return { rowCount: 1, rows: [{ ...state.card }] };
                    }
                    return { rowCount: 0, rows: [] };
                },
                release() {}
            };
        },
        async query() {
            return { rowCount: 0, rows: [] };
        }
    };
}

test('logging a habit twice for one date awards its stat only once', async () => {
    const pool = createFakePool();
    const repository = createRepository(pool);

    const first = await repository.logHabit('user-1', 'habit-1', '2026-10-20');
    const retry = await repository.logHabit('user-1', 'habit-1', '2026-10-20');

    assert.equal(first.updatedCard.pac, 52);
    assert.equal(retry.updatedCard.pac, 52);
    assert.equal(retry.message, 'Habit was already logged for this date');
});

test('a user cannot complete another user habit', async () => {
    const repository = createRepository(createFakePool());

    const result = await repository.logHabit('other-user', 'habit-1', '2026-10-20');

    assert.equal(result, null);
});
