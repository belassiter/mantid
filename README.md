# Mantid

A colorfully cutthroat multiplayer card game based on Mantis by Exploding Kittens. Built with React, Vite, and Firebase.

## Features

- **Multiplayer**: 2-6 players can join and play together in real-time
- **Room Codes**: Easy 4-letter codes to share with friends
- **Real-time Sync**: All players see updates instantly via Firebase
- **Responsive Design**: Works on desktop and mobile devices
- **Game Mechanics**: Full implementation of Mantis rules including:
  - Score action (add to your tank)
  - Steal action (add to opponent's tank)
  - Matching cards move to score pile or your tank
  - Strategic card back visibility (3 possible colors shown)
  - Win condition: 10 cards (15 for 2 players)

## Setup Instructions

### 1. Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable **Firestore Database**
   - Create database in production mode
   - Choose a location closest to your users
4. Enable **Authentication**
   - Go to Authentication > Sign-in method
   - Enable "Anonymous" provider
5. Get your Firebase config:
   - Go to Project Settings > Your Apps
   - Add a web app if you haven't
   - Copy the config object
6. Update `src/firebase/config.js` with your Firebase credentials:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 2. Firestore Security Rules

In Firebase Console > Firestore Database > Rules, add these rules:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /games/{gameId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      allow delete: if false;
    }
  }
}
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### 5. Build for Production

```bash
npm run build
```

This creates a `dist/` folder with static files ready for deployment.

### 6. Deploy to Your FTP Server

1. Build the project (see above)
2. Upload all contents of the `dist/` folder to your web server via FTP
3. Make sure your server serves `index.html` for all routes

Alternatively, you can deploy to Firebase Hosting:

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

## How to Play

**Goal**: Be the first player to have 10 or more cards in your Score Pile (15 for 2 players).

**On Your Turn**, choose one action:

1. **Score**: Draw a card into YOUR tank
   - If it matches any cards there, move all matching cards to your Score Pile
   - If no match, card stays in your tank

2. **Steal**: Choose an opponent and draw a card into THEIR tank
   - If it matches any of their cards, steal all matching cards to YOUR tank
   - If no match, card stays in their tank

**Strategy**: The back of each draw pile card shows 3 possible colors. Use this information to make smart decisions about scoring vs stealing and which player to target!

## Tech Stack

- **Frontend**: React 19 + Vite
- **Backend**: Firebase (Firestore + Auth)
- **Styling**: CSS Modules
- **Deployment**: Static hosting (FTP or Firebase Hosting)

## Project Structure

```
mantid/
├── src/
│   ├── components/       # React components
│   │   ├── Lobby.jsx    # Game creation/joining
│   │   ├── WaitingRoom.jsx
│   │   ├── GameBoard.jsx
│   │   ├── Card.jsx
│   │   └── Tank.jsx
│   ├── hooks/           # Custom React hooks
│   │   └── useGameState.js
│   ├── utils/           # Game logic utilities
│   │   ├── cardLogic.js
│   │   └── gameRules.js
│   ├── firebase/        # Firebase configuration
│   │   └── config.js
│   └── App.jsx          # Main app component
├── public/              # Static assets
└── package.json
```

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint

### Adding Features

Some ideas for future enhancements:
- Card flip animations
- Sound effects
- Game history/replay
- Player statistics
- Custom themes
- Chat functionality
- Tournament mode

## License

This is a non-commercial demonstration project based on the Mantis card game by Exploding Kittens.

## Credits

Original game design by Ken Gruhl and Jeremy Posner (Exploding Kittens)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
