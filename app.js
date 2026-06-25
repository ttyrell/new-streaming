// Configuration
const TMDB_API_KEY = 'a3baddb0263957e23fc56b4517ee6499';
const BASE_URL = 'https://api.themoviedb.org/3';

// Application State
let activeTypeFilter = 'all';
let activePlatformFilter = 'all';
let searchQuery = '';
let watchlist = JSON.parse(localStorage.getItem('weekend_watchlist') || '[]');
let currentReleases = []; // Fetched live from TMDB
let genreMap = {}; // Populated at startup: { id: "Genre Name" }

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

// Helper to check if a release falls on the selected week (Monday to Sunday)
function isReleaseInSelectedWeekend(releaseDateStr, weekendStartDateStr) {
  const releaseDate = new Date(releaseDateStr + 'T00:00:00');
  const startDate = new Date(weekendStartDateStr + 'T00:00:00');
  
  const qStart = new Date(startDate);
  qStart.setDate(startDate.getDate() - 4); // Preceding Monday
  
  const qEnd = new Date(startDate);
  qEnd.setDate(startDate.getDate() + 2); // Sunday
  
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

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Fetch Genre Map first
  await initGenres();

  // 2. Initial Data Load
  await loadWeekendData();

  // 3. Setup Event Listeners
  weekendSelect.addEventListener('change', async () => {
    await loadWeekendData();
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    render();
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTypeFilter = btn.dataset.filter;
      render();
    });
  });

  platformSelect.addEventListener('change', (e) => {
    activePlatformFilter = e.target.value;
    render();
  });

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });
});

// Fetch and Cache Genres from TMDB
async function initGenres() {
  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${BASE_URL}/genre/movie/list?api_key=${TMDB_API_KEY}`),
      fetch(`${BASE_URL}/genre/tv/list?api_key=${TMDB_API_KEY}`)
    ]);
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

// Load Movie and TV Releases for selected weekend
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

// Helper to resolve TMDB watch provider logo path for major streaming platforms
function getLogoForPlatform(platformName) {
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
    title: m.title,
    type: "Movie",
    releaseDate: m.release_date,
    genreIds: genreIds,
    rating: m.adult ? "R" : "PG-13", 
    duration: "N/A", 
    userRating: Math.round((m.vote_average || 0) * 10) / 10,
    backdropPath: m.backdrop_path,
    posterPath: m.poster_path,
    synopsis: m.overview || "No overview available.",
    platform: "Digital Release",
    platformLogo: "🌐",
    spotlight: m.popularity > 80 || isCurated,
    popularity: m.popularity,
    isCurated: isCurated
  };
}

// Map TMDB TV response to our app structure
function mapTv(t, isCurated = false) {
  const genreIds = t.genre_ids || (t.genres ? t.genres.map(g => g.id) : []);
  return {
    id: t.id,
    title: t.name,
    type: "TV Show",
    releaseDate: t.first_air_date,
    genreIds: genreIds,
    rating: "TV-14", 
    seasons: new Date(t.first_air_date) < new Date('2026-01-01') ? "Returning Series" : "New Series",
    userRating: Math.round((t.vote_average || 0) * 10) / 10,
    backdropPath: t.backdrop_path,
    posterPath: t.poster_path,
    synopsis: t.overview || "No overview available.",
    platform: "Streaming",
    platformLogo: "📺",
    spotlight: t.popularity > 80 || isCurated,
    popularity: t.popularity,
    isCurated: isCurated
  };
}

// Load Movie and TV Releases for selected weekend (with expanded range & page fetching)
async function loadWeekendData() {
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
  const qStartDateStr = qStart.toISOString().split('T')[0];
  
  const qEnd = new Date(start);
  qEnd.setDate(start.getDate() + 3);
  const qEndDateStr = qEnd.toISOString().split('T')[0];

  try {
    // 1. Fetch 3 pages of TV shows and Movies from discover endpoints (without monetization filters)
    const moviePromises = [];
    const tvPromises = [];
    for (let page = 1; page <= 3; page++) {
      moviePromises.push(fetch(`${BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&release_date.gte=${qStartDateStr}&release_date.lte=${qEndDateStr}&with_release_type=4|6&region=US&sort_by=popularity.desc&page=${page}`));
      tvPromises.push(fetch(`${BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&air_date.gte=${qStartDateStr}&air_date.lte=${qEndDateStr}&sort_by=popularity.desc&page=${page}`));
    }

    // 2. Fetch Curated Items details directly if configured for this weekend
    const curated = CURATED_RELEASES[selectedWeekend] || { tv: [], movie: [] };
    const curatedMovieIds = curated.movie.map(c => c.id);
    const curatedTvIds = curated.tv.map(c => c.id);

    let curatedMovies = [];
    let curatedTv = [];

    if (curatedMovieIds.length > 0 || curatedTvIds.length > 0) {
      const cMovieResponses = await Promise.all(curatedMovieIds.map(id => fetch(`${BASE_URL}/movie/${id}?api_key=${TMDB_API_KEY}`)));
      const cTvResponses = await Promise.all(curatedTvIds.map(id => fetch(`${BASE_URL}/tv/${id}?api_key=${TMDB_API_KEY}`)));
      
      const cMoviesData = await Promise.all(cMovieResponses.map(r => r.json()));
      const cTvData = await Promise.all(cTvResponses.map(r => r.json()));
      
      curatedMovies = cMoviesData.filter(m => m && m.id && !m.status_message);
      curatedTv = cTvData.filter(t => t && t.id && !t.status_message);
    }

    // Resolve discover API responses
    const movieResponses = await Promise.all(moviePromises);
    const tvResponses = await Promise.all(tvPromises);
    
    const moviesData = await Promise.all(movieResponses.map(r => r.json()));
    const tvData = await Promise.all(tvResponses.map(r => r.json()));

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

    // Combine and deduplicate
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

    // 3. Fetch Watch Providers and full Details (runtime, seasons) for all items in parallel
    await Promise.all(combined.map(async (item) => {
      try {
        const pathType = item.type === "Movie" ? "movie" : "tv";
        const [providersRes, detailsRes] = await Promise.all([
          fetch(`${BASE_URL}/${pathType}/${item.id}/watch/providers?api_key=${TMDB_API_KEY}`),
          fetch(`${BASE_URL}/${pathType}/${item.id}?api_key=${TMDB_API_KEY}`)
        ]);

        const providersData = await providersRes.json();
        const detailsData = await detailsRes.json();
        
        item.details = detailsData;

        // Set duration if movie details fetched
        if (item.type === "Movie" && detailsData.runtime) {
          item.duration = `${Math.floor(detailsData.runtime / 60)}h ${detailsData.runtime % 60}m`;
        }

        // Set watch provider
        const usProviders = providersData.results && providersData.results.US;
        if (usProviders) {
          const flatrate = usProviders.flatrate || usProviders.ads || usProviders.buy || usProviders.rent || [];
          if (flatrate.length > 0) {
            item.platform = flatrate[0].provider_name;
            item.platformLogoUrl = `https://image.tmdb.org/t/p/original${flatrate[0].logo_path}`;
            item.allPlatforms = flatrate.map(p => ({
              name: p.provider_name,
              logo: `https://image.tmdb.org/t/p/original${p.logo_path}`
            }));
          }
        }

        // Fallback for curated items that don't have watch providers listed in TMDB yet
        if (item.isCurated) {
          const curatedList = CURATED_RELEASES[selectedWeekend];
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
      } catch (err) {
        console.error(`Failed to fetch details for ${item.title}:`, err);
      }
    }));

    currentReleases = combined;
    
    // 4. Update Platform Selector dynamically
    populatePlatformDropdown();

    // 5. Render
    render();
  } catch (err) {
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

// Populate Platform selector options from current releases
function populatePlatformDropdown() {
  // Clear previous options except "All"
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
}

// Watchlist Logic
function toggleWatchlist(id, event) {
  if (event) {
    event.stopPropagation(); // Prevent opening modal
  }
  const index = watchlist.indexOf(id);
  if (index > -1) {
    watchlist.splice(index, 1);
  } else {
    watchlist.push(id);
  }
  localStorage.setItem('weekend_watchlist', JSON.stringify(watchlist));
  render();
  
  // Update modal button if open
  if (modalOverlay.classList.contains('open')) {
    const isOpen = watchlist.includes(id);
    btnModalWatchlist.innerHTML = isOpen 
      ? '💖 In Watchlist' 
      : '➕ Add to Watchlist';
    btnModalWatchlist.classList.toggle('active', isOpen);
  }
}

// Filtering Function
function getFilteredData() {
  const selectedWeekend = weekendSelect.value;
  
  return currentReleases.filter(release => {
    // 1. Search Query filter
    const matchesSearch = release.title.toLowerCase().includes(searchQuery) ||
                          release.synopsis.toLowerCase().includes(searchQuery) ||
                          release.genreIds.some(id => (genreMap[id] || '').toLowerCase().includes(searchQuery));
    
    // 2. Type tab filter
    let matchesType = true;
    if (activeTypeFilter === 'movie') {
      matchesType = release.type === 'Movie';
    } else if (activeTypeFilter === 'tv') {
      matchesType = release.type === 'TV Show';
    } else if (activeTypeFilter === 'watchlist') {
      matchesType = watchlist.includes(release.id);
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
  const isWatchlisted = watchlist.includes(item.id);
  
  // Setup rotten tomatoes link html (dynamic search fallback)
  const rtSearchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(item.title)}`;
  const rtHtml = `<a href="${rtSearchUrl}" target="_blank" class="rt-link" onclick="event.stopPropagation();">🍅 Rotten Tomatoes</a>`;

  // Image Backdrops & Posters
  const backdropUrl = item.backdropPath 
    ? `url(https://image.tmdb.org/t/p/w780${item.backdropPath})` 
    : `linear-gradient(135deg, #e2e8f0, #cbd5e1)`;

  // Platform badges
  const platformLogoHtml = item.platformLogoUrl 
    ? `<img src="${item.platformLogoUrl}" alt="${item.platform}" style="width: 16px; height: 16px; border-radius: 3px;">`
    : `<span>${item.platformLogo || '🌐'}</span>`;

  // Map genre names
  const genres = (item.genreIds || []).map(id => genreMap[id]).filter(Boolean).slice(0, 2);

  const selectedWeekend = weekendSelect.value;
  let airDate = item.releaseDate;
  if (item.type === 'TV Show') {
    const lastEp = item.details && item.details.last_episode_to_air;
    const nextEp = item.details && item.details.next_episode_to_air;
    if (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) {
      airDate = nextEp.air_date;
    } else if (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend)) {
      airDate = lastEp.air_date;
    }
  }
  const formattedAirDate = formatAiringDate(airDate);

  let metaHtml = `
    <span class="card-rating-star">★ ${item.userRating}</span>
    <span>•</span>
    <span>${item.rating}</span>
    <span>•</span>
  `;
  if (item.type === 'Movie') {
    metaHtml += `<span>${item.duration !== "N/A" ? item.duration : "Movie"}</span>`;
    const originalDate = item.details && item.details.release_date;
    if (originalDate) {
      const year = new Date(originalDate).getFullYear();
      metaHtml += `<span>•</span><span>Theaters: ${year}</span>`;
    }
  } else if (item.type === 'TV Show') {
    let typeSubtext = "";
    const lastEp = item.details && item.details.last_episode_to_air;
    const nextEp = item.details && item.details.next_episode_to_air;
    
    if (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) {
      typeSubtext = `S${nextEp.season_number} E${nextEp.episode_number}`;
    } else if (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend)) {
      typeSubtext = `S${lastEp.season_number} E${lastEp.episode_number}`;
    } else {
      const seasons = (item.details && item.details.seasons) || [];
      const latestSeason = seasons.length > 0 ? seasons[seasons.length - 1].season_number : 1;
      typeSubtext = `Season ${latestSeason}`;
    }
    metaHtml += `<span>${typeSubtext}</span>`;
  }

  if (formattedAirDate) {
    metaHtml += `<span>•</span><span class="air-date-highlight">🗓️ ${formattedAirDate}</span>`;
  }

  return `
    <div class="release-card ${isSpotlight ? 'spotlight-card' : ''}" onclick="openModal(${item.id})">
      <div class="card-visual" style="background-image: ${backdropUrl}; background-size: cover; background-position: center;">
        <div class="card-gradient-overlay"></div>
        <div class="card-badges">
          <span class="type-badge">${item.type}</span>
        </div>
        <button class="watchlist-btn ${isWatchlisted ? 'active' : ''}" onclick="toggleWatchlist(${item.id}, event)">
          ${isWatchlisted ? '💖' : '🤍'}
        </button>
      </div>
      <div class="card-content">
        <div class="platform-pill">
          ${platformLogoHtml}
          <span>${item.platform}</span>
        </div>
        <h3 class="card-title">${item.title}</h3>
        <div class="card-meta">
          ${metaHtml}
        </div>
        <p class="card-synopsis">${item.synopsis}</p>
        <div class="card-footer">
          <div class="card-genres">
            ${genres.map(g => `<span class="genre-tag">${g}</span>`).join('')}
          </div>
          ${rtHtml}
        </div>
      </div>
    </div>
  `;
}

// Modal Controllers
async function openModal(id) {
  const item = currentReleases.find(r => r.id === id);
  if (!item) return;

  const pathType = item.type === "Movie" ? "movie" : "tv";

  // Set initial modal details from cached data
  modalTitle.textContent = item.title;
  modalType.textContent = item.type;
  modalRating.textContent = item.rating;
  modalSynopsis.textContent = item.synopsis;

  const backdropUrl = item.backdropPath 
    ? `url(https://image.tmdb.org/t/p/w780${item.backdropPath})` 
    : `linear-gradient(135deg, #e2e8f0, #cbd5e1)`;
  modalHero.style.backgroundImage = backdropUrl;
  modalHero.style.backgroundSize = 'cover';
  modalHero.style.backgroundPosition = 'center';

  // Watch provider listing
  if (item.platformLogoUrl) {
    modalPlatform.innerHTML = `<img src="${item.platformLogoUrl}" alt="${item.platform}" style="width: 16px; height: 16px; border-radius: 3px;"> <span>Available on ${item.platform}</span>`;
  } else {
    modalPlatform.innerHTML = `<span>${item.platformLogo || '🌐'}</span> <span>${item.platform}</span>`;
  }

  const selectedWeekend = weekendSelect.value;
  let airDate = item.releaseDate;
  if (item.type === 'TV Show') {
    const lastEp = item.details && item.details.last_episode_to_air;
    const nextEp = item.details && item.details.next_episode_to_air;
    if (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) {
      airDate = nextEp.air_date;
    } else if (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend)) {
      airDate = lastEp.air_date;
    }
  }
  const formattedAirDate = formatAiringDate(airDate);

  let modalMeta = `${formattedAirDate ? `Airing: ${formattedAirDate}` : (item.releaseDate || "")}`;
  if (item.type === 'Movie') {
    modalMeta += ` • ${item.duration !== "N/A" ? item.duration : "Movie"}`;
    const originalDate = item.details && item.details.release_date;
    if (originalDate) {
      const year = new Date(originalDate).getFullYear();
      modalMeta += ` • Theaters: ${year}`;
    }
  } else if (item.type === 'TV Show') {
    let typeSubtext = "";
    const lastEp = item.details && item.details.last_episode_to_air;
    const nextEp = item.details && item.details.next_episode_to_air;
    
    if (nextEp && isReleaseInSelectedWeekend(nextEp.air_date, selectedWeekend)) {
      typeSubtext = `S${nextEp.season_number} E${nextEp.episode_number}`;
    } else if (lastEp && isReleaseInSelectedWeekend(lastEp.air_date, selectedWeekend)) {
      typeSubtext = `S${lastEp.season_number} E${lastEp.episode_number}`;
    } else {
      const seasons = (item.details && item.details.seasons) || [];
      const latestSeason = seasons.length > 0 ? seasons[seasons.length - 1].season_number : 1;
      typeSubtext = `Season ${latestSeason}`;
    }
    modalMeta += ` • ${typeSubtext}`;
  }
  modalMeta += ` • ★ ${item.userRating}`;
  modalInfoText.textContent = modalMeta;

  // Reset cast list while loading
  castList.innerHTML = '<span class="cast-member">Loading cast...</span>';

  // Dynamic Rotten Tomatoes link
  const rtSearchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(item.title)}`;
  btnRottenTomatoes.href = rtSearchUrl;

  // Watchlist setup
  const isWatchlisted = watchlist.includes(item.id);
  btnModalWatchlist.innerHTML = isWatchlisted ? '💖 In Watchlist' : '➕ Add to Watchlist';
  btnModalWatchlist.className = `btn-secondary ${isWatchlisted ? 'active' : ''}`;
  btnModalWatchlist.onclick = () => toggleWatchlist(item.id);

  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Asynchronously fetch details: Cast only (Runtime & release info pre-loaded)
  try {
    const creditsRes = await fetch(`${BASE_URL}/${pathType}/${item.id}/credits?api_key=${TMDB_API_KEY}`);
    const creditsData = await creditsRes.json();
    const cast = (creditsData.cast || []).slice(0, 4).map(c => c.name);
    
    if (cast.length > 0) {
      castList.innerHTML = cast.map(member => `<span class="cast-member">${member}</span>`).join('');
    } else {
      castList.innerHTML = '<span class="cast-member">N/A</span>';
    }
  } catch (err) {
    console.error("Failed to load modal credits:", err);
    castList.innerHTML = '<span class="cast-member">N/A</span>';
  }
}

function closeModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
}
