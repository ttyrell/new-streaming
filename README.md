# Weekend Streamer 🍿

Weekend Streamer is a modern, minimalist Progressive Web App (PWA) designed to help you discover what's new to streaming and airing each weekend. 

Built with semantic HTML5, modern vanilla JavaScript, and a warm, eye-friendly light CSS design system, it fetches real-time data directly from **The Movie Database (TMDB) API** to show streaming availability, original theatrical release years, cast listings, and direct Rotten Tomatoes search links.

![Weekend Streamer UI Preview](https://raw.githubusercontent.com/tommytyrell/weekend-streamer/main/icon.png)

---

## Features

- **Live TMDB Integration**: Dynamically fetches movie and TV releases for the selected weekend date ranges.
- **New to Streaming focus**: Shows movies newly added to streaming services (digital releases) and TV shows airing new episodes this weekend.
- **Platform Availability**: Lists exact flatrate streaming platforms in the US (Netflix, Max, Disney+, Hulu, Prime Video, etc.) along with high-res logos.
- **Original Release Dates & TV Codes**: Displays original theatrical release years for movies (e.g. *Theaters: 2024*) and airing codes for TV shows (e.g. *S2 E4*).
- **Rotten Tomatoes Redirects**: Automatically constructs dynamic tomatoes lookup search links for every card.
- **Local Watchlist**: Bookmark shows to your personal watchlist, saved locally in your browser (`localStorage`).
- **Progressive Web App (PWA)**: Register a service worker for static asset pre-caching and fully installable to your Android (Pixel) or iOS home screen.

---

## Technical Architecture

- `index.html`: Structural markup, PWA manifest linking, and service worker registration.
- `style.css`: Clean, minimalist light-themed design tokens (stone background `#f5f4f0`, soft charcoal text `#1c1d21`, custom shadows, and rounded capsule layouts).
- `app.js`: Data controller handles the fetch requests, genre caching, watchlist local storage, details modal, and search filtering.
- `manifest.json`: Mobile standalone application splash setup.
- `sw.js`: Service worker caching controller for offline speed.
- `icon.png`: Custom-designed application logo.

---

## Installation & Deployment

### Running Locally
To run and test the application locally, simply locate `index.html` on your filesystem and open it in any modern web browser.

### Deploying to GitHub Pages
To host this application for PWA mobile installation:
1. Create a public repository on GitHub.
2. Push your local files:
   ```bash
   git branch -M main
   git remote add origin https://github.com/your-username/weekend-streamer.git
   git push -u origin main
   ```
3. Go to **Settings** > **Pages** in your GitHub repository.
4. Set the source branch to **`main`** and save.
5. Visit the provided HTTPS URL on your Android or iOS device and choose **Add to Home screen**!
