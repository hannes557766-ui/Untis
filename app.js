// ==================== CONFIG ====================
const API_BASE = 'https://<school>.webuntis.com';

// ==================== STATE ====================
let currentToken = null;
let currentSchool = null;
let currentBaseUrl = null;
let currentWeekStart = null;

// ==================== UTILS ====================
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatWeekRange(startDate) {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 4);
    
    const options = { day: '2-digit', month: '2-digit' };
    return `${startDate.toLocaleDateString('de-DE', options)} – ${endDate.toLocaleDateString('de-DE', options)}`;
}

// ==================== API ====================
async function untisRequest(endpoint, method = 'GET', body = null) {
    if (!currentBaseUrl || !currentToken) {
        throw new Error('Nicht eingeloggt');
    }

    const url = `${currentBaseUrl}/WebUntis/api/rest${endpoint}`;
    
    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json'
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Fehler: ${response.status} - ${errorText}`);
    }
    
    return response.json();
}

// ==================== AUTH ====================
async function login(school, username, password) {
    currentSchool = school;
    currentBaseUrl = `https://${school}.webuntis.com`;

    const response = await fetch(`${currentBaseUrl}/WebUntis/api/rest/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, client: 'UntisClone-PWA' })
    });

    if (!response.ok) {
        throw new Error('Login fehlgeschlagen');
    }

    const data = await response.json();
    
    if (!data.token) {
        throw new Error('Kein Token erhalten');
    }

    currentToken = data.token;
    
    localStorage.setItem('untis_token', currentToken);
    localStorage.setItem('untis_school', school);
    localStorage.setItem('untis_baseUrl', currentBaseUrl);

    return true;
}

function logout() {
    localStorage.clear();
    currentToken = null;
    currentSchool = null;
    currentBaseUrl = null;
    
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('timetableScreen').classList.add('hidden');
}

// ==================== TIMETABLE ====================
async function fetchTimetable(weekStart) {
    const startDate = formatDate(weekStart);
    const endDate = formatDate(new Date(weekStart.getTime() + 4 * 24 * 60 * 60 * 1000));

    try {
        const data = await untisRequest(`/timetable/weekly?startDate=${startDate}&endDate=${endDate}`);
        return data;
    } catch (error) {
        console.error('Fehler beim Laden des Stundenplans:', error);
        return null;
    }
}

function renderTimetable(timetableData, weekStart) {
    const container = document.getElementById('timetableContainer');
    container.innerHTML = '';

    if (!timetableData || !timetableData.days) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500">
                Keine Daten für diese Woche verfügbar.
            </div>
        `;
        return;
    }

    const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
    const timeSlots = ['07:45', '08:30', '09:15', '10:00', '10:45', '11:30', '12:15', '13:00', '13:45', '14:30', '15:15'];

    let html = `
        <div class="timetable-grid rounded-2xl overflow-hidden border border-gray-200">
            <!-- Header -->
            <div class="bg-gray-50 p-3 text-center text-xs font-semibold text-gray-600">Zeit</div>
    `;

    days.forEach((day, index) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + index);
        const dateStr = date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
        
        html += `
            <div class="timetable-header p-3 text-center">
                <div class="font-semibold">${day}</div>
                <div class="text-xs text-gray-500">${dateStr}</div>
            </div>
        `;
    });

    // Time slots
    timeSlots.forEach(time => {
        html += `<div class="time-slot text-right text-gray-500">${time}</div>`;
        
        days.forEach(() => {
            html += `<div class="bg-white min-h-[52px] border border-gray-100"></div>`;
        });
    });

    html += `</div>`;
    container.innerHTML = html;

    // TODO: In Phase 3 werden echte Stunden in die Grid-Zellen gerendert
}

// ==================== WEEK NAVIGATION ====================
function loadCurrentWeek() {
    currentWeekStart = getMonday(new Date());
    loadWeek();
}

function changeWeek(direction) {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());
    
    currentWeekStart.setDate(currentWeekStart.getDate() + (direction * 7));
    loadWeek();
}

async function loadWeek() {
    const weekInfo = document.getElementById('weekInfo');
    weekInfo.textContent = `Woche vom ${formatWeekRange(currentWeekStart)}`;

    const data = await fetchTimetable(currentWeekStart);
    renderTimetable(data, currentWeekStart);
}

// ==================== APP INITIALIZATION ====================
async function initializeApp() {
    // Check for existing session
    const savedToken = localStorage.getItem('untis_token');
    const savedSchool = localStorage.getItem('untis_school');
    const savedBaseUrl = localStorage.getItem('untis_baseUrl');

    if (savedToken && savedSchool && savedBaseUrl) {
        currentToken = savedToken;
        currentSchool = savedSchool;
        currentBaseUrl = savedBaseUrl;

        // Show timetable screen
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('timetableScreen').classList.remove('hidden');
        
        document.getElementById('userInfo').innerHTML = `Eingeloggt als <span class="font-medium">${savedSchool}</span>`;
        document.getElementById('userInfo').classList.remove('hidden');

        // Load current week
        loadCurrentWeek();
    }

    // Login form handler
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
        e.preventDefault();

        const school = document.getElementById('school').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const errorDiv = document.getElementById('loginError');

        errorDiv.classList.add('hidden');

        try {
            await login(school, username, password);
            
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('timetableScreen').classList.remove('hidden');
            document.getElementById('userInfo').innerHTML = `Eingeloggt als <span class="font-medium">${school}</span>`;
            document.getElementById('userInfo').classList.remove('hidden');

            loadCurrentWeek();
            
        } catch (error) {
            errorDiv.textContent = error.message || 'Login fehlgeschlagen';
            errorDiv.classList.remove('hidden');
        }
    });

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

// Start application
initializeApp();
