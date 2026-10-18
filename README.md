# SelfEvo REST API Backend

This is the standalone REST API backend repository for the **SelfEvo** Android application (OPSC63212 PoE). It provides robust endpoints for authentication, habit synchronization, stat upgrades, and player card progression.

---

## Features
- **Authentication**: Secure login and token generation (`POST /api/auth/login`)
- **Habit Management**: Fetch user habits (`GET /api/habits`) and log completed habits (`POST /api/habits/log`)
- **Player Stat Synchronization**: Retrieve and sync Ultimate Team player card stats (`GET /api/sync/card`, `POST /api/sync/card`)

---

## Tech Stack
- **Node.js** & **Express.js**
- **CORS** middleware for seamless Android network communication

---

## Getting Started & Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

3. Server runs on `http://localhost:3000` (or configured cloud provider such as Azure / Render / Heroku).
