const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const admin = require('firebase-admin');
const { Pool } = require('pg');
const { createRepository } = require('./repository');

const attributeAliases = Object.freeze({
    PAC: 'PACE',
    PACE: 'PACE',
    SHO: 'SHOOTING',
    SHOOTING: 'SHOOTING',
    PAS: 'PASSING',
    PASSING: 'PASSING',
    SKL: 'DRIBBLING',
    SKILL: 'DRIBBLING',
    DRIBBLING: 'DRIBBLING',
    DEF: 'DEFENDING',
    DEFENDING: 'DEFENDING',
    PHY: 'PHYSICAL',
    PHYSICAL: 'PHYSICAL'
});
const frequencies = new Set(['Daily', 'Mon-Fri', 'Weekends']);

function isDateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function createApp({ repository, verifyIdToken }) {
    if (!repository || typeof verifyIdToken !== 'function') {
        throw new Error('API repository and Firebase token verifier are required');
    }

    const app = express();
    app.set('trust proxy', 1);
    app.disable('x-powered-by');
    app.use(helmet());
    app.use(express.json({ limit: '16kb', strict: true }));
    app.use(rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 120,
        standardHeaders: 'draft-8',
        legacyHeaders: false
    }));

    app.get('/healthz', async (req, res, next) => {
        try {
            await repository.checkHealth();
            res.status(200).json({ status: 'ok' });
        } catch (error) {
            next(error);
        }
    });

    app.use('/api', async (req, res, next) => {
        const authorization = req.get('authorization');
        const match = authorization?.match(/^Bearer ([^\s]+)$/i);
        if (!match) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        try {
            const decodedToken = await verifyIdToken(match[1]);
            if (typeof decodedToken?.uid !== 'string' || decodedToken.uid.length === 0) {
                return res.status(401).json({ error: 'Invalid authentication token' });
            }
            req.user = { uid: decodedToken.uid };
            return next();
        } catch (error) {
            return res.status(401).json({ error: 'Invalid or expired authentication token' });
        }
    });

    app.get('/api/habits', async (req, res, next) => {
        const completionDate = req.query.date || new Date().toISOString().slice(0, 10);
        if (!isDateOnly(completionDate)) {
            return res.status(400).json({ error: 'A valid date query parameter is required' });
        }
        try {
            res.json(await repository.getHabits(req.user.uid, completionDate));
        } catch (error) {
            next(error);
        }
    });

    app.post('/api/habits', async (req, res, next) => {
        const habit = req.body;
        if (!habit || typeof habit !== 'object' || Array.isArray(habit)
            || typeof habit.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(habit.id)
            || typeof habit.title !== 'string' || habit.title.trim().length < 1 || habit.title.trim().length > 100
            || typeof habit.description !== 'string' || habit.description.length > 500
            || typeof habit.attributeType !== 'string' || !attributeAliases[habit.attributeType.toUpperCase()]
            || typeof habit.frequency !== 'string' || !frequencies.has(habit.frequency)
            || typeof habit.reminderTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(habit.reminderTime)) {
            return res.status(400).json({ error: 'Invalid habit data' });
        }

        try {
            const savedHabit = await repository.createHabit(req.user.uid, {
                ...habit,
                title: habit.title.trim(),
                attributeType: attributeAliases[habit.attributeType.toUpperCase()]
            });
            return res.status(200).json(savedHabit);
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/habits/log', async (req, res, next) => {
        const habitId = req.body?.habitId;
        const completedOn = req.body?.completedOn;
        if (typeof habitId !== 'string' || !/^[0-9a-f-]{36}$/i.test(habitId) || !isDateOnly(completedOn)) {
            return res.status(400).json({ error: 'A valid habitId and completion date are required' });
        }

        try {
            const result = await repository.logHabit(req.user.uid, habitId, completedOn);
            if (!result) {
                return res.status(404).json({ success: false, message: 'Habit not found' });
            }
            return res.json(result);
        } catch (error) {
            return next(error);
        }
    });

    app.get('/api/sync/card', async (req, res, next) => {
        try {
            res.json(await repository.getPlayerCard(req.user.uid));
        } catch (error) {
            next(error);
        }
    });

    app.patch('/api/sync/card', async (req, res, next) => {
        const playerName = req.body?.playerName;
        if (typeof playerName !== 'string' || playerName.trim().length < 1 || playerName.trim().length > 40) {
            return res.status(400).json({ error: 'Player name must be between 1 and 40 characters' });
        }

        try {
            res.json(await repository.updatePlayerName(req.user.uid, playerName.trim()));
        } catch (error) {
            next(error);
        }
    });

    app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });

    app.use((error, req, res, next) => {
        if (res.headersSent) {
            return next(error);
        }
        if (error?.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Invalid JSON body' });
        }
        if (error?.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body is too large' });
        }
        console.error('Request failed', {
            method: req.method,
            path: req.path,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

function initializeFirebaseAdmin() {
    if (admin.apps.length > 0) {
        return admin.auth();
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must be configured');
    }

    let serviceAccount;
    try {
        serviceAccount = JSON.parse(serviceAccountJson);
    } catch (error) {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON');
    }

    const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    });
    return admin.auth(app);
}

async function start() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL must be configured');
    }

    const firebaseAuth = initializeFirebaseAdmin();
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : undefined,
        max: 10,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
    });
    pool.on('error', (error) => {
        console.error('Unexpected PostgreSQL pool error', error.message);
    });

    const repository = createRepository(pool);
    try {
        await repository.initialize();
    } catch (error) {
        await pool.end();
        throw error;
    }

    const app = createApp({
        repository,
        verifyIdToken: (token) => firebaseAuth.verifyIdToken(token, true)
    });
    const server = app.listen(process.env.PORT || 3000, () => {
        console.log(`SelfEvo API listening on port ${process.env.PORT || 3000}`);
    });

    const shutdown = () => {
        server.close(() => {
            pool.end().then(() => process.exit(0));
        });
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

if (require.main === module) {
    start().catch((error) => {
        console.error('SelfEvo API startup failed:', error.message);
        process.exitCode = 1;
    });
}

module.exports = { createApp, start };
