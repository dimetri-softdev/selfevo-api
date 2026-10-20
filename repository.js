const { randomUUID } = require('node:crypto');

const attributeColumns = Object.freeze({
    PACE: 'pace',
    SHOOTING: 'shooting',
    PASSING: 'passing',
    DRIBBLING: 'skill',
    DEFENDING: 'defending',
    PHYSICAL: 'physical'
});

const defaultHabits = [
    ['Morning Run', 'Cardio conditioning', 'PACE', 'Daily', '07:00'],
    ['Free Kick Practice', 'Shooting accuracy training', 'SHOOTING', 'Daily', '16:00'],
    ['Passing Drills', 'Vision and short passing', 'PASSING', 'Daily', '12:00']
];

function mapCard(row) {
    return {
        id: row.user_id,
        playerName: row.player_name,
        pac: row.pace,
        sho: row.shooting,
        pas: row.passing,
        skl: row.skill,
        def: row.defending,
        phy: row.physical
    };
}

function createRepository(pool) {
    return {
        async initialize() {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS app_users (
                    user_id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE TABLE IF NOT EXISTS player_cards (
                    user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
                    player_name VARCHAR(40) NOT NULL DEFAULT 'SelfEvo Player',
                    pace INTEGER NOT NULL DEFAULT 50 CHECK (pace BETWEEN 0 AND 99),
                    shooting INTEGER NOT NULL DEFAULT 50 CHECK (shooting BETWEEN 0 AND 99),
                    passing INTEGER NOT NULL DEFAULT 50 CHECK (passing BETWEEN 0 AND 99),
                    skill INTEGER NOT NULL DEFAULT 50 CHECK (skill BETWEEN 0 AND 99),
                    defending INTEGER NOT NULL DEFAULT 50 CHECK (defending BETWEEN 0 AND 99),
                    physical INTEGER NOT NULL DEFAULT 50 CHECK (physical BETWEEN 0 AND 99)
                );
                CREATE TABLE IF NOT EXISTS habits (
                    id TEXT NOT NULL,
                    user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
                    title VARCHAR(100) NOT NULL,
                    description VARCHAR(500) NOT NULL DEFAULT '',
                    attribute_type VARCHAR(16) NOT NULL CHECK (attribute_type IN ('PACE', 'SHOOTING', 'PASSING', 'DRIBBLING', 'DEFENDING', 'PHYSICAL')),
                    frequency VARCHAR(16) NOT NULL CHECK (frequency IN ('Daily', 'Mon-Fri', 'Weekends')),
                    reminder_time TIME NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_id, id)
                );
                CREATE TABLE IF NOT EXISTS habit_completions (
                    user_id TEXT NOT NULL,
                    habit_id TEXT NOT NULL,
                    completed_on DATE NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_id, habit_id, completed_on),
                    FOREIGN KEY (user_id, habit_id) REFERENCES habits(user_id, id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS habits_user_created_idx ON habits(user_id, created_at);
            `);
        },

        async checkHealth() {
            await pool.query('SELECT 1');
        },

        async ensureUser(userId) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [userId]);
                await client.query('INSERT INTO app_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
                await client.query('INSERT INTO player_cards (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
                const existing = await client.query('SELECT 1 FROM habits WHERE user_id = $1 LIMIT 1', [userId]);
                if (existing.rowCount === 0) {
                    for (const [title, description, attributeType, frequency, reminderTime] of defaultHabits) {
                        await client.query(
                            `INSERT INTO habits (id, user_id, title, description, attribute_type, frequency, reminder_time)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [randomUUID(), userId, title, description, attributeType, frequency, reminderTime]
                        );
                    }
                }
                await client.query('COMMIT');
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },

        async getHabits(userId, completionDate) {
            await this.ensureUser(userId);
            const result = await pool.query(
                `SELECT h.id, h.title, h.description, h.attribute_type AS "attributeType",
                        (c.habit_id IS NOT NULL) AS "isCompletedToday",
                        h.frequency, TO_CHAR(h.reminder_time, 'HH24:MI') AS "reminderTime"
                 FROM habits h
                 LEFT JOIN habit_completions c
                   ON c.user_id = h.user_id AND c.habit_id = h.id AND c.completed_on = $2::date
                 WHERE h.user_id = $1
                 ORDER BY h.created_at, h.id`,
                [userId, completionDate]
            );
            return result.rows;
        },

        async createHabit(userId, habit) {
            await this.ensureUser(userId);
            const result = await pool.query(
                `INSERT INTO habits (id, user_id, title, description, attribute_type, frequency, reminder_time)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (user_id, id) DO UPDATE
                   SET title = EXCLUDED.title,
                       description = EXCLUDED.description,
                       attribute_type = EXCLUDED.attribute_type,
                       frequency = EXCLUDED.frequency,
                       reminder_time = EXCLUDED.reminder_time
                 RETURNING id, title, description, attribute_type AS "attributeType",
                           FALSE AS "isCompletedToday", frequency,
                           TO_CHAR(reminder_time, 'HH24:MI') AS "reminderTime"`,
                [habit.id, userId, habit.title, habit.description, habit.attributeType, habit.frequency, habit.reminderTime]
            );
            return result.rows[0];
        },

        async getPlayerCard(userId) {
            await this.ensureUser(userId);
            const result = await pool.query('SELECT * FROM player_cards WHERE user_id = $1', [userId]);
            return mapCard(result.rows[0]);
        },

        async updatePlayerName(userId, playerName) {
            await this.ensureUser(userId);
            const result = await pool.query(
                'UPDATE player_cards SET player_name = $2 WHERE user_id = $1 RETURNING *',
                [userId, playerName]
            );
            return mapCard(result.rows[0]);
        },

        async logHabit(userId, habitId, completedOn) {
            await this.ensureUser(userId);
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const habitResult = await client.query(
                    'SELECT attribute_type FROM habits WHERE user_id = $1 AND id = $2 FOR UPDATE',
                    [userId, habitId]
                );
                if (habitResult.rowCount === 0) {
                    await client.query('ROLLBACK');
                    return null;
                }

                const completion = await client.query(
                    `INSERT INTO habit_completions (user_id, habit_id, completed_on)
                     VALUES ($1, $2, $3::date)
                     ON CONFLICT DO NOTHING`,
                    [userId, habitId, completedOn]
                );
                if (completion.rowCount > 0) {
                    const column = attributeColumns[habitResult.rows[0].attribute_type];
                    await client.query(
                        `UPDATE player_cards SET ${column} = LEAST(99, ${column} + 2) WHERE user_id = $1`,
                        [userId]
                    );
                }
                const cardResult = await client.query('SELECT * FROM player_cards WHERE user_id = $1', [userId]);
                await client.query('COMMIT');
                return {
                    success: true,
                    message: completion.rowCount > 0 ? 'Habit logged successfully' : 'Habit was already logged for this date',
                    updatedCard: mapCard(cardResult.rows[0])
                };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }
    };
}

module.exports = { createRepository };
