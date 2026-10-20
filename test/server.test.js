const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { createApp } = require('../server');

let server;
let baseUrl;
const calls = [];
const repository = {
    async checkHealth() {},
    async getHabits(userId, date) {
        calls.push(['getHabits', userId, date]);
        return [];
    },
    async createHabit(userId, habit) {
        calls.push(['createHabit', userId, habit]);
        return habit;
    },
    async logHabit(userId, habitId, completedOn) {
        calls.push(['logHabit', userId, habitId, completedOn]);
        return { success: true, message: 'Habit logged', updatedCard: { id: userId } };
    },
    async getPlayerCard(userId) {
        calls.push(['getPlayerCard', userId]);
        return { id: userId };
    },
    async updatePlayerName(userId, playerName) {
        calls.push(['updatePlayerName', userId, playerName]);
        return { id: userId, playerName };
    }
};

before(async () => {
    const app = createApp({
        repository,
        verifyIdToken: async (token) => {
            if (token !== 'valid-test-token') throw new Error('Invalid test token');
            return { uid: 'test-user' };
        }
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('API data routes reject requests without Firebase authentication', async () => {
    const response = await fetch(`${baseUrl}/api/habits`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required' });
    assert.equal(calls.length, 0);
});

test('authenticated habit requests use the verified Firebase uid', async () => {
    const response = await fetch(`${baseUrl}/api/habits`, {
        headers: { Authorization: 'Bearer valid-test-token' }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
    assert.deepEqual(calls.at(-1), ['getHabits', 'test-user', new Date().toISOString().slice(0, 10)]);
});

test('habit creation validates input and canonicalizes stat attributes', async () => {
    const invalid = await fetch(`${baseUrl}/api/habits`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer valid-test-token',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: 'Bad habit' })
    });
    assert.equal(invalid.status, 400);

    const habit = {
        id: '123e4567-e89b-42d3-a456-426614174000',
        title: '  Daily run  ',
        description: 'Exercise',
        attributeType: 'PAC',
        frequency: 'Daily',
        reminderTime: '07:00'
    };
    const response = await fetch(`${baseUrl}/api/habits`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer valid-test-token',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(habit)
    });
    assert.equal(response.status, 200);
    assert.equal(calls.at(-1)[1], 'test-user');
    assert.equal(calls.at(-1)[2].attributeType, 'PACE');
    assert.equal(calls.at(-1)[2].title, 'Daily run');
});

test('completion endpoint requires a valid habit ID and scopes it to the token user', async () => {
    const response = await fetch(`${baseUrl}/api/habits/log`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer valid-test-token',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            habitId: '123e4567-e89b-42d3-a456-426614174000',
            completedOn: new Date().toISOString().slice(0, 10)
        })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), [
        'logHabit',
        'test-user',
        '123e4567-e89b-42d3-a456-426614174000',
        new Date().toISOString().slice(0, 10)
    ]);
});

    test('habit list rejects malformed local dates', async () => {
        const response = await fetch(`${baseUrl}/api/habits?date=2026-02-30`, {
            headers: { Authorization: 'Bearer valid-test-token' }
        });
        assert.equal(response.status, 400);
    });

    test('invalid Firebase tokens are rejected', async () => {
    const response = await fetch(`${baseUrl}/api/sync/card`, {
        headers: { Authorization: 'Bearer invalid-token' }
    });
    assert.equal(response.status, 401);
});
