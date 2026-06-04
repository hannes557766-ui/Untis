// ==================== CONFIG ====================
const PROXY_URL = 'https://untis-proxy.deinname.workers.dev'; // ← Deine Cloudflare Worker URL hier eintragen

// ==================== STATE ====================
let currentToken = null;
let currentSchool = null;
let currentBaseUrl = null;
let currentWeekStart = null;
let currentDay = null;

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

function getSubjectColor(subjectName) {
    let hash = 0;
    for (let i = 0; i < subjectName.length; i++) {
        hash = subjectName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 88%)`;
}

// ==================== LOADING & ERROR ====================
function showLoading(container) {
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12">
            <div class="w-6 h-6 border-2 border-gray-300 border-t-black rounded-full animate-spin mb-4"></div>
            <p class="text-gray-500 text-sm">Daten werden geladen...</p>
        </div>
    `;
}

function showError(container, message) {
    container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center">
            <p class="text-red-600 font-medium">${message}</p>
        </div>
    `;
}

// ==================== API (über Proxy) ====================
async function untisRequest(endpoint, method = 'GET', body = null) {
    if (!currentBaseUrl || !currentToken) throw new Error('Nicht eingeloggt');

    const targetUrl = `${currentBaseUrl}/WebUntis/api/rest${endpoint}`;
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;

    const options = {
        method,
        headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(proxyUrl, options);
    if (!response.ok) throw new Error(`API Fehler: ${response.status}`);
    return response.json();
}

// ==================== AUTH (über Proxy) ====================
async function login(school, username, password) {
    currentSchool = school;
    currentBaseUrl = `https://${school}.webuntis.com`;

    const targetUrl = `${currentBaseUrl}/WebUntis/api/rest/auth/login`;
    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(targetUrl)}`;

    const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, client: 'UntisClone' })
    });

    if (!res.ok) throw new Error('Login fehlgeschlagen');
    const data = await res.json();
    if (!data.token) throw new Error('Kein Token');

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
    document.getElementById('substitutionScreen').classList.add('hidden');
    document.getElementById('dayViewScreen').classList.add('hidden');
    document.getElementById('settingsScreen').classList.add('hidden');
}

function showSettings() {
    document.getElementById('timetableScreen').classList.add('hidden');
    document.getElementById('substitutionScreen').classList.add('hidden');
    document.getElementById('dayViewScreen').classList.add('hidden');
    document.getElementById('settingsScreen').classList.remove('hidden');

    document.getElementById('settingsSchool').textContent = currentSchool || '-';
    document.getElementById('settingsUser').textContent = 'Angemeldet';
}

// ==================== TIMETABLE ====================
async function fetchTimetable(weekStart) {
    const start = formatDate(weekStart);
    const end = formatDate(new Date(weekStart.getTime() + 4 * 86400000));
    return await untisRequest(`/timetable/weekly?startDate=${start}&endDate=${end}`);
}

function renderTimetable(data, weekStart) {
    const container = document.getElementById('timetableContainer');
    container.innerHTML = '';

    if (!data || !data.days || data.days.length === 0) {
        container.innerHTML = `<div class="text-center py-12 text-gray-500">Keine Daten für diese Woche.</div>`;
        return;
    }

    const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
    const timeSlots = ['07:45', '08:30', '09:15', '10:00', '10:45', '11:30', '12:15', '13:00', '13:45', '14:30'];

    let html = `<div class="grid grid-cols-[58px_repeat(5,1fr)] gap-2">`;

    html += `<div class="bg-gray-50 p-2 text-xs font-medium text-gray-500 text-center rounded-xl">Zeit</div>`;
    days.forEach((day, i) => {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + i);
        html += `
            <div class="bg-gray-50 p-2 text-center rounded-xl">
                <div class="font-medium text-sm">${day}</div>
                <div class="text-xs text-gray-500">${date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}</div>
            </div>`;
    });

    timeSlots.forEach(time => {
        html += `<div class="bg-gray-50 p-2 text-right text-xs text-gray-500">${time}</div>`;
        for (let i = 0; i < 5; i++) {
            html += `<div class="bg-white min-h-[54px] border border-gray-100 rounded-xl p-1 relative" data-time="${time}" data-day="${i}"></div>`;
        }
    });

    html += `</div>`;
    container.innerHTML = html;

    renderLessons(data);
}

function renderLessons(data) {
    if (!data.days) return;

    data.days.forEach((day, dayIndex) => {
        if (!day.periods) return;

        day.periods.forEach(period => {
            const cells = document.querySelectorAll(`[data-day="${dayIndex}"]`);
            
            cells.forEach(cell => {
                const cellTime = cell.getAttribute('data-time');
                
                if (period.startTime && cellTime === period.startTime.substring(0, 5)) {
                    const lessonDiv = document.createElement('div');
                    lessonDiv.className = `p-2 text-xs rounded-xl border-l-4 overflow-hidden h-full`;
                    lessonDiv.style.backgroundColor = getSubjectColor(period.subject?.name || 'Unbekannt');
                    lessonDiv.style.borderLeftColor = '#374151';

                    lessonDiv.innerHTML = `
                        <div class="font-semibold text-gray-900">${period.subject?.name || 'Unbekannt'}</div>
                        <div class="text-gray-600 text-[10px] mt-0.5">
                            ${period.teacher?.name || ''} ${period.room?.name ? '• ' + period.room.name : ''}
                        </div>
                    `;

                    cell.appendChild(lessonDiv);
                }
            });
        });
    });
}

// ==================== WEEK NAVIGATION ====================
function loadCurrentWeek() {
    currentWeekStart = getMonday(new Date());
    loadWeek();
}

function changeWeek(direction) {
    if (!currentWeekStart) currentWeekStart = getMonday(new Date());
    currentWeekStart.setDate(currentWeekStart.getDate() + direction * 7);
    loadWeek();
}

async function loadWeek() {
    const container = document.getElementById('timetableContainer');
    showLoading(container);

    document.getElementById('weekInfo').textContent = `Woche vom ${formatWeekRange(currentWeekStart)}`;

    try {
        const data = await fetchTimetable(currentWeekStart);
        renderTimetable(data, currentWeekStart);
    } catch (error) {
        showError(container, 'Fehler beim Laden des Stundenplans.');
    }
}

// ==================== INITIALIZATION ====================
function initializeApp() {
    const savedToken = localStorage.getItem('untis_token');
    const savedSchool = localStorage.getItem('untis_school');
    const savedBaseUrl = localStorage.getItem('untis_baseUrl');

    if (savedToken && savedSchool && savedBaseUrl) {
        currentToken = savedToken;
        currentSchool = savedSchool;
        currentBaseUrl = savedBaseUrl;

        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('timetableScreen').classList.remove('hidden');
        document.getElementById('userInfo').innerHTML = `Eingeloggt als <span class="font-medium">${savedSchool}</span>`;
        document.getElementById('userInfo').classList.remove('hidden');

        loadCurrentWeek();
    }

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const loginButton = document.getElementById('loginButton');
        const errorDiv = document.getElementById('loginError');

        loginButton.disabled = true;
        loginButton.textContent = 'Wird angemeldet...';
        errorDiv.classList.add('hidden');

        const school = document.getElementById('school').value.trim();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        try {
            await login(school, username, password);
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('timetableScreen').classList.remove('hidden');
            document.getElementById('userInfo').innerHTML = `Eingeloggt als <span class="font-medium">${school}</span>`;
            document.getElementById('userInfo').classList.remove('hidden');
            loadCurrentWeek();
        } catch (err) {
            errorDiv.textContent = err.message || 'Login fehlgeschlagen';
            errorDiv.classList.remove('hidden');
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = 'Anmelden';
        }
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
}

initializeApp();
