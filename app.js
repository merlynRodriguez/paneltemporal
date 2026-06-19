import { createClient } from '@supabase/supabase-js';

// Supabase Configuration (using service role key to bypass RLS for administrative operations)
const SUPABASE_URL = "https://flwrkxufkknrqbdlkvvp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd3JreHVma2tucnFiZGxrdnZwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTYzMjEwMywiZXhwIjoyMDk3MjA4MTAzfQ.2bQaLJPuybEaHL9thSxsoUZi9q-blPzIdeBdYF-LWuM";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fallback Silhouette Image (Premium dark SVG vector)
const DEFAULT_PHOTO = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="100%" height="100%" fill="%231b253b"/><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="%23475569"/></svg>`;

// Application State
let state = {
  players: [],
  teams: [],
  history: [],
  selectedPlayer: null,
  pendingAction: null // Holds data for confirmation modal
};

// DOM Elements
const elements = {
  statPlayers: document.getElementById('stat-players'),
  statTeams: document.getElementById('stat-teams'),
  statHistory: document.getElementById('stat-history'),
  btnSync: document.getElementById('btn-sync'),
  searchPlayer: document.getElementById('search-player'),
  btnSearchTrigger: document.getElementById('btn-search-trigger'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  searchSuggestions: document.getElementById('search-suggestions'),
  playerProfile: document.getElementById('player-profile'),
  playerPlaceholder: document.getElementById('player-placeholder'),
  playerImg: document.getElementById('player-img'),
  playerFullName: document.getElementById('player-fullname'),
  playerCIBadge: document.getElementById('player-ci-badge'),
  playerBirthdate: document.getElementById('player-birthdate'),
  playerTimeline: document.getElementById('player-timeline'),
  formTransfer: document.getElementById('form-transfer'),
  transferTeamInput: document.getElementById('transfer-team-input'),
  formNewPlayer: document.getElementById('form-new-player'),
  newTeamInput: document.getElementById('new-team-input'),
  teamsList: document.getElementById('teams-list'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmSummaryText: document.getElementById('confirm-summary-text'),
  modalCancel: document.getElementById('modal-cancel'),
  modalConfirm: document.getElementById('modal-confirm'),
  toastContainer: document.getElementById('toast-container')
};

// Helper: Normalize strings (removes accents, lowercase)
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Helper: Highlight matching characters in search results (accent-insensitive)
function highlightText(text, query) {
  if (!query) return text;
  const normalizedText = normalizeString(text);
  const normalizedQuery = normalizeString(query);
  
  let result = '';
  let currentIndex = 0;
  let matchIndex = normalizedText.indexOf(normalizedQuery, currentIndex);
  
  if (matchIndex === -1) return text;
  
  while (matchIndex !== -1) {
    result += text.substring(currentIndex, matchIndex);
    const matchText = text.substring(matchIndex, matchIndex + query.length);
    result += `<strong>${matchText}</strong>`;
    currentIndex = matchIndex + query.length;
    matchIndex = normalizedText.indexOf(normalizedQuery, currentIndex);
  }
  
  result += text.substring(currentIndex);
  return result;
}

// Toast Notifications System
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  toast.innerHTML = `
    <span>${icon}</span>
    <div>${message}</div>
    <div class="toast-progress" style="animation-duration: 4000ms;"></div>
  `;
  
  elements.toastContainer.appendChild(toast);
  
  // Slide out and remove
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Helper: Format Date
function formatDate(dateStr) {
  if (!dateStr) return 'No registrada';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

// Helper: Format full name
function formatFullName(player) {
  return `${player.nombres} ${player.apellidos}`;
}

// Generate Temporary CI
function generateTempCI() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `TEMP-${year}${month}${day}${hours}${minutes}${seconds}`;
}

// Initialize Application Cache
async function initApp() {
  setupEventListeners();
  
  const cachedPlayers = localStorage.getItem('vinto_players');
  const cachedTeams = localStorage.getItem('vinto_teams');
  const cachedHistory = localStorage.getItem('vinto_history');
  
  if (cachedPlayers && cachedTeams && cachedHistory) {
    try {
      state.players = JSON.parse(cachedPlayers);
      state.teams = JSON.parse(cachedTeams);
      state.history = JSON.parse(cachedHistory);
      
      updateStatsUI();
      populateTeamDropdowns();
      showToast('Base de datos local cargada desde caché', 'info');
    } catch (e) {
      console.error("Error reading cache", e);
      await syncDatabase();
    }
  } else {
    // If no cache, perform initial sync
    await syncDatabase();
  }
}

// Sync Database from Supabase (handling pagination chunks of 1000)
async function syncDatabase() {
  setSyncingState(true);
  showToast('Iniciando sincronización con Supabase...', 'info');
  
  try {
    // 1. Fetch Teams
    const { data: teamsData, error: teamsError } = await supabase
      .from('equipos')
      .select('*')
      .order('nombre', { ascending: true });
      
    if (teamsError) throw teamsError;
    state.teams = teamsData;

    // 2. Fetch Players (Paginated)
    let playersList = [];
    let from = 0;
    const limit = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('jugadores')
        .select('*')
        .range(from, from + limit - 1);
        
      if (error) throw error;
      playersList = playersList.concat(data);
      
      if (data.length < limit) {
        hasMore = false;
      } else {
        from += limit;
      }
    }
    state.players = playersList;

    // 3. Fetch History (Paginated)
    let historyList = [];
    from = 0;
    hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('historial_participacion')
        .select('*')
        .range(from, from + limit - 1);
        
      if (error) throw error;
      historyList = historyList.concat(data);
      
      if (data.length < limit) {
        hasMore = false;
      } else {
        from += limit;
      }
    }
    state.history = historyList;

    // Cache in localStorage
    localStorage.setItem('vinto_teams', JSON.stringify(state.teams));
    localStorage.setItem('vinto_players', JSON.stringify(state.players));
    localStorage.setItem('vinto_history', JSON.stringify(state.history));
    
    updateStatsUI();
    populateTeamDropdowns();
    
    showToast('Sincronización completa. Base de datos guardada localmente.', 'success');
  } catch (err) {
    console.error("Sync error:", err);
    showToast(`Error al sincronizar: ${err.message}`, 'error');
  } finally {
    setSyncingState(false);
  }
}

// Update UI Stats Numbers
function updateStatsUI() {
  elements.statPlayers.textContent = state.players.length;
  elements.statTeams.textContent = state.teams.length;
  elements.statHistory.textContent = state.history.length;
}

// Set UI Sync Button State
function setSyncingState(isSyncing) {
  if (isSyncing) {
    elements.btnSync.disabled = true;
    elements.btnSync.querySelector('svg').classList.add('icon-spin');
  } else {
    elements.btnSync.disabled = false;
    elements.btnSync.querySelector('svg').classList.remove('icon-spin');
  }
}

// Populate Datalist with Sorted Teams
function populateTeamDropdowns() {
  const options = state.teams
    .map(team => `<option value="${team.nombre}"></option>`)
    .join('');
  elements.teamsList.innerHTML = options;
}

// Clear Search input, suggestions, and deselect player
function clearSearch() {
  elements.searchPlayer.value = '';
  state.selectedPlayer = null;
  elements.searchSuggestions.innerHTML = '';
  elements.searchSuggestions.classList.add('hidden');
  elements.btnClearSearch.classList.add('hidden');
  
  // Show placeholder card and hide profile
  elements.playerProfile.classList.add('hidden');
  elements.playerPlaceholder.classList.remove('hidden');
  
  // Focus search box
  elements.searchPlayer.focus();
}

// Toggle visibility of clear button
function toggleClearButtonVisibility() {
  if (elements.searchPlayer.value.trim().length > 0) {
    elements.btnClearSearch.classList.remove('hidden');
  } else {
    elements.btnClearSearch.classList.add('hidden');
  }
}

// Setup Event Listeners
function setupEventListeners() {
  // Sync Button
  elements.btnSync.addEventListener('click', syncDatabase);
  
  // Search input events
  elements.searchPlayer.addEventListener('input', () => {
    handleSearchInput();
    toggleClearButtonVisibility();
  });
  elements.searchPlayer.addEventListener('focus', () => {
    if (elements.searchPlayer.value.trim().length > 0) {
      elements.searchSuggestions.classList.remove('hidden');
    }
  });
  
  // Clear search button event
  elements.btnClearSearch.addEventListener('click', clearSearch);
  
  // Search Trigger events
  elements.btnSearchTrigger.addEventListener('click', performFullSearch);
  elements.searchPlayer.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performFullSearch();
    }
  });
  
  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (
      !elements.searchPlayer.contains(e.target) && 
      !elements.searchSuggestions.contains(e.target) && 
      !elements.btnSearchTrigger.contains(e.target) &&
      !elements.btnClearSearch.contains(e.target)
    ) {
      elements.searchSuggestions.classList.add('hidden');
    }
  });

  // Tabs navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Transfer form submit (Save)
  elements.formTransfer.addEventListener('submit', handleTransferSubmit);
  
  // New Player form submit (Save)
  elements.formNewPlayer.addEventListener('submit', handleNewPlayerSubmit);
  
  // Modal buttons
  elements.modalCancel.addEventListener('click', hideConfirmModal);
  elements.modalConfirm.addEventListener('click', executePendingAction);
}

// Handle Search Input and render fast suggestions
function handleSearchInput() {
  const rawQuery = elements.searchPlayer.value.trim();
  const query = normalizeString(rawQuery);
  
  if (query.length < 2) {
    elements.searchSuggestions.innerHTML = '';
    elements.searchSuggestions.classList.add('hidden');
    
    // Restore appropriate card when search is cleared
    if (state.selectedPlayer) {
      elements.playerProfile.classList.remove('hidden');
      elements.playerPlaceholder.classList.add('hidden');
    } else {
      elements.playerProfile.classList.add('hidden');
      elements.playerPlaceholder.classList.remove('hidden');
    }
    return;
  }
  
  // Hide cards while actively searching to prevent occlusion/clutter
  elements.playerProfile.classList.add('hidden');
  elements.playerPlaceholder.classList.add('hidden');
  
  // Search locally
  const matches = state.players.filter(player => {
    const nameMatch = normalizeString(player.nombres).includes(query);
    const surnameMatch = normalizeString(player.apellidos).includes(query);
    const ciMatch = player.ci.toLowerCase().includes(query);
    return nameMatch || surnameMatch || ciMatch;
  });
  
  // Render suggestions
  elements.searchSuggestions.innerHTML = '';
  
  if (matches.length === 0) {
    elements.searchSuggestions.innerHTML = `<div class="no-suggestions">No se encontraron jugadores</div>`;
    elements.searchSuggestions.classList.remove('hidden');
    return;
  }
  
  // Take top 25 matches for typing suggestions
  const topMatches = matches.slice(0, 25);
  
  topMatches.forEach((player) => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.dataset.ci = player.ci;
    
    // Check if temporal CI
    const isTemp = player.ci.startsWith('TEMP-');
    const badgeHtml = isTemp ? `<span class="badge badge-temp">Temp</span>` : `<span class="badge">CI: ${player.ci}</span>`;
    
    // Build photo url
    const photoUrl = isTemp ? DEFAULT_PHOTO : `${SUPABASE_URL}/storage/v1/object/public/fotos_jugadores/${player.ci}.jpg`;
    
    // Highlight matching text
    const rawFullName = formatFullName(player);
    const highlightedName = highlightText(rawFullName, rawQuery);
    
    item.innerHTML = `
      <img src="${photoUrl}" class="suggestion-photo" onerror="this.src='${DEFAULT_PHOTO}'">
      <div class="suggestion-info">
        <span class="suggestion-name">${highlightedName}</span>
        <span>${badgeHtml}</span>
      </div>
    `;
    
    item.addEventListener('click', () => selectPlayer(player));
    elements.searchSuggestions.appendChild(item);
  });
  
  elements.searchSuggestions.classList.remove('hidden');
}

// Perform Full Search showing all matches with scroll bar
function performFullSearch() {
  const rawQuery = elements.searchPlayer.value.trim();
  const query = normalizeString(rawQuery);
  
  if (query.length < 2) {
    showToast('Ingresa al menos 2 caracteres para buscar', 'warning');
    return;
  }
  
  // Hide cards while displaying search results
  elements.playerProfile.classList.add('hidden');
  elements.playerPlaceholder.classList.add('hidden');
  
  // Search locally
  const matches = state.players.filter(player => {
    const nameMatch = normalizeString(player.nombres).includes(query);
    const surnameMatch = normalizeString(player.apellidos).includes(query);
    const ciMatch = player.ci.toLowerCase().includes(query);
    return nameMatch || surnameMatch || ciMatch;
  });
  
  // Render suggestions
  elements.searchSuggestions.innerHTML = '';
  
  if (matches.length === 0) {
    elements.searchSuggestions.innerHTML = `<div class="no-suggestions">No se encontraron jugadores para "${rawQuery}"</div>`;
    elements.searchSuggestions.classList.remove('hidden');
    return;
  }
  
  // Render suggestions header
  const header = document.createElement('div');
  header.className = 'suggestions-header';
  header.textContent = `Resultados de búsqueda: ${matches.length} encontrados`;
  elements.searchSuggestions.appendChild(header);
  
  // Take top 100 matches to prevent lag
  const displayMatches = matches.slice(0, 100);
  
  displayMatches.forEach((player) => {
    const item = document.createElement('div');
    item.className = 'suggestion-item';
    item.dataset.ci = player.ci;
    
    // Check if temporal CI
    const isTemp = player.ci.startsWith('TEMP-');
    const badgeHtml = isTemp ? `<span class="badge badge-temp">Temp</span>` : `<span class="badge">CI: ${player.ci}</span>`;
    
    // Build photo url
    const photoUrl = isTemp ? DEFAULT_PHOTO : `${SUPABASE_URL}/storage/v1/object/public/fotos_jugadores/${player.ci}.jpg`;
    
    // Highlight matching text
    const rawFullName = formatFullName(player);
    const highlightedName = highlightText(rawFullName, rawQuery);
    
    item.innerHTML = `
      <img src="${photoUrl}" class="suggestion-photo" onerror="this.src='${DEFAULT_PHOTO}'">
      <div class="suggestion-info">
        <span class="suggestion-name">${highlightedName}</span>
        <span>${badgeHtml}</span>
      </div>
    `;
    
    item.addEventListener('click', () => selectPlayer(player));
    elements.searchSuggestions.appendChild(item);
  });
  
  elements.searchSuggestions.classList.remove('hidden');
}

// Select Player and Render Profile
function selectPlayer(player) {
  state.selectedPlayer = player;
  elements.searchSuggestions.classList.add('hidden');
  elements.searchPlayer.value = formatFullName(player);
  elements.btnClearSearch.classList.remove('hidden');
  
  // Populate Player profile card
  elements.playerFullName.textContent = formatFullName(player);
  elements.playerBirthdate.textContent = `Fecha de Nacimiento: ${formatDate(player.fecha_nacimiento)}`;
  
  // CI Badge setup
  const isTemp = player.ci.startsWith('TEMP-');
  elements.playerCIBadge.textContent = `C.I.: ${player.ci}`;
  if (isTemp) {
    elements.playerCIBadge.classList.add('badge-temp');
  } else {
    elements.playerCIBadge.classList.remove('badge-temp');
  }

  // Load Image with Fallback
  if (isTemp) {
    elements.playerImg.src = DEFAULT_PHOTO;
  } else {
    const photoUrl = `${SUPABASE_URL}/storage/v1/object/public/fotos_jugadores/${player.ci}.jpg`;
    elements.playerImg.src = photoUrl;
    elements.playerImg.onerror = () => {
      elements.playerImg.src = DEFAULT_PHOTO;
      elements.playerImg.onerror = null;
    };
  }

  // Fetch and display player participation timeline
  renderPlayerTimeline(player.ci);
  
  // Show Profile & Hide Placeholder
  elements.playerPlaceholder.classList.add('hidden');
  elements.playerProfile.classList.remove('hidden');
  
  // Reset transfer form
  elements.formTransfer.reset();
  document.getElementById('trans-2024').checked = true;
  
  // Reset tabs: activate history tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="tab-history"]').classList.add('active');
  document.getElementById('tab-history').classList.add('active');
}

// Render Selected Player Timeline
function renderPlayerTimeline(playerCi) {
  // Filter history records
  const playerHistory = state.history.filter(h => h.jugador_ci === playerCi);
  
  // Sort descending by year
  playerHistory.sort((a, b) => b['año'] - a['año']);
  
  elements.playerTimeline.innerHTML = '';
  
  if (playerHistory.length === 0) {
    elements.playerTimeline.innerHTML = '<p class="no-suggestions">No se registra historial de participación.</p>';
    return;
  }
  
  playerHistory.forEach((item, index) => {
    const team = state.teams.find(t => t.id === item.equipo_id);
    const teamName = team ? team.nombre : `Club ID: ${item.equipo_id}`;
    const isCurrent = index === 0; // Highlight the latest record
    
    const timelineItem = document.createElement('div');
    timelineItem.className = `timeline-item ${isCurrent ? 'current' : ''}`;
    
    timelineItem.innerHTML = `
      <div class="timeline-marker"></div>
      <div class="timeline-content">
        <div class="timeline-year">${item['año']}</div>
        <div class="timeline-team">${teamName}</div>
        <div class="timeline-category">Categoría: <span>${item.categoria_jugador}</span></div>
      </div>
    `;
    
    elements.playerTimeline.appendChild(timelineItem);
  });
}

// Handle submit of Transfer Form
function handleTransferSubmit(e) {
  e.preventDefault();
  
  if (!state.selectedPlayer) {
    showToast('Por favor selecciona un jugador primero', 'error');
    return;
  }
  
  const selectedTeamName = elements.transferTeamInput.value.trim();
  const team = state.teams.find(t => t.nombre.toLowerCase() === selectedTeamName.toLowerCase());
  
  if (!team) {
    showToast(`El club "${selectedTeamName}" no es válido o no está registrado. Elige uno de la lista.`, 'error');
    return;
  }
  
  const teamId = team.id;
  const teamName = team.nombre;
  
  const yearVal = parseInt(document.querySelector('input[name="transfer-year"]:checked').value);
  const category = document.getElementById('transfer-category').value;
  
  // Create pending action object
  state.pendingAction = {
    type: 'transfer',
    playerCi: state.selectedPlayer.ci,
    playerName: formatFullName(state.selectedPlayer),
    teamId: teamId,
    teamName: teamName,
    year: yearVal,
    category: category
  };
  
  // Update modal text
  elements.confirmSummaryText.innerHTML = `El jugador <strong>${state.selectedPlayer.nombres} ${state.selectedPlayer.apellidos}</strong> perteneció al equipo <strong>${teamName}</strong> en el año <strong>${yearVal}</strong> bajo la categoría <strong>${category}</strong>.`;
  
  showConfirmModal();
}

// Handle submit of New Player Form
function handleNewPlayerSubmit(e) {
  e.preventDefault();
  
  const nombres = document.getElementById('new-nombres').value.trim();
  const apellidos = document.getElementById('new-apellidos').value.trim();
  let ci = document.getElementById('new-ci').value.trim();
  const birthdate = document.getElementById('new-birthdate').value;
  
  const selectedTeamName = elements.newTeamInput.value.trim();
  const team = state.teams.find(t => t.nombre.toLowerCase() === selectedTeamName.toLowerCase());
  
  if (!team) {
    showToast(`El club "${selectedTeamName}" no es válido o no está registrado. Elige uno de la lista.`, 'error');
    return;
  }
  
  const teamId = team.id;
  const teamName = team.nombre;
  const yearVal = parseInt(document.querySelector('input[name="new-year"]:checked').value);
  const category = document.getElementById('new-category').value;
  
  if (!ci) {
    ci = generateTempCI();
  }
  
  // Check if CI already exists in cache to prevent duplicate CIs locally
  const ciExists = state.players.some(p => p.ci.toLowerCase() === ci.toLowerCase());
  if (ciExists) {
    showToast(`El C.I. "${ci}" ya se encuentra registrado a otro jugador en el sistema.`, 'error');
    return;
  }
  
  state.pendingAction = {
    type: 'new_player',
    nombres: nombres,
    apellidos: apellidos,
    ci: ci,
    birthdate: birthdate || null,
    teamId: teamId,
    teamName: teamName,
    year: yearVal,
    category: category
  };
  
  elements.confirmSummaryText.innerHTML = `Se registrará al NUEVO jugador <strong>${nombres.toUpperCase()} ${apellidos.toUpperCase()}</strong> (C.I.: <em>${ci}</em>) y se habilitará su participación inicial en el club <strong>${teamName}</strong> para el año <strong>${yearVal}</strong> como <strong>${category}</strong>.`;
  
  showConfirmModal();
}

// Show/Hide Modal Dialog
function showConfirmModal() {
  elements.confirmModal.classList.remove('hidden');
}

function hideConfirmModal() {
  elements.confirmModal.classList.add('hidden');
  state.pendingAction = null;
  resetButtonSpinner();
}

function showButtonSpinner() {
  elements.modalConfirm.disabled = true;
  elements.modalConfirm.querySelector('.btn-spinner').classList.remove('hidden');
  elements.modalConfirm.querySelector('.btn-text').textContent = 'Inyectando...';
}

function resetButtonSpinner() {
  elements.modalConfirm.disabled = false;
  elements.modalConfirm.querySelector('.btn-spinner').classList.add('hidden');
  elements.modalConfirm.querySelector('.btn-text').textContent = 'Confirmar e Inyectar';
}

// Execute Pending Database Injection (Transfer or New Player)
async function executePendingAction() {
  if (!state.pendingAction) return;
  
  showButtonSpinner();
  const action = state.pendingAction;
  
  try {
    if (action.type === 'transfer') {
      // Inyectar / Upsert en historial_participacion
      const { data, error } = await supabase
        .from('historial_participacion')
        .upsert({
          jugador_ci: action.playerCi,
          equipo_id: action.teamId,
          "año": action.year,
          categoria_jugador: action.category
        }, {
          onConflict: 'jugador_ci,año'
        })
        .select();
        
      if (error) throw error;
      
      // Update local history cache
      const existingIndex = state.history.findIndex(h => h.jugador_ci === action.playerCi && h['año'] === action.year);
      const insertedItem = data[0];
      
      if (existingIndex > -1) {
        state.history[existingIndex] = insertedItem;
      } else {
        state.history.push(insertedItem);
      }
      
      localStorage.setItem('vinto_history', JSON.stringify(state.history));
      updateStatsUI();
      
      // Re-render current timeline
      if (state.selectedPlayer && state.selectedPlayer.ci === action.playerCi) {
        renderPlayerTimeline(action.playerCi);
      }
      
      showToast(`Pase de ${action.playerName} guardado con éxito.`, 'success');
      hideConfirmModal();
      
    } else if (action.type === 'new_player') {
      // 1. Insert Player
      const upperNombres = action.nombres.toUpperCase();
      const upperApellidos = action.apellidos.toUpperCase();
      
      const { data: playerData, error: playerError } = await supabase
        .from('jugadores')
        .insert({
          ci: action.ci,
          nombres: upperNombres,
          apellidos: upperApellidos,
          fecha_nacimiento: action.birthdate
        })
        .select();
        
      if (playerError) throw playerError;
      
      // 2. Insert Participation
      const { data: histData, error: histError } = await supabase
        .from('historial_participacion')
        .insert({
          jugador_ci: action.ci,
          equipo_id: action.teamId,
          "año": action.year,
          categoria_jugador: action.category
        })
        .select();
        
      if (histError) {
        // Rollback player creation locally if database allows (or just report)
        throw histError;
      }
      
      // Add to local state
      const newPlayer = playerData[0];
      const newHist = histData[0];
      
      state.players.push(newPlayer);
      state.history.push(newHist);
      
      // Update localStorage
      localStorage.setItem('vinto_players', JSON.stringify(state.players));
      localStorage.setItem('vinto_history', JSON.stringify(state.history));
      
      updateStatsUI();
      
      // Reset new player form
      elements.formNewPlayer.reset();
      document.getElementById('new-y-2024').checked = true;
      
      showToast(`Nuevo jugador ${upperNombres} ${upperApellidos} creado y habilitado.`, 'success');
      hideConfirmModal();
      
      // Auto-select the newly created player in search profile
      selectPlayer(newPlayer);
    }
  } catch (err) {
    console.error("Database writing error:", err);
    showToast(`Error al guardar en Supabase: ${err.message || JSON.stringify(err)}`, 'error');
    resetButtonSpinner();
  }
}

// Start Application
initApp();
