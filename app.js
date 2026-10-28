// Configuration
const BASE_URL = 'https://api.themoviedb.org/3';
const API_KEY_STORAGE_KEY = 'weekend_tmdb_api_key';
const WATCHLIST_STORAGE_KEY = 'weekend_watchlist_v2';
const LEGACY_WATCHLIST_KEY = 'weekend_watchlist';

function getStoredApiKey() {
  try {
    return (localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim();
  } catch (err) {
    console.warn('Unable to read API key from localStorage:', err);
    return '';
  }
}

let tmdbApiKey = getStoredApiKey();

// Streaming Platform Priority (preferred services to show first)
const PLATFORM_PRIORITY = [
  "Netflix",
  "Max",
  "HBO Max",
  "Paramount+",
  "Paramount Plus",
  "Disney+",
  "Disney Plus",
  "Peacock",
  "Peacock Premium",
  "Hulu",
  "Apple TV+",
  "Apple TV",
  "Amazon Prime Video",
  "Prime Video",
  "MGM+",
  "Showtime",
  "Starz",
  "Crunchyroll"
];

// Curated Highlights mapping weekend start dates to specific recommended TMDB IDs and custom metadata
const CURATED_RELEASES = {
  '2026-06-19': {
    tv: [
      { id: 94997, platform: "HBO Max" }, // House of the Dragon
      { id: 219971, platform: "Paramount+" }, // The Agency
      { id: 278178, platform: "Netflix" }, // I Will Find You
      { id: 203744, platform: "Apple TV+" }, // Sugar
      { id: 93166, platform: "Peacock" }, // The Capture
      { id: 456, platform: "Disney+", titleOverride: "The Simpsons - Extreme Makeover: Homer Edition" } // The Simpsons
    ],
    movie: [
      { id: 687163, platform: "MGM+" }, // Project Hail Mary
      { id: 614945, platform: "Netflix" }, // Voicemails for Isabelle
      { id: 467905, platform: "HBO Max" } // How to Make a Killing
    ]
  }
};

// --- Security & Storage Helpers ---
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getCompositeKey(type, id) {
  return `${type}:${id}`;
}

function loadWatchlistState() {
  let map = {};
  let legacyIds = new Set();
  try {
    const rawV2 = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = parsed;
      }
    }
    const rawV1 = localStorage.getItem(LEGACY_WATCHLIST_KEY);
    if (rawV1) {
      const parsedV1 = JSON.parse(rawV1);
      if (Array.isArray(parsedV1)) {
        parsedV1.forEach(id => legacyIds.add(Number(id)));
      }
    }
  } catch (err) {
    console.warn('Unable to read watchlist from localStorage:', err);
  }
  return { map, legacyIds };
}

function saveWatchlistState() {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlistMap));
    // Also sync numeric IDs to legacy key for backward compatibility
    const numericIds = Object.values(watchlistMap).map(item => item.id);
    localStorage.setItem(LEGACY_WATCHLIST_KEY, JSON.stringify(numericIds));
  } catch (err) {
    console.warn('Unable to save watchlist to localStorage:', err);
  }
}

// Application State
let activeTypeFilter = 'all';
let activePlatformFilter = 'all';
let searchQuery = '';
const initialWatchlist = loadWatchlistState();
let watchlistMap = initialWatchlist.map; // { "Movie:687163": itemSnapshot }
let legacyWatchlistIds = initialWatchlist.legacyIds;
let currentReleases = []; // Fetched live from TMDB
let genreMap = {}; // Populated at startup: { id: "Genre Name" }
let activeLoadController = null;
let activeModalController = null;
let lastFocusedElement = null;

// DOM Elements
const spotlightGrid = document.getElementById('spotlight-grid');
const spotlightSection = document.getElementById('spotlight-section');
const releasesGrid = document.getElementById('releases-grid');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.filter-btn');
const platformSelect = document.getElementById('platform-select');
const weekendSelect = document.getElementById('weekend-select');

// Modal Elements
const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const modalHero = document.getElementById('modal-hero');
const modalTitle = document.getElementById('modal-title');
const modalType = document.getElementById('modal-type');
const modalPlatform = document.getElementById('modal-platform');
const modalRating = document.getElementById('modal-rating');
const modalInfoText = document.getElementById('modal-info-text');
const modalSynopsis = document.getElementById('modal-synopsis');
const castList = document.getElementById('cast-list');
const btnRottenTomatoes = document.getElementById('btn-rotten-tomatoes');
const btnModalWatchlist = document.getElementById('btn-modal-watchlist');

// API Key Modal Elements
const btnApiSettings = document.getElementById('btn-api-settings');
const apiKeyModalOverlay = document.getElementById('api-key-modal-overlay');
const apiModalClose = document.getElementById('api-modal-close');
const apiKeyForm = document.getElementById('api-key-form');
const apiKeyInput = document.getElementById('api-key-input');
const apiKeyError = document.getElementById('api-key-error');
const btnClearApiKey = document.getElementById('btn-clear-api-key');

// Helper to check if an item is watchlisted
function isItemWatchlisted(item) {
  if (!item) return false;
  const key = getCompositeKey(item.type, item.id);
  return Boolean(watchlistMap[key]) || legacyWatchlistIds.has(Number(item.id));
}

// Bounded concurrency pool to prevent TMDB HTTP 429 rate-limit exhaustion
async function mapWithConcurrency(items, limit, asyncFn, signal) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const currentIndex = index++;
      results[currentIndex] = await asyncFn(items[currentIndex], currentIndex);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Helper to check if a release falls on the selected weekend (Wednesday to Sunday)
function isReleaseInSelectedWeekend(releaseDateStr, weekendStartDateStr) {
  if (!releaseDateStr || !weekendStartDateStr) return false;
  const releaseDate = new Date(releaseDateStr + 'T00:00:00');
  const startDate = new Date(weekendStartDateStr + 'T00:00:00');
  
  const qStart = new Date(startDate);
  qStart.setDate(startDate.getDate() - 2); // Preceding Wednesday (Friday - 2 days)
  
  const qEnd = new Date(startDate);
  qEnd.setDate(startDate.getDate() + 2); // Sunday (Friday + 2 days)
  
  return releaseDate >= qStart && releaseDate <= qEnd;
}

// Helper to format date string to human readable format (e.g. Friday, Jun 19)
function formatAiringDate(dateStr) {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  } catch (e) {
    return "";
  }
}

// Helper to extract the US digital/streaming release date for movies
function getUSDigitalReleaseDate(detailsData, selectedWeekend) {
  if (!detailsData || !detailsData.release_dates || !detailsData.release_dates.results) {
    return null;
  }
  const usRelease = detailsData.release_dates.results.find(r => r.iso_3166_1 === "US");
  if (usRelease && usRelease.release_dates) {
    // 1. First, look for a digital/TV release that falls exactly in the selected weekend range (Wednesday to Sunday)
    if (selectedWeekend) {
      const weekendRelease = usRelease.release_dates.find(rd => {
        if (rd.type === 4 || rd.type === 6) {
          const dateStr = rd.release_date.split('T')[0];
          return isReleaseInSelectedWeekend(dateStr, selectedWeekend);
        }
        return false;
      });
      if (weekendRelease) {
        return weekendRelease.release_date.split('T')[0];
      }
    }

    // 2. Fallback: look for the first digital (type 4) or TV (type 6) release
    const digitalRelease = usRelease.release_dates.find(rd => rd.type === 4 || rd.type === 6);
    if (digitalRelease) {
      return digitalRelease.release_date.split('T')[0];
    }
    // 3. Fallback: look for type 3 (Theatrical) or any type if digital not found
    const fallbackRelease = usRelease.release_dates.find(rd => rd.type === 3) || usRelease.release_dates[0];
    if (fallbackRelease) {
      return fallbackRelease.release_date.split('T')[0];
    }
  }
  return null;
}

// Extract real US MPAA or TV Content Rating from appended TMDB response
function extractUSCertification(detailsData, type) {
  if (type === 'Movie') {
    const usRelease = detailsData?.release_dates?.results?.find(r => r.iso_3166_1 === "US");
    const certObj = usRelease?.release_dates?.find(rd => rd.certification && rd.certification.trim() !== "");
    return certObj ? certObj.certification.trim() : "NR";
  } else {
    const usRating = detailsData?.content_ratings?.results?.find(r => r.iso_3166_1 === "US");
    return usRating && usRating.rating ? usRating.rating.trim() : "TV-14";
  }
}

// Centralized Air Date & Episode Subtext Resolver (eliminates triple duplication)
function resolveReleaseSchedule(item, selectedWeekend) {
  let airDate = item.type === 'Movie' ? (item.streamingDate || item.releaseDate) : item.releaseDate;
  let subtext = item.type === 'Movie' ? (item.duration !== "N/A" ? item.duration : "Movie") : "Season 1";

  if (item.type === 'TV Show') {
    const lastEp = item.details && item.details.last_episode_to_air;
    const nextEp = item.details && item.details.next_episode_to_air;
    const matchedEp = item.matchedWeekendEpisode;
    const seasons = (item.details && item.details.seasons) || [];

    if (matchedEp && isReleaseInSelectedWeekend(matchedEp.air_date, selectedWeekend)) {
      airDate = matchedEp.air_date;
      subtext = `S${matchedEp.season_number} E${matchedEp.episode_number}`;
    } else if (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) {
      airDate = nextEp.air_date;
      subtext = `S${nextEp.season_number} E${nextEp.episode_number}`;
    } else if (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend)) {
      airDate = lastEp.air_date;
      subtext = `S${lastEp.season_number} E${lastEp.episode_number}`;
    } else if (seasons.length > 0) {
      const latestSeason = seasons[seasons.length - 1].season_number;
      subtext = `Season ${latestSeason}`;
    }
  }

  return {
    airDate,
    formattedDate: formatAiringDate(airDate),
    subtext,
    inSelectedWeekend: Boolean(item.isCurated || isReleaseInSelectedWeekend(airDate, selectedWeekend))
  };
}

// Helper to format date in local YYYY-MM-DD format (prevents timezone shifts)
function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper to format the display range text for the weekend dropdown
function formatWeekendText(fridayDate) {
  const sundayDate = new Date(fridayDate);
  sundayDate.setDate(fridayDate.getDate() + 2);
  
  const fMonth = fridayDate.toLocaleDateString('en-US', { month: 'long' });
  const fDay = fridayDate.getDate();
  const fYear = fridayDate.getFullYear();
  
  const sMonth = sundayDate.toLocaleDateString('en-US', { month: 'long' });
  const sDay = sundayDate.getDate();
  const sYear = sundayDate.getFullYear();
  
  if (fYear !== sYear) {
    return `${fridayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${sundayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  
  if (fMonth !== sMonth) {
    const fMonthShort = fridayDate.toLocaleDateString('en-US', { month: 'short' });
    const sMonthShort = sundayDate.toLocaleDateString('en-US', { month: 'short' });
    return `${fMonthShort} ${fDay} – ${sMonthShort} ${sDay}, ${fYear}`;
  }
  
  return `${fMonth} ${fDay} – ${sDay}, ${fYear}`;
}

// Dynamically generate 3 weekend choices (Previous, Current, Upcoming) centered on the current week's Friday
function populateWeekendDropdown() {
  const now = new Date();
  const day = now.getDay();
  let diffToFriday = 0;
  if (day === 0) diffToFriday = -2;
  else if (day === 6) diffToFriday = -1;
  else diffToFriday = 5 - day;
  
  const currentFriday = new Date(now);
  currentFriday.setDate(now.getDate() + diffToFriday);
  
  weekendSelect.innerHTML = '';
  
  for (let offset = -1; offset <= 1; offset++) {
    const fDate = new Date(currentFriday);
    fDate.setDate(currentFriday.getDate() + offset * 7);
    
    const value = getLocalDateString(fDate);
    const rangeText = formatWeekendText(fDate);
    
    let label = '';
    if (offset === 0) {
      label = ' (Current)';
    } else if (offset === -1) {
      label = ' (Previous)';
    } else if (offset === 1) {
      label = ' (Upcoming)';
    }
    
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${rangeText}${label}`;
    
    if (offset === 0) {
      option.selected = true;
    }
    
    weekendSelect.appendChild(option);
  }
}

// Delegated Card Click & Keyboard Handler
function handleGridInteraction(e) {
  const rtLink = e.target.closest('.rt-link');
  if (rtLink) {
    e.stopPropagation();
    return;
  }

  const watchlistBtn = e.target.closest('.watchlist-btn');
  if (watchlistBtn) {
    e.stopPropagation();
    const id = Number(watchlistBtn.dataset.id);
    const type = watchlistBtn.dataset.type;
    toggleWatchlist(id, null, type);
    return;
  }

  const card = e.target.closest('.release-card');
  if (card) {
    const id = Number(card.dataset.id);
    const type = card.dataset.type;
    openModal(id, type);
  }
}

function handleGridKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const target = e.target;
  if (target.classList.contains('release-card')) {
    e.preventDefault();
    const id = Number(target.dataset.id);
    const type = target.dataset.type;
    openModal(id, type);
  }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker cleanly (CSP-compliant)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then(reg => console.log('Service Worker registered successfully.', reg.scope))
        .catch(err => console.error('Service Worker registration failed.', err));
    });
  }

  // Populate the weekend picker dropdown dynamically
  populateWeekendDropdown();

  // 1. Setup Event Listeners
  weekendSelect.addEventListener('change', async () => {
    await loadWeekendData();
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      activeTypeFilter = btn.dataset.filter;
      render();
    });
  });

  platformSelect.addEventListener('change', (e) => {
    activePlatformFilter = e.target.value;
    render();
  });

  // Event delegation for Spotlight and Standard release grids
  [spotlightGrid, releasesGrid].forEach(grid => {
    if (!grid) return;
    grid.addEventListener('click', handleGridInteraction);
    grid.addEventListener('keydown', handleGridKeydown);
  });

  if (btnApiSettings) {
    btnApiSettings.addEventListener('click', () => openApiKeyModal());
  }
  if (apiModalClose) {
    apiModalClose.addEventListener('click', closeApiKeyModal);
  }
  if (apiKeyModalOverlay) {
    apiKeyModalOverlay.addEventListener('click', (e) => {
      if (e.target === apiKeyModalOverlay) closeApiKeyModal();
    });
  }
  if (apiKeyForm) {
    apiKeyForm.addEventListener('submit', handleSaveApiKey);
  }
  if (btnClearApiKey) {
    btnClearApiKey.addEventListener('click', handleClearApiKey);
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    const activeModalOverlay = (apiKeyModalOverlay && apiKeyModalOverlay.classList.contains('open'))
      ? apiKeyModalOverlay
      : (modalOverlay && modalOverlay.classList.contains('open') ? modalOverlay : null);

    if (!activeModalOverlay) return;

    if (e.key === 'Escape') {
      if (activeModalOverlay === apiKeyModalOverlay) {
        closeApiKeyModal();
      } else {
        closeModal();
      }
      return;
    }

    if (e.key === 'Tab') {
      const focusable = activeModalOverlay.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // 2. Load Genres & Weekend Data (or prompt for API key if not configured)
  if (!tmdbApiKey) {
    renderMissingApiKeyState();
    openApiKeyModal();
  } else {
    await initGenres();
    await loadWeekendData();
  }
});

// API Key Modal Controllers
function openApiKeyModal(errorMessage = '') {
  if (!apiKeyModalOverlay) return;
  lastFocusedElement = document.activeElement;
  apiKeyInput.value = tmdbApiKey;
  if (errorMessage) {
    apiKeyError.textContent = errorMessage;
    apiKeyError.style.display = 'block';
  } else {
    apiKeyError.style.display = 'none';
  }
  apiKeyModalOverlay.classList.add('open');
  apiKeyModalOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  apiKeyInput.focus();
}

function closeApiKeyModal() {
  if (!apiKeyModalOverlay) return;
  apiKeyModalOverlay.classList.remove('open');
  apiKeyModalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}

async function handleSaveApiKey(e) {
  e.preventDefault();
  const candidateKey = apiKeyInput.value.trim();
  if (!candidateKey) {
    apiKeyError.textContent = 'Please enter a valid TMDB API key.';
    apiKeyError.style.display = 'block';
    return;
  }

  try {
    const testRes = await fetch(`${BASE_URL}/genre/movie/list?api_key=${encodeURIComponent(candidateKey)}`);
    if (!testRes.ok) {
      apiKeyError.textContent = 'Invalid TMDB API key. Please check your key and try again.';
      apiKeyError.style.display = 'block';
      return;
    }
    tmdbApiKey = candidateKey;
    try {
      localStorage.setItem(API_KEY_STORAGE_KEY, tmdbApiKey);
    } catch (storageErr) {
      console.warn('Unable to persist API key to localStorage:', storageErr);
    }
    closeApiKeyModal();
    await initGenres();
    await loadWeekendData();
  } catch (err) {
    apiKeyError.textContent = 'Network error while verifying API key. Please check your connection.';
    apiKeyError.style.display = 'block';
  }
}

function handleClearApiKey() {
  tmdbApiKey = '';
  apiKeyInput.value = '';
  try {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch (err) {
    console.warn('Unable to clear API key from localStorage:', err);
  }
  closeApiKeyModal();
  renderMissingApiKeyState();
}

function renderMissingApiKeyState() {
  spotlightSection.style.display = 'none';
  releasesGrid.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">🔑</div>
      <h3>TMDB API Key Required</h3>
      <p style="margin-bottom: 1rem;">Configure your personal TMDB API key to load live weekend streaming releases on this device.</p>
      <button type="button" class="btn-primary" id="btn-inline-api-setup">Enter TMDB API Key</button>
    </div>
  `;
  const inlineBtn = document.getElementById('btn-inline-api-setup');
  if (inlineBtn) {
    inlineBtn.addEventListener('click', () => openApiKeyModal());
  }
}

// Fetch and Cache Genres from TMDB
async function initGenres() {
  if (!tmdbApiKey) return;
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${BASE_URL}/genre/movie/list?api_key=${encodeURIComponent(tmdbApiKey)}`),
      fetch(`${BASE_URL}/genre/tv/list?api_key=${encodeURIComponent(tmdbApiKey)}`)
    ]);
    if (!movieRes.ok || !tvRes.ok) return;
    const movieData = await movieRes.json();
    const tvData = await tvRes.json();
    
    const allGenres = [...(movieData.genres || []), ...(tvData.genres || [])];
    allGenres.forEach(g => {
      genreMap[g.id] = g.name;
    });
  } catch (err) {
    console.error("Failed to load genres from TMDB:", err);
  }
}

// Helper to resolve TMDB watch provider logo path for major streaming platforms
function getLogoForPlatform(platformName) {
  if (!platformName) return null;
  const name = platformName.toLowerCase();
  if (name.includes("netflix")) {
    return "https://image.tmdb.org/t/p/original/pTpxStgKIICwRedszW4BBsiP7ls.jpg";
  } else if (name.includes("hbo max") || name.includes("max")) {
    return "https://image.tmdb.org/t/p/original/kkB621424755aG28EtU39ez405a.jpg";
  } else if (name.includes("paramount")) {
    return "https://image.tmdb.org/t/p/original/kiwG3Z1m13J1eSard8nH5C66mBg.jpg";
  } else if (name.includes("apple")) {
    return "https://image.tmdb.org/t/p/original/68SpthnPI546u10oIE83jqv55Zt.jpg";
  } else if (name.includes("peacock")) {
    return "https://image.tmdb.org/t/p/original/87gV2lskY9H329tJadH1N76mE0I.jpg";
  } else if (name.includes("disney")) {
    return "https://image.tmdb.org/t/p/original/78vJi961LIUyw0vUTu7O4ZKJ1m5.jpg";
  } else if (name.includes("mgm")) {
    return "https://image.tmdb.org/t/p/original/r2nFtrKGezfBEV2xA3gufBaqi5j.jpg";
  } else if (name.includes("prime")) {
    return "https://image.tmdb.org/t/p/original/ou84u9ULW1w5z148tMof213c476.jpg";
  }
  return null;
}

// Map TMDB movie response (either discover or detail response) to our app structure
function mapMovie(m, isCurated = false) {
  const genreIds = m.genre_ids || (m.genres ? m.genres.map(g => g.id) : []);
  return {
    id: m.id,
    title: m.title || "Untitled Movie",
    type: "Movie",
    releaseDate: m.release_date || "",
    genreIds: genreIds,
    rating: "NR",
    duration: "N/A",
    userRating: Math.round((m.vote_average || 0) * 10) / 10,
    backdropPath: m.backdrop_path || null,
    posterPath: m.poster_path || null,
    synopsis: m.overview || "No overview available.",
    platform: "Digital Release",
    platformLogo: "🌐",
    spotlight: m.popularity > 80 || isCurated,
    popularity: m.popularity || 0,
    isCurated: isCurated,
    cast: [],
    rawDetails: m.release_dates ? m : null
  };
}

// Map TMDB TV response to our app structure
function mapTv(t, isCurated = false) {
  const genreIds = t.genre_ids || (t.genres ? t.genres.map(g => g.id) : []);
  const currentYearStart = new Date(new Date().getFullYear(), 0, 1);
  return {
    id: t.id,
    title: t.name || "Untitled Show",
    type: "TV Show",
    releaseDate: t.first_air_date || "",
    genreIds: genreIds,
    rating: "TV-14",
    seasons: (t.first_air_date && new Date(t.first_air_date) < currentYearStart) ? "Returning Series" : "New Series",
    userRating: Math.round((t.vote_average || 0) * 10) / 10,
    backdropPath: t.backdrop_path || null,
    posterPath: t.poster_path || null,
    synopsis: t.overview || "No overview available.",
    platform: "Streaming",
    platformLogo: "📺",
    spotlight: t.popularity > 80 || isCurated,
    popularity: t.popularity || 0,
    isCurated: isCurated,
    cast: [],
    rawDetails: t.content_ratings ? t : null
  };
}

// Apply enriched TMDB detail response (including release_dates/content_ratings, watch/providers, credits) to an item
function applyDetailsToItem(item, detailsData, selectedWeekend) {
  if (!detailsData) return;
  item.details = detailsData;
  item.rating = extractUSCertification(detailsData, item.type);
  item.cast = (detailsData.credits && detailsData.credits.cast || []).slice(0, 4).map(c => c.name);

  if (item.type === "Movie") {
    if (detailsData.runtime) {
      item.duration = `${Math.floor(detailsData.runtime / 60)}h ${detailsData.runtime % 60}m`;
    }
    const streamingDate = getUSDigitalReleaseDate(detailsData, selectedWeekend);
    if (streamingDate) {
      item.streamingDate = streamingDate;
    }
  }

  // Extract watch providers from appended response
  const providersRoot = detailsData['watch/providers'] || detailsData.watch_providers;
  const usProviders = providersRoot && providersRoot.results && providersRoot.results.US;
  if (usProviders) {
    // Exclude "Apple TV Store" from the results as it represents buy/rent options that clutter the guide
    const filterOutStore = list => (list || []).filter(p => p.provider_name !== "Apple TV Store");
    
    const flatrate = filterOutStore(usProviders.flatrate);
    const ads = filterOutStore(usProviders.ads);
    const buy = filterOutStore(usProviders.buy);
    const rent = filterOutStore(usProviders.rent);

    let providersList = [];
    if (flatrate.length > 0) {
      providersList = flatrate;
    } else if (ads.length > 0) {
      providersList = ads;
    } else if (buy.length > 0) {
      providersList = buy;
    } else if (rent.length > 0) {
      providersList = rent;
    }

    if (providersList.length > 0) {
      // Sort based on priority list of major subscription platforms (copied to avoid mutating original)
      const sortedProviders = [...providersList].sort((a, b) => {
        const nameA = a.provider_name.toLowerCase();
        const nameB = b.provider_name.toLowerCase();
        
        let indexA = PLATFORM_PRIORITY.findIndex(p => nameA.includes(p.toLowerCase()));
        let indexB = PLATFORM_PRIORITY.findIndex(p => nameB.includes(p.toLowerCase()));
        
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;
        
        return indexA - indexB;
      });

      const bestProvider = sortedProviders[0];
      item.platform = bestProvider.provider_name;
      item.platformLogoUrl = `https://image.tmdb.org/t/p/original${bestProvider.logo_path}`;
      item.allPlatforms = sortedProviders.map(p => ({
        name: p.provider_name,
        logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
      }));
    }
  }

  // Fallback for TV networks if watch providers are empty in TMDB
  if ((!item.platform || item.platform === "Streaming" || item.platform === "Digital Release") && detailsData.networks && detailsData.networks.length > 0) {
    const priorityNetworks = detailsData.networks.filter(n => {
      const name = n.name.toLowerCase();
      return PLATFORM_PRIORITY.some(p => name.includes(p.toLowerCase()));
    });
    
    const bestNetwork = priorityNetworks[0] || detailsData.networks[0];
    if (bestNetwork) {
      item.platform = bestNetwork.name;
      if (bestNetwork.logo_path) {
        item.platformLogoUrl = `https://image.tmdb.org/t/p/original${bestNetwork.logo_path}`;
      } else {
        item.platformLogoUrl = getLogoForPlatform(bestNetwork.name);
      }
      item.allPlatforms = [{
        name: bestNetwork.name,
        logo: item.platformLogoUrl
      }];
    }
  }

  // Fallback for curated items that don't have watch providers listed in TMDB yet
  if (item.isCurated) {
    const curatedList = CURATED_RELEASES[selectedWeekend];
    if (curatedList) {
      const list = item.type === "Movie" ? curatedList.movie : curatedList.tv;
      const curatedInfo = list.find(c => c.id === item.id);

      if (curatedInfo) {
        if (curatedInfo.titleOverride) {
          item.title = curatedInfo.titleOverride;
        }
        if (!item.platformLogoUrl && curatedInfo.platform) {
          item.platform = curatedInfo.platform;
          item.platformLogoUrl = getLogoForPlatform(curatedInfo.platform);
          item.allPlatforms = [{
            name: curatedInfo.platform,
            logo: item.platformLogoUrl
          }];
        }
      }
    }
  }

  // Upgrade any legacy numeric watchlist entry into a full v2 item snapshot
  const key = getCompositeKey(item.type, item.id);
  if (legacyWatchlistIds.has(Number(item.id)) || watchlistMap[key]) {
    watchlistMap[key] = item;
    legacyWatchlistIds.delete(Number(item.id));
  }
}

// Load Movie and TV Releases for selected weekend (with AbortController & consolidated single-request hydration)
async function loadWeekendData() {
  if (!tmdbApiKey) {
    renderMissingApiKeyState();
    return;
  }

  if (activeLoadController) {
    activeLoadController.abort();
  }
  activeLoadController = new AbortController();
  const { signal } = activeLoadController;

  // Show loading indicator
  releasesGrid.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 4rem 1.5rem; color: var(--text-secondary);">
      <div style="font-size: 2rem; animation: spin 1s infinite linear; display: inline-block; margin-bottom: 1rem;">⏳</div>
      <h3>Fetching live TMDB releases...</h3>
      <p>Please wait while we load this weekend's streaming guide.</p>
    </div>
  `;
  spotlightSection.style.display = 'none';

  const selectedWeekend = weekendSelect.value;
  const startDate = selectedWeekend;
  
  // Calculate date range: Preceding Monday to Following Monday (8-day window)
  const start = new Date(startDate + 'T00:00:00');
  
  const qStart = new Date(start);
  qStart.setDate(start.getDate() - 4);
  const qStartDateStr = getLocalDateString(qStart);
  
  const qEnd = new Date(start);
  qEnd.setDate(start.getDate() + 3);
  const qEndDateStr = getLocalDateString(qEnd);
  const encodedKey = encodeURIComponent(tmdbApiKey);

  try {
    // 1. Fetch 3 pages of TV shows and Movies from discover endpoints
    const moviePromises = [];
    const tvPromises = [];
    for (let page = 1; page <= 3; page++) {
      moviePromises.push(fetch(`${BASE_URL}/discover/movie?api_key=${encodedKey}&release_date.gte=${qStartDateStr}&release_date.lte=${qEndDateStr}&with_release_type=4|6&region=US&sort_by=popularity.desc&page=${page}`, { signal }));
      tvPromises.push(fetch(`${BASE_URL}/discover/tv?api_key=${encodedKey}&air_date.gte=${qStartDateStr}&air_date.lte=${qEndDateStr}&sort_by=popularity.desc&page=${page}`, { signal }));
    }
    // Also fetch the first 2 pages of TV series premieres (first_air_date) to capture new low-popularity shows
    for (let page = 1; page <= 2; page++) {
      tvPromises.push(fetch(`${BASE_URL}/discover/tv?api_key=${encodedKey}&first_air_date.gte=${qStartDateStr}&first_air_date.lte=${qEndDateStr}&sort_by=popularity.desc&page=${page}`, { signal }));
    }

    // 2. Fetch Curated Items details directly (including release_dates/content_ratings, watch/providers, and credits in 1 call)
    const curated = CURATED_RELEASES[selectedWeekend] || { tv: [], movie: [] };
    const curatedMovieIds = curated.movie.map(c => c.id);
    const curatedTvIds = curated.tv.map(c => c.id);

    let curatedMovies = [];
    let curatedTv = [];

    if (curatedMovieIds.length > 0 || curatedTvIds.length > 0) {
      const cMovieResponses = await Promise.all(
        curatedMovieIds.map(id => fetch(`${BASE_URL}/movie/${id}?api_key=${encodedKey}&append_to_response=release_dates,watch/providers,credits`, { signal }))
      );
      const cTvResponses = await Promise.all(
        curatedTvIds.map(id => fetch(`${BASE_URL}/tv/${id}?api_key=${encodedKey}&append_to_response=content_ratings,watch/providers,credits`, { signal }))
      );
      
      const cMoviesData = await Promise.all(cMovieResponses.map(r => r.ok ? r.json() : null));
      const cTvData = await Promise.all(cTvResponses.map(r => r.ok ? r.json() : null));
      
      curatedMovies = cMoviesData.filter(m => m && m.id && !m.status_message);
      curatedTv = cTvData.filter(t => t && t.id && !t.status_message);
    }

    // Resolve discover API responses
    const movieResponses = await Promise.all(moviePromises);
    const tvResponses = await Promise.all(tvPromises);
    
    const moviesData = await Promise.all(movieResponses.map(r => r.ok ? r.json() : { results: [] }));
    const tvData = await Promise.all(tvResponses.map(r => r.ok ? r.json() : { results: [] }));

    let discoverMovies = [];
    moviesData.forEach(data => {
      discoverMovies = discoverMovies.concat(data.results || []);
    });

    let discoverTv = [];
    tvData.forEach(data => {
      discoverTv = discoverTv.concat(data.results || []);
    });

    // Map all results to app structures
    const mappedDiscoverMovies = discoverMovies.map(m => mapMovie(m, curatedMovieIds.includes(m.id)));
    const mappedDiscoverTv = discoverTv.map(t => mapTv(t, curatedTvIds.includes(t.id)));
    const mappedCuratedMovies = curatedMovies.map(m => mapMovie(m, true));
    const mappedCuratedTv = curatedTv.map(t => mapTv(t, true));

    // Combine and deduplicate (Curated items take precedence as they already carry full appended details)
    const movieMap = new Map();
    [...mappedCuratedMovies, ...mappedDiscoverMovies].forEach(m => {
      if (!movieMap.has(m.id)) movieMap.set(m.id, m);
    });

    const tvMap = new Map();
    [...mappedCuratedTv, ...mappedDiscoverTv].forEach(t => {
      if (!tvMap.has(t.id)) tvMap.set(t.id, t);
    });

    let combined = [...movieMap.values(), ...tvMap.values()];

    // Group movies first, followed by TV shows, sorted by popularity within their types
    combined.sort((a, b) => {
      if (a.type === b.type) {
        return b.popularity - a.popularity;
      }
      return a.type === "Movie" ? -1 : 1;
    });

    // 3. Hydrate all items using a single consolidated request per item + bounded concurrency (8 workers)
    await mapWithConcurrency(combined, 8, async (item) => {
      try {
        // If curated item was already fetched with full appended details, reuse it without a duplicate network call!
        if (item.rawDetails) {
          const detailsData = item.rawDetails;
          delete item.rawDetails;
          applyDetailsToItem(item, detailsData, selectedWeekend);
          return;
        }

        const pathType = item.type === "Movie" ? "movie" : "tv";
        const append = item.type === "Movie"
          ? "release_dates,watch/providers,credits"
          : "content_ratings,watch/providers,credits";
        const detailsUrl = `${BASE_URL}/${pathType}/${item.id}?api_key=${encodedKey}&append_to_response=${append}`;

        const detailsRes = await fetch(detailsUrl, { signal });
        if (!detailsRes.ok) return;
        const detailsData = await detailsRes.json();

        applyDetailsToItem(item, detailsData, selectedWeekend);

        // When browsing a Previous or Upcoming weekend, if neither last_episode_to_air nor next_episode_to_air
        // falls in the selected weekend, check the active season's episode list so weekly shows aren't missed.
        if (item.type === "TV Show") {
          const lastEp = detailsData.last_episode_to_air;
          const nextEp = detailsData.next_episode_to_air;
          const hasMatchingSummaryEp =
            (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) ||
            (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend));

          if (!hasMatchingSummaryEp) {
            const candidateSeasonNum =
              (nextEp && nextEp.season_number) ||
              (lastEp && lastEp.season_number) ||
              (detailsData.seasons && detailsData.seasons.length > 0
                ? detailsData.seasons[detailsData.seasons.length - 1].season_number
                : null);

            if (candidateSeasonNum !== null && candidateSeasonNum !== undefined) {
              const seasonRes = await fetch(
                `${BASE_URL}/tv/${item.id}/season/${candidateSeasonNum}?api_key=${encodedKey}`,
                { signal }
              );
              if (seasonRes.ok) {
                const seasonData = await seasonRes.json();
                const matchingEp = (seasonData.episodes || []).find(ep =>
                  isReleaseInSelectedWeekend(ep.air_date, selectedWeekend)
                );
                if (matchingEp) {
                  item.matchedWeekendEpisode = matchingEp;
                }
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.error(`Failed to fetch details for ${item.title}:`, err);
      }
    }, signal);

    if (signal.aborted) return;

    // Persist any upgraded watchlist snapshots
    saveWatchlistState();

    // Filter to only include curated releases or releases within the Wednesday-Sunday range of this weekend
    currentReleases = combined.filter(item => {
      const schedule = resolveReleaseSchedule(item, selectedWeekend);
      return schedule.inSelectedWeekend;
    });
    
    // 4. Update Platform Selector dynamically (preserving active selection if still available)
    populatePlatformDropdown();

    // 5. Render
    render();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Failed loading TMDB releases:", err);
    releasesGrid.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">⚠️</div>
        <h3>Failed to fetch live data</h3>
        <p>Please check your internet connection or try again later.</p>
      </div>
    `;
  }
}

// Populate Platform selector options from current releases while preserving active filter state
function populatePlatformDropdown() {
  const previousSelection = activePlatformFilter;
  platformSelect.innerHTML = '<option value="all">All Services</option>';
  
  const platforms = [];
  currentReleases.forEach(r => {
    if (r.platform && r.platform !== "Digital Release" && r.platform !== "Streaming") {
      platforms.push(r.platform);
    }
  });

  const uniquePlatforms = [...new Set(platforms)];
  uniquePlatforms.forEach(platform => {
    const option = document.createElement('option');
    option.value = platform;
    option.textContent = platform;
    platformSelect.appendChild(option);
  });

  if (previousSelection !== 'all' && uniquePlatforms.includes(previousSelection)) {
    platformSelect.value = previousSelection;
  } else {
    activePlatformFilter = 'all';
    platformSelect.value = 'all';
  }
}

// Watchlist Logic (supports composite type:id keys & cross-weekend snapshot persistence)
function toggleWatchlist(id, event, type = null) {
  if (event) {
    event.stopPropagation(); // Prevent opening modal
  }

  const numericId = Number(id);
  let targetItem = currentReleases.find(
    r => r.id === numericId && (!type || r.type === type)
  );

  if (!targetItem) {
    // Check stored watchlist snapshots if toggling from the Watchlist tab on a different weekend
    targetItem = Object.values(watchlistMap).find(
      r => r.id === numericId && (!type || r.type === type)
    );
  }

  const resolvedType = type || (targetItem ? targetItem.type : 'Movie');
  const key = getCompositeKey(resolvedType, numericId);
  const currentlyWatchlisted = Boolean(watchlistMap[key]) || legacyWatchlistIds.has(numericId);

  if (currentlyWatchlisted) {
    delete watchlistMap[key];
    legacyWatchlistIds.delete(numericId);
  } else if (targetItem) {
    watchlistMap[key] = targetItem;
  } else {
    legacyWatchlistIds.add(numericId);
  }

  saveWatchlistState();
  render();
  
  // Update modal button if open
  if (modalOverlay.classList.contains('open')) {
    const isNowOpenWatchlisted = Boolean(watchlistMap[key]) || legacyWatchlistIds.has(numericId);
    btnModalWatchlist.innerHTML = isNowOpenWatchlisted 
      ? '💖 In Watchlist' 
      : '➕ Add to Watchlist';
    btnModalWatchlist.classList.toggle('active', isNowOpenWatchlisted);
    btnModalWatchlist.setAttribute('aria-pressed', String(isNowOpenWatchlisted));
  }
}

// Filtering Function (supports cross-weekend Watchlist snapshots & Cast search)
function getFilteredData() {
  // When viewing the Watchlist tab, merge current weekend releases with persisted snapshots from other weekends
  let sourceList = currentReleases;
  if (activeTypeFilter === 'watchlist') {
    const mergedMap = new Map();
    Object.values(watchlistMap).forEach(item => {
      if (item && item.id) {
        mergedMap.set(getCompositeKey(item.type, item.id), item);
      }
    });
    currentReleases.forEach(item => {
      if (isItemWatchlisted(item)) {
        mergedMap.set(getCompositeKey(item.type, item.id), item);
      }
    });
    sourceList = [...mergedMap.values()];
  }

  return sourceList.filter(release => {
    // 1. Search Query filter (Title, Synopsis, Genre, and Cast)
    const matchesSearch = !searchQuery ||
      release.title.toLowerCase().includes(searchQuery) ||
      release.synopsis.toLowerCase().includes(searchQuery) ||
      (release.genreIds || []).some(id => (genreMap[id] || '').toLowerCase().includes(searchQuery)) ||
      (release.cast || []).some(actor => actor.toLowerCase().includes(searchQuery));
    
    // 2. Type tab filter
    let matchesType = true;
    if (activeTypeFilter === 'movie') {
      matchesType = release.type === 'Movie';
    } else if (activeTypeFilter === 'tv') {
      matchesType = release.type === 'TV Show';
    } else if (activeTypeFilter === 'watchlist') {
      matchesType = isItemWatchlisted(release);
    }
    
    // 3. Platform select filter
    const matchesPlatform = activePlatformFilter === 'all' || release.platform === activePlatformFilter;
    
    return matchesSearch && matchesType && matchesPlatform;
  });
}

// Render Listings
function render() {
  const filtered = getFilteredData();
  
  // Split into spotlight and standard
  const spotlightItems = filtered.filter(item => item.spotlight && activeTypeFilter !== 'watchlist');
  const standardItems = filtered.filter(item => !item.spotlight || activeTypeFilter === 'watchlist');
  
  // Toggle visibility of spotlight section if filtering or empty
  if (spotlightItems.length > 0 && searchQuery === '' && activePlatformFilter === 'all') {
    spotlightSection.style.display = 'block';
    spotlightGrid.innerHTML = spotlightItems.map(item => createCardHtml(item, true)).join('');
  } else {
    spotlightSection.style.display = 'none';
  }
  
  if (filtered.length === 0) {
    releasesGrid.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <h3>No matches found</h3>
        <p>Try refining your search query or selecting a different filter.</p>
      </div>
    `;
    return;
  }
  
  // If we had no spotlight section, show all items in the main grid
  const itemsToDisplay = spotlightSection.style.display === 'none' ? filtered : standardItems;
  releasesGrid.innerHTML = itemsToDisplay.map(item => createCardHtml(item, false)).join('');
}

function createCardHtml(item, isSpotlight) {
  const isWatchlisted = isItemWatchlisted(item);
  const safeTitle = escapeHtml(item.title);
  const safeType = escapeHtml(item.type);
  const safePlatform = escapeHtml(item.platform);
  const safeRating = escapeHtml(item.rating);
  const safeSynopsis = escapeHtml(item.synopsis);
  
  // Setup rotten tomatoes link html (dynamic search fallback with noopener noreferrer)
  const rtSearchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(item.title)}`;
  const rtHtml = `<a href="${escapeHtml(rtSearchUrl)}" target="_blank" rel="noopener noreferrer" class="rt-link">🍅 Rotten Tomatoes</a>`;

  // Image Backdrops & Posters
  const backdropUrl = item.backdropPath 
    ? `url(https://image.tmdb.org/t/p/w780${encodeURI(item.backdropPath)})` 
    : `linear-gradient(135deg, #e2e8f0, #cbd5e1)`;

  // Platform badges
  const platformLogoHtml = item.platformLogoUrl 
    ? `<img src="${escapeHtml(item.platformLogoUrl)}" alt="${safePlatform}" style="width: 16px; height: 16px; border-radius: 3px;">`
    : `<span>${escapeHtml(item.platformLogo || '🌐')}</span>`;

  // Map genre names
  const genres = (item.genreIds || []).map(id => genreMap[id]).filter(Boolean).slice(0, 2);

  const selectedWeekend = weekendSelect.value;
  const schedule = resolveReleaseSchedule(item, selectedWeekend);

  let metaHtml = `
    <span class="card-rating-star">★ ${escapeHtml(item.userRating)}</span>
    <span>•</span>
    <span>${safeRating}</span>
    <span>•</span>
    <span>${escapeHtml(schedule.subtext)}</span>
  `;

  if (schedule.formattedDate) {
    metaHtml += `<span>•</span><span class="air-date-highlight">🗓️ ${escapeHtml(schedule.formattedDate)}</span>`;
  }

  const watchlistAriaLabel = isWatchlisted
    ? `Remove ${safeTitle} from watchlist`
    : `Add ${safeTitle} to watchlist`;

  return `
    <div class="release-card ${isSpotlight ? 'spotlight-card' : ''}" role="button" tabindex="0" data-id="${escapeHtml(item.id)}" data-type="${safeType}" aria-label="View details for ${safeTitle}">
      <div class="card-visual" style="background-image: ${backdropUrl}; background-size: cover; background-position: center;">
        <div class="card-gradient-overlay"></div>
        <div class="card-badges">
          <span class="type-badge">${safeType}</span>
        </div>
        <button type="button" class="watchlist-btn ${isWatchlisted ? 'active' : ''}" data-id="${escapeHtml(item.id)}" data-type="${safeType}" aria-label="${watchlistAriaLabel}" aria-pressed="${isWatchlisted}">
          ${isWatchlisted ? '💖' : '🤍'}
        </button>
      </div>
      <div class="card-content">
        <div class="platform-pill">
          ${platformLogoHtml}
          <span>${safePlatform}</span>
        </div>
        <h3 class="card-title">${safeTitle}</h3>
        <div class="card-meta">
          ${metaHtml}
        </div>
        <p class="card-synopsis">${safeSynopsis}</p>
        <div class="card-footer">
          <div class="card-genres">
            ${genres.map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('')}
          </div>
          ${rtHtml}
        </div>
      </div>
    </div>
  `;
}

// Modal Controllers
async function openModal(id, type = null) {
  const numericId = Number(id);
  let item = currentReleases.find(r => r.id === numericId && (!type || r.type === type));
  if (!item) {
    item = Object.values(watchlistMap).find(r => r.id === numericId && (!type || r.type === type));
  }
  if (!item) return;

  lastFocusedElement = document.activeElement;

  const pathType = item.type === "Movie" ? "movie" : "tv";
  const safePlatform = escapeHtml(item.platform);

  // Set initial modal details from cached data
  modalTitle.textContent = item.title;
  modalType.textContent = item.type;
  modalRating.textContent = item.rating;
  modalSynopsis.textContent = item.synopsis;

  const backdropUrl = item.backdropPath 
    ? `url(https://image.tmdb.org/t/p/w780${encodeURI(item.backdropPath)})` 
    : `linear-gradient(135deg, #e2e8f0, #cbd5e1)`;
  modalHero.style.backgroundImage = backdropUrl;
  modalHero.style.backgroundSize = 'cover';
  modalHero.style.backgroundPosition = 'center';

  // Watch provider listing
  if (item.platformLogoUrl) {
    modalPlatform.innerHTML = `<img src="${escapeHtml(item.platformLogoUrl)}" alt="${safePlatform}" style="width: 16px; height: 16px; border-radius: 3px;"> <span>Available on ${safePlatform}</span>`;
  } else {
    modalPlatform.innerHTML = `<span>${escapeHtml(item.platformLogo || '🌐')}</span> <span>${safePlatform}</span>`;
  }

  const selectedWeekend = weekendSelect.value;
  const schedule = resolveReleaseSchedule(item, selectedWeekend);

  let dateLabel = "";
  if (schedule.formattedDate) {
    dateLabel = item.type === 'Movie' ? `Streaming: ${schedule.formattedDate}` : `Airing: ${schedule.formattedDate}`;
  } else {
    dateLabel = item.releaseDate || "";
  }

  const modalMeta = `${dateLabel} • ${schedule.subtext} • ★ ${item.userRating}`;
  modalInfoText.textContent = modalMeta;

  // Dynamic Rotten Tomatoes link
  const rtSearchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(item.title)}`;
  btnRottenTomatoes.href = rtSearchUrl;

  // Watchlist setup
  const isWatchlisted = isItemWatchlisted(item);
  btnModalWatchlist.innerHTML = isWatchlisted ? '💖 In Watchlist' : '➕ Add to Watchlist';
  btnModalWatchlist.className = `btn-secondary ${isWatchlisted ? 'active' : ''}`;
  btnModalWatchlist.setAttribute('aria-pressed', String(isWatchlisted));
  btnModalWatchlist.onclick = () => toggleWatchlist(item.id, null, item.type);

  modalOverlay.classList.add('open');
  modalOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  modalClose.focus();

  // Render pre-loaded cast immediately if available, otherwise fetch with AbortController guard
  if (item.cast && item.cast.length > 0) {
    castList.innerHTML = item.cast.map(member => `<span class="cast-member">${escapeHtml(member)}</span>`).join('');
    return;
  }

  if (activeModalController) {
    activeModalController.abort();
  }
  activeModalController = new AbortController();
  const { signal } = activeModalController;

  castList.innerHTML = '<span class="cast-member">Loading cast...</span>';

  try {
    const creditsRes = await fetch(`${BASE_URL}/${pathType}/${item.id}/credits?api_key=${encodeURIComponent(tmdbApiKey)}`, { signal });
    if (!creditsRes.ok) throw new Error(`HTTP ${creditsRes.status}`);
    const creditsData = await creditsRes.json();
    const cast = (creditsData.cast || []).slice(0, 4).map(c => c.name);
    item.cast = cast;
    
    if (cast.length > 0) {
      castList.innerHTML = cast.map(member => `<span class="cast-member">${escapeHtml(member)}</span>`).join('');
    } else {
      castList.innerHTML = '<span class="cast-member">N/A</span>';
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error("Failed to load modal credits:", err);
    castList.innerHTML = '<span class="cast-member">N/A</span>';
  }
}

function closeModal() {
  if (activeModalController) {
    activeModalController.abort();
    activeModalController = null;
  }
  modalOverlay.classList.remove('open');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
    lastFocusedElement = null;
  }
}
