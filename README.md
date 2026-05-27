# Solara ☀️
**Know your sun window.**

Personalized UV and sun exposure dashboard. Enter your location, skin type, and outdoor activities — Solara tells you exactly when it's safe to go outside without sunscreen.

## Features
- Live UV + weather data via Open-Meteo (free, no API key)
- Personalized safe windows per activity and skin type
- No-sunscreen mode: see exactly when UV is low enough
- Today and tomorrow forecast
- Google Calendar integration for activity windows
- Anonymous use (location saved locally) or Google sign-in (syncs across devices)
- Adjustable activity durations in preferences

## Stack
- Next.js 14 (App Router, static export)
- Firebase Auth + Firestore
- Firebase Hosting
- Tailwind CSS
- GitHub Actions for CI/CD

## Setup

### 1. Clone and install
```bash
git clone https://github.com/yourusername/solara.git
cd solara
npm install
```

### 2. Create a Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project
3. Enable **Authentication** → Google sign-in method
4. Enable **Firestore Database** → start in production mode
5. Enable **Hosting**
6. Go to Project Settings → Web app → copy config values

### 3. Configure environment variables
```bash
cp .env.local.example .env.local
```
Fill in your Firebase config values in `.env.local`.

### 4. Update Firebase project ID
In `.firebaserc`, replace `YOUR_FIREBASE_PROJECT_ID` with your actual project ID.

### 5. Run locally
```bash
npm run dev
```

## Deploy to Firebase Hosting via GitHub Actions

### 1. Add GitHub Secrets
Go to your repo → Settings → Secrets and add:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `FIREBASE_SERVICE_ACCOUNT` (see below)

### 2. Generate Firebase service account
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
```
This generates a service account JSON. Add its contents as the `FIREBASE_SERVICE_ACCOUNT` secret.

### 3. Push to main
Every push to `main` automatically builds and deploys to Firebase Hosting.

## Firestore data structure
```
users/{uid}
  uid: string
  location: { lat, lon, city, region }
  skinType: 'very-fair' | 'fair' | 'medium' | 'olive' | 'dark'
  sunscreen: boolean
  activities: Activity[]
```

## License
MIT
