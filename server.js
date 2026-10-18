const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// In-memory mock database for PoE demonstration
let habitsStore = [
    { id: "h1", title: "Morning Run", description: "Cardio conditioning", attributeType: "PACE", isCompletedToday: false, frequency: "DAILY", reminderTime: "07:00" },
    { id: "h2", title: "Free Kick Practice", description: "Shooting accuracy training", attributeType: "SHOOTING", isCompletedToday: false, frequency: "DAILY", reminderTime: "16:00" },
    { id: "h3", title: "Passing Drills", description: "Vision and short passing", attributeType: "PASSING", isCompletedToday: true, frequency: "DAILY", reminderTime: "12:00" }
];

let playerCardStore = {
    id: "user1",
    playerName: "MAKHENESA",
    pac: 75,
    sho: 72,
    pas: 70,
    skl: 68,
    def: 65,
    phy: 70
};

// 1. Authentication Endpoint
app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    console.log(`Login attempt for: ${email}`);
    if (email) {
        res.json({
            token: "jwt_token_selfevo_secure_987654321",
            email: email,
            username: playerCardStore.playerName
        });
    } else {
        res.status(400).json({ error: "Invalid credentials" });
    }
});

// 2. Get Habits Endpoint
app.get('/api/habits', (req, res) => {
    res.json(habitsStore);
});

// 3. Log Habit Endpoint
app.post('/api/habits/log', (req, res) => {
    const { habitId } = req.body;
    const habit = habitsStore.find(h => h.id === habitId);
    if (habit) {
        habit.isCompletedToday = true;
        // Boost corresponding attribute
        switch (habit.attributeType) {
            case 'PACE': playerCardStore.pac += 2; break;
            case 'SHOOTING': playerCardStore.sho += 2; break;
            case 'PASSING': playerCardStore.pas += 2; break;
            case 'DRIBBLING': playerCardStore.skl += 2; break;
            case 'DEFENDING': playerCardStore.def += 2; break;
            case 'PHYSICAL': playerCardStore.phy += 2; break;
        }
        res.json({
            success: true,
            message: "Habit logged successfully and stats upgraded",
            updatedCard: playerCardStore
        });
    } else {
        res.status(404).json({ success: false, message: "Habit not found" });
    }
});

// 4. Get Player Card Endpoint
app.get('/api/sync/card', (req, res) => {
    res.json(playerCardStore);
});

// 5. Sync Player Card Endpoint
app.post('/api/sync/card', (req, res) => {
    const updatedCard = req.body;
    if (updatedCard) {
        playerCardStore = { ...playerCardStore, ...updatedCard };
        res.json(playerCardStore);
    } else {
        res.status(400).json({ error: "Invalid player card data" });
    }
});

app.get('/', (req, res) => {
    res.send('SelfEvo REST API Backend is running successfully!');
});

app.listen(PORT, () => {
    console.log(`SelfEvo API server listening on port ${PORT}`);
});
