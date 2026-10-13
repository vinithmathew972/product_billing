/**
 * METRO FRESH SMART POS & RETAIL MANAGEMENT ENGINE
 * Complete Supermarket Billing, Suppliers, Purchases, Barcodes & Staff Suite
 */

// Global State
const state = {
    token: localStorage.getItem('pos_token') || null,
    currentUser: null,
    activeAttendance: null,
    catalog: [],
    categories: [],
    cart: [],
    selectedCartIndex: -1,
    currentCustomer: null,
    storeSettings: {},
    heldCarts: [],
    activeScreen: 'screen-login',
    selectedCategory: 'All',
    soundEnabled: true,
    activePaymentTab: 'CASH',
    lastCompletedOrder: null,
    loyaltyDiscountApplied: 0,
    couponDiscountApplied: 0,
    couponCode: null,
    codeReader: null,
    ownerSalesChart: null,
    currentPOItems: [],
    printerSettings: {
        enabled: localStorage.getItem('pos_printer_enabled') !== 'false',
        paperWidth: localStorage.getItem('pos_printer_width') || '80mm',
        type: localStorage.getItem('pos_printer_type') || 'ESC_POS',
        printerName: localStorage.getItem('pos_printer_name') || 'Default',
        autoPrint: localStorage.getItem('pos_auto_print') === 'true',
        cutPaper: localStorage.getItem('pos_cut_paper') !== 'false',
        openDrawer: localStorage.getItem('pos_open_drawer') === 'true',
        qzConnected: false
    },
    activeShift: null,
    detectedPrinters: []
};

// Web Audio API Sound Generator for POS Feedback
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBeep(type = 'scan') {
    if (!state.soundEnabled || !audioCtx) return;
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'scan') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1800, audioCtx.currentTime);
            gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.08);
        } else if (type === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(800, audioCtx.currentTime);
            osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.25);
        } else if (type === 'error') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, audioCtx.currentTime);
            osc.frequency.setValueAtTime(200, audioCtx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.2);
        }
    } catch (e) {
        console.warn('Audio feedback failed', e);
    }
}

// API Helper with Auth Bearer Token
async function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (state.token) {
        options.headers['Authorization'] = `Bearer ${state.token}`;
    }
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, options);
    if (response.status === 401) {
        handleLogout(false);
        throw new Error('Session expired. Please log in again.');
    }
    return response;
}

// ================= TIME & SIDEBAR UTILITIES ================= //

function formatTime12H(timeStr) {
    if (!timeStr || timeStr === '-' || timeStr === '—' || timeStr === 'null' || timeStr === 'undefined') return '-';
    const s = String(timeStr).trim();
    if (s.includes('AM') || s.includes('PM') || s.includes('am') || s.includes('pm')) {
        // If it also contains date e.g. "2026-10-11 11:30 AM", return just the time portion
        const parts = s.split(' ');
        if (parts.length >= 2 && (parts[parts.length - 1].toUpperCase() === 'AM' || parts[parts.length - 1].toUpperCase() === 'PM')) {
            return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
        }
        return s;
    }
    // Check if format is HH:MM or HH:MM:SS (e.g. shift "08:00", "16:00")
    if (s.includes(':') && s.length <= 8 && !s.includes('-')) {
        const parts = s.split(':');
        let h = parseInt(parts[0], 10);
        const m = parts[1] ? parts[1].padStart(2, '0') : '00';
        if (isNaN(h)) return s;
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (h === 0) h = 12;
        return `${h}:${m} ${ampm}`;
    }
    // Check if ISO or full datetime string (SQLite UTC naive timestamp "2026-10-09 06:26:48" or ISO)
    if (s.includes('T') || s.includes('-')) {
        try {
            // Append Z if no timezone is present so the browser parses it as UTC
            const iso = (s.includes('T') ? s : s.replace(' ', 'T')) + (s.includes('Z') || /[+-]\d{2}/.test(s) ? '' : 'Z');
            const d = new Date(iso);
            if (!isNaN(d.getTime())) {
                return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
            }
        } catch (e) {}
    }
    return s;
}

function formatDateTime12H(dateTimeStr) {
    if (!dateTimeStr || dateTimeStr === '-' || dateTimeStr === '—' || dateTimeStr === 'null' || dateTimeStr === 'undefined') return '-';
    const s = String(dateTimeStr).trim();
    if ((s.includes('AM') || s.includes('PM')) && s.includes('-')) {
        return s;
    }
    try {
        const iso = (s.includes('T') ? s : s.replace(' ', 'T')) + (s.includes('Z') || /[+-]\d{2}/.test(s) ? '' : 'Z');
        const d = new Date(iso);
        if (!isNaN(d.getTime())) {
            const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
            return `${dateStr} ${timeStr}`;
        }
    } catch (e) {}
    return s;
}

function formatShiftRange(start, end) {
    if (!start && !end) return 'General Shift (OPEN)';
    return `${formatTime12H(start)} - ${formatTime12H(end)}`;
}

function toggleSidebar() {
    const body = document.body;
    const isCollapsed = body.classList.toggle('sidebar-collapsed');
    localStorage.setItem('sidebar_collapsed', isCollapsed ? 'true' : 'false');
    const icon = document.getElementById('icon-toggle-sidebar');
    if (icon) {
        icon.setAttribute('data-lucide', isCollapsed ? 'panel-left-open' : 'panel-left-close');
        lucide.createIcons();
    }
}

function initSidebarState() {
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
        document.body.classList.add('sidebar-collapsed');
        const icon = document.getElementById('icon-toggle-sidebar');
        if (icon) {
            icon.setAttribute('data-lucide', 'panel-left-open');
        }
    }
}

// Initialization on DOM Load
document.addEventListener('DOMContentLoaded', async () => {
    initSidebarState();
    lucide.createIcons();
    startLiveClock();
    setupKeyboardShortcuts();
    
    // Load store configuration & catalog basics
    await loadSettings();
    await loadCategories();
    await loadCatalog();

    // Initialize printer settings
    initPrinterSettings();

    // Check existing auth session
    await checkAuthOnLoad();

    // Check system notifications & alerts
    checkStoreNotifications();

    // Barcode listener on enter key
    const barcodeInput = document.getElementById('barcode-input');
    if (barcodeInput) {
        barcodeInput.addEventListener('keydown', handleBarcodeEnter);
    }
});

// Live Digital Clock & Formatted Date
function startLiveClock() {
    function update() {
        const now = new Date();
        const clockEl = document.getElementById('live-clock');
        const hdrDateEl = document.getElementById('hdr-date-display');
        const ownerWelcomeDate = document.getElementById('owner-welcome-date');
        const empDateBadge = document.getElementById('emp-date-badge');
        const posHdrDate = document.getElementById('pos-hdr-date');
        const posHdrTime = document.getElementById('pos-hdr-time');

        const formattedDate = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: '2-digit', year: 'numeric' });
        const formattedTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

        if (clockEl) clockEl.textContent = formattedTime;
        if (hdrDateEl) hdrDateEl.textContent = formattedDate;
        if (ownerWelcomeDate) ownerWelcomeDate.textContent = formattedDate;
        if (empDateBadge) empDateBadge.textContent = formattedDate;
        if (posHdrDate) posHdrDate.textContent = formattedDate;
        if (posHdrTime) posHdrTime.textContent = formattedTime;
    }
    update();
    setInterval(update, 1000);
}

function updatePosHeader() {
    const storeNameEl = document.getElementById('pos-hdr-shop-name');
    if (storeNameEl) {
        storeNameEl.textContent = (state.storeSettings && state.storeSettings.store_name) ? state.storeSettings.store_name.toUpperCase() : 'METRO FRESH SUPERMARKET';
    }
    const cashierEl = document.getElementById('pos-hdr-cashier');
    if (cashierEl) {
        cashierEl.textContent = state.currentUser ? state.currentUser.name : 'Cashier';
    }
    const shiftTextEl = document.getElementById('pos-hdr-shift-text');
    if (shiftTextEl) {
        shiftTextEl.textContent = state.activeShift ? state.activeShift.name : 'OPEN';
    }
    const printerEl = document.getElementById('pos-hdr-printer');
    if (printerEl) {
        printerEl.textContent = (state.printerSettings && state.printerSettings.enabled) ? `READY (${state.printerSettings.paperWidth || '80mm'})` : 'OFFLINE';
    }
    const heldBadge = document.getElementById('hdr-held-count');
    if (heldBadge) {
        heldBadge.textContent = state.heldCarts.length;
    }
}

// ==========================================
// 1. AUTHENTICATION & SESSION MANAGEMENT
// ==========================================

async function checkAuthOnLoad() {
    if (!state.token) {
        showLoginScreen();
        return;
    }
    try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
            const user = await res.json();
            state.currentUser = user;
            setupUserSessionUI(user);
            
            if (user.role === 'OWNER') {
                switchScreen('owner-dashboard');
            } else {
                switchScreen('employee-dashboard');
            }
        } else {
            showLoginScreen();
        }
    } catch (err) {
        showLoginScreen();
    }
}

function showLoginScreen() {
    const loginScreen = document.getElementById('screen-login');
    if (loginScreen) {
        loginScreen.classList.remove('hidden');
    }
    document.querySelectorAll('.screen-view').forEach(s => s.classList.add('hidden'));
    document.getElementById('nav-owner-group')?.classList.add('hidden');
    document.getElementById('nav-employee-group')?.classList.add('hidden');
}

function fillLoginCredentials(username, password) {
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
}

function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
    }
}

async function handleLoginSubmit(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    if (!username || !password) {
        Swal.fire({
            title: 'Missing Credentials',
            text: 'Please enter both Username/Employee ID and Password.',
            icon: 'warning',
            confirmButtonColor: '#2563eb'
        });
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const err = await res.json();
            playBeep('error');
            Swal.fire({
                title: 'Login Failed',
                text: err.detail || 'Invalid username or password.',
                icon: 'error',
                confirmButtonColor: '#dc2626'
            });
            return;
        }

        const data = await res.json();
        state.token = data.access_token || data.token;
        state.currentUser = data.user;
        localStorage.setItem('pos_token', state.token);

        playBeep('success');
        setupUserSessionUI(data.user);

        const loginOverlay = document.getElementById('screen-login');
        if (loginOverlay) loginOverlay.classList.add('hidden');

        if (data.user.role === 'OWNER') {
            await switchScreen('owner-dashboard');
        } else {
            await switchScreen('employee-dashboard');
        }

        Swal.fire({
            title: `Welcome, ${data.user.name}!`,
            text: `Logged in as ${data.user.role === 'OWNER' ? 'Store Owner' : 'Cashier (' + data.user.employee_id + ')'}`,
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });

    } catch (err) {
        console.error('Login error:', err);
    }
}

function setupUserSessionUI(user) {
    const hdrUserName = document.getElementById('hdr-user-name');
    const hdrUserSubtext = document.getElementById('hdr-user-subtext');
    const hdrAvatar = document.getElementById('hdr-user-avatar');
    const hdrRoleBadge = document.getElementById('hdr-role-badge');
    const posCashierBadge = document.getElementById('pos-cashier-badge');

    const navOwnerGroup = document.getElementById('nav-owner-group');
    const navEmpGroup = document.getElementById('nav-employee-group');

    if (hdrUserName) hdrUserName.innerHTML = `<span>${user.name}</span>`;
    if (hdrUserSubtext) hdrUserSubtext.textContent = user.role === 'OWNER' ? 'Store Owner / Admin' : `Cashier (${user.employee_id})`;
    if (hdrAvatar) {
        const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        hdrAvatar.textContent = initials || 'US';
    }
    if (hdrRoleBadge) {
        hdrRoleBadge.textContent = user.role === 'OWNER' ? 'OWNER ACCESS' : `CASHIER: ${user.employee_id}`;
    }
    if (posCashierBadge) {
        posCashierBadge.textContent = `${user.name} (${user.employee_id || 'OWNER'})`;
    }

    if (user.role === 'OWNER') {
        if (navOwnerGroup) navOwnerGroup.classList.remove('hidden');
        if (navEmpGroup) navEmpGroup.classList.add('hidden');
    } else {
        if (navOwnerGroup) navOwnerGroup.classList.add('hidden');
        if (navEmpGroup) navEmpGroup.classList.remove('hidden');
    }
    updatePosHeader();
    lucide.createIcons();
}

async function handleLogout(confirm = true) {
    if (confirm) {
        const result = await Swal.fire({
            title: 'Confirm Logout?',
            text: 'Are you sure you want to log out from this terminal?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, Log Out',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc2626'
        });
        if (!result.isConfirmed) return;
    }

    try {
        if (state.token) {
            await apiFetch('/api/auth/logout', { method: 'POST' });
        }
    } catch (e) {}

    localStorage.removeItem('pos_token');
    state.token = null;
    state.currentUser = null;
    state.cart = [];
    renderCart();

    showLoginScreen();
}

function handleLogoClick() {
    if (!state.currentUser) {
        showLoginScreen();
        return;
    }
    if (state.currentUser.role === 'OWNER') {
        switchScreen('owner-dashboard');
    } else {
        switchScreen('employee-dashboard');
    }
}

// ==========================================
// 2. SCREEN ROUTER & NAVIGATION
// ==========================================

async function switchScreen(screenKey) {
    if (!state.currentUser) {
        showLoginScreen();
        return;
    }

    // Role Security Guard
    if (state.currentUser.role !== 'OWNER' && screenKey.startsWith('owner-') && screenKey !== 'owner-inventory') {
        Swal.fire({
            title: 'Access Restricted',
            text: 'This section requires Owner / Admin privileges.',
            icon: 'warning',
            confirmButtonColor: '#2563eb'
        });
        screenKey = 'employee-dashboard';
    }

    // Hide all screens
    document.querySelectorAll('.screen-view').forEach(screen => {
        screen.classList.add('hidden');
    });

    // Deselect all nav items
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
    });

    // Show selected screen
    const targetScreen = document.getElementById(`screen-${screenKey}`);
    if (targetScreen) {
        targetScreen.classList.remove('hidden');
        state.activeScreen = screenKey;
    }

    // Highlight nav item
    const targetNav = document.getElementById(`nav-${screenKey}`) || 
                      document.getElementById(`nav-owner-${screenKey.replace('owner-', '')}`) ||
                      document.getElementById(`nav-employee-${screenKey.replace('employee-', '')}`);
    if (targetNav) {
        targetNav.classList.add('active');
    }

    // Load dynamic data for screens
    if (screenKey === 'owner-dashboard') {
        await loadOwnerDashboard();
    } else if (screenKey === 'owner-inventory') {
        await loadInventoryTable();
    } else if (screenKey === 'owner-batches') {
        await loadOwnerBatches();
    } else if (screenKey === 'owner-stock-ledger') {
        await loadStockLedger();
    } else if (screenKey === 'owner-returns') {
        await loadSalesReturnsTable();
    } else if (screenKey === 'owner-reorder') {
        await loadSmartReorder();
    } else if (screenKey === 'owner-promotions') {
        await loadOwnerPromotions();
    } else if (screenKey === 'owner-reports') {
        await loadOwnerReports();
    } else if (screenKey === 'owner-system-health') {
        await loadSystemHealthScreen();
    } else if (screenKey === 'owner-suppliers') {
        await loadSuppliersTable();
    } else if (screenKey === 'owner-purchases') {
        await loadPurchasesTable();
    } else if (screenKey === 'owner-orders') {
        await loadOrdersHistory();
    } else if (screenKey === 'owner-employees') {
        await loadOwnerEmployees();
    } else if (screenKey === 'owner-shifts') {
        await loadOwnerShifts();
    } else if (screenKey === 'owner-attendance') {
        await loadOwnerAttendance();
    } else if (screenKey === 'owner-salary') {
        await loadOwnerSalaryManagement();
    } else if (screenKey === 'owner-barcodes') {
        loadShelfLabelsScreen();
    } else if (screenKey === 'owner-settings') {
        loadSettingsScreen();
    } else if (screenKey === 'employee-dashboard') {
        await loadEmployeeDashboard();
    } else if (screenKey === 'employee-attendance') {
        await loadEmployeeAttendance();
    } else if (screenKey === 'employee-bills') {
        await loadEmployeeBills();
    } else if (screenKey === 'pos') {
        renderPosProductGrid();
        renderCart();
        setTimeout(() => {
            const input = document.getElementById('barcode-input');
            if (input) input.focus();
        }, 100);
    }

    lucide.createIcons();
}

// ==========================================
// 3. OWNER DASHBOARD & METRICS
// ==========================================

async function loadOwnerDashboard() {
    try {
        const res = await apiFetch('/api/owner/dashboard-metrics');
        if (!res.ok) return;
        const data = await res.json();

        // Greeting
        const greetingEl = document.getElementById('owner-greeting');
        const hour = new Date().getHours();
        const timeGreeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
        if (greetingEl) greetingEl.textContent = `${timeGreeting}, Store Owner 👋`;

        // Metrics
        document.getElementById('owner-metric-sales').textContent = `₹${(data.today_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        document.getElementById('owner-metric-bills').textContent = data.today_bills || 0;
        document.getElementById('owner-metric-total-prods').textContent = data.total_products || 0;
        document.getElementById('owner-metric-low-stock').textContent = data.low_stock_products || 0;
        document.getElementById('owner-metric-suppliers').textContent = data.total_suppliers || 0;
        document.getElementById('owner-metric-purchases').textContent = data.today_purchases || 0;
        document.getElementById('owner-metric-supplier-due').textContent = `₹${(data.supplier_outstanding || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        document.getElementById('owner-metric-profit').textContent = `₹${(data.today_profit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        const lowStockBadge = document.getElementById('owner-lowstock-badge');
        if (lowStockBadge) {
            lowStockBadge.textContent = `${data.low_stock_products || 0} Low`;
        }

        // Active Workers Now List
        const workingList = document.getElementById('owner-working-now-list');
        if (workingList) {
            const workers = data.active_workers || data.working_now_list || [];
            if (workers.length === 0) {
                workingList.innerHTML = `
                    <div class="text-center py-6 text-slate-400 text-xs">
                        <i data-lucide="user-x" class="w-8 h-8 mx-auto mb-2 opacity-50 text-slate-300"></i>
                        <p>No cashiers currently checked into an active shift.</p>
                    </div>
                `;
            } else {
                workingList.innerHTML = workers.map(w => `
                    <div class="p-3 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-between">
                        <div class="flex items-center space-x-3">
                            <div class="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                                ${w.employee_id}
                            </div>
                            <div>
                                <div class="font-bold text-xs text-slate-900 flex items-center space-x-1.5">
                                    <span>${w.employee_name}</span>
                                    <span class="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.2 rounded-full">WORKING</span>
                                </div>
                                <div class="text-[11px] text-slate-500">
                                    Shift: <strong class="text-slate-700">${w.shift_name}</strong> • In: <span class="font-mono text-slate-700">${w.check_in_time}</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="font-mono font-bold text-xs text-emerald-700">₹${(w.shift_sales || 0).toFixed(2)}</div>
                            <div class="text-[10px] text-slate-500">${w.shift_bills || 0} bills • ${w.working_duration}</div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // Cashier Sales Leaderboard
        const empSalesBody = document.getElementById('owner-emp-sales-body');
        if (empSalesBody) {
            const sales = data.sales_by_employee || [];
            if (sales.length === 0) {
                empSalesBody.innerHTML = `<tr><td colspan="3" class="text-center py-4 text-slate-400">No cashier sales recorded today.</td></tr>`;
            } else {
                empSalesBody.innerHTML = sales.map((emp, idx) => `
                    <tr class="hover:bg-slate-50 transition">
                        <td class="p-2.5 font-medium flex items-center space-x-2">
                            <span class="w-5 h-5 rounded-full ${idx === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'} flex items-center justify-center font-mono font-bold text-[10px]">
                                ${idx + 1}
                            </span>
                            <div>
                                <div class="font-semibold text-slate-900">${emp.employee_name}</div>
                                <div class="text-[10px] text-slate-400 font-mono">${emp.employee_id}</div>
                            </div>
                        </td>
                        <td class="p-2.5 text-center font-mono font-bold text-slate-700">${emp.bills_created}</td>
                        <td class="p-2.5 text-right font-mono font-bold text-emerald-700">₹${(emp.total_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                `).join('');
            }
        }

        // Payment Settlements
        const pay = data.payments || data.payment_stats || {};
        const cashTotal = pay.CASH || 0;
        const upiTotal = pay.UPI || 0;
        const cardTotal = pay.CARD || 0;
        const grandTotal = cashTotal + upiTotal + cardTotal;

        document.getElementById('owner-pay-cash').textContent = `₹${cashTotal.toFixed(2)}`;
        document.getElementById('owner-pay-upi').textContent = `₹${upiTotal.toFixed(2)}`;
        document.getElementById('owner-pay-card').textContent = `₹${cardTotal.toFixed(2)}`;
        document.getElementById('owner-pay-total').textContent = `₹${grandTotal.toFixed(2)}`;

        // Hourly Sales Chart
        renderHourlySalesChart(data.hourly_sales || { labels: [], values: [] });

        // Dashboard Stock Alerts Table
        renderDashboardStockAlerts();

        lucide.createIcons();
    } catch (err) {
        console.error('Failed to load owner dashboard:', err);
    }
}

function renderDashboardStockAlerts() {
    const tbody = document.getElementById('owner-dash-stock-alerts-body');
    if (!tbody) return;

    const lowStockItems = state.catalog.filter(p => (p.stock_qty ?? p.stock_quantity ?? 0) <= (p.min_stock ?? p.min_stock_level ?? 10)).slice(0, 5);
    if (lowStockItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">All products have sufficient stock levels.</td></tr>`;
        return;
    }

    tbody.innerHTML = lowStockItems.map(p => {
        const currentStock = (p.stock_qty !== undefined ? p.stock_qty : (p.stock_quantity !== undefined ? p.stock_quantity : 0));
        const isOut = currentStock <= 0;
        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-2.5 font-medium text-slate-900">${p.name}</td>
                <td class="p-2.5 text-slate-500">${p.category}</td>
                <td class="p-2.5 text-center font-mono font-bold ${isOut ? 'text-red-600' : 'text-amber-600'}">${currentStock} ${p.unit || 'pcs'}</td>
                <td class="p-2.5 text-center font-mono text-slate-500">${p.min_stock ?? p.min_stock_level ?? 10}</td>
                <td class="p-2.5 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isOut ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}">
                        ${isOut ? 'OUT OF STOCK' : 'LOW STOCK'}
                    </span>
                </td>
                <td class="p-2.5 text-right">
                    <button onclick="openCreatePurchaseModal()" class="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition">
                        Order Stock
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderHourlySalesChart(hourlyData) {
    const canvas = document.getElementById('chart-owner-sales');
    if (!canvas) return;

    const labels = hourlyData.labels || [];
    const values = hourlyData.values || [];

    if (state.ownerSalesChart) {
        state.ownerSalesChart.destroy();
    }

    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(37, 99, 235, 0.25)');
    gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)');

    state.ownerSalesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00', '22:00'],
            datasets: [{
                label: "Today's Revenue (₹)",
                data: values.length ? values : [0, 0, 0, 0, 0, 0, 0, 0],
                borderColor: '#2563eb',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: '#2563eb',
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#0f172a',
                    titleColor: '#ffffff',
                    bodyColor: '#38bdf8',
                    callbacks: {
                        label: ctx => ` Sales: ₹${ctx.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: { color: '#64748b', font: { size: 10 } }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        callback: val => `₹${val}`
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

// ==========================================
// 4. SUPPLIER MANAGEMENT
// ==========================================

let cachedSuppliers = [];

async function loadSuppliersTable() {
    const search = document.getElementById('supplier-search-input')?.value.toLowerCase() || '';
    try {
        const res = await apiFetch('/api/suppliers');
        if (!res.ok) return;
        cachedSuppliers = await res.json();

        let list = cachedSuppliers;
        if (search) {
            list = list.filter(s => 
                (s.name && s.name.toLowerCase().includes(search)) ||
                (s.company_name && s.company_name.toLowerCase().includes(search)) ||
                (s.contact_person && s.contact_person.toLowerCase().includes(search)) ||
                (s.phone && s.phone.includes(search))
            );
        }

        const tbody = document.getElementById('suppliers-table-body');
        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">No suppliers found. Click "+ Add New Supplier" to create.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(s => {
            const due = s.summary ? s.summary.total_due : 0;
            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3">
                        <div class="font-bold text-slate-900">${s.name}</div>
                        <div class="text-[10px] text-slate-400">SUP-${s.id.toString().padStart(4, '0')}</div>
                    </td>
                    <td class="p-3">
                        <div class="font-medium text-slate-800">${s.company_name || s.name}</div>
                        <div class="text-[10px] text-slate-500">Contact: ${s.contact_person || '-'}</div>
                    </td>
                    <td class="p-3">
                        <div class="text-slate-800">${s.phone}</div>
                        <div class="text-[10px] text-slate-500">${s.email || '-'}</div>
                    </td>
                    <td class="p-3 font-mono text-slate-600 text-[11px]">${s.gstin || '-'}</td>
                    <td class="p-3 text-right font-mono font-semibold text-slate-900">₹${((s.summary?.total_purchases) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-right font-mono font-semibold text-emerald-700">₹${((s.summary?.total_paid) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-right font-mono font-bold ${due > 0 ? 'text-rose-600' : 'text-slate-500'}">₹${(due || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === 'ACTIVE' || s.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
                            ${s.status || 'ACTIVE'}
                        </span>
                    </td>
                    <td class="p-3 text-center space-x-1">
                        <button onclick="openSupplierPaymentModal(${s.id}, null, '${s.name}', ${due})" class="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs" title="Pay Supplier">
                            <i data-lucide="banknote" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="editSupplier(${s.id})" class="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs" title="Edit">
                            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="deleteSupplier(${s.id})" class="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs" title="Delete">
                            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Failed to load suppliers:', err);
    }
}

function openAddSupplierModal() {
    document.getElementById('modal-supplier-title').textContent = 'Add Supermarket Supplier';
    document.getElementById('supp-form-id').value = '';
    document.getElementById('supp-name').value = '';
    document.getElementById('supp-company').value = '';
    document.getElementById('supp-contact').value = '';
    document.getElementById('supp-phone').value = '';
    document.getElementById('supp-email').value = '';
    document.getElementById('supp-gstin').value = '';
    document.getElementById('supp-address').value = '';
    document.getElementById('supp-city').value = 'Chennai';
    document.getElementById('supp-state').value = 'Tamil Nadu';
    document.getElementById('supp-terms').value = 'Net 15 Days';
    document.getElementById('modal-supplier').classList.remove('hidden');
}

function closeSupplierModal() {
    document.getElementById('modal-supplier').classList.add('hidden');
}

async function editSupplier(id) {
    const supp = cachedSuppliers.find(s => s.id === id);
    if (!supp) return;

    document.getElementById('modal-supplier-title').textContent = `Edit Supplier (${supp.name})`;
    document.getElementById('supp-form-id').value = supp.id;
    document.getElementById('supp-name').value = supp.name || '';
    document.getElementById('supp-company').value = supp.company_name || '';
    document.getElementById('supp-contact').value = supp.contact_person || '';
    document.getElementById('supp-phone').value = supp.phone || '';
    document.getElementById('supp-email').value = supp.email || '';
    document.getElementById('supp-gstin').value = supp.gstin || '';
    document.getElementById('supp-address').value = supp.address || '';
    document.getElementById('supp-city').value = supp.city || 'Chennai';
    document.getElementById('supp-state').value = supp.state || 'Tamil Nadu';
    document.getElementById('supp-terms').value = supp.payment_terms || '';
    document.getElementById('modal-supplier').classList.remove('hidden');
}

async function saveSupplierForm() {
    const id = document.getElementById('supp-form-id').value;
    const name = document.getElementById('supp-name').value.trim();
    const company_name = document.getElementById('supp-company').value.trim();
    const contact_person = document.getElementById('supp-contact').value.trim();
    const phone = document.getElementById('supp-phone').value.trim();
    const email = document.getElementById('supp-email').value.trim();
    const gstin = document.getElementById('supp-gstin').value.trim();
    const address = document.getElementById('supp-address').value.trim();
    const city = document.getElementById('supp-city').value.trim();
    const stateName = document.getElementById('supp-state').value.trim();
    const payment_terms = document.getElementById('supp-terms').value.trim();

    if (!name || !phone) {
        Swal.fire({ title: 'Required Fields', text: 'Supplier Name and Mobile Number are required.', icon: 'warning', confirmButtonColor: '#2563eb' });
        return;
    }

    const payload = {
        name, company_name, contact_person, phone, email, gstin, address, city, state: stateName, payment_terms
    };

    try {
        let res;
        if (id) {
            res = await apiFetch(`/api/suppliers/${id}`, { method: 'PUT', body: payload });
        } else {
            res = await apiFetch('/api/suppliers', { method: 'POST', body: payload });
        }

        if (res.ok) {
            closeSupplierModal();
            playBeep('success');
            Swal.fire({ title: 'Supplier Saved!', icon: 'success', timer: 1200, showConfirmButton: false });
            await loadSuppliersTable();
        } else {
            const err = await res.json();
            Swal.fire({ title: 'Error', text: err.detail || 'Failed to save supplier.', icon: 'error' });
        }
    } catch (e) {}
}

async function deleteSupplier(id) {
    const confirm = await Swal.fire({
        title: 'Delete Supplier?',
        text: 'This will remove the supplier record from active listings.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Delete',
        confirmButtonColor: '#dc2626'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await apiFetch(`/api/suppliers/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await loadSuppliersTable();
        }
    } catch (e) {}
}

function openSupplierPaymentModal(supplierId, poId, suppName, dueAmount) {
    document.getElementById('pay-supp-supplier-id').value = supplierId;
    document.getElementById('pay-supp-po-id').value = poId || '';
    document.getElementById('pay-supp-name').textContent = suppName;
    document.getElementById('pay-supp-due').textContent = `₹${(dueAmount || 0).toFixed(2)}`;
    document.getElementById('pay-supp-amount').value = dueAmount > 0 ? dueAmount : '';
    document.getElementById('pay-supp-date').value = new Date().toISOString().substring(0, 10);
    document.getElementById('pay-supp-ref').value = `NEFT-${Math.floor(100000 + Math.random() * 900000)}`;
    document.getElementById('modal-supplier-payment').classList.remove('hidden');
}

function closeSupplierPaymentModal() {
    document.getElementById('modal-supplier-payment').classList.add('hidden');
}

async function submitSupplierPayment() {
    const supplier_id = parseInt(document.getElementById('pay-supp-supplier-id').value);
    const purchase_order_id = document.getElementById('pay-supp-po-id').value ? parseInt(document.getElementById('pay-supp-po-id').value) : null;
    const amount = parseFloat(document.getElementById('pay-supp-amount').value) || 0;
    const payment_date = document.getElementById('pay-supp-date').value;
    const payment_method = document.getElementById('pay-supp-method').value;
    const reference_number = document.getElementById('pay-supp-ref').value.trim();

    if (!amount || amount <= 0) {
        Swal.fire({ title: 'Invalid Amount', text: 'Please enter a valid payment amount.', icon: 'warning' });
        return;
    }

    try {
        const res = await apiFetch('/api/supplier-payments', {
            method: 'POST',
            body: { supplier_id, purchase_order_id, amount, payment_date, payment_method, reference_number }
        });

        if (res.ok) {
            closeSupplierPaymentModal();
            playBeep('success');
            Swal.fire({ title: 'Payment Recorded!', icon: 'success', timer: 1200, showConfirmButton: false });
            await loadSuppliersTable();
            await loadPurchasesTable();
        }
    } catch (e) {}
}

// ==========================================
// 5. PURCHASES & GOODS RECEIVING (GRN)
// ==========================================

let cachedPurchases = [];

async function loadPurchasesTable() {
    try {
        const res = await apiFetch('/api/purchases');
        if (!res.ok) return;
        cachedPurchases = await res.json();

        const tbody = document.getElementById('purchases-table-body');
        if (!tbody) return;

        if (cachedPurchases.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">No purchase orders found. Click "+ Create Purchase Order" to buy stock.</td></tr>`;
            return;
        }

        tbody.innerHTML = cachedPurchases.map(p => {
            const isReceived = p.received_status === 'RECEIVED' || p.status === 'RECEIVED';
            const isPaid = p.payment_status === 'PAID';
            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 font-mono font-bold text-indigo-600">${p.po_number}</td>
                    <td class="p-3 font-semibold text-slate-900">${p.supplier_name}</td>
                    <td class="p-3 text-slate-500 font-mono text-[11px]">${p.created_at || p.purchase_date || '-'}</td>
                    <td class="p-3 text-center font-mono">${p.items_count || 0}</td>
                    <td class="p-3 text-right font-mono font-bold text-slate-900">₹${(p.total_amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-right font-mono font-semibold text-emerald-700">₹${((p.paid_amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-right font-mono font-bold ${p.due_amount > 0 ? 'text-rose-600' : 'text-slate-400'}">₹${((p.due_amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isReceived ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                            ${isReceived ? 'RECEIVED' : 'PENDING'}
                        </span>
                    </td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${isPaid ? 'bg-emerald-100 text-emerald-800' : (p.paid_amount > 0 ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800')}">
                            ${p.payment_status || (isPaid ? 'PAID' : 'PENDING')}
                        </span>
                    </td>
                    <td class="p-3 text-center space-x-1 whitespace-nowrap">
                        <button onclick="viewPurchaseOrder(${p.id})" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold" title="View & Print PO">
                            View PO
                        </button>
                        ${!isReceived ? `
                            <button onclick="openReceiveGoodsModal(${p.id})" class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-sm" title="Receive Goods into Inventory">
                                Receive GRN
                            </button>
                        ` : ''}
                        ${!isPaid && p.due_amount > 0 ? `
                            <button onclick="openSupplierPaymentModal(${p.supplier_id}, ${p.id}, '${p.supplier_name}', ${p.due_amount})" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm" title="Record Payment">
                                Pay Due
                            </button>
                        ` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Failed to load purchases:', err);
    }
}

async function openCreatePurchaseModal() {
    state.currentPOItems = [];
    document.getElementById('po-inv-num').value = `INV-${Math.floor(1000 + Math.random() * 9000)}`;
    document.getElementById('po-date').value = new Date().toISOString().substring(0, 10);

    // Populate suppliers dropdown
    const suppSelect = document.getElementById('po-supplier-select');
    try {
        const res = await apiFetch('/api/suppliers');
        if (res.ok) {
            const suppliers = await res.json();
            suppSelect.innerHTML = suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
        }
    } catch (e) {}

    // Populate product select
    const prodSelect = document.getElementById('po-add-prod-select');
    prodSelect.innerHTML = state.catalog.map(p => `
        <option value="${p.id}" data-cost="${p.cost_price}" data-tax="${p.tax_rate}">${p.name} (Cost: ₹${p.cost_price})</option>
    `).join('');

    autoFillPOCostPrice();
    renderPOItemsTable();
    document.getElementById('modal-create-purchase').classList.remove('hidden');
}

function closeCreatePurchaseModal() {
    document.getElementById('modal-create-purchase').classList.add('hidden');
}

function autoFillPOCostPrice() {
    const select = document.getElementById('po-add-prod-select');
    const option = select.options[select.selectedIndex];
    if (option) {
        document.getElementById('po-add-cost').value = option.dataset.cost || 10;
        document.getElementById('po-add-tax').value = option.dataset.tax || 5;
    }
}

function addPOItemRow() {
    const select = document.getElementById('po-add-prod-select');
    const prodId = parseInt(select.value);
    const qty = parseFloat(document.getElementById('po-add-qty').value) || 1;
    const cost = parseFloat(document.getElementById('po-add-cost').value) || 0;
    const tax = parseFloat(document.getElementById('po-add-tax').value) || 0;

    const prod = state.catalog.find(p => p.id === prodId);
    if (!prod) return;

    const existing = state.currentPOItems.find(i => i.product_id === prodId);
    if (existing) {
        existing.quantity += qty;
    } else {
        state.currentPOItems.push({
            product_id: prod.id,
            name: prod.name,
            barcode: prod.barcode,
            quantity: qty,
            purchase_price: cost,
            tax_rate: tax,
            unit: prod.unit || 'pcs'
        });
    }

    renderPOItemsTable();
}

function removePOItemRow(idx) {
    state.currentPOItems.splice(idx, 1);
    renderPOItemsTable();
}

function renderPOItemsTable() {
    const tbody = document.getElementById('po-items-table-body');
    if (!tbody) return;

    let subtotal = 0;
    let totalTax = 0;

    if (state.currentPOItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-400">No items added to this PO yet.</td></tr>`;
    } else {
        tbody.innerHTML = state.currentPOItems.map((item, idx) => {
            const lineSub = item.purchase_price * item.quantity;
            const lineTax = lineSub * (item.tax_rate / 100);
            const lineTotal = lineSub + lineTax;
            subtotal += lineSub;
            totalTax += lineTax;

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-2.5 font-medium text-slate-900">${item.name}</td>
                    <td class="p-2.5 text-center font-mono font-bold text-slate-800">${item.quantity} ${item.unit}</td>
                    <td class="p-2.5 text-right font-mono text-slate-700">₹${item.purchase_price.toFixed(2)}</td>
                    <td class="p-2.5 text-center font-mono text-slate-500">${item.tax_rate}%</td>
                    <td class="p-2.5 text-right font-mono font-bold text-indigo-700">₹${lineTotal.toFixed(2)}</td>
                    <td class="p-2.5 text-center">
                        <button onclick="removePOItemRow(${idx})" class="p-1 text-slate-400 hover:text-red-500"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    const grandTotal = subtotal + totalTax;
    document.getElementById('po-total-items-count').textContent = state.currentPOItems.length;
    document.getElementById('po-subtotal-disp').textContent = `₹${subtotal.toFixed(2)}`;
    document.getElementById('po-tax-disp').textContent = `₹${totalTax.toFixed(2)}`;
    document.getElementById('po-grand-total-disp').textContent = `₹${grandTotal.toFixed(2)}`;

    lucide.createIcons();
}

async function savePurchaseOrderSubmit() {
    if (state.currentPOItems.length === 0) {
        Swal.fire({ title: 'Empty Purchase Order', text: 'Please add at least one product item.', icon: 'warning' });
        return;
    }

    const supplier_id = parseInt(document.getElementById('po-supplier-select').value);
    const invoice_number = document.getElementById('po-inv-num').value.trim();
    const purchase_date = document.getElementById('po-date').value;

    let subtotal = 0;
    let tax_amount = 0;
    state.currentPOItems.forEach(i => {
        const line = i.purchase_price * i.quantity;
        subtotal += line;
        tax_amount += line * (i.tax_rate / 100);
    });
    const total_amount = subtotal + tax_amount;

    const payload = {
        supplier_id,
        invoice_number,
        purchase_date,
        total_amount,
        tax_amount,
        items: state.currentPOItems
    };

    try {
        const res = await apiFetch('/api/purchases', { method: 'POST', body: payload });
        if (res.ok) {
            closeCreatePurchaseModal();
            playBeep('success');
            Swal.fire({ title: 'Purchase Order Created!', icon: 'success', timer: 1500, showConfirmButton: false });
            await loadPurchasesTable();
        }
    } catch (e) {}
}

async function viewPurchaseOrder(poId) {
    try {
        const res = await apiFetch(`/api/purchases/${poId}`);
        if (!res.ok) return;
        const po = await res.json();

        const printable = document.getElementById('purchase-order-printable');
        const set = state.storeSettings || {};

        const itemsHtml = (po.items || []).map(i => `
            <tr>
                <td class="p-2 border border-slate-300 font-medium">${i.name || i.product_name}</td>
                <td class="p-2 border border-slate-300 text-center font-mono">${i.quantity} ${i.unit || 'pcs'}</td>
                <td class="p-2 border border-slate-300 text-right font-mono">₹${(i.purchase_price || i.cost_price || 0).toFixed(2)}</td>
                <td class="p-2 border border-slate-300 text-center font-mono">${i.tax_rate || 0}%</td>
                <td class="p-2 border border-slate-300 text-right font-mono font-bold">₹${((i.purchase_price || i.cost_price || 0) * i.quantity * (1 + (i.tax_rate||0)/100)).toFixed(2)}</td>
            </tr>
        `).join('');

        printable.innerHTML = `
            <div class="flex justify-between items-start border-b-2 border-slate-900 pb-3">
                <div>
                    <h1 class="text-xl font-black uppercase text-slate-900">${set.store_name || 'METRO FRESH MART'}</h1>
                    <p class="text-[11px] text-slate-600">${set.address || 'Chennai, India'}</p>
                    <p class="text-[11px] font-mono">GSTIN: ${set.gstin || '33AAAAA0000A1Z5'}</p>
                </div>
                <div class="text-right">
                    <h2 class="text-lg font-black text-indigo-700">PURCHASE ORDER</h2>
                    <p class="font-mono font-bold text-xs">${po.po_number}</p>
                    <p class="text-[11px] text-slate-500">Date: ${po.created_at || new Date().toLocaleDateString()}</p>
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                <div>
                    <div class="font-bold text-slate-500 uppercase text-[10px]">Vendor / Supplier:</div>
                    <div class="font-bold text-sm text-slate-900">${po.supplier_name}</div>
                    <div class="text-slate-600">Supplier Inv: ${po.invoice_number || 'N/A'}</div>
                </div>
                <div class="text-right">
                    <div class="font-bold text-slate-500 uppercase text-[10px]">Order Status:</div>
                    <div class="font-bold text-indigo-700">${po.status || 'PENDING'}</div>
                    <div class="text-slate-600">Payment: ${po.payment_status || 'PENDING'}</div>
                </div>
            </div>

            <table class="w-full text-left text-xs border-collapse border border-slate-300">
                <thead class="bg-slate-100 font-bold uppercase text-[10px]">
                    <tr>
                        <th class="p-2 border border-slate-300">Product Item</th>
                        <th class="p-2 border border-slate-300 text-center">Quantity</th>
                        <th class="p-2 border border-slate-300 text-right">Unit Rate (₹)</th>
                        <th class="p-2 border border-slate-300 text-center">GST %</th>
                        <th class="p-2 border border-slate-300 text-right">Total (₹)</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div class="flex justify-between items-center pt-2 text-xs">
                <div class="text-slate-500 text-[11px]">
                    Payment Terms: Standard 15 Days Net
                </div>
                <div class="text-right font-mono space-y-1">
                    <div>Tax Total: <strong>₹${(po.tax_amount || 0).toFixed(2)}</strong></div>
                    <div class="text-base font-black text-slate-900 border-t-2 border-slate-900 pt-1">
                        GRAND TOTAL: ₹${(po.total_amount || 0).toFixed(2)}
                    </div>
                </div>
            </div>

            <div class="pt-8 flex justify-between text-[10px] text-slate-500 border-t border-dashed border-slate-300">
                <div>Authorized Store Signature: __________________</div>
                <div>Supplier Acknowledgment: __________________</div>
            </div>
        `;

        document.getElementById('modal-view-po').classList.remove('hidden');
    } catch (e) {}
}

function closeViewPOModal() {
    document.getElementById('modal-view-po').classList.add('hidden');
}

function printPurchaseOrderDirect() {
    document.body.classList.add('print-po-active');
    window.print();
    document.body.classList.remove('print-po-active');
}

async function openReceiveGoodsModal(poId) {
    try {
        const res = await apiFetch(`/api/purchases/${poId}`);
        if (!res.ok) return;
        const po = await res.json();

        document.getElementById('grn-po-id').value = po.id;
        document.getElementById('grn-po-ref-title').textContent = `PO: ${po.po_number} • Supplier: ${po.supplier_name}`;

        const tbody = document.getElementById('grn-items-table-body');
        tbody.innerHTML = (po.items || []).map(i => `
            <tr class="hover:bg-slate-50 transition" data-prod-id="${i.product_id}">
                <td class="p-2.5 font-medium text-slate-900">${i.name || i.product_name}</td>
                <td class="p-2.5 text-center font-mono font-bold text-slate-600">${i.quantity} ${i.unit || 'pcs'}</td>
                <td class="p-2.5 text-center">
                    <input type="number" step="any" value="${i.quantity}" class="grn-recv-qty w-20 bg-white border-2 border-indigo-400 rounded-lg text-center font-mono font-bold text-slate-900 px-2 py-1 focus:outline-none">
                </td>
                <td class="p-2.5 text-right font-mono text-slate-700">₹${(i.purchase_price || i.cost_price || 0).toFixed(2)}</td>
            </tr>
        `).join('');

        document.getElementById('modal-receive-goods').classList.remove('hidden');
    } catch (e) {}
}

function closeReceiveGoodsModal() {
    document.getElementById('modal-receive-goods').classList.add('hidden');
}

async function confirmReceiveGoodsSubmit() {
    const poId = document.getElementById('grn-po-id').value;
    const notes = document.getElementById('grn-notes').value.trim();

    const rows = document.querySelectorAll('#grn-items-table-body tr');
    const items = [];
    rows.forEach(row => {
        const prodId = parseInt(row.dataset.prodId);
        const recvQty = parseFloat(row.querySelector('.grn-recv-qty').value) || 0;
        items.push({ product_id: prodId, received_qty: recvQty });
    });

    try {
        const res = await apiFetch(`/api/purchases/${poId}/receive`, {
            method: 'POST',
            body: { items, notes }
        });

        if (res.ok) {
            closeReceiveGoodsModal();
            playBeep('success');
            Swal.fire({ title: 'Stock Updated!', text: 'Goods received and added to inventory.', icon: 'success', timer: 1500, showConfirmButton: false });
            await loadCatalog();
            await loadPurchasesTable();
        }
    } catch (e) {}
}

// ==========================================
// 6. PRODUCT MANAGEMENT & BARCODE PRINTING
// ==========================================

let inventorySearchTimeout = null;
function debounceInventorySearch() {
    clearTimeout(inventorySearchTimeout);
    inventorySearchTimeout = setTimeout(loadInventoryTable, 300);
}

async function loadInventoryTable() {
    const search = document.getElementById('inv-search-input')?.value || '';
    const category = document.getElementById('inv-category-select')?.value || 'All';
    const lowStockOnly = document.getElementById('inv-lowstock-filter')?.checked || false;
    const isOwner = state.currentUser && state.currentUser.role === 'OWNER';

    // Role-based visibility for Inventory Screen Header and Controls
    const addProdBtn = document.getElementById('btn-inv-add-product');
    const thCost = document.getElementById('inv-th-cost');
    const thActions = document.getElementById('inv-th-actions');
    const hdrTitle = document.getElementById('inv-hdr-title');
    const hdrSubtitle = document.getElementById('inv-hdr-subtitle');

    if (addProdBtn) addProdBtn.classList.toggle('hidden', !isOwner);
    if (thCost) thCost.classList.toggle('hidden', !isOwner);
    if (thActions) thActions.classList.toggle('hidden', !isOwner);

    if (hdrTitle) {
        hdrTitle.textContent = isOwner ? 'Product Catalog & Shelf Inventory' : 'Products Directory (Read-Only)';
    }
    if (hdrSubtitle) {
        hdrSubtitle.textContent = isOwner 
            ? 'Manage supermarket products, pricing, stock levels, GST rates and print shelf barcode labels'
            : 'Search and view supermarket products, selling prices, MRP, and stock availability (Read-Only access)';
    }

    try {
        const res = await fetch('/api/products');
        if (!res.ok) return;
        let prods = await res.json();
        state.catalog = prods;

        const catSelect = document.getElementById('inv-category-select');
        if (catSelect && catSelect.children.length <= 1) {
            catSelect.innerHTML = '<option value="All">All Categories</option>' + state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        }

        if (search) {
            const q = search.toLowerCase();
            prods = prods.filter(p => p.name.toLowerCase().includes(q) || p.barcode.includes(q) || (p.brand && p.brand.toLowerCase().includes(q)));
        }
        if (category && category !== 'All') {
            prods = prods.filter(p => p.category === category);
        }
        if (lowStockOnly) {
            prods = prods.filter(p => (p.stock_qty ?? p.stock_quantity ?? 0) <= (p.min_stock ?? p.min_stock_level ?? 10));
        }

        const tbody = document.getElementById('inventory-table-body');
        if (!tbody) return;

        const colSpan = isOwner ? 10 : 8;
        if (prods.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${colSpan}" class="text-center py-6 text-slate-400">No products matching criteria.</td></tr>`;
            return;
        }

        tbody.innerHTML = prods.map(p => {
            const currentStock = (p.stock_qty !== undefined ? p.stock_qty : (p.stock_quantity !== undefined ? p.stock_quantity : 0));
            const isOut = currentStock <= 0;
            const isLow = currentStock <= (p.min_stock ?? p.min_stock_level ?? 10);
            return `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="p-3 font-mono font-bold text-slate-800">${p.barcode}</td>
                    <td class="p-3">
                        <div class="font-bold text-slate-900">${p.name}</div>
                        <div class="text-[10px] text-slate-400">${p.brand || 'Generic'}</div>
                    </td>
                    <td class="p-3 text-slate-600">${p.category}</td>
                    ${isOwner ? `<td class="p-3 text-right font-mono text-slate-500">₹${(p.cost_price || 0).toFixed(2)}</td>` : ''}
                    <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${p.selling_price.toFixed(2)}</td>
                    <td class="p-3 text-right font-mono text-slate-400 line-through">₹${p.mrp.toFixed(2)}</td>
                    <td class="p-3 text-center font-mono">${p.tax_rate}%</td>
                    <td class="p-3 text-center">
                        <span class="px-2 py-0.5 rounded-full font-mono font-bold text-xs ${isOut ? 'bg-red-100 text-red-700 border border-red-200' : (isLow ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200')}">
                            ${currentStock} ${p.unit || 'pcs'}
                        </span>
                    </td>
                    <td class="p-3 text-center font-mono text-slate-500">${p.rack_location || '-'}</td>
                    ${isOwner ? `
                    <td class="p-3 text-center space-x-1 whitespace-nowrap">
                        <button onclick="openBarcodePrintModal('${p.barcode}', '${p.name.replace(/'/g, "\\'")}', ${p.selling_price}, ${p.mrp})" class="p-1.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-lg text-xs" title="Print Barcode Label">
                            <i data-lucide="printer" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="editProduct(${p.id})" class="p-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs" title="Edit">
                            <i data-lucide="edit" class="w-3.5 h-3.5"></i>
                        </button>
                        <button onclick="deleteProduct(${p.id})" class="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs" title="Delete">
                            <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                        </button>
                    </td>` : ''}
                </tr>
            `;
        }).join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Error in loadInventoryTable:', err);
    }
}

async function triggerBarcodeGeneration() {
    try {
        const res = await apiFetch('/api/products/generate-barcode', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            const barcodeInput = document.getElementById('prod-barcode');
            if (barcodeInput) barcodeInput.value = data.barcode;
            return data.barcode;
        }
    } catch (e) {}
    const fallback = `8901${Math.floor(100000000 + Math.random() * 900000000)}`;
    const barcodeInput = document.getElementById('prod-barcode');
    if (barcodeInput) barcodeInput.value = fallback;
    return fallback;
}

function openAddProductModal() {
    document.getElementById('modal-product-title').textContent = 'Add Supermarket Product';
    document.getElementById('prod-form-id').value = '';
    // Allow custom barcode entry; do NOT auto-replace unless explicitly generated
    const barcodeInput = document.getElementById('prod-barcode');
    if (barcodeInput) {
        barcodeInput.value = '';
        barcodeInput.placeholder = 'Enter custom barcode or click Generate';
    }
    document.getElementById('prod-sku').value = `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    document.getElementById('prod-name').value = '';
    document.getElementById('prod-brand').value = '';
    document.getElementById('prod-cost').value = '100';
    document.getElementById('prod-selling').value = '120';
    document.getElementById('prod-mrp').value = '130';
    document.getElementById('prod-tax').value = '12';
    document.getElementById('prod-stock').value = '50';
    document.getElementById('prod-min-stock').value = '10';
    document.getElementById('prod-rack').value = 'AISLE-01';

    const catSelect = document.getElementById('prod-category');
    catSelect.innerHTML = state.categories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    document.getElementById('modal-product').classList.remove('hidden');
    setTimeout(() => {
        const bInput = document.getElementById('prod-barcode');
        if (bInput) bInput.focus();
    }, 100);
}

function closeProductModal() {
    document.getElementById('modal-product').classList.add('hidden');
}

async function editProduct(id) {
    const p = state.catalog.find(i => i.id === id);
    if (!p) return;

    document.getElementById('modal-product-title').textContent = `Edit Product (${p.name})`;
    document.getElementById('prod-form-id').value = p.id;
    // Preserve exact barcode string including any leading zeros
    document.getElementById('prod-barcode').value = String(p.barcode || '');
    document.getElementById('prod-sku').value = p.sku;
    document.getElementById('prod-name').value = p.name;
    document.getElementById('prod-brand').value = p.brand || '';
    document.getElementById('prod-cost').value = p.cost_price;
    document.getElementById('prod-selling').value = p.selling_price;
    document.getElementById('prod-mrp').value = p.mrp;
    document.getElementById('prod-tax').value = p.tax_rate;
    document.getElementById('prod-stock').value = (p.stock_qty !== undefined ? p.stock_qty : (p.stock_quantity !== undefined ? p.stock_quantity : 0));
    document.getElementById('prod-min-stock').value = (p.min_stock !== undefined ? p.min_stock : (p.min_stock_level !== undefined ? p.min_stock_level : 10));
    document.getElementById('prod-rack').value = p.rack_location || '';
    document.getElementById('prod-unit').value = p.unit || 'pcs';

    const catSelect = document.getElementById('prod-category');
    catSelect.innerHTML = state.categories.map(c => `<option value="${c.name}" ${c.name === p.category ? 'selected' : ''}>${c.name}</option>`).join('');

    document.getElementById('modal-product').classList.remove('hidden');
}

async function saveProductForm() {
    const id = document.getElementById('prod-form-id').value;
    let barcode = document.getElementById('prod-barcode').value.trim();
    const sku = document.getElementById('prod-sku').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const category = document.getElementById('prod-category').value;
    const brand = document.getElementById('prod-brand').value.trim();
    const cost_price = parseFloat(document.getElementById('prod-cost').value) || 0;
    const selling_price = parseFloat(document.getElementById('prod-selling').value) || 0;
    const mrp = parseFloat(document.getElementById('prod-mrp').value) || selling_price;
    const tax_rate = parseFloat(document.getElementById('prod-tax').value) || 0;
    const stock_qty = parseFloat(document.getElementById('prod-stock').value) || 0;
    const min_stock = parseFloat(document.getElementById('prod-min-stock').value) || 5;
    const rack_location = document.getElementById('prod-rack').value.trim();
    const unit = document.getElementById('prod-unit').value;

    if (!name || isNaN(selling_price) || selling_price <= 0) {
        Swal.fire({ title: 'Missing Information', text: 'Product Name and a valid Selling Price are required.', icon: 'warning' });
        return;
    }

    if (!barcode) {
        // If empty and saving, generate a unique barcode
        barcode = await triggerBarcodeGeneration();
    }

    // Validate duplicate barcodes locally before submitting
    const duplicate = state.catalog.find(p => String(p.barcode) === barcode && p.id != id);
    if (duplicate) {
        playBeep('error');
        Swal.fire({
            title: 'Duplicate Barcode',
            text: `Barcode "${barcode}" is already assigned to product "${duplicate.name}". Please enter a unique barcode.`,
            icon: 'error'
        });
        return;
    }

    const payload = {
        barcode, sku, name, category, brand, cost_price, selling_price, mrp, tax_rate, stock_qty, min_stock, rack_location, unit
    };

    try {
        let res;
        if (id) {
            res = await apiFetch(`/api/products/${id}`, { method: 'PUT', body: payload });
        } else {
            res = await apiFetch('/api/products', { method: 'POST', body: payload });
        }

        if (res.ok) {
            closeProductModal();
            playBeep('success');
            Swal.fire({ title: 'Product Saved', text: `Product "${name}" saved with barcode ${barcode}.`, icon: 'success', timer: 1400, showConfirmButton: false });
            await loadCatalog();
            await loadInventoryTable();
        } else {
            const err = await res.json();
            playBeep('error');
            Swal.fire({ title: 'Save Failed', text: err.detail || 'Could not save product.', icon: 'error' });
        }
    } catch (e) {
        console.error('Save product error:', e);
    }
}

async function deleteProduct(id) {
    const confirm = await Swal.fire({
        title: 'Delete Product?',
        text: 'This will remove the product SKU from catalog.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Yes, Delete',
        confirmButtonColor: '#dc2626'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await loadCatalog();
            await loadInventoryTable();
        }
    } catch (e) {}
}

function openBarcodePrintModal(barcode, name, price, mrp) {
    document.getElementById('label-store-name').textContent = state.storeSettings.store_name || 'METRO FRESH MART';
    document.getElementById('label-product-name').textContent = name;
    document.getElementById('label-price').textContent = `₹${parseFloat(price).toFixed(2)}`;
    document.getElementById('label-mrp').textContent = `MRP: ₹${parseFloat(mrp).toFixed(2)}`;

    if (typeof JsBarcode !== 'undefined') {
        try {
            JsBarcode("#barcode-label-svg", barcode, {
                format: "CODE128",
                width: 1.5,
                height: 36,
                displayValue: true,
                fontSize: 10,
                margin: 0
            });
        } catch (e) {}
    }

    document.getElementById('modal-barcode-print').classList.remove('hidden');
}

function closeBarcodePrintModal() {
    document.getElementById('modal-barcode-print').classList.add('hidden');
}

function printBarcodeLabelDirect() {
    document.body.classList.add('print-label-active');
    window.print();
    document.body.classList.remove('print-label-active');
}

// ==========================================
// 7. POS BILLING ENGINE
// ==========================================

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        if (res.ok) {
            state.storeSettings = await res.json();
            const set = state.storeSettings;
            if (document.getElementById('login-store-name')) document.getElementById('login-store-name').textContent = set.store_name || 'METRO FRESH SMART MART';
            if (document.getElementById('hdr-store-name')) document.getElementById('hdr-store-name').textContent = set.store_name || 'METRO FRESH SMART MART';
            if (document.getElementById('upi-id-display')) document.getElementById('upi-id-display').textContent = set.upi_id || 'metrofresh@icici';
        }
    } catch (e) {}
}

async function loadCategories() {
    try {
        const res = await fetch('/api/categories');
        if (res.ok) {
            state.categories = await res.json();
            renderCategoryFilterPills();
        }
    } catch (e) {}
}

async function loadCatalog() {
    try {
        const res = await fetch('/api/products');
        if (res.ok) {
            state.catalog = await res.json();
            const countEl = document.getElementById('total-catalog-count');
            if (countEl) countEl.textContent = state.catalog.length;
            renderPosProductGrid();
        }
    } catch (e) {}
}

function renderCategoryFilterPills() {
    const container = document.getElementById('pos-category-pills');
    if (!container) return;

    container.innerHTML = `
        <button onclick="filterPosCatalog('All')" class="cat-pill ${state.selectedCategory === 'All' ? 'active' : ''} px-3 py-1 rounded-lg text-xs whitespace-nowrap transition">
            All Items
        </button>
    ` + state.categories.map(cat => `
        <button onclick="filterPosCatalog('${cat.name}')" class="cat-pill ${state.selectedCategory === cat.name ? 'active' : ''} px-3 py-1 rounded-lg text-xs whitespace-nowrap transition">
            ${cat.name}
        </button>
    `).join('');
}

function filterPosCatalog(categoryName) {
    state.selectedCategory = categoryName;
    renderCategoryFilterPills();
    renderPosProductGrid();
}

function renderPosProductGrid() {
    const grid = document.getElementById('pos-product-grid');
    if (!grid) return;

    let items = state.catalog;
    if (state.selectedCategory && state.selectedCategory !== 'All') {
        items = items.filter(p => p.category === state.selectedCategory);
    }

    if (items.length === 0) {
        grid.innerHTML = `<div class="col-span-4 text-center py-12 text-slate-400">No products found in this category.</div>`;
        return;
    }

    grid.innerHTML = items.map(p => {
        const currentStock = (p.stock_qty !== undefined ? p.stock_qty : (p.stock_quantity !== undefined ? p.stock_quantity : 0));
        const minStock = (p.min_stock !== undefined ? p.min_stock : (p.min_stock_level !== undefined ? p.min_stock_level : 5));
        const isLow = currentStock <= minStock;
        return `
        <div onclick="addProductToCartByBarcode('${p.barcode}')" class="pos-prod-card p-3 h-36 rounded-2xl transition transform active:scale-98 group flex flex-col justify-between">
            <div>
                <div class="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                    <span class="font-mono text-slate-500 font-semibold truncate max-w-[90px]">${p.barcode}</span>
                    <span class="px-1.5 py-0.5 rounded-md font-mono font-bold text-[10px] shrink-0 ${isLow ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">${currentStock} ${p.unit || 'pcs'}</span>
                </div>
                <h4 class="font-bold text-xs text-slate-900 group-hover:text-blue-600 transition line-clamp-2 leading-snug">${p.name}</h4>
                <div class="text-[10px] text-slate-400 mt-0.5 truncate">${p.category || 'General'}</div>
            </div>
            <div class="pt-1.5 border-t border-slate-100 flex items-center justify-between mt-auto">
                <div class="flex items-baseline space-x-1">
                    <span class="text-xs font-bold font-mono text-emerald-700">₹${p.selling_price.toFixed(2)}</span>
                    ${p.mrp > p.selling_price ? `<span class="text-[10px] text-slate-400 line-through font-mono">₹${p.mrp.toFixed(2)}</span>` : ''}
                </div>
                <button class="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs group-hover:bg-blue-600 group-hover:text-white font-bold transition shadow-xs">
                    +
                </button>
            </div>
        </div>
    `;
    }).join('');
}

function handleBarcodeEnter(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    // Do not process scan if a blocking modal or Swal is open
    const anyModalOpen = document.querySelector('[id^="modal-"]:not(.hidden)');
    const swalOpen = document.querySelector('.swal2-container');
    if (anyModalOpen || (swalOpen && swalOpen.offsetParent !== null)) return;

    const code = e.target.value.trim();
    if (code) {
        addProductToCartByBarcode(code);
        e.target.value = '';
    }
}

function addProductToCartByBarcode(barcode, isFromCamera = false) {
    if (!barcode) return null;
    const barcodeClean = String(barcode).trim();
    const product = state.catalog.find(p => String(p.barcode) === barcodeClean || String(p.sku) === barcodeClean);
    if (!product) {
        const match = state.catalog.find(p => p.name && p.name.toLowerCase().includes(barcodeClean.toLowerCase()));
        if (match) {
            return addProductObjectToCart(match);
        }
        playBeep('error');
        if (!isFromCamera) {
            Swal.fire({
                title: 'Barcode Not Found',
                text: `No product matches barcode or SKU "${barcodeClean}".`,
                icon: 'warning',
                timer: 1400,
                showConfirmButton: false
            });
        }
        return null;
    }

    return addProductObjectToCart(product);
}

function addProductObjectToCart(product, customQty = 1) {
    const existingIndex = state.cart.findIndex(i => i.product_id === product.id && i.is_loose === product.is_loose);
    let targetItem;
    if (existingIndex > -1) {
        state.cart[existingIndex].quantity += customQty;
        state.selectedCartIndex = existingIndex;
        targetItem = state.cart[existingIndex];
    } else {
        targetItem = {
            product_id: product.id,
            name: product.name,
            barcode: String(product.barcode || ''),
            unit: product.unit || 'pcs',
            unit_price: product.selling_price,
            mrp: product.mrp,
            tax_rate: product.tax_rate || 0,
            quantity: customQty,
            is_loose: product.is_loose || false
        };
        state.cart.push(targetItem);
        state.selectedCartIndex = state.cart.length - 1;
    }

    playBeep('scan');
    renderCart();
    return targetItem;
}

function updateCartItemQty(index, newQty) {
    newQty = parseFloat(newQty);
    if (isNaN(newQty) || newQty <= 0) {
        removeCartItem(index);
        return;
    }
    state.cart[index].quantity = newQty;
    state.selectedCartIndex = index;
    renderCart();
}

function removeCartItem(index) {
    state.cart.splice(index, 1);
    if (state.selectedCartIndex >= state.cart.length) {
        state.selectedCartIndex = state.cart.length - 1;
    }
    playBeep('scan');
    renderCart();
}

function clearCartConfirm() {
    if (state.cart.length === 0) return;
    state.cart = [];
    state.loyaltyDiscountApplied = 0;
    state.couponDiscountApplied = 0;
    state.couponCode = null;
    state.selectedCartIndex = -1;
    playBeep('scan');
    renderCart();
}

function renderCart() {
    const container = document.getElementById('pos-cart-items');
    if (!container) return;

    if (state.cart.length === 0) {
        container.innerHTML = `
            <div class="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                <i data-lucide="shopping-basket" class="w-12 h-12 stroke-[1.2] mb-2 text-slate-300"></i>
                <p class="text-sm font-medium text-slate-600">Cart is currently empty</p>
                <p class="text-xs text-slate-400 mt-1">Scan a barcode [F3] or click items to start billing</p>
            </div>
        `;
        calculateCartTotals();
        lucide.createIcons();
        return;
    }

    container.innerHTML = state.cart.map((item, idx) => {
        const itemTotal = item.unit_price * item.quantity;
        const isSelected = idx === state.selectedCartIndex;
        return `
            <div class="grid grid-cols-12 gap-1.5 py-2 items-center text-xs ${isSelected ? 'bg-blue-50/80 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'} rounded-xl px-2 transition cursor-pointer" onclick="state.selectedCartIndex = ${idx}">
                <div class="col-span-6 pr-1">
                    <div class="font-bold text-slate-900 truncate" title="${item.name}">${item.name}</div>
                    <div class="text-[10px] text-slate-500 font-mono flex items-center space-x-1.5 mt-0.5">
                        <span>₹${item.unit_price.toFixed(2)}/${item.unit}</span>
                        <span>•</span>
                        <span>GST ${item.tax_rate}%</span>
                    </div>
                </div>
                <div class="col-span-3 flex items-center justify-center space-x-1" onclick="event.stopPropagation()">
                    <button onclick="updateCartItemQty(${idx}, ${item.quantity - 1})" class="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center text-xs border border-slate-200 transition">-</button>
                    <input type="number" step="any" onchange="updateCartItemQty(${idx}, this.value)" value="${item.quantity}" class="w-11 bg-white border border-slate-300 focus:border-blue-500 rounded-lg text-center text-xs font-mono font-bold text-slate-900 py-0.5 focus:outline-none">
                    <button onclick="updateCartItemQty(${idx}, ${item.quantity + 1})" class="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold flex items-center justify-center text-xs border border-slate-200 transition">+</button>
                </div>
                <div class="col-span-2 text-right font-mono font-bold text-emerald-700">
                    ₹${itemTotal.toFixed(2)}
                </div>
                <div class="col-span-1 flex justify-center" onclick="event.stopPropagation()">
                    <button onclick="removeCartItem(${idx})" class="w-6 h-6 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 flex items-center justify-center transition" title="Remove item">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    calculateCartTotals();
    lucide.createIcons();
}

function calculateCartTotals() {
    let subtotal = 0;
    let totalTax = 0;
    let totalUnits = 0;
    let totalMrp = 0;

    state.cart.forEach(item => {
        const lineTotal = item.unit_price * item.quantity;
        subtotal += lineTotal;
        totalUnits += item.quantity;
        totalMrp += (item.mrp || item.unit_price) * item.quantity;

        if (item.tax_rate > 0) {
            const taxPart = (lineTotal * item.tax_rate) / (100 + item.tax_rate);
            totalTax += taxPart;
        }
    });

    const promoDiscount = state.couponDiscountApplied || 0;
    const loyaltyDiscount = state.loyaltyDiscountApplied || 0;
    const mrpSavings = Math.max(0, totalMrp - subtotal);
    const totalSavings = mrpSavings + promoDiscount + loyaltyDiscount;

    let grandTotalRaw = subtotal - promoDiscount - loyaltyDiscount;
    grandTotalRaw = Math.max(0, grandTotalRaw);

    const roundedGrandTotal = Math.round(grandTotalRaw);
    const roundOff = roundedGrandTotal - grandTotalRaw;

    document.getElementById('cart-item-count').textContent = state.cart.length;
    document.getElementById('cart-unit-count').textContent = totalUnits.toFixed(1).replace('.0', '');
    document.getElementById('cart-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
    document.getElementById('cart-tax').textContent = `₹${totalTax.toFixed(2)}`;
    document.getElementById('cart-discount').textContent = `- ₹${promoDiscount.toFixed(2)}`;
    document.getElementById('cart-roundoff').textContent = `${roundOff >= 0 ? '+' : ''}₹${roundOff.toFixed(2)}`;
    document.getElementById('cart-grand-total').textContent = `₹${roundedGrandTotal.toFixed(2)}`;
    document.getElementById('cart-savings-badge').textContent = `You save ₹${totalSavings.toFixed(2)}`;

    const modalTotal = document.getElementById('pay-modal-total');
    if (modalTotal) modalTotal.textContent = `₹${roundedGrandTotal.toFixed(2)}`;

    return {
        subtotal, totalTax, promoDiscount, loyaltyDiscount, roundOff, grandTotal: roundedGrandTotal, totalSavings
    };
}

async function applyCoupon() {
    const input = document.getElementById('coupon-input');
    if (!input) return;
    const code = input.value.trim().toUpperCase();
    if (!code) return;

    const { subtotal } = calculateCartTotals();
    try {
        const res = await apiFetch('/api/pos/apply-coupon', {
            method: 'POST',
            body: { coupon_code: code, bill_subtotal: subtotal, items: state.cart }
        });
        if (res.ok) {
            const data = await res.json();
            if (data.valid) {
                state.couponDiscountApplied = data.discount_amount;
                state.couponCode = code;
                playBeep('success');
                Swal.fire({ title: 'Coupon Applied!', text: data.message || `₹${data.discount_amount.toFixed(2)} discount applied.`, icon: 'success', timer: 1500, showConfirmButton: false });
                renderCart();
            } else {
                playBeep('error');
                Swal.fire({ title: 'Coupon Invalid', text: data.message || 'Coupon not valid for this order.', icon: 'warning' });
            }
        }
    } catch (e) {
        console.error('Coupon apply error:', e);
    }
}

function openCustomerSelectModal() {
    document.getElementById('modal-customer').classList.remove('hidden');
    const input = document.getElementById('cust-search-phone');
    if (input) {
        input.value = '';
        input.focus();
    }
    const resultBox = document.getElementById('cust-lookup-result');
    if (resultBox) resultBox.classList.add('hidden');
}

function closeCustomerModal() {
    document.getElementById('modal-customer').classList.add('hidden');
}

async function lookupCustomerByPhone() {
    const phone = document.getElementById('cust-search-phone').value.trim();
    const resultBox = document.getElementById('cust-lookup-result');
    if (phone.length < 3) {
        resultBox.classList.add('hidden');
        return;
    }
    try {
        const res = await apiFetch(`/api/customers?search=${encodeURIComponent(phone)}`);
        if (res.ok) {
            const customers = await res.json();
            resultBox.classList.remove('hidden');
            if (customers.length === 0) {
                resultBox.innerHTML = `<div class="text-slate-400 py-1">No member found for '${phone}'. Register below.</div>`;
            } else {
                resultBox.innerHTML = customers.map(c => `
                    <div class="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                        <div>
                            <div class="font-bold text-xs text-slate-900">${c.name} (${c.phone})</div>
                            <div class="text-[10px] text-blue-600 font-semibold">${c.tier || 'Bronze'} Tier • ${c.loyalty_points || 0} Loyalty Points</div>
                        </div>
                        <button onclick='attachCustomer(${JSON.stringify(c).replace(/'/g, "\\'")})' class="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition">Attach</button>
                    </div>
                `).join('');
            }
        }
    } catch (e) {}
}

async function registerNewCustomer() {
    const name = document.getElementById('cust-new-name').value.trim();
    const phone = document.getElementById('cust-new-phone').value.trim();
    if (!name || !phone) {
        Swal.fire({ title: 'Missing Info', text: 'Please enter customer name and phone number.', icon: 'warning' });
        return;
    }
    try {
        const res = await apiFetch('/api/customers', {
            method: 'POST',
            body: { name, phone }
        });
        if (res.ok) {
            const newCust = await res.json();
            playBeep('success');
            attachCustomer(newCust);
            Swal.fire({ title: 'Customer Registered', text: `${name} has been enrolled in loyalty program.`, icon: 'success', timer: 1200, showConfirmButton: false });
        } else {
            const err = await res.json();
            Swal.fire({ title: 'Registration Failed', text: err.detail || 'Could not register customer.', icon: 'error' });
        }
    } catch (e) {}
}

function attachCustomer(cust) {
    state.currentCustomer = cust;
    document.getElementById('pos-customer-name').textContent = cust.name;
    document.getElementById('pos-customer-tier').textContent = cust.tier || 'Bronze';
    document.getElementById('pos-customer-phone').textContent = cust.phone;
    document.getElementById('pos-customer-points').textContent = `${cust.loyalty_points || cust.points || 0} pts`;
    document.getElementById('pos-cust-clear-btn').classList.remove('hidden');
    document.getElementById('redeem-points-btn').classList.remove('hidden');
    closeCustomerModal();
    renderCart();
}

function clearCurrentCustomer() {
    state.currentCustomer = null;
    state.loyaltyDiscountApplied = 0;
    document.getElementById('pos-customer-name').textContent = 'Walk-in Customer';
    document.getElementById('pos-customer-tier').textContent = 'Bronze';
    document.getElementById('pos-customer-phone').textContent = 'No loyalty linked';
    document.getElementById('pos-customer-points').textContent = '0 pts';
    document.getElementById('pos-cust-clear-btn').classList.add('hidden');
    document.getElementById('redeem-points-btn').classList.add('hidden');
    document.getElementById('cart-points-discount-row')?.classList.add('hidden');
    renderCart();
}

function redeemLoyaltyPointsModal() {
    const pts = state.currentCustomer ? (state.currentCustomer.loyalty_points || state.currentCustomer.points || 0) : 0;
    if (pts < 100) {
        Swal.fire({ title: 'Insufficient Points', text: `Customer has ${pts} points. Minimum 100 points required to redeem discount.`, icon: 'info' });
        return;
    }
    // 100 points = Rs 50 discount
    const discount = Math.floor(pts / 100) * 50;
    state.loyaltyDiscountApplied = discount;
    document.getElementById('cart-points-discount-row')?.classList.remove('hidden');
    document.getElementById('cart-points-discount').textContent = `- ₹${discount.toFixed(2)}`;
    playBeep('success');
    Swal.fire({ title: 'Points Redeemed!', text: `Redeemed points for a ₹${discount.toFixed(2)} discount.`, icon: 'success', timer: 1200, showConfirmButton: false });
    renderCart();
}

function seedQuickDummyBill() {
    state.cart = [
        { product_id: 1, name: 'Amul Butter 500g', barcode: '8901262010015', unit: 'pack', unit_price: 275.0, mrp: 285.0, tax_rate: 12.0, quantity: 1, is_loose: false },
        { product_id: 7, name: 'Tata Tea Gold 500g', barcode: '8901058852382', unit: 'pack', unit_price: 310.0, mrp: 340.0, tax_rate: 5.0, quantity: 2, is_loose: false },
        { product_id: 14, name: 'Fortune Sunlite Sunflower Oil 1L', barcode: '8906007280014', unit: 'bottle', unit_price: 145.0, mrp: 165.0, tax_rate: 5.0, quantity: 1, is_loose: false }
    ];
    playBeep('scan');
    renderCart();
}

function holdCurrentCart() {
    if (state.cart.length === 0) {
        playBeep('error');
        Swal.fire({ title: 'Cart Empty', text: 'No items in cart to hold.', icon: 'info', timer: 1200, showConfirmButton: false });
        return;
    }
    const heldItem = {
        id: 'HOLD-' + (state.heldCarts.length + 1) + '-' + Date.now().toString().slice(-4),
        time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        items: [...state.cart],
        customer: state.currentCustomer,
        total: calculateCartTotals().grandTotal
    };
    state.heldCarts.push(heldItem);
    updatePosHeader();
    
    state.cart = [];
    state.currentCustomer = null;
    clearCurrentCustomer();
    playBeep('scan');
    renderCart();
    focusBarcodeInput();
    
    Swal.fire({
        title: 'Bill Suspended [F5]',
        text: `Transaction #${heldItem.id} placed on hold. (${heldItem.items.length} items)`,
        icon: 'info',
        timer: 1400,
        showConfirmButton: false
    });
}

function openHeldCartsModal() {
    const modal = document.getElementById('modal-held-carts');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderHeldCartsList();
}

function closeHeldCartsModal() {
    const modal = document.getElementById('modal-held-carts');
    if (modal) modal.classList.add('hidden');
    focusBarcodeInput();
}

function renderHeldCartsList() {
    const container = document.getElementById('held-carts-list');
    if (!container) return;
    
    if (state.heldCarts.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-slate-400">
                <i data-lucide="folder-x" class="w-10 h-10 mx-auto stroke-[1.5] mb-2 text-slate-300"></i>
                <p class="font-medium text-xs">No held bills currently on hold.</p>
                <p class="text-[11px] text-slate-400 mt-0.5">Press F5 during checkout to hold a cart.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = state.heldCarts.map((h, index) => `
        <div class="p-3.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-2xl flex items-center justify-between transition gap-3">
            <div class="space-y-1 min-w-0 flex-1">
                <div class="flex items-center space-x-2">
                    <span class="font-mono font-bold text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">${h.id}</span>
                    <span class="text-xs text-slate-500 font-mono">${h.time}</span>
                    <span class="text-xs font-bold text-slate-800 truncate">${h.customer ? h.customer.name : 'Walk-in'}</span>
                </div>
                <div class="text-xs text-slate-600 truncate">
                    ${h.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                </div>
                <div class="font-mono font-black text-sm text-emerald-700">
                    Total: ₹${(h.total || 0).toFixed(2)} (${h.items.length} items)
                </div>
            </div>
            <div class="flex items-center space-x-2 flex-shrink-0">
                <button onclick="recallHeldCart(${index})" class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs transition shadow-sm flex items-center space-x-1">
                    <i data-lucide="folder-check" class="w-3.5 h-3.5"></i>
                    <span>Recall [F6]</span>
                </button>
                <button onclick="discardHeldCart(${index})" class="p-2 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs transition" title="Discard">
                    <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
            </div>
        </div>
    `).join('');
    
    lucide.createIcons();
}

function recallHeldCart(index) {
    if (index < 0 || index >= state.heldCarts.length) return;
    const item = state.heldCarts[index];
    state.cart = [...item.items];
    if (item.customer) {
        selectCustomer(item.customer);
    }
    state.heldCarts.splice(index, 1);
    updatePosHeader();
    closeHeldCartsModal();
    switchScreen('pos');
    renderCart();
    playBeep('success');
    focusBarcodeInput();
}

function discardHeldCart(index) {
    if (index < 0 || index >= state.heldCarts.length) return;
    state.heldCarts.splice(index, 1);
    updatePosHeader();
    renderHeldCartsList();
    playBeep('scan');
}

function focusBarcodeInput() {
    setTimeout(() => {
        const anyModalOpen = document.querySelector('[id^="modal-"]:not(.hidden)');
        const swalOpen = document.querySelector('.swal2-container');
        if (anyModalOpen || (swalOpen && swalOpen.offsetParent !== null)) {
            return;
        }
        const input = document.getElementById('barcode-input');
        if (input) {
            input.focus();
            input.select();
        }
    }, 50);
}

function startNewBill() {
    state.cart = [];
    state.loyaltyDiscountApplied = 0;
    state.couponDiscountApplied = 0;
    state.couponCode = null;
    state.currentCustomer = null;
    clearCurrentCustomer();
    
    switchScreen('pos');
    renderCart();
    focusBarcodeInput();
}

function startNewBillFromSuccess() {
    const succModal = document.getElementById('modal-payment-success');
    if (succModal) succModal.classList.add('hidden');
    startNewBill();
}

function reprintCurrentSuccessBill() {
    if (state.lastCompletedOrder) {
        renderThermalReceipt(state.lastCompletedOrder, true);
        printThermalReceiptDirect(state.lastCompletedOrder, true);
    }
}

function viewFullReceiptModal() {
    const succModal = document.getElementById('modal-payment-success');
    if (succModal) succModal.classList.add('hidden');
    if (state.lastCompletedOrder) {
        renderThermalReceipt(state.lastCompletedOrder, false);
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal) receiptModal.classList.remove('hidden');
    }
}

// reprintLastBill is defined in section 14 (Thermal Printing), below.


// Camera scanner debounce state
let _camLastBarcode = null;
let _camLastScanTs = 0;
const CAMERA_SCAN_DEBOUNCE_MS = 800; // Prevent duplicate frame detections within this window
let _camIsPaused = false;

function updateCameraScannerStatus(status, text) {
    // status: 'ready' | 'scanning' | 'error' | 'off'
    const badge = document.getElementById('cam-status-badge');
    const statusText = document.getElementById('cam-status-text');
    const globalIndicator = document.getElementById('cam-global-indicator');

    const colors = {
        'scanning': 'bg-emerald-100 text-emerald-800 border-emerald-200',
        'ready': 'bg-blue-100 text-blue-800 border-blue-200',
        'error': 'bg-red-100 text-red-800 border-red-200',
        'off': 'bg-slate-100 text-slate-600 border-slate-200'
    };

    const displayText = text || (status === 'scanning' ? 'Scanning' : status === 'ready' ? 'Camera Ready' : status === 'error' ? 'Camera Unavailable' : 'Camera Off');

    if (badge) {
        badge.className = `px-2 py-0.5 rounded-full text-[10px] font-bold border ${colors[status] || colors['off']}`;
        badge.textContent = displayText;
    }
    if (statusText) statusText.textContent = displayText;

    if (globalIndicator) {
        if (status === 'scanning') {
            globalIndicator.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-100 text-emerald-800 border-emerald-300';
            globalIndicator.textContent = '● Scanning';
        } else if (status === 'ready') {
            globalIndicator.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold border bg-blue-100 text-blue-800 border-blue-300';
            globalIndicator.textContent = 'Camera Ready';
        } else if (status === 'error') {
            globalIndicator.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold border bg-red-100 text-red-800 border-red-300';
            globalIndicator.textContent = 'Camera Unavailable';
        } else {
            globalIndicator.className = 'hidden';
            globalIndicator.textContent = 'Camera Off';
        }
    }
}

function pauseCameraScanner() {
    if (state.cameraScanningActive && !state.cameraScannerPaused) {
        state.cameraScannerPaused = true;
        updateCameraScannerStatus('ready', 'Camera Ready (Paused)');
    }
}

function resumeCameraScanner() {
    if (state.cameraScanningActive && state.cameraScannerPaused) {
        state.cameraScannerPaused = false;
        updateCameraScannerStatus('scanning', 'Scanning');
    }
}

function toggleCameraScannerFromButton() {
    const camModal = document.getElementById('modal-camera-scanner');
    if (camModal && !camModal.classList.contains('hidden')) {
        closeCameraScannerModal();
    } else {
        openCameraScannerModal();
    }
}

function openCameraScannerModal() {
    const modal = document.getElementById('modal-camera-scanner');
    if (!modal) return;
    modal.classList.remove('hidden');
    state.cameraScanningActive = true;
    state.cameraScannerPaused = false;
    _camLastBarcode = null;
    _camLastScanTs = 0;

    if (typeof ZXing === 'undefined') {
        updateCameraScannerStatus('error', 'Camera Unavailable');
        const feedbackEl = document.getElementById('camera-scan-last-feedback');
        if (feedbackEl) {
            feedbackEl.classList.remove('hidden');
            feedbackEl.className = feedbackEl.className.replace('bg-emerald-50 border-emerald-300 text-emerald-900', 'bg-red-50 border-red-300 text-red-900');
            const nameEl = document.getElementById('cam-feedback-name');
            if (nameEl) nameEl.textContent = 'Camera scanning library (ZXing) not loaded.';
        }
        return;
    }

    updateCameraScannerStatus('ready', 'Camera Ready');

    try {
        state.codeReader = new ZXing.BrowserMultiFormatReader();
        state.codeReader.decodeFromVideoDevice(null, 'camera-scanner-video', (result, err) => {
            if (state.cameraScannerPaused) return; // Do not process when paused for modal

            if (result && result.text) {
                const barcode = result.text.trim();
                const now = Date.now();
                // Debounce: prevent duplicate detections of the same frame within CAMERA_SCAN_DEBOUNCE_MS
                if (barcode === _camLastBarcode && (now - _camLastScanTs) < CAMERA_SCAN_DEBOUNCE_MS) {
                    return;
                }
                _camLastBarcode = barcode;
                _camLastScanTs = now;

                // Add product to cart (continuous — keep camera scanning ready for next product)
                const item = addProductToCartByBarcode(barcode, true);
                updateCameraScannerStatus('scanning', 'Scanning');

                // Show feedback inside modal
                if (item) {
                    const feedbackEl = document.getElementById('camera-scan-last-feedback');
                    const nameEl = document.getElementById('cam-feedback-name');
                    const qtyEl = document.getElementById('cam-feedback-qty');
                    const priceEl = document.getElementById('cam-feedback-price');
                    if (feedbackEl) {
                        feedbackEl.classList.remove('hidden');
                        feedbackEl.className = 'p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 flex items-center justify-between shadow-sm camera-scan-badge';
                    }
                    if (nameEl) nameEl.textContent = item.name;
                    const cartItem = state.cart.find(c => c.product_id === item.product_id);
                    if (qtyEl) qtyEl.textContent = `(Qty: ${cartItem ? cartItem.quantity : item.quantity})`;
                    if (priceEl) priceEl.textContent = `₹${(item.unit_price || 0).toFixed(2)}`;
                    playBeep('scan');
                } else {
                    // Barcode not found feedback
                    const feedbackEl = document.getElementById('camera-scan-last-feedback');
                    const nameEl = document.getElementById('cam-feedback-name');
                    if (feedbackEl) {
                        feedbackEl.classList.remove('hidden');
                        feedbackEl.className = 'p-2.5 bg-amber-50 border border-amber-300 rounded-xl text-xs text-amber-900 flex items-center justify-between shadow-sm camera-scan-badge';
                    }
                    if (nameEl) nameEl.textContent = `Barcode not found: ${barcode}`;
                    playBeep('error');
                }
                // Reset status back to scanning ready after brief indicator
                setTimeout(() => {
                    if (state.cameraScanningActive && !state.cameraScannerPaused) {
                        updateCameraScannerStatus('scanning', 'Scanning');
                    }
                }, 600);
            }
        }).then(() => {
            // Video stream is open and ready; actual 'scanning' status fires on first decode
            updateCameraScannerStatus('ready', 'Camera Ready – Aim at barcode');
        }).catch(camErr => {
            console.error('Camera error:', camErr);
            state.cameraScanningActive = false;
            if (camErr && camErr.name === 'NotAllowedError') {
                updateCameraScannerStatus('error', 'Camera Unavailable');
                Swal.fire({ title: 'Camera Permission Denied', text: 'Please allow camera access in your browser settings and try again.', icon: 'warning' });
            } else if (camErr && camErr.name === 'NotFoundError') {
                updateCameraScannerStatus('error', 'Camera Unavailable');
                Swal.fire({ title: 'No Camera Detected', text: 'No camera device was found. Focusing physical USB barcode scanner input.', icon: 'info' });
            } else {
                updateCameraScannerStatus('error', 'Camera Unavailable');
            }
            focusBarcodeInput();
        });
    } catch (initErr) {
        console.error('Camera init error:', initErr);
        state.cameraScanningActive = false;
        updateCameraScannerStatus('error', 'Camera Unavailable');
        focusBarcodeInput();
    }
}

function closeCameraScannerModal() {
    state.cameraScanningActive = false;
    state.cameraScannerPaused = false;
    if (state.codeReader) {
        try { state.codeReader.reset(); } catch(e) {}
        state.codeReader = null;
    }
    _camLastBarcode = null;
    _camLastScanTs = 0;
    const modal = document.getElementById('modal-camera-scanner');
    if (modal) modal.classList.add('hidden');
    updateCameraScannerStatus('off', 'Camera Off');
    focusBarcodeInput();
}



function openWeightScaleModal() {
    const select = document.getElementById('scale-product-select');
    const scaleItems = state.catalog.filter(p => p.unit === 'kg' || p.is_loose);
    select.innerHTML = (scaleItems.length ? scaleItems : state.catalog.slice(0, 5)).map(p => `
        <option value="${p.id}" data-rate="${p.selling_price}">${p.name} (₹${p.selling_price}/kg)</option>
    `).join('');
    updateScaleCalculation();
    document.getElementById('modal-weight-scale').classList.remove('hidden');
}

function closeWeightScaleModal() {
    document.getElementById('modal-weight-scale').classList.add('hidden');
    focusBarcodeInput();
}

function updateScaleCalculation() {
    const select = document.getElementById('scale-product-select');
    const rate = parseFloat(select.options[select.selectedIndex]?.dataset.rate) || 0;
    const weight = parseFloat(document.getElementById('scale-weight-input').value) || 0;
    const total = rate * weight;

    document.getElementById('scale-unit-rate').textContent = `₹${rate.toFixed(2)}/kg`;
    document.getElementById('scale-computed-total').textContent = `₹${total.toFixed(2)}`;
}

function addScaleItemToCart() {
    const select = document.getElementById('scale-product-select');
    const prodId = parseInt(select.value);
    const weight = parseFloat(document.getElementById('scale-weight-input').value) || 1.0;
    const product = state.catalog.find(p => p.id === prodId);
    if (product) {
        addProductObjectToCart({ ...product, is_loose: true, unit: 'kg' }, weight);
    }
    closeWeightScaleModal();
}

function openCustomItemModal() {
    Swal.fire({
        title: 'Add Miscellaneous Item / Bag',
        html: `
            <input id="misc-name" class="swal2-input" placeholder="Item Description (e.g. Carry Bag L)">
            <input id="misc-price" type="number" step="1" class="swal2-input" placeholder="Price (₹)">
        `,
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Add to Bill',
        preConfirm: () => {
            return {
                name: document.getElementById('misc-name').value || 'Misc Item / Carry Bag',
                price: parseFloat(document.getElementById('misc-price').value) || 10
            }
        }
    }).then(result => {
        if (result.isConfirmed) {
            state.cart.push({
                product_id: 99999,
                name: result.value.name,
                barcode: 'MISC-01',
                unit: 'pcs',
                unit_price: result.value.price,
                mrp: result.value.price,
                tax_rate: 0,
                quantity: 1,
                is_loose: false
            });
            playBeep('scan');
            renderCart();
            focusBarcodeInput();
        }
    });
}

// ==========================================
// 8. PAYMENT & CHECKOUT SETTLEMENT
// ==========================================

function openPaymentModal() {
    if (state.cart.length === 0) {
        playBeep('error');
        Swal.fire({ title: 'Cart Empty', text: 'Please add items before opening payment.', icon: 'warning', confirmButtonColor: '#2563eb' });
        focusBarcodeInput();
        return;
    }
    pauseCameraScanner();
    const { grandTotal } = calculateCartTotals();
    switchPaymentTab('CASH');
    document.getElementById('modal-payment').classList.remove('hidden');
    
    const cashInput = document.getElementById('cash-tendered-input');
    if (cashInput) {
        cashInput.value = grandTotal;
        setTimeout(() => {
            cashInput.focus();
            cashInput.select();
        }, 100);
    }
    renderQuickCashPresets(grandTotal);
    calculateCashChange();
}

function closePaymentModal() {
    document.getElementById('modal-payment').classList.add('hidden');
    resumeCameraScanner();
    focusBarcodeInput();
}

function quickCashCheckout() {
    if (state.cart.length === 0) return;
    openPaymentModal();
    switchPaymentTab('CASH');
}

function switchPaymentTab(tab) {
    state.activePaymentTab = tab;
    document.querySelectorAll('.pay-tab').forEach(t => {
        t.classList.remove('active', 'border-blue-600', 'text-blue-600');
        t.classList.add('border-transparent', 'text-slate-500');
    });
    const activeBtn = document.getElementById(`pay-tab-${tab.toLowerCase()}`);
    if (activeBtn) {
        activeBtn.classList.add('active', 'border-blue-600', 'text-blue-600');
        activeBtn.classList.remove('border-transparent', 'text-slate-500');
    }

    document.getElementById('pay-content-cash').classList.toggle('hidden', tab !== 'CASH');
    document.getElementById('pay-content-upi').classList.toggle('hidden', tab !== 'UPI');
    document.getElementById('pay-content-card').classList.toggle('hidden', tab !== 'CARD');
    document.getElementById('pay-content-split').classList.toggle('hidden', tab !== 'SPLIT');

    if (tab === 'UPI') {
        generateUpiQrCode();
    } else if (tab === 'CASH') {
        const { grandTotal } = calculateCartTotals();
        renderQuickCashPresets(grandTotal);
        calculateCashChange();
    }
}

function renderQuickCashPresets(grandTotal) {
    const container = document.getElementById('quick-cash-preset-buttons');
    if (!container) return;
    
    grandTotal = Math.round(grandTotal);
    if (grandTotal <= 0) {
        container.innerHTML = '';
        return;
    }

    const presets = [];
    presets.push({ label: `EXACT ₹${grandTotal}`, val: grandTotal, isExact: true });

    if (grandTotal % 50 !== 0) {
        const next50 = Math.ceil(grandTotal / 50) * 50;
        if (!presets.some(p => p.val === next50)) {
            presets.push({ label: `₹${next50}`, val: next50 });
        }
    }

    const next100 = Math.ceil(grandTotal / 100) * 100;
    if (next100 > grandTotal && !presets.some(p => p.val === next100)) {
        presets.push({ label: `₹${next100}`, val: next100 });
    }

    const next500 = Math.ceil(grandTotal / 500) * 500;
    if (next500 > grandTotal && !presets.some(p => p.val === next500)) {
        presets.push({ label: `₹${next500}`, val: next500 });
    }

    const next1000 = Math.ceil(grandTotal / 1000) * 1000;
    if (next1000 > grandTotal && !presets.some(p => p.val === next1000)) {
        presets.push({ label: `₹${next1000}`, val: next1000 });
    }

    if (grandTotal < 2000 && !presets.some(p => p.val === 2000)) {
        presets.push({ label: `₹2000`, val: 2000 });
    }

    container.innerHTML = presets.map(p => `
        <button type="button" onclick="setTenderPreset(${p.val})" class="py-2.5 px-3 ${p.isExact ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-black' : 'bg-white hover:bg-blue-50 text-slate-800 font-bold border-2 border-slate-200 hover:border-blue-400'} rounded-xl text-xs font-mono transition shadow-xs flex items-center justify-center transform active:scale-95">
            ${p.label}
        </button>
    `).join('');
}

function calculateCashChange() {
    const { grandTotal } = calculateCartTotals();
    const tenderInput = document.getElementById('cash-tendered-input');
    const tendered = parseFloat(tenderInput ? tenderInput.value : 0) || 0;
    
    const container = document.getElementById('cash-change-container');
    const title = document.getElementById('cash-change-title');
    const returnEl = document.getElementById('cash-change-return');
    const tag = document.getElementById('cash-change-tag');
    const helper = document.getElementById('cash-change-helper');

    if (tendered >= grandTotal) {
        const change = tendered - grandTotal;
        if (container) {
            container.className = 'p-4 rounded-2xl border-2 space-y-2 transition-all bg-emerald-50 border-emerald-300';
        }
        if (title) {
            title.className = 'block text-xs font-black uppercase tracking-wider text-emerald-800';
            title.textContent = 'CHANGE TO RETURN (₹)';
        }
        if (returnEl) {
            returnEl.className = 'text-emerald-700 font-mono font-black';
            returnEl.textContent = `₹${change.toFixed(2)}`;
        }
        if (tag) {
            tag.className = 'text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
            tag.textContent = change === 0 ? 'Exact Amount' : 'Change Due';
        }
        if (helper) {
            helper.className = 'text-[11px] font-bold text-emerald-700';
            helper.textContent = change === 0 ? 'Exact amount received. No change required.' : `Return ₹${change.toFixed(2)} to customer.`;
        }
    } else {
        const due = grandTotal - tendered;
        if (container) {
            container.className = 'p-4 rounded-2xl border-2 space-y-2 transition-all bg-rose-50 border-rose-300';
        }
        if (title) {
            title.className = 'block text-xs font-black uppercase tracking-wider text-rose-800';
            title.textContent = 'AMOUNT DUE / SHORT (₹)';
        }
        if (returnEl) {
            returnEl.className = 'text-rose-700 font-mono font-black';
            returnEl.textContent = `₹${due.toFixed(2)}`;
        }
        if (tag) {
            tag.className = 'text-xs font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800';
            tag.textContent = `Short ₹${due.toFixed(2)}`;
        }
        if (helper) {
            helper.className = 'text-[11px] font-bold text-rose-700';
            helper.textContent = `Customer still owes ₹${due.toFixed(2)}. Complete cash before checkout.`;
        }
    }
}

function setTenderPreset(val) {
    const { grandTotal } = calculateCartTotals();
    const input = document.getElementById('cash-tendered-input');
    if (!input) return;
    if (val === 'EXACT') {
        input.value = grandTotal;
    } else {
        input.value = val;
    }
    calculateCashChange();
}

function generateUpiQrCode() {
    const { grandTotal } = calculateCartTotals();
    const upiId = state.storeSettings.upi_id || 'metrofresh@icici';
    const storeName = encodeURIComponent(state.storeSettings.store_name || 'Metro Fresh Mart');
    const upiUri = `upi://pay?pa=${upiId}&pn=${storeName}&am=${grandTotal}&cu=INR&tn=POS%20Bill`;

    const container = document.getElementById('upi-qrcode-canvas');
    if (!container) return;
    container.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
        new QRCode(container, {
            text: upiUri,
            width: 180,
            height: 180,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }
}

function calculateSplitTotal() {
    const { grandTotal } = calculateCartTotals();
    const cash = parseFloat(document.getElementById('split-cash-input').value) || 0;
    const card = parseFloat(document.getElementById('split-card-input').value) || 0;
    const upi = parseFloat(document.getElementById('split-upi-input').value) || 0;
    const total = cash + card + upi;
    const rem = Math.max(0, grandTotal - total);
}

async function confirmAndProcessPayment() {
    if (state.cart.length === 0) return;
    const { grandTotal, subtotal, totalTax, promoDiscount, loyaltyDiscount, roundOff } = calculateCartTotals();
    const paymentMethod = state.activePaymentTab;

    let tenderedAmt = grandTotal;
    let changeAmt = 0;
    let transactionRef = '';

    if (paymentMethod === 'CASH') {
        const cashInput = parseFloat(document.getElementById('cash-tendered-input').value) || 0;
        if (cashInput < grandTotal || isNaN(cashInput) || cashInput <= 0) {
            playBeep('error');
            Swal.fire({
                title: 'Insufficient Cash Tendered',
                text: `Tendered amount (₹${cashInput.toFixed(2)}) is less than Grand Total (₹${grandTotal.toFixed(2)}). Please enter sufficient cash.`,
                icon: 'warning',
                confirmButtonColor: '#dc2626'
            });
            return;
        }
        tenderedAmt = cashInput;
        changeAmt = Math.max(0, cashInput - grandTotal);
    } else if (paymentMethod === 'UPI') {
        transactionRef = `UPI-${Date.now().toString().slice(-6)}`;
    } else if (paymentMethod === 'CARD') {
        const last4 = document.getElementById('card-last4-input').value.trim() || '8892';
        transactionRef = `CARD-****${last4}`;
    } else if (paymentMethod === 'SPLIT') {
        const cash = parseFloat(document.getElementById('split-cash-input').value) || 0;
        const card = parseFloat(document.getElementById('split-card-input').value) || 0;
        const upi = parseFloat(document.getElementById('split-upi-input').value) || 0;
        const splitSum = cash + card + upi;
        if (Math.abs(splitSum - grandTotal) > 0.01) {
            playBeep('error');
            Swal.fire({
                title: 'Split Mismatch',
                text: `Split total (₹${splitSum.toFixed(2)}) must equal Grand Total (₹${grandTotal.toFixed(2)}). Current sum: ₹${splitSum.toFixed(2)}`,
                icon: 'warning',
                confirmButtonColor: '#2563eb'
            });
            return;
        }
        tenderedAmt = splitSum;
    }

    const payload = {
        customer_id: state.currentCustomer ? state.currentCustomer.id : null,
        customer_name: state.currentCustomer ? state.currentCustomer.name : 'Walk-in Customer',
        customer_phone: state.currentCustomer ? state.currentCustomer.phone : null,
        employee_id: state.currentUser ? (state.currentUser.employee_id || state.currentUser.username) : 'EMP001',
        cashier_name: state.currentUser ? state.currentUser.name : 'Cashier',
        register_number: 'REG-01',
        counter_id: 'Counter C01',
        items: state.cart.map(i => ({
            product_id: i.product_id,
            name: i.name,
            barcode: i.barcode,
            unit: i.unit,
            unit_price: i.unit_price,
            mrp: i.mrp,
            tax_rate: i.tax_rate,
            quantity: i.quantity,
            total_price: i.unit_price * i.quantity
        })),
        subtotal,
        tax_total: totalTax,
        discount_total: promoDiscount,
        points_discount: loyaltyDiscount,
        coupon_code: state.couponCode,
        round_off: roundOff,
        grand_total: grandTotal,
        payment_method: paymentMethod,
        tendered_amount: tenderedAmt,
        change_amount: changeAmt,
        transaction_ref: transactionRef
    };

    try {
        const res = await apiFetch('/api/pos/checkout', {
            method: 'POST',
            body: payload
        });

        if (!res.ok) {
            const err = await res.json();
            Swal.fire({ title: 'Transaction Failed', text: err.detail || 'Could not complete order checkout.', icon: 'error' });
            return;
        }

        const order = await res.json();
        state.lastCompletedOrder = order;

        closePaymentModal();
        playBeep('success');
        if (typeof confetti === 'function') confetti({ particleCount: 60, spread: 60, origin: { y: 0.8 } });

        // Auto Thermal Print if configured (safe fallback if printer is offline)
        let printStatusText = 'PRINTED ✓';
        if (state.printerSettings && state.printerSettings.enabled && state.printerSettings.autoPrint) {
            try {
                printThermalReceiptDirect(order, false);
                printStatusText = 'AUTO-PRINTED ✓';
            } catch (e) {
                console.warn('Auto print error:', e);
                printStatusText = 'PRINTER OFFLINE';
            }
        }

        // Populate Fast Payment Success Modal
        const succInvoice = document.getElementById('succ-invoice-no');
        if (succInvoice) succInvoice.textContent = `Bill No: ${order.invoice_number}`;
        const succTotal = document.getElementById('succ-total');
        if (succTotal) succTotal.textContent = `₹${order.grand_total.toFixed(2)}`;
        const succPaid = document.getElementById('succ-paid');
        if (succPaid) succPaid.textContent = `₹${(order.tendered_amount || order.grand_total).toFixed(2)}`;
        const succChange = document.getElementById('succ-change');
        if (succChange) succChange.textContent = `₹${(order.change_amount || 0).toFixed(2)}`;
        const succMethod = document.getElementById('succ-method');
        if (succMethod) succMethod.textContent = order.payment_method;
        const succPrint = document.getElementById('succ-print-status');
        if (succPrint) {
            succPrint.innerHTML = `<i data-lucide="printer" class="w-3.5 h-3.5"></i> ${printStatusText}`;
        }

        const succModal = document.getElementById('modal-payment-success');
        if (succModal) succModal.classList.remove('hidden');

        // Clear Cart for next customer
        state.cart = [];
        state.loyaltyDiscountApplied = 0;
        state.couponDiscountApplied = 0;
        state.couponCode = null;
        state.currentCustomer = null;
        clearCurrentCustomer();
        renderCart();

        // Refresh inventory in background
        loadCatalog();
        lucide.createIcons();

    } catch (err) {
        console.error('Checkout error:', err);
    }
}

function renderThermalReceipt(order, isReprint = false) {
    const paper = document.getElementById('thermal-receipt-paper');
    if (!paper) return;

    const set = state.storeSettings || {};
    const is58 = state.printerSettings.paperWidth === '58mm';
    paper.className = `w-full ${is58 ? 'paper-58mm max-w-[260px]' : 'paper-80mm max-w-[340px]'} bg-white text-slate-900 font-mono p-4 shadow-md border border-slate-300 rounded-sm`;

    const items = order.items || [];
    const itemsHtml = items.map(item => `
        <div class="flex justify-between text-[10px] py-0.5">
            <span class="truncate flex-1">${item.product_name || item.name}</span>
            <span class="w-12 text-center">${item.quantity || item.qty}x</span>
            <span class="w-16 text-right">₹${(item.total_price || item.total || 0).toFixed(2)}</span>
        </div>
    `).join('');

    const isDuplicate = isReprint || order.is_reprinted;
    const reprintBannerHtml = isDuplicate ? `
        <div class="reprint-banner bg-black text-white text-center font-bold py-0.5 px-2 mb-2 text-[10px] tracking-widest uppercase">
            *** DUPLICATE / REPRINT ***
        </div>
    ` : '';

    const grandTotal = order.grand_total || 0;
    const tendered = order.tendered_amount !== undefined ? order.tendered_amount : grandTotal;
    const change = order.change_amount !== undefined ? order.change_amount : (order.payment_method === 'CASH' ? Math.max(0, tendered - grandTotal) : 0);

    paper.innerHTML = `
        ${reprintBannerHtml}
        <div class="text-center pb-2 border-b border-dashed border-slate-400 space-y-0.5">
            <div class="font-extrabold text-sm uppercase">${set.store_name || 'METRO FRESH SMART MART'}</div>
            <div class="text-[9px] text-slate-600">${set.store_tagline || 'Supermarket & Fresh Groceries'}</div>
            <div class="text-[9px] text-slate-600">${set.address || 'Chennai, India'}</div>
            <div class="text-[9px] font-mono">GSTIN: ${set.gstin || '33AAAAA0000A1Z5'} | FSSAI: ${set.fssai || '10018042000'}</div>
        </div>

        <div class="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-0.5">
            <div class="flex justify-between"><span>Bill: <strong>${order.invoice_number}</strong></span><span>Date: ${order.created_at ? order.created_at.substring(0, 10) : new Date().toLocaleDateString()}</span></div>
            <div class="flex justify-between"><span>Cashier: <strong>${order.cashier_name || 'Ravi Kumar'}</strong></span><span>Counter: <strong>${order.counter_id || 'Counter 1'}</strong></span></div>
            <div class="flex justify-between"><span>Customer: ${order.customer_name || 'Walk-in'}</span><span>Pay: <strong>${order.payment_method}</strong></span></div>
        </div>

        <div class="py-2 border-b border-dashed border-slate-400 space-y-1">
            <div class="flex justify-between font-bold text-[10px] text-slate-700 pb-1 border-b border-dashed border-slate-300">
                <span>ITEM</span><span class="w-12 text-center">QTY</span><span class="w-16 text-right">AMT</span>
            </div>
            ${itemsHtml}
        </div>

        <div class="py-2 border-b border-dashed border-slate-400 space-y-1 text-[10px]">
            <div class="flex justify-between"><span>Subtotal:</span><span>₹${(order.subtotal || 0).toFixed(2)}</span></div>
            <div class="flex justify-between"><span>Est. GST Tax:</span><span>₹${(order.tax_amount || order.tax_total || 0).toFixed(2)}</span></div>
            ${(order.discount_amount || order.discount_total || 0) > 0 ? `<div class="flex justify-between font-bold text-emerald-700"><span>Total Savings:</span><span>- ₹${(order.discount_amount || order.discount_total).toFixed(2)}</span></div>` : ''}
            ${(order.points_discount || 0) > 0 ? `<div class="flex justify-between font-bold text-purple-700"><span>Loyalty Discount:</span><span>- ₹${order.points_discount.toFixed(2)}</span></div>` : ''}
            <div class="flex justify-between"><span>Round Off:</span><span>${(order.round_off || 0) >= 0 ? '+' : ''}₹${(order.round_off || 0).toFixed(2)}</span></div>
            <div class="pt-1.5 border-t border-slate-400 flex justify-between font-black text-sm">
                <span>NET TOTAL:</span>
                <span>₹${grandTotal.toFixed(2)}</span>
            </div>
            <div class="pt-1 border-t border-dashed border-slate-300 text-[9px] text-slate-600 flex justify-between">
                <span>Paid via ${order.payment_method}: ₹${tendered.toFixed(2)}</span>
                ${change > 0 ? `<span>Change: ₹${change.toFixed(2)}</span>` : ''}
            </div>
        </div>

        <div class="pt-3 text-center space-y-2">
            <svg id="receipt-barcode" class="mx-auto"></svg>
            <div class="text-[9px] text-slate-600">${set.receipt_footer || 'Thank you for shopping with us! Please visit again.'}</div>
        </div>
    `;

    if (typeof JsBarcode !== 'undefined') {
        try {
            JsBarcode("#receipt-barcode", order.invoice_number, {
                format: "CODE128",
                width: is58 ? 1.0 : 1.2,
                height: 28,
                displayValue: true,
                fontSize: 9,
                margin: 0
            });
        } catch (e) {}
    }
}

function printThermalReceiptDirect(orderData = null, isReprint = false) {
    const order = orderData || state.lastCompletedOrder;
    if (!order) return;

    renderThermalReceipt(order, isReprint);

    const mode = state.printerSettings.type;
    const paperWidth = state.printerSettings.paperWidth || '80mm';

    if (mode === 'QZ_TRAY' && typeof window.qz !== 'undefined') {
        try {
            const config = qz.configs.create(state.printerSettings.printerName !== 'Default' ? state.printerSettings.printerName : null);
            const receiptHtml = document.getElementById('thermal-receipt-paper').outerHTML;
            const data = [{
                type: 'html',
                format: 'plain',
                data: `<html><head><style>body { font-family: monospace; font-size: ${paperWidth === '58mm' ? '10px' : '12px'}; margin: 0; padding: 2mm; }</style></head><body>${receiptHtml}</body></html>`
            }];
            qz.print(config, data).catch(err => {
                console.warn('QZ Tray print failed, using iframe print fallback:', err);
                fallbackIframePrint();
            });
            return;
        } catch (e) {
            fallbackIframePrint();
            return;
        }
    }

    fallbackIframePrint();
}

function fallbackIframePrint() {
    const paper = document.getElementById('thermal-receipt-paper');
    if (!paper) return;

    let printFrame = document.getElementById('silent-print-iframe');
    if (!printFrame) {
        printFrame = document.createElement('iframe');
        printFrame.id = 'silent-print-iframe';
        printFrame.style.position = 'fixed';
        printFrame.style.right = '0';
        printFrame.style.bottom = '0';
        printFrame.style.width = '0';
        printFrame.style.height = '0';
        printFrame.style.border = '0';
        document.body.appendChild(printFrame);
    }

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Thermal Receipt</title>
            <style>
                @page { margin: 0; }
                body {
                    margin: 0;
                    padding: 2mm;
                    font-family: 'JetBrains Mono', 'Courier New', Courier, monospace;
                    font-size: ${state.printerSettings.paperWidth === '58mm' ? '10px' : '11px'};
                    color: #000;
                    background: #fff;
                    width: ${state.printerSettings.paperWidth === '58mm' ? '54mm' : '76mm'};
                }
                .reprint-banner {
                    background: #000;
                    color: #fff;
                    font-weight: bold;
                    text-align: center;
                    padding: 2px 0;
                    margin-bottom: 4px;
                    font-size: 10px;
                }
                .flex { display: flex; }
                .justify-between { justify-content: space-between; }
                .text-center { text-align: center; }
                .text-right { text-align: right; }
                .font-bold { font-weight: bold; }
                .font-black { font-weight: 900; }
                .border-b { border-bottom: 1px dashed #444; }
                .border-t { border-top: 1px dashed #444; }
                .py-1 { padding-top: 2px; padding-bottom: 2px; }
                .py-2 { padding-top: 4px; padding-bottom: 4px; }
                .pb-2 { padding-bottom: 4px; }
                .pt-1 { padding-top: 2px; }
                .pt-1\\.5 { padding-top: 3px; }
                .pt-2 { padding-top: 4px; }
                .pt-3 { padding-top: 6px; }
                .uppercase { text-transform: uppercase; }
                .truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .w-12 { width: 32px; }
                .w-16 { width: 50px; }
                .flex-1 { flex: 1; }
            </style>
        </head>
        <body>
            ${paper.innerHTML}
        </body>
        </html>
    `);
    doc.close();

    setTimeout(() => {
        try {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
        } catch (e) {
            document.body.classList.add('print-receipt-active');
            window.print();
            document.body.classList.remove('print-receipt-active');
        }
    }, 250);
}

function closeReceiptModal() {
    document.getElementById('modal-receipt').classList.add('hidden');
}

function startNewBillAfterReceipt() {
    closeReceiptModal();
    startNewBill();
}

// ==========================================
// 9. SALES ORDERS HISTORY (OWNER)
// ==========================================

async function loadOrdersHistory() {
    try {
        const res = await apiFetch('/api/orders');
        if (!res.ok) return;
        const orders = await res.json();

        const tbody = document.getElementById('orders-table-body');
        if (!tbody) return;

        if (orders.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">No sales orders found in database.</td></tr>`;
            return;
        }

        tbody.innerHTML = orders.map(ord => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-blue-600">${ord.invoice_number}</td>
                <td class="p-3 text-slate-500 text-[11px]">${ord.created_at ? ord.created_at.substring(0, 19).replace('T', ' ') : '-'}</td>
                <td class="p-3">
                    <div class="font-semibold text-slate-900">${ord.cashier_name || 'Cashier'}</div>
                    <div class="text-[10px] text-blue-600 font-mono">${ord.employee_id || 'EMP001'}</div>
                </td>
                <td class="p-3 text-slate-700">${ord.customer_name || 'Walk-in'}</td>
                <td class="p-3 text-center font-mono">${ord.items_count || 0}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${(ord.grand_total || 0).toFixed(2)}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${ord.payment_method}</span>
                </td>
                <td class="p-3 text-center">
                    <button onclick="reprintOrderReceipt('${ord.invoice_number}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-xs font-semibold">Print</button>
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (err) {}
}

async function reprintOrderReceipt(invoiceNum) {
    try {
        const res = await apiFetch(`/api/orders`);
        if (res.ok) {
            const orders = await res.json();
            const order = orders.find(o => o.invoice_number === invoiceNum);
            if (order) {
                renderThermalReceipt(order);
            }
        }
    } catch (e) {}
}

// ==========================================
// 10. EMPLOYEE CRUD & ATTENDANCE & SALARY
// ==========================================

let cachedEmployees = [];

async function loadOwnerEmployees() {
    try {
        const res = await apiFetch('/api/owner/employees');
        if (!res.ok) return;
        cachedEmployees = await res.json();

        const tbody = document.getElementById('owner-employees-table-body');
        if (!tbody) return;

        if (cachedEmployees.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">No employees found.</td></tr>`;
            return;
        }

        tbody.innerHTML = cachedEmployees.map(emp => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-blue-600">${emp.employee_id}</td>
                <td class="p-3">
                    <div class="font-bold text-slate-900">${emp.name}</div>
                    <div class="text-[10px] text-slate-400">@${emp.username} • ${emp.role}</div>
                </td>
                <td class="p-3">
                    <div class="text-slate-700">${emp.phone || '-'}</div>
                    <div class="text-[10px] text-slate-400">${emp.email || '-'}</div>
                </td>
                <td class="p-3">
                    <span class="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        ${emp.assigned_shift?.name || emp.assigned_shift_name || 'Unassigned'}
                    </span>
                </td>
                <td class="p-3">
                    <div class="font-mono font-bold text-emerald-700">₹${(emp.salary_rate || 0).toLocaleString('en-IN')}</div>
                    <div class="text-[10px] text-slate-400">${emp.salary_type}</div>
                </td>
                <td class="p-3 text-slate-500">${emp.joining_date || '-'}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${emp.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}">
                        ${emp.status}
                    </span>
                </td>
                <td class="p-3 text-center space-x-1">
                    <button onclick="editEmployee('${emp.employee_id}')" class="p-1.5 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 text-xs"><i data-lucide="edit-3" class="w-4 h-4"></i></button>
                    <button onclick="toggleEmployeeStatus('${emp.employee_id}', '${emp.status}')" class="p-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg ${emp.status === 'ACTIVE' ? 'text-red-600' : 'text-emerald-700'} text-xs"><i data-lucide="${emp.status === 'ACTIVE' ? 'user-x' : 'user-check'}" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (err) {}
}

async function populateShiftSelectOptions(selectId, selectedShiftId = null) {
    const select = document.getElementById(selectId);
    if (!select) return;
    try {
        const res = await apiFetch('/api/owner/shifts');
        if (!res.ok) return;
        const shifts = await res.json();
        select.innerHTML = '<option value="">-- Select Shift --</option>' + shifts.map(s => `
            <option value="${s.id}" ${selectedShiftId == s.id ? 'selected' : ''}>${s.name} (${formatTime12H(s.start_time)} - ${formatTime12H(s.end_time)})</option>
        `).join('');
    } catch (e) {}
}

async function openAddEmployeeModal() {
    document.getElementById('modal-employee-title').textContent = 'Create Employee Account';
    document.getElementById('emp-form-id').value = '';
    document.getElementById('emp-form-code').value = '';
    document.getElementById('emp-form-code').disabled = false;
    document.getElementById('emp-form-username').value = '';
    document.getElementById('emp-form-name').value = '';
    document.getElementById('emp-form-phone').value = '';
    document.getElementById('emp-form-password').value = '';
    document.getElementById('emp-form-salary-rate').value = '18000';
    document.getElementById('emp-form-salary-type').value = 'MONTHLY';

    await populateShiftSelectOptions('emp-form-shift');
    document.getElementById('modal-employee').classList.remove('hidden');
}

function closeEmployeeModal() {
    document.getElementById('modal-employee').classList.add('hidden');
}

async function editEmployee(empId) {
    const emp = cachedEmployees.find(e => e.employee_id === empId);
    if (!emp) return;

    document.getElementById('modal-employee-title').textContent = `Edit Employee (${emp.employee_id})`;
    document.getElementById('emp-form-id').value = emp.id;
    document.getElementById('emp-form-code').value = emp.employee_id;
    document.getElementById('emp-form-code').disabled = true;
    document.getElementById('emp-form-username').value = emp.username;
    document.getElementById('emp-form-name').value = emp.name;
    document.getElementById('emp-form-phone').value = emp.phone || '';
    document.getElementById('emp-form-password').value = '';
    document.getElementById('emp-form-salary-rate').value = emp.salary_rate || 0;
    document.getElementById('emp-form-salary-type').value = emp.salary_type || 'MONTHLY';

    await populateShiftSelectOptions('emp-form-shift', emp.assigned_shift_id);
    document.getElementById('modal-employee').classList.remove('hidden');
}

async function saveEmployeeForm() {
    const id = document.getElementById('emp-form-id').value;
    const employee_id = document.getElementById('emp-form-code').value.trim();
    const username = document.getElementById('emp-form-username').value.trim() || employee_id;
    const name = document.getElementById('emp-form-name').value.trim();
    const phone = document.getElementById('emp-form-phone').value.trim();
    const password = document.getElementById('emp-form-password').value;
    const shift_id = document.getElementById('emp-form-shift').value || null;
    const salary_type = document.getElementById('emp-form-salary-type').value;
    const salary_rate = parseFloat(document.getElementById('emp-form-salary-rate').value) || 0;

    if (!employee_id || !name) {
        Swal.fire({ title: 'Required', text: 'Employee ID and Name are mandatory.', icon: 'warning' });
        return;
    }

    const payload = {
        employee_id, username, name, phone, role: 'EMPLOYEE', salary_type, salary_rate, assigned_shift_id: shift_id ? parseInt(shift_id) : null
    };
    if (password) payload.password = password;

    try {
        let res;
        if (id) {
            res = await apiFetch(`/api/owner/employees/${id}`, { method: 'PUT', body: payload });
        } else {
            res = await apiFetch('/api/owner/employees', { method: 'POST', body: payload });
        }

        if (res.ok) {
            closeEmployeeModal();
            playBeep('success');
            await loadOwnerEmployees();
        }
    } catch (e) {}
}

async function toggleEmployeeStatus(empId, currentStatus) {
    const emp = cachedEmployees.find(e => e.employee_id === empId);
    if (!emp) return;
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
        const res = await apiFetch(`/api/owner/employees/${emp.id}`, { method: 'PUT', body: { status: newStatus } });
        if (res.ok) await loadOwnerEmployees();
    } catch (e) {}
}

async function loadOwnerShifts() {
    try {
        const res = await apiFetch('/api/owner/shifts');
        if (!res.ok) return;
        const shifts = await res.json();
        const container = document.getElementById('owner-shifts-cards-container');
        if (!container) return;

        container.innerHTML = shifts.map(s => `
            <div class="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-sm">
                <div class="flex justify-between items-start">
                    <div>
                        <h3 class="font-bold text-base text-slate-900">${s.name}</h3>
                        <p class="text-xs text-slate-500">${s.description || 'Supermarket Shift'}</p>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold font-mono bg-blue-50 text-blue-700 border border-blue-200">
                        ${formatTime12H(s.start_time)} - ${formatTime12H(s.end_time)}
                    </span>
                </div>
            </div>
        `).join('');

        lucide.createIcons();
    } catch (e) {}
}

function openAddShiftModal() {
    document.getElementById('new-shift-name').value = '';
    document.getElementById('modal-add-shift').classList.remove('hidden');
}
function closeAddShiftModal() {
    document.getElementById('modal-add-shift').classList.add('hidden');
}
async function saveNewWorkShift() {
    const name = document.getElementById('new-shift-name').value.trim();
    const start_time = document.getElementById('new-shift-start').value.trim();
    const end_time = document.getElementById('new-shift-end').value.trim();
    try {
        const res = await apiFetch('/api/owner/shifts', { method: 'POST', body: { name, start_time, end_time } });
        if (res.ok) {
            closeAddShiftModal();
            await loadOwnerShifts();
        }
    } catch (e) {}
}

async function loadOwnerAttendance() {
    const filter = document.getElementById('owner-att-filter')?.value || 'today';
    try {
        const res = await apiFetch(`/api/owner/attendance?filter=${filter}`);
        if (!res.ok) return;
        const records = await res.json();
        const tbody = document.getElementById('owner-attendance-table-body');
        if (!tbody) return;

        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">No attendance entries for selected period.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(att => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-blue-600">${att.employee_id}</td>
                <td class="p-3 font-semibold text-slate-900">${att.employee_name}</td>
                <td class="p-3 text-slate-600">${att.shift_name}</td>
                <td class="p-3 text-slate-500 font-mono text-[11px]">${att.date}</td>
                <td class="p-3 font-mono text-emerald-700">${att.check_in_time || '-'}</td>
                <td class="p-3 font-mono text-amber-600">${att.check_out_time || '-'}</td>
                <td class="p-3 font-mono font-bold text-slate-800">${att.working_duration || '-'}</td>
                <td class="p-3">
                    ${att.is_late 
                        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Late (${att.late_minutes}m)</span>` 
                        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">On Time</span>`}
                </td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${(att.shift_sales || 0).toFixed(2)}</td>
                <td class="p-3 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${att.status === 'WORKING' ? 'bg-emerald-100 text-emerald-800 animate-pulse' : 'bg-slate-100 text-slate-600'}">
                        ${att.status}
                    </span>
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {}
}

let cachedSalaryRecords = [];

async function loadOwnerSalaryManagement() {
    const month = document.getElementById('salary-month-select')?.value || '2026-10';
    try {
        const res = await apiFetch(`/api/owner/salary-records?month=${month}`);
        if (!res.ok) return;
        cachedSalaryRecords = await res.json();
        const tbody = document.getElementById('owner-salary-table-body');
        if (!tbody) return;

        tbody.innerHTML = cachedSalaryRecords.map(rec => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3">
                    <div class="font-bold text-slate-900">${rec.employee_name}</div>
                    <div class="text-[10px] text-blue-600 font-mono">${rec.employee_id}</div>
                </td>
                <td class="p-3 text-slate-600">${rec.salary_type}</td>
                <td class="p-3 text-right font-mono text-slate-700">₹${(rec.base_salary_rate || 0).toLocaleString('en-IN')}</td>
                <td class="p-3 text-center font-mono font-bold text-emerald-700">${rec.present_days}</td>
                <td class="p-3 text-center font-mono text-amber-600">${rec.late_days}</td>
                <td class="p-3 text-center font-mono text-slate-800">${rec.total_hours_worked.toFixed(1)}h</td>
                <td class="p-3 text-right font-mono font-black text-emerald-700 text-sm">₹${(rec.calculated_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td class="p-3 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${rec.payment_status === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                        ${rec.payment_status}
                    </span>
                </td>
                <td class="p-3 text-center">
                    ${rec.payment_status === 'PAID'
                        ? `<button onclick="printSalaryReceipt('${rec.id}')" class="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">Receipt</button>`
                        : `<button onclick="openPaySalaryModal('${rec.id}', '${rec.employee_name} (${rec.employee_id})', ${rec.calculated_salary})" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs shadow-sm">Pay Salary</button>`}
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {}
}

function openPaySalaryModal(recordId, empName, amount) {
    document.getElementById('pay-sal-record-id').value = recordId;
    document.getElementById('pay-sal-emp-name').textContent = empName;
    document.getElementById('pay-sal-amount').textContent = `₹${(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    document.getElementById('pay-sal-ref').value = `NEFT-${Math.floor(100000 + Math.random() * 900000)}`;
    document.getElementById('modal-pay-salary').classList.remove('hidden');
}
function closePaySalaryModal() {
    document.getElementById('modal-pay-salary').classList.add('hidden');
}
async function confirmSalaryPaymentSubmit() {
    const recordId = document.getElementById('pay-sal-record-id').value;
    const payment_method = document.getElementById('pay-sal-method').value;
    const transaction_ref = document.getElementById('pay-sal-ref').value.trim();

    try {
        const res = await apiFetch(`/api/owner/salary-records/${recordId}/pay`, {
            method: 'POST',
            body: { payment_method, transaction_ref }
        });
        if (res.ok) {
            closePaySalaryModal();
            playBeep('success');
            await loadOwnerSalaryManagement();
            printSalaryReceipt(recordId);
        }
    } catch (e) {}
}

function printSalaryReceipt(recordId) {
    const rec = cachedSalaryRecords.find(r => r.id === recordId);
    if (!rec) return;

    const paper = document.getElementById('salary-receipt-paper');
    if (!paper) return;

    paper.innerHTML = `
        <div class="text-center pb-2 border-b border-dashed border-slate-400 space-y-1">
            <div class="font-extrabold text-sm uppercase">${state.storeSettings.store_name || 'METRO FRESH SMART MART'}</div>
            <div class="text-[10px] text-slate-600">STAFF SALARY DISBURSEMENT VOUCHER</div>
            <div class="text-[10px]">Date: ${rec.paid_at || new Date().toLocaleString()}</div>
        </div>
        <div class="py-2 space-y-1 border-b border-dashed border-slate-400 text-[11px]">
            <div><strong>Employee:</strong> ${rec.employee_name} (${rec.employee_id})</div>
            <div><strong>Month:</strong> ${rec.month}</div>
            <div><strong>Present Days:</strong> ${rec.present_days} (Late: ${rec.late_days})</div>
            <div><strong>Total Hours:</strong> ${rec.total_hours_worked.toFixed(1)} hrs</div>
            <div><strong>Mode:</strong> ${rec.payment_method || 'BANK'} | Ref: ${rec.transaction_ref || '-'}</div>
        </div>
        <div class="py-2 flex justify-between font-bold text-xs border-b border-dashed border-slate-400">
            <span>NET AMOUNT PAID:</span>
            <span>₹${(rec.calculated_salary || 0).toFixed(2)}</span>
        </div>
    `;

    document.getElementById('modal-salary-receipt').classList.remove('hidden');
}
function closeSalaryReceiptModal() {
    document.getElementById('modal-salary-receipt').classList.add('hidden');
}

// ==========================================
// 11. EMPLOYEE DASHBOARD & SHIFT LIFECYCLE
// ==========================================

async function loadEmployeeDashboard() {
    try {
        const res = await apiFetch('/api/employee/dashboard');
        if (!res.ok) return;
        const data = await res.json();

        const hour = new Date().getHours();
        const timeGreeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
        const empGreeting = document.getElementById('emp-greeting');
        if (empGreeting) empGreeting.textContent = `${timeGreeting}, ${data.name || 'Cashier'} 👋`;

        const cardId = document.getElementById('emp-card-id');
        if (cardId) cardId.textContent = data.employee_id || 'EMP001';

        const cardShift = document.getElementById('emp-card-shift');
        if (cardShift) {
            cardShift.textContent = data.assigned_shift 
                ? `${data.assigned_shift.name} (${formatTime12H(data.assigned_shift.start_time)} - ${formatTime12H(data.assigned_shift.end_time)})`
                : 'General Shift (OPEN)';
        }

        const billsCount = document.getElementById('emp-my-bills-today');
        if (billsCount) billsCount.textContent = data.today_bills || 0;

        const salesTotal = document.getElementById('emp-my-sales-today');
        if (salesTotal) salesTotal.textContent = `₹${(data.today_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        // Render Recent Bills table on Employee Dashboard
        const recentTbody = document.getElementById('emp-recent-bills-body');
        if (recentTbody) {
            const bills = data.recent_bills || [];
            if (bills.length === 0) {
                recentTbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-slate-400 font-medium">No sales bills created yet today. Click "OPEN NEW BILL" to start!</td></tr>`;
            } else {
                recentTbody.innerHTML = bills.map(bill => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
                        <td class="p-3 font-mono font-bold text-blue-600">${bill.invoice_number}</td>
                        <td class="p-3 font-medium text-slate-800">${bill.customer_name || 'Walk-in Customer'}</td>
                        <td class="p-3 text-center font-mono font-bold">${bill.items_count || 0}</td>
                        <td class="p-3 text-right font-mono font-black text-emerald-700">₹${(bill.grand_total || 0).toFixed(2)}</td>
                        <td class="p-3 text-center">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${bill.payment_method === 'CASH' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}">
                                ${bill.payment_method || 'CASH'}
                            </span>
                        </td>
                        <td class="p-3 text-center text-slate-500 font-mono">${formatTime12H(bill.created_at)}</td>
                        <td class="p-3 text-center">
                            <button onclick="reprintOrderReceipt('${bill.invoice_number}')" class="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 font-bold rounded-lg text-xs transition flex items-center justify-center space-x-1 mx-auto">
                                <i data-lucide="printer" class="w-3 h-3"></i>
                                <span>Reprint</span>
                            </button>
                        </td>
                    </tr>
                `).join('');
            }
        }

        const container = document.getElementById('emp-shift-status-container');
        if (container) {
            const shiftStatus = data.status || data.shift_status;

            if (shiftStatus === 'NOT_CHECKED_IN') {
                container.className = 'bg-white border-2 border-red-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4';
                container.innerHTML = `
                    <div class="space-y-1">
                        <div class="flex items-center space-x-2">
                            <span class="w-3 h-3 rounded-full bg-red-500"></span>
                            <span class="font-extrabold text-lg text-red-600">🔴 Shift Not Started</span>
                        </div>
                        <p class="text-xs text-slate-500">Please check in to start your counter session and track shift billing accurately.</p>
                    </div>
                    <button onclick="handleEmployeeCheckIn()" class="px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl text-base shadow-lg shadow-emerald-600/25 transition transform active:scale-95 flex items-center justify-center space-x-2">
                        <i data-lucide="log-in" class="w-5 h-5"></i>
                        <span>START SHIFT (CHECK IN)</span>
                    </button>
                `;
            } else if (shiftStatus === 'WORKING') {
                container.className = 'bg-white border-2 border-emerald-300 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4';
                container.innerHTML = `
                    <div class="space-y-1">
                        <div class="flex items-center space-x-2">
                            <span class="w-3 h-3 rounded-full bg-emerald-500 animate-ping"></span>
                            <span class="font-extrabold text-lg text-emerald-700">🟢 SHIFT ACTIVE & READY FOR BILLING</span>
                        </div>
                        <div class="text-xs text-slate-600">
                            Counter: <strong class="font-mono text-slate-800">C01</strong> • Checked in at: <strong class="font-mono text-emerald-800">${data.checked_in_time || '08:00 AM'}</strong>
                        </div>
                    </div>
                    <div class="flex items-center space-x-3">
                        <button onclick="startNewBill()" class="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-2xl text-sm transition shadow-md shadow-blue-600/25 flex items-center space-x-2">
                            <i data-lucide="shopping-cart" class="w-4 h-4"></i>
                            <span>OPEN POS BILLING [F1]</span>
                        </button>
                        <button onclick="handleEmployeeCheckOut()" class="px-6 py-3.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl text-sm shadow-md shadow-red-600/25 transition transform active:scale-95 flex items-center space-x-2">
                            <i data-lucide="log-out" class="w-4 h-4"></i>
                            <span>END SHIFT</span>
                        </button>
                    </div>
                `;
            } else if (shiftStatus === 'COMPLETED') {
                container.className = 'bg-white border-2 border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4';
                container.innerHTML = `
                    <div class="space-y-1">
                        <div class="flex items-center space-x-2">
                            <span class="w-3 h-3 rounded-full bg-slate-400"></span>
                            <span class="font-extrabold text-lg text-slate-700">🏁 Shift Completed</span>
                        </div>
                        <p class="text-xs text-slate-500">Your scheduled work shift is concluded and logged. Thank you!</p>
                    </div>
                `;
            }
        }

        updatePosHeader();
        lucide.createIcons();
    } catch (e) {
        console.error('Error loading employee dashboard:', e);
    }
}

async function handleEmployeeCheckIn() {
    try {
        const res = await apiFetch('/api/employee/check-in', { method: 'POST' });
        if (res.ok) {
            playBeep('success');
            await loadEmployeeDashboard();
        }
    } catch (e) {}
}

async function handleEmployeeCheckOut() {
    const confirm = await Swal.fire({
        title: 'Confirm Shift Checkout?',
        text: 'Are you ready to end your working shift and generate handover totals?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: 'Yes, Check Out',
        cancelButtonText: 'Continue Shift',
        confirmButtonColor: '#dc2626'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await apiFetch('/api/employee/check-out', { method: 'POST' });
        if (res.ok) {
            const summary = await res.json();
            playBeep('success');
            renderCheckoutSummaryModal(summary);
            await loadEmployeeDashboard();
        }
    } catch (e) {}
}

function renderCheckoutSummaryModal(sum) {
    document.getElementById('summary-emp-shift-name').textContent = `${sum.employee_name} • ${sum.shift_name} (${sum.date})`;
    document.getElementById('sum-checkin').textContent = sum.check_in_time || '-';
    document.getElementById('sum-checkout').textContent = sum.check_out_time || '-';
    document.getElementById('sum-duration').textContent = sum.working_duration || '-';
    document.getElementById('sum-bills').textContent = sum.shift_bills || 0;
    document.getElementById('sum-items').textContent = `${sum.shift_items_sold || 0} items`;
    document.getElementById('sum-cash').textContent = `₹${(sum.cash_sales || 0).toFixed(2)}`;
    document.getElementById('sum-upi').textContent = `₹${(sum.upi_sales || 0).toFixed(2)}`;
    document.getElementById('sum-card').textContent = `₹${(sum.card_sales || 0).toFixed(2)}`;
    document.getElementById('sum-total-sales').textContent = `₹${(sum.shift_sales || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    document.getElementById('modal-checkout-summary').classList.remove('hidden');
    lucide.createIcons();
}

function closeCheckoutSummaryModal() {
    document.getElementById('modal-checkout-summary').classList.add('hidden');
}

async function loadEmployeeAttendance() {
    try {
        const res = await apiFetch('/api/employee/my-attendance');
        if (!res.ok) return;
        const records = await res.json();
        const tbody = document.getElementById('emp-attendance-history-body');
        if (!tbody) return;

        tbody.innerHTML = records.map(att => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono text-[11px] text-slate-700">${att.date}</td>
                <td class="p-3 text-slate-600">${att.shift_name}</td>
                <td class="p-3 font-mono text-emerald-700">${att.check_in_time || '-'}</td>
                <td class="p-3 font-mono text-amber-600">${att.check_out_time || '-'}</td>
                <td class="p-3 font-mono font-bold text-slate-800">${att.working_duration || '-'}</td>
                <td class="p-3">
                    ${att.is_late 
                        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">Late (${att.late_minutes}m)</span>` 
                        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">On Time</span>`}
                </td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${(att.shift_sales || 0).toFixed(2)}</td>
                <td class="p-3 text-center"><span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${att.status}</span></td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {}
}

async function loadEmployeeBills() {
    try {
        const res = await apiFetch('/api/employee/my-orders');
        if (!res.ok) return;
        const orders = await res.json();
        const tbody = document.getElementById('emp-my-bills-body');
        if (!tbody) return;

        tbody.innerHTML = orders.map(ord => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-blue-600">${ord.invoice_number}</td>
                <td class="p-3 text-slate-500 text-[11px]">${ord.created_at || '-'}</td>
                <td class="p-3 text-slate-800">${ord.customer_name || 'Walk-in'}</td>
                <td class="p-3 text-center font-mono">${ord.items_count || 0}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${(ord.grand_total || 0).toFixed(2)}</td>
                <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">${ord.payment_method}</span></td>
                <td class="p-3 text-center"><button onclick="reprintOrderReceipt('${ord.invoice_number}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 text-xs font-semibold">View</button></td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {}
}

// ==========================================
// 12. SHELF LABELS & SETTINGS
// ==========================================

function loadShelfLabelsScreen() {
    const select = document.getElementById('barcode-product-select');
    if (select) {
        select.innerHTML = state.catalog.map(p => `<option value="${p.id}">${p.name} (₹${p.selling_price})</option>`).join('');
    }
    generateSelectedLabel();
}

function generateSelectedLabel() {
    const select = document.getElementById('barcode-product-select');
    const prodId = parseInt(select.value);
    const prod = state.catalog.find(p => p.id === prodId) || state.catalog[0];
    if (!prod) return;
    renderShelfLabels([prod]);
}

function generateAllStoreLabels() {
    renderShelfLabels(state.catalog);
}

function renderShelfLabels(products) {
    const container = document.getElementById('shelf-labels-preview-container');
    if (!container) return;

    container.innerHTML = products.map(p => `
        <div class="bg-white text-slate-900 p-3 rounded-xl border border-slate-200 space-y-1 font-mono text-center shadow-sm">
            <div class="font-bold text-xs uppercase tracking-tight truncate">${p.name}</div>
            <div class="text-[9px] text-slate-500">${p.category} • Rack: ${p.rack_location || 'A-01'}</div>
            <div class="flex justify-center items-baseline space-x-2 py-1">
                <span class="text-base font-black text-emerald-700">₹${p.selling_price.toFixed(2)}</span>
                <span class="text-[10px] text-slate-400 line-through">MRP: ₹${p.mrp.toFixed(2)}</span>
            </div>
            <svg id="tag-svg-${p.id}" class="mx-auto"></svg>
        </div>
    `).join('');

    if (typeof JsBarcode !== 'undefined') {
        products.forEach(p => {
            try {
                JsBarcode(`#tag-svg-${p.id}`, p.barcode, {
                    format: "CODE128", width: 1.2, height: 28, displayValue: true, fontSize: 9, margin: 0
                });
            } catch (e) {}
        });
    }
}

function printShelfLabels() {
    window.print();
}

function loadSettingsScreen() {
    const set = state.storeSettings || {};
    document.getElementById('set-store-name').value = set.store_name || '';
    document.getElementById('set-store-tagline').value = set.store_tagline || '';
    document.getElementById('set-store-address').value = set.address || '';
    document.getElementById('set-store-gstin').value = set.gstin || '';
    document.getElementById('set-store-fssai').value = set.fssai || '';
    document.getElementById('set-upi-id').value = set.upi_id || '';
    document.getElementById('set-receipt-footer').value = set.receipt_footer || '';
}

async function saveStoreSettings() {
    const payload = {
        store_name: document.getElementById('set-store-name').value.trim(),
        store_tagline: document.getElementById('set-store-tagline').value.trim(),
        address: document.getElementById('set-store-address').value.trim(),
        gstin: document.getElementById('set-store-gstin').value.trim(),
        fssai: document.getElementById('set-store-fssai').value.trim(),
        upi_id: document.getElementById('set-upi-id').value.trim(),
        receipt_footer: document.getElementById('set-receipt-footer').value.trim()
    };

    try {
        const res = await apiFetch('/api/settings', { method: 'POST', body: payload });
        if (res.ok) {
            state.storeSettings = await res.json();
            playBeep('success');
            Swal.fire({ title: 'Settings Saved', icon: 'success', timer: 1200, showConfirmButton: false });
        }
    } catch (e) {}
}

// ==========================================
// 13. KEYBOARD SHORTCUTS & ALERTS
// ==========================================

function openKeyboardShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.remove('hidden');
}
function closeKeyboardShortcutsModal() {
    document.getElementById('modal-shortcuts').classList.add('hidden');
}

function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInputFocused = (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select');

        // Enter Key Handlers for Success Modal and Payment Modal
        const successModal = document.getElementById('modal-payment-success');
        if (successModal && !successModal.classList.contains('hidden') && e.key === 'Enter') {
            e.preventDefault();
            startNewBillFromSuccess();
            return;
        }

        const payModal = document.getElementById('modal-payment');
        if (payModal && !payModal.classList.contains('hidden') && e.key === 'Enter' && !isInputFocused) {
            e.preventDefault();
            confirmAndProcessPayment();
            return;
        }

        // ESC - Close any open modal and focus barcode
        if (e.key === 'Escape') {
            e.preventDefault();
            document.querySelectorAll('[id^="modal-"]').forEach(m => m.classList.add('hidden'));
            focusBarcodeInput();
            return;
        }

        // F1 - New Bill / Switch to POS
        if (e.key === 'F1') {
            e.preventDefault();
            startNewBill();
            return;
        }

        // F2 - Focus physical barcode scanner input
        if (e.key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            const anyModalOpen = document.querySelector('[id^="modal-"]:not(.hidden)');
            const swalOpen = document.querySelector('.swal2-container');
            if (anyModalOpen || (swalOpen && swalOpen.offsetParent !== null)) return;
            if (state.activeScreen !== 'pos') switchScreen('pos');
            focusBarcodeInput();
            return;
        }

        // F3 - Toggle Camera Scanner (start/stop continuous camera scanning)
        if (e.key === 'F3') {
            e.preventDefault();
            e.stopPropagation();
            // If camera scanner modal is already open, close it
            const camModal = document.getElementById('modal-camera-scanner');
            if (camModal && !camModal.classList.contains('hidden')) {
                closeCameraScannerModal();
                return;
            }
            // If any other blocking modal or swal open, do nothing
            const anyModalOpen = document.querySelector('[id^="modal-"]:not(.hidden)');
            const swalOpen = document.querySelector('.swal2-container');
            if (anyModalOpen || (swalOpen && swalOpen.offsetParent !== null)) return;
            if (state.activeScreen !== 'pos') switchScreen('pos');
            // Open camera scanner for continuous scanning
            openCameraScannerModal();
            return;
        }

        // F4 - Customer Member Search
        if (e.key === 'F4') {
            e.preventDefault();
            if (state.activeScreen === 'pos') {
                if (payModal && !payModal.classList.contains('hidden')) {
                    quickCashCheckout();
                } else {
                    openCustomerSelectModal();
                }
            }
            return;
        }

        // F5 - Hold Bill
        if (e.key === 'F5') {
            e.preventDefault();
            if (state.activeScreen === 'pos') holdCurrentCart();
            return;
        }

        // F6 - Held Bills
        if (e.key === 'F6') {
            e.preventDefault();
            openHeldCartsModal();
            return;
        }

        // F7 - Open Payment
        if (e.key === 'F7') {
            e.preventDefault();
            if (state.activeScreen === 'pos') openPaymentModal();
            return;
        }

        // F8 - Reprint Last Bill (only when no blocking modal is open)
        if (e.key === 'F8') {
            e.preventDefault();
            // Do not trigger print if payment, product or other modal is open (receipt modal is ok to re-print)
            const blockingModals = ['modal-payment', 'modal-product', 'modal-camera-scanner', 'modal-weight-scale'];
            const isBlockingModalOpen = blockingModals.some(id => {
                const el = document.getElementById(id);
                return el && !el.classList.contains('hidden');
            });
            const swalOpen = document.querySelector('.swal2-container');
            if (isBlockingModalOpen || (swalOpen && swalOpen.offsetParent !== null)) return;
            reprintLastBill();
            return;
        }


        // F9 - Apply Coupon / Discount
        if (e.key === 'F9') {
            e.preventDefault();
            const couponInput = document.getElementById('coupon-input');
            if (couponInput) couponInput.focus();
            return;
        }

        // F10 - Clear Cart
        if (e.key === 'F10') {
            e.preventDefault();
            if (state.activeScreen === 'pos') clearCartConfirm();
            return;
        }

        // CTRL + S - Save / Hold
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (state.activeScreen === 'pos') holdCurrentCart();
            return;
        }

        // CTRL + P - Print Last Bill
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            reprintLastBill();
            return;
        }

        // When not in a text field:
        if (!isInputFocused && state.activeScreen === 'pos') {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (state.selectedCartIndex >= 0 && state.selectedCartIndex < state.cart.length) {
                    removeCartItem(state.selectedCartIndex);
                }
            } else if (e.key === '+' || e.key === '=') {
                const targetIdx = state.selectedCartIndex >= 0 ? state.selectedCartIndex : state.cart.length - 1;
                if (targetIdx >= 0 && state.cart[targetIdx]) {
                    updateCartItemQty(targetIdx, state.cart[targetIdx].quantity + 1);
                }
            } else if (e.key === '-' || e.key === '_') {
                const targetIdx = state.selectedCartIndex >= 0 ? state.selectedCartIndex : state.cart.length - 1;
                if (targetIdx >= 0 && state.cart[targetIdx]) {
                    updateCartItemQty(targetIdx, state.cart[targetIdx].quantity - 1);
                }
            }
        }
    });
}

function showNotificationsAlert() {
    const modal = document.getElementById('modal-notifications');
    if (modal) {
        modal.classList.remove('hidden');
        renderNotificationsDrawer();
    }
}

function closeNotificationsAlert() {
    const modal = document.getElementById('modal-notifications');
    if (modal) modal.classList.add('hidden');
}

// ==========================================
// 14. THERMAL PRINTER SETTINGS & BRIDGE
// ==========================================

function initPrinterSettings() {
    state.printerSettings = {
        enabled: localStorage.getItem('pos_printer_enabled') !== 'false',
        paperWidth: localStorage.getItem('pos_printer_width') || '80mm',
        type: localStorage.getItem('pos_printer_type') || 'ESC_POS',
        printerName: localStorage.getItem('pos_printer_name') || 'Default',
        autoPrint: localStorage.getItem('pos_auto_print') === 'true',
        cutPaper: localStorage.getItem('pos_cut_paper') !== 'false',
        openDrawer: localStorage.getItem('pos_open_drawer') === 'true',
        qzConnected: false
    };

    const widthBadge = document.getElementById('hdr-printer-status-text');
    if (widthBadge) {
        widthBadge.textContent = `Printer: ${state.printerSettings.paperWidth}`;
    }
}

function openPrinterSettingsModal() {
    const p = state.printerSettings;
    const enabledEl = document.getElementById('cfg-printer-enabled');
    const widthEl = document.getElementById('cfg-printer-width');
    const typeEl = document.getElementById('cfg-printer-type');
    const nameEl = document.getElementById('cfg-printer-name');
    const autoEl = document.getElementById('cfg-auto-print');
    const cutEl = document.getElementById('cfg-cut-paper');
    const drawerEl = document.getElementById('cfg-open-drawer');

    if (enabledEl) enabledEl.value = p.enabled ? 'true' : 'false';
    if (widthEl) widthEl.value = p.paperWidth || '80mm';
    if (typeEl) typeEl.value = p.type || 'ESC_POS';
    if (nameEl) nameEl.value = p.printerName || 'Default';
    if (autoEl) autoEl.checked = p.autoPrint;
    if (cutEl) cutEl.checked = p.cutPaper;
    if (drawerEl) drawerEl.checked = p.openDrawer;

    document.getElementById('modal-printer-settings').classList.remove('hidden');
    detectPrinters(false);
}

function closePrinterSettingsModal() {
    document.getElementById('modal-printer-settings').classList.add('hidden');
}

function savePrinterSettings() {
    const enabled = document.getElementById('cfg-printer-enabled').value === 'true';
    const paperWidth = document.getElementById('cfg-printer-width').value;
    const type = document.getElementById('cfg-printer-type').value;
    const printerName = document.getElementById('cfg-printer-name').value.trim() || 'Default';
    const autoPrint = document.getElementById('cfg-auto-print').checked;
    const cutPaper = document.getElementById('cfg-cut-paper').checked;
    const openDrawer = document.getElementById('cfg-open-drawer').checked;

    state.printerSettings = {
        ...state.printerSettings,
        enabled,
        paperWidth,
        type,
        printerName,
        autoPrint,
        cutPaper,
        openDrawer
    };

    localStorage.setItem('pos_printer_enabled', enabled ? 'true' : 'false');
    localStorage.setItem('pos_printer_width', paperWidth);
    localStorage.setItem('pos_printer_type', type);
    localStorage.setItem('pos_printer_name', printerName);
    localStorage.setItem('pos_auto_print', autoPrint ? 'true' : 'false');
    localStorage.setItem('pos_cut_paper', cutPaper ? 'true' : 'false');
    localStorage.setItem('pos_open_drawer', openDrawer ? 'true' : 'false');

    const widthBadge = document.getElementById('hdr-printer-status-text');
    if (widthBadge) {
        widthBadge.textContent = `Printer: ${paperWidth}`;
    }

    playBeep('success');
    Swal.fire({ title: 'Printer Settings Saved', icon: 'success', timer: 1200, showConfirmButton: false });
    closePrinterSettingsModal();
}

async function detectPrinters(showToast = true) {
    const dot = document.getElementById('printer-status-dot');
    const title = document.getElementById('printer-status-title');
    const detail = document.getElementById('printer-status-detail');
    const dropdown = document.getElementById('cfg-printer-dropdown');

    if (typeof window.qz !== 'undefined') {
        try {
            if (!qz.websocket.isActive()) {
                await qz.websocket.connect();
            }
            state.printerSettings.qzConnected = true;
            const printers = await qz.printers.find();
            state.detectedPrinters = printers || [];

            if (dot) dot.className = 'w-3 h-3 rounded-full bg-emerald-500 animate-pulse';
            if (title) title.textContent = 'QZ Tray Connected';
            if (detail) detail.textContent = `${printers.length} thermal / system printers detected`;

            if (dropdown && printers.length > 0) {
                dropdown.classList.remove('hidden');
                dropdown.innerHTML = `<option value="">-- Choose Detected Printer --</option>` +
                    printers.map(pr => `<option value="${pr}">${pr}</option>`).join('');
            }
            if (showToast) {
                playBeep('success');
                Swal.fire({ title: 'Printers Detected', text: `Found ${printers.length} local printers via QZ Tray.`, icon: 'success', timer: 1500, showConfirmButton: false });
            }
            return;
        } catch (qzErr) {
            console.warn('QZ Tray bridge note:', qzErr);
        }
    }

    // Default Web Driver Fallback
    if (dot) dot.className = 'w-3 h-3 rounded-full bg-blue-500';
    if (title) title.textContent = 'Thermal Web Driver Active';
    if (detail) detail.textContent = 'ESC/POS & Browser Silent Print Bridge Ready';
    if (showToast) {
        Swal.fire({
            title: 'Thermal Driver Ready',
            text: 'System thermal driver active. For raw hardware bypass, start QZ Tray bridge.',
            icon: 'info',
            confirmButtonColor: '#2563eb'
        });
    }
}

function selectDetectedPrinter() {
    const dropdown = document.getElementById('cfg-printer-dropdown');
    if (dropdown && dropdown.value) {
        document.getElementById('cfg-printer-name').value = dropdown.value;
    }
}

function handlePaperWidthChange() {
    const width = document.getElementById('cfg-printer-width').value;
    const paper = document.getElementById('thermal-receipt-paper');
    if (paper) {
        paper.className = `w-full ${width === '58mm' ? 'paper-58mm max-w-[260px]' : 'paper-80mm max-w-[340px]'} bg-white text-slate-900 font-mono p-4 shadow-md border border-slate-300 rounded-sm`;
    }
}

function testPrintThermalReceipt() {
    const testOrder = {
        invoice_number: `TEST-${Date.now().toString().slice(-6)}`,
        created_at: new Date().toLocaleString(),
        cashier_name: state.currentUser ? state.currentUser.name : 'Test Cashier',
        employee_id: state.currentUser ? state.currentUser.employee_id : 'EMP001',
        customer_name: 'Printer Self-Test',
        register_number: 'REG-01',
        counter_id: 'Counter 1',
        subtotal: 100.0,
        tax_amount: 5.0,
        discount_amount: 10.0,
        round_off: 0.0,
        grand_total: 95.0,
        payment_method: 'TEST_PRINT',
        tendered_amount: 100.0,
        change_amount: 5.0,
        items: [
            { name: 'Thermal Alignment Test 1', quantity: 1, unit: 'pcs', unit_price: 50.0, total_price: 50.0 },
            { name: '58mm / 80mm Font Scaler', quantity: 1, unit: 'pcs', unit_price: 50.0, total_price: 50.0 }
        ]
    };
    renderThermalReceipt(testOrder, false);
    printThermalReceiptDirect(testOrder, false);
}

function handleBillPrintShortcut() {
    const blockingModals = ['modal-payment', 'modal-product', 'modal-camera-scanner', 'modal-weight-scale', 'modal-customer-select'];
    const isBlockingModalOpen = blockingModals.some(id => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });
    const swalOpen = document.querySelector('.swal2-container');
    if (isBlockingModalOpen || (swalOpen && swalOpen.offsetParent !== null)) return;
    reprintLastBill();
}

async function reprintLastBill() {
    try {
        // If modal-receipt is currently open and has a bill loaded, print it
        const receiptModal = document.getElementById('modal-receipt');
        if (receiptModal && !receiptModal.classList.contains('hidden') && state.lastCompletedOrder) {
            printThermalReceiptDirect(state.lastCompletedOrder, true);
            return;
        }

        // If a bill has just been completed, print that bill
        if (state.lastCompletedOrder) {
            renderThermalReceipt(state.lastCompletedOrder, true);
            if (receiptModal) receiptModal.classList.remove('hidden');
            printThermalReceiptDirect(state.lastCompletedOrder, true);
            return;
        }

        // Otherwise fetch last completed order from API
        const res = await apiFetch('/api/orders/reprint-last');
        if (!res.ok) {
            Swal.fire({ title: 'No Bills Found', text: 'No previous orders found to reprint.', icon: 'info' });
            return;
        }
        const order = await res.json();
        state.lastCompletedOrder = order;
        renderThermalReceipt(order, true);
        if (receiptModal) receiptModal.classList.remove('hidden');
        printThermalReceiptDirect(order, true);
    } catch (err) {
        console.error('Reprint last bill error:', err);
    }
}

async function reprintOrderReceipt(invoiceNum) {
    try {
        const res = await apiFetch(`/api/orders/${encodeURIComponent(invoiceNum)}/reprint`, { method: 'POST' });
        if (res.ok) {
            const order = await res.json();
            renderThermalReceipt(order, true);
            document.getElementById('modal-receipt').classList.remove('hidden');
            printThermalReceiptDirect(order, true);
        } else {
            const fallbackRes = await apiFetch(`/api/orders/${encodeURIComponent(invoiceNum)}`);
            if (fallbackRes.ok) {
                const order = await fallbackRes.json();
                renderThermalReceipt(order, true);
                document.getElementById('modal-receipt').classList.remove('hidden');
                printThermalReceiptDirect(order, true);
            }
        }
    } catch (e) {
        console.error('Reprint error:', e);
    }
}

// ==========================================
// 15. BATCH & EXPIRY MANAGEMENT
// ==========================================

let cachedBatches = [];

async function loadOwnerBatches() {
    try {
        const res = await apiFetch('/api/batches');
        const alertRes = await apiFetch('/api/expiry-alerts');
        if (res.ok) {
            cachedBatches = await res.json();
            renderBatchesTable(cachedBatches);
        }
        if (alertRes.ok) {
            const alerts = await alertRes.json();
            const expEl = document.getElementById('count-expired');
            const exp7El = document.getElementById('count-exp7');
            const exp30El = document.getElementById('count-exp30');
            if (expEl) expEl.textContent = alerts.expired ? alerts.expired.length : 0;
            if (exp7El) exp7El.textContent = alerts.expiring_7_days ? alerts.expiring_7_days.length : 0;
            if (exp30El) exp30El.textContent = alerts.expiring_30_days ? alerts.expiring_30_days.length : 0;
        }
    } catch (err) {
        console.error('Batches load error:', err);
    }
}

function filterBatches(status) {
    document.querySelectorAll('.batch-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-600', 'text-white');
        btn.classList.add('bg-white', 'text-slate-700');
    });

    const activeMap = {
        'ALL': 'batch-filter-all',
        'EXPIRED': 'batch-filter-expired',
        'EXP_7': 'batch-filter-exp7',
        'EXP_30': 'batch-filter-exp30'
    };
    const target = document.getElementById(activeMap[status]);
    if (target) {
        target.classList.add('active', 'bg-blue-600', 'text-white');
        target.classList.remove('bg-white', 'text-slate-700');
    }

    if (status === 'ALL') {
        renderBatchesTable(cachedBatches);
    } else if (status === 'EXPIRED') {
        renderBatchesTable(cachedBatches.filter(b => b.is_expired));
    } else if (status === 'EXP_7') {
        renderBatchesTable(cachedBatches.filter(b => b.days_left >= 0 && b.days_left <= 7));
    } else if (status === 'EXP_30') {
        renderBatchesTable(cachedBatches.filter(b => b.days_left >= 0 && b.days_left <= 30));
    }
}

function renderBatchesTable(batches) {
    const tbody = document.getElementById('batches-table-body');
    if (!tbody) return;

    if (batches.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">No product batches found. Click '+ Add Product Batch' to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = batches.map(b => {
        let badgeClass = 'bg-emerald-100 text-emerald-800';
        let statusText = `${b.days_left} days left`;
        if (b.is_expired) {
            badgeClass = 'bg-red-100 text-red-800 font-bold';
            statusText = 'EXPIRED';
        } else if (b.days_left <= 7) {
            badgeClass = 'bg-amber-100 text-amber-800 font-bold animate-pulse';
            statusText = `⚡ ${b.days_left} days left (FEFO)`;
        } else if (b.days_left <= 30) {
            badgeClass = 'bg-yellow-100 text-yellow-800';
            statusText = `${b.days_left} days left`;
        }

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-slate-900">${b.batch_number}</td>
                <td class="p-3 font-semibold text-slate-900">${b.product_name}</td>
                <td class="p-3 font-mono text-slate-500">${b.barcode || '-'}</td>
                <td class="p-3 text-slate-600">${b.mfg_date || '-'}</td>
                <td class="p-3 font-semibold ${b.is_expired ? 'text-red-600 font-bold' : 'text-slate-800'}">${b.expiry_date}</td>
                <td class="p-3 text-center"><span class="px-2.5 py-0.5 rounded-full text-[10px] ${badgeClass}">${statusText}</span></td>
                <td class="p-3 text-right font-mono font-bold text-slate-900">${b.quantity}</td>
                <td class="p-3 text-right font-mono text-emerald-700 font-bold">₹${(b.selling_price || 0).toFixed(2)}</td>
                <td class="p-3 text-slate-600">${b.supplier_name || 'Direct'}</td>
                <td class="p-3 text-center">
                    <button onclick="deleteProductBatch(${b.id})" class="p-1 text-slate-400 hover:text-red-600" title="Delete Batch"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

function openAddBatchModal() {
    const prodSelect = document.getElementById('batch-form-product');
    if (prodSelect) {
        prodSelect.innerHTML = state.catalog.map(p => `<option value="${p.id}">${p.name} (${p.barcode})</option>`).join('');
    }
    const numInput = document.getElementById('batch-form-number');
    if (numInput) {
        numInput.value = `BAT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
    }
    document.getElementById('modal-add-batch').classList.remove('hidden');
}

function closeAddBatchModal() {
    document.getElementById('modal-add-batch').classList.add('hidden');
}

async function saveNewProductBatch() {
    const productId = parseInt(document.getElementById('batch-form-product').value);
    const batchNumber = document.getElementById('batch-form-number').value.trim();
    const mfgDate = document.getElementById('batch-form-mfg').value || null;
    const expiryDate = document.getElementById('batch-form-expiry').value;
    const qty = parseFloat(document.getElementById('batch-form-qty').value) || 0;
    const price = parseFloat(document.getElementById('batch-form-price').value) || 0;

    if (!productId || !batchNumber || !expiryDate || qty <= 0) {
        Swal.fire({ title: 'Missing Info', text: 'Please fill product, batch number, expiry date and quantity.', icon: 'warning' });
        return;
    }

    try {
        const res = await apiFetch('/api/batches', {
            method: 'POST',
            body: {
                product_id: productId,
                batch_number: batchNumber,
                mfg_date: mfgDate,
                expiry_date: expiryDate,
                quantity: qty,
                selling_price: price
            }
        });
        if (res.ok) {
            playBeep('success');
            closeAddBatchModal();
            Swal.fire({ title: 'Batch Added', icon: 'success', timer: 1200, showConfirmButton: false });
            loadOwnerBatches();
        }
    } catch (e) {
        console.error('Batch save error:', e);
    }
}

async function deleteProductBatch(batchId) {
    const confirm = await Swal.fire({
        title: 'Delete Batch?',
        text: 'Are you sure you want to remove this batch record?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Yes, Delete'
    });
    if (!confirm.isConfirmed) return;

    try {
        const res = await apiFetch(`/api/batches/${batchId}`, { method: 'DELETE' });
        if (res.ok) {
            playBeep('success');
            loadOwnerBatches();
        }
    } catch (e) {}
}

// ==========================================
// 16. STOCK MOVEMENT HISTORY LEDGER
// ==========================================

async function loadStockLedger() {
    const typeFilter = document.getElementById('ledger-type-filter')?.value || '';
    const prodFilter = document.getElementById('ledger-product-filter')?.value || '';

    // Populate product dropdown if empty
    const prodSelect = document.getElementById('ledger-product-filter');
    if (prodSelect && prodSelect.options.length <= 1) {
        state.catalog.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            prodSelect.appendChild(opt);
        });
    }

    let url = `/api/stock-movements?limit=250`;
    if (typeFilter) url += `&movement_type=${encodeURIComponent(typeFilter)}`;
    if (prodFilter) url += `&product_id=${encodeURIComponent(prodFilter)}`;

    try {
        const res = await apiFetch(url);
        if (!res.ok) return;
        const movements = await res.json();
        const tbody = document.getElementById('stock-ledger-table-body');
        if (!tbody) return;

        const countLabel = document.getElementById('ledger-count-label');
        if (countLabel) countLabel.textContent = `Displaying ${movements.length} logged stock transactions`;

        if (movements.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">No stock movements found matching filters.</td></tr>`;
            return;
        }

        tbody.innerHTML = movements.map(m => {
            const isPos = m.quantity_change > 0;
            const changeBadge = isPos ?
                `<span class="text-emerald-600 font-bold font-mono">+${m.quantity_change}</span>` :
                `<span class="text-red-600 font-bold font-mono">${m.quantity_change}</span>`;

            let typeBadge = 'bg-slate-100 text-slate-700';
            if (m.movement_type === 'PURCHASE') typeBadge = 'bg-blue-100 text-blue-800 font-bold';
            else if (m.movement_type === 'SALE') typeBadge = 'bg-emerald-100 text-emerald-800 font-bold';
            else if (m.movement_type === 'SALES_RETURN') typeBadge = 'bg-orange-100 text-orange-800 font-bold';
            else if (m.movement_type === 'PURCHASE_RETURN') typeBadge = 'bg-purple-100 text-purple-800 font-bold';
            else if (m.movement_type === 'DAMAGE') typeBadge = 'bg-red-100 text-red-800 font-bold';

            return `
                <tr class="hover:bg-slate-50 transition">
                    <td class="p-3 text-slate-500 font-mono text-[11px]">${m.created_at || '-'}</td>
                    <td class="p-3 font-semibold text-slate-900">${m.product_name}</td>
                    <td class="p-3 font-mono text-slate-500">${m.barcode || '-'}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] ${typeBadge}">${m.movement_type.replace('_', ' ')}</span></td>
                    <td class="p-3 text-right">${changeBadge}</td>
                    <td class="p-3 text-right font-mono font-bold text-slate-900">${m.balance_after}</td>
                    <td class="p-3 font-mono text-blue-600 text-xs">${m.reference_id || '-'}</td>
                    <td class="p-3 text-slate-700">${m.user_name || 'System'}</td>
                    <td class="p-3 text-slate-500 text-xs">${m.reason || '-'}</td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('Stock ledger error:', e);
    }
}

// ==========================================
// 17. SALES & PURCHASE RETURNS
// ==========================================

let returnActiveOrder = null;

function switchReturnsTab(tab) {
    const isSales = tab === 'sales';
    document.getElementById('section-sales-returns').classList.toggle('hidden', !isSales);
    document.getElementById('section-purchase-returns').classList.toggle('hidden', isSales);

    const salesBtn = document.getElementById('tab-returns-sales');
    const poBtn = document.getElementById('tab-returns-purchases');

    if (isSales) {
        salesBtn.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs text-center bg-orange-50 text-orange-700 border border-orange-200 transition';
        poBtn.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs text-center text-slate-500 hover:text-slate-800 transition';
        loadSalesReturnsTable();
    } else {
        poBtn.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs text-center bg-slate-900 text-white transition';
        salesBtn.className = 'flex-1 py-2.5 rounded-xl font-bold text-xs text-center text-slate-500 hover:text-slate-800 transition';
        loadPurchaseReturnsTable();
    }
}

async function loadSalesReturnsTable() {
    try {
        const res = await apiFetch('/api/sales-returns');
        if (!res.ok) return;
        const returns = await res.json();
        const countEl = document.getElementById('count-sales-returns');
        if (countEl) countEl.textContent = returns.length;

        const tbody = document.getElementById('sales-returns-table-body');
        if (!tbody) return;

        if (returns.length === 0) {
            tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-slate-400">No customer sales returns recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = returns.map(r => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-orange-600">${r.return_number}</td>
                <td class="p-3 font-mono text-blue-600 font-semibold">${r.invoice_number}</td>
                <td class="p-3 text-slate-500 text-[11px]">${r.created_at || '-'}</td>
                <td class="p-3 text-slate-800">${r.customer_name || 'Walk-in'}</td>
                <td class="p-3 text-center font-mono font-bold">${r.items_count || 1}</td>
                <td class="p-3 text-right font-mono font-black text-orange-600">₹${(r.total_refund || 0).toFixed(2)}</td>
                <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800">${r.refund_method}</span></td>
                <td class="p-3 text-slate-700">${r.cashier_name || 'Cashier'}</td>
                <td class="p-3 text-slate-500 text-xs">${r.reason}</td>
                <td class="p-3 text-center">
                    <button onclick="viewSalesReturnDetail(${r.id})" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">View</button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Sales returns table error:', e);
    }
}

async function viewSalesReturnDetail(id) {
    try {
        const res = await apiFetch(`/api/sales-returns/${id}`);
        if (!res.ok) return;
        const r = await res.json();
        const itemsList = r.items.map(i => `
            <div class="flex justify-between py-1 border-b border-slate-100">
                <span>${i.product_name} (${i.returned_quantity} ${i.unit})</span>
                <span class="font-mono font-bold">₹${(i.refund_amount || 0).toFixed(2)}</span>
            </div>
        `).join('');

        Swal.fire({
            title: `Sales Return: ${r.return_number}`,
            html: `
                <div class="text-left text-xs space-y-2 p-2">
                    <div>Original Invoice: <strong class="font-mono text-blue-600">${r.invoice_number}</strong></div>
                    <div>Customer: <strong>${r.customer_name}</strong></div>
                    <div>Reason: <em>${r.reason}</em></div>
                    <div class="pt-2 border-t font-bold">Returned Products:</div>
                    ${itemsList}
                    <div class="pt-2 border-t flex justify-between font-black text-sm text-orange-600">
                        <span>Total Refund Paid:</span>
                        <span>₹${(r.total_refund || 0).toFixed(2)} (${r.refund_method})</span>
                    </div>
                </div>
            `,
            confirmButtonColor: '#2563eb'
        });
    } catch (e) {}
}

async function loadPurchaseReturnsTable() {
    try {
        const res = await apiFetch('/api/purchase-returns');
        if (!res.ok) return;
        const returns = await res.json();
        const countEl = document.getElementById('count-purchase-returns');
        if (countEl) countEl.textContent = returns.length;

        const tbody = document.getElementById('purchase-returns-table-body');
        if (!tbody) return;

        if (returns.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-slate-400">No supplier purchase returns recorded.</td></tr>`;
            return;
        }

        tbody.innerHTML = returns.map(r => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-mono font-bold text-slate-900">${r.return_number}</td>
                <td class="p-3 font-mono text-blue-600">${r.po_number || '-'}</td>
                <td class="p-3 font-semibold text-slate-900">${r.supplier_name}</td>
                <td class="p-3 text-slate-500 text-[11px]">${r.created_at || '-'}</td>
                <td class="p-3 text-center font-mono font-bold">${r.items_count || 1}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">₹${(r.total_refund || 0).toFixed(2)}</td>
                <td class="p-3 text-center"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">${r.refund_method}</span></td>
                <td class="p-3 text-slate-500 text-xs">${r.reason}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Purchase returns table error:', e);
    }
}

function openSalesReturnModal() {
    returnActiveOrder = null;
    document.getElementById('return-search-invoice').value = '';
    document.getElementById('return-order-info-card').classList.add('hidden');
    document.getElementById('return-items-container').classList.add('hidden');
    document.getElementById('return-details-container').classList.add('hidden');
    document.getElementById('return-grand-total').textContent = '₹0.00';
    document.getElementById('btn-submit-sales-return').disabled = true;
    document.getElementById('modal-sales-return').classList.remove('hidden');
}

function closeSalesReturnModal() {
    document.getElementById('modal-sales-return').classList.add('hidden');
}

async function searchOrderForReturn() {
    const inv = document.getElementById('return-search-invoice').value.trim();
    if (!inv) return;

    try {
        const res = await apiFetch(`/api/orders/${encodeURIComponent(inv)}`);
        if (!res.ok) {
            Swal.fire({ title: 'Bill Not Found', text: `Invoice '${inv}' does not exist in database.`, icon: 'error' });
            return;
        }

        const order = await res.json();
        returnActiveOrder = order;

        document.getElementById('ret-info-inv').textContent = order.invoice_number;
        document.getElementById('ret-info-date').textContent = order.created_at;
        document.getElementById('ret-info-cust').textContent = order.customer_name || 'Walk-in';
        document.getElementById('ret-info-cashier').textContent = order.cashier_name || 'Cashier';
        document.getElementById('ret-info-total').textContent = `₹${(order.grand_total || 0).toFixed(2)}`;
        document.getElementById('return-order-info-card').classList.remove('hidden');

        // Populate items
        const tbody = document.getElementById('return-items-tbody');
        tbody.innerHTML = (order.items || []).map((it, idx) => `
            <tr class="hover:bg-slate-50">
                <td class="p-2.5 text-center">
                    <input type="checkbox" class="ret-item-check w-4 h-4 text-orange-600 rounded" data-index="${idx}" onchange="updateSalesReturnLineRefund(${idx})">
                </td>
                <td class="p-2.5 font-semibold text-slate-900">${it.name}</td>
                <td class="p-2.5 text-right font-mono">₹${it.unit_price.toFixed(2)}</td>
                <td class="p-2.5 text-center font-mono font-bold">${it.quantity}</td>
                <td class="p-2.5 text-center">
                    <input type="number" step="1" min="1" max="${it.quantity}" value="${it.quantity}" class="ret-item-qty w-16 bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-center font-bold text-slate-900" data-index="${idx}" oninput="updateSalesReturnLineRefund(${idx})">
                </td>
                <td class="p-2.5 text-center">
                    <select class="ret-item-condition bg-slate-50 border border-slate-300 rounded-lg px-2 py-1 text-[11px]" data-index="${idx}">
                        <option value="GOOD">Good (Restock)</option>
                        <option value="DAMAGED">Damaged (No restock)</option>
                    </select>
                </td>
                <td class="p-2.5 text-right font-mono font-bold text-orange-600" id="ret-line-refund-${idx}">₹0.00</td>
            </tr>
        `).join('');

        document.getElementById('return-items-container').classList.remove('hidden');
        document.getElementById('return-details-container').classList.remove('hidden');
        document.getElementById('btn-submit-sales-return').disabled = false;

    } catch (e) {
        console.error('Return order search error:', e);
    }
}

function toggleAllReturnItems(masterCheck) {
    const checks = document.querySelectorAll('.ret-item-check');
    checks.forEach((chk, idx) => {
        chk.checked = masterCheck.checked;
        updateSalesReturnLineRefund(idx);
    });
}

function updateSalesReturnLineRefund(idx) {
    if (!returnActiveOrder) return;
    const checks = document.querySelectorAll('.ret-item-check');
    const qtys = document.querySelectorAll('.ret-item-qty');
    let totalRefund = 0;

    checks.forEach((chk, i) => {
        const lineEl = document.getElementById(`ret-line-refund-${i}`);
        const it = returnActiveOrder.items[i];
        if (chk.checked) {
            const q = parseFloat(qtys[i].value) || 0;
            const lineAmt = q * it.unit_price;
            totalRefund += lineAmt;
            if (lineEl) lineEl.textContent = `₹${lineAmt.toFixed(2)}`;
        } else {
            if (lineEl) lineEl.textContent = '₹0.00';
        }
    });

    document.getElementById('return-grand-total').textContent = `₹${totalRefund.toFixed(2)}`;
}

async function confirmSalesReturnSubmit() {
    if (!returnActiveOrder) return;

    const checks = document.querySelectorAll('.ret-item-check');
    const qtys = document.querySelectorAll('.ret-item-qty');
    const conditions = document.querySelectorAll('.ret-item-condition');

    const returnItems = [];
    checks.forEach((chk, i) => {
        if (chk.checked) {
            const it = returnActiveOrder.items[i];
            const q = parseFloat(qtys[i].value) || 0;
            const cond = conditions[i].value;
            if (q > 0) {
                returnItems.push({
                    product_id: it.product_id,
                    returned_quantity: q,
                    unit_price: it.unit_price,
                    restock_condition: cond
                });
            }
        }
    });

    if (returnItems.length === 0) {
        Swal.fire({ title: 'No Items Selected', text: 'Please check at least one product to return.', icon: 'warning' });
        return;
    }

    const reason = document.getElementById('ret-reason-select').value;
    const refundMethod = document.getElementById('ret-payment-method').value;
    const notes = document.getElementById('ret-notes-input').value.trim();

    try {
        const res = await apiFetch('/api/sales-returns', {
            method: 'POST',
            body: {
                invoice_number: returnActiveOrder.invoice_number,
                refund_method: refundMethod,
                reason: reason,
                notes: notes,
                items: returnItems
            }
        });

        if (!res.ok) {
            const err = await res.json();
            Swal.fire({ title: 'Return Failed', text: err.detail || 'Could not process sales return.', icon: 'error' });
            return;
        }

        const data = await res.json();
        playBeep('success');
        closeSalesReturnModal();

        Swal.fire({
            title: 'Sales Return Completed!',
            text: `Return Reference: ${data.return_number}. Refund amount ₹${data.total_refund.toFixed(2)} disbursed.`,
            icon: 'success',
            confirmButtonColor: '#2563eb'
        });

        loadSalesReturnsTable();
        loadCatalog();

    } catch (e) {
        console.error('Confirm return error:', e);
    }
}

function openPurchaseReturnModal() {
    const suppSelect = document.getElementById('po-ret-supplier-select');
    if (suppSelect) {
        suppSelect.innerHTML = (cachedSuppliers || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }
    const prodSelect = document.getElementById('po-ret-product-select');
    if (prodSelect) {
        prodSelect.innerHTML = state.catalog.map(p => `<option value="${p.id}" data-price="${p.cost_price}">${p.name} (Stock: ${p.stock_qty})</option>`).join('');
    }
    handlePurchaseReturnProductChange();
    document.getElementById('modal-purchase-return').classList.remove('hidden');
}

function closePurchaseReturnModal() {
    document.getElementById('modal-purchase-return').classList.add('hidden');
}

function handlePurchaseReturnSupplierChange() {}

function handlePurchaseReturnProductChange() {
    const prodSelect = document.getElementById('po-ret-product-select');
    if (!prodSelect) return;
    const selectedOpt = prodSelect.options[prodSelect.selectedIndex];
    const cost = selectedOpt ? parseFloat(selectedOpt.getAttribute('data-price') || 0) : 0;
    const priceInput = document.getElementById('po-ret-price');
    if (priceInput) priceInput.value = cost;
    calculatePurchaseReturnTotal();
}

function calculatePurchaseReturnTotal() {
    const qty = parseFloat(document.getElementById('po-ret-qty').value) || 0;
    const price = parseFloat(document.getElementById('po-ret-price').value) || 0;
    const total = qty * price;
    const out = document.getElementById('po-ret-total-refund');
    if (out) out.textContent = `₹${total.toFixed(2)}`;
}

async function confirmPurchaseReturnSubmit() {
    const supplierId = parseInt(document.getElementById('po-ret-supplier-select').value);
    const productId = parseInt(document.getElementById('po-ret-product-select').value);
    const qty = parseFloat(document.getElementById('po-ret-qty').value) || 0;
    const price = parseFloat(document.getElementById('po-ret-price').value) || 0;
    const reason = document.getElementById('po-ret-reason').value.trim();

    if (!supplierId || !productId || qty <= 0 || !reason) {
        Swal.fire({ title: 'Missing Info', text: 'Please fill supplier, product, return quantity, and reason.', icon: 'warning' });
        return;
    }

    try {
        const res = await apiFetch('/api/purchase-returns', {
            method: 'POST',
            body: {
                supplier_id: supplierId,
                reason: reason,
                items: [{ product_id: productId, returned_quantity: qty, unit_price: price }]
            }
        });

        if (res.ok) {
            playBeep('success');
            closePurchaseReturnModal();
            Swal.fire({ title: 'Purchase Return Saved', icon: 'success', timer: 1500, showConfirmButton: false });
            loadPurchaseReturnsTable();
            loadCatalog();
        }
    } catch (e) {}
}

// ==========================================
// 18. CASHIER SHIFT MANAGEMENT
// ==========================================

async function openShiftManagementModal() {
    const container = document.getElementById('shift-modal-content');
    if (!container) return;

    try {
        const res = await apiFetch('/api/shifts/active');
        if (!res.ok) return;
        const data = await res.json();
        state.activeShift = data.has_active_shift ? data.shift : null;

        if (!data.has_active_shift) {
            container.innerHTML = `
                <div class="space-y-4">
                    <div class="p-4 bg-blue-50 border border-blue-200 rounded-2xl text-blue-900 text-xs">
                        <strong>No Shift Currently Open:</strong> Open a cashier shift to initialize drawer cash float and start logging register sales.
                    </div>
                    <div>
                        <label class="block font-semibold text-slate-700 mb-1">Cashier Name</label>
                        <input type="text" id="shift-open-cashier" value="${state.currentUser ? state.currentUser.name : 'Cashier'}" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-900">
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">Register / Counter ID</label>
                            <input type="text" id="shift-open-register" value="Counter 1" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900">
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">Opening Cash Float (₹) *</label>
                            <input type="number" id="shift-open-cash" placeholder="e.g. 2000" value="2000" class="w-full bg-slate-50 border border-blue-500 rounded-xl px-3 py-2 text-xs font-bold font-mono text-slate-900">
                        </div>
                    </div>
                    <div class="pt-2">
                        <button onclick="openNewCashierShift()" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-sm transition">
                            OPEN CASHIER SHIFT
                        </button>
                    </div>
                </div>
            `;
        } else {
            const s = data.shift;
            const expectedCash = (s.opening_cash || 0) + (s.cash_sales || 0);

            container.innerHTML = `
                <div class="space-y-4">
                    <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2">
                        <div class="flex justify-between font-bold text-sm text-slate-900">
                            <span>Active Shift: ${s.register_number}</span>
                            <span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px]">IN PROGRESS</span>
                        </div>
                        <div class="grid grid-cols-2 gap-2 text-slate-600 text-xs">
                            <div>Cashier: <strong class="text-slate-900">${s.cashier_name}</strong></div>
                            <div>Opened At: <strong>${s.opened_at ? s.opened_at.substring(11, 16) : 'Today'}</strong></div>
                            <div>Opening Cash Float: <strong class="font-mono text-slate-900">₹${(s.opening_cash || 0).toFixed(2)}</strong></div>
                            <div>Bills Billed: <strong class="font-mono text-blue-600">${s.total_transactions || 0}</strong></div>
                        </div>
                    </div>

                    <!-- Live Aggregated Sales -->
                    <div class="bg-emerald-50 p-3.5 rounded-2xl border border-emerald-200 space-y-1.5">
                        <div class="font-bold text-emerald-900 uppercase text-[10px]">Real-Time Shift Revenue</div>
                        <div class="flex justify-between"><span>Cash Collected:</span><strong class="font-mono text-slate-900">₹${(s.cash_sales || 0).toFixed(2)}</strong></div>
                        <div class="flex justify-between"><span>UPI Collected:</span><strong class="font-mono text-blue-600">₹${(s.upi_sales || 0).toFixed(2)}</strong></div>
                        <div class="flex justify-between"><span>Card Collected:</span><strong class="font-mono text-purple-600">₹${(s.card_sales || 0).toFixed(2)}</strong></div>
                        <div class="pt-1.5 border-t border-emerald-200 flex justify-between font-bold text-sm">
                            <span class="text-emerald-900">Total Shift Sales:</span>
                            <strong class="font-mono text-emerald-700">₹${(s.total_sales || 0).toFixed(2)}</strong>
                        </div>
                    </div>

                    <!-- Cash Drawer Reconciliation -->
                    <div class="p-4 bg-white border-2 border-slate-200 rounded-2xl space-y-3">
                        <div class="font-bold text-slate-900 text-xs uppercase">End of Shift Cash Reconciliation</div>
                        <div class="flex justify-between text-xs font-semibold text-slate-700">
                            <span>Expected Cash in Drawer:</span>
                            <span class="font-mono text-slate-900 text-sm font-black" id="shift-expected-cash">₹${expectedCash.toFixed(2)}</span>
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">Actual Physical Cash Counted (₹) *</label>
                            <input type="number" id="shift-actual-cash" oninput="calculateShiftDifference(${expectedCash})" placeholder="Count cash in drawer..." class="w-full bg-slate-50 border-2 border-blue-500 rounded-xl px-4 py-2.5 text-base font-mono font-bold text-slate-900">
                        </div>
                        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                            <span class="font-bold text-slate-700">Difference (Variance):</span>
                            <span class="font-mono font-black text-base text-slate-900" id="shift-diff-display">₹0.00</span>
                        </div>
                        <div>
                            <label class="block font-semibold text-slate-700 mb-1">Handover Notes</label>
                            <input type="text" id="shift-close-notes" placeholder="Optional comments on cash count" class="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900">
                        </div>
                        <button onclick="closeCurrentCashierShift(${s.id})" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs shadow-sm transition">
                            RECONCILE & CLOSE SHIFT (Z-REPORT)
                        </button>
                    </div>
                </div>
            `;
        }

        document.getElementById('modal-shift-management').classList.remove('hidden');
    } catch (e) {
        console.error('Shift modal error:', e);
    }
}

function closeShiftManagementModal() {
    document.getElementById('modal-shift-management').classList.add('hidden');
}

async function openNewCashierShift() {
    const cashier = document.getElementById('shift-open-cashier').value.trim();
    const register = document.getElementById('shift-open-register').value.trim() || 'Counter 1';
    const cash = parseFloat(document.getElementById('shift-open-cash').value) || 0;

    try {
        const res = await apiFetch('/api/shifts/open', {
            method: 'POST',
            body: { cashier_name: cashier, register_number: register, opening_cash: cash }
        });
        if (res.ok) {
            playBeep('success');
            Swal.fire({ title: 'Shift Opened', text: `Shift started on ${register} with ₹${cash.toFixed(2)} opening float.`, icon: 'success', timer: 1500, showConfirmButton: false });
            openShiftManagementModal();
        }
    } catch (e) {}
}

function calculateShiftDifference(expected) {
    const actual = parseFloat(document.getElementById('shift-actual-cash').value) || 0;
    const diff = actual - expected;
    const display = document.getElementById('shift-diff-display');
    if (!display) return;

    if (Math.abs(diff) < 0.01) {
        display.textContent = '₹0.00 (Exact Match 🟢)';
        display.className = 'font-mono font-black text-base text-emerald-600';
    } else if (diff < 0) {
        display.textContent = `- ₹${Math.abs(diff).toFixed(2)} (Shortage 🔴)`;
        display.className = 'font-mono font-black text-base text-red-600';
    } else {
        display.textContent = `+ ₹${diff.toFixed(2)} (Excess 🔵)`;
        display.className = 'font-mono font-black text-base text-blue-600';
    }
}

async function closeCurrentCashierShift(shiftId) {
    const actual = parseFloat(document.getElementById('shift-actual-cash').value);
    if (isNaN(actual)) {
        Swal.fire({ title: 'Enter Cash Count', text: 'Please enter the actual physical cash counted in drawer.', icon: 'warning' });
        return;
    }
    const notes = document.getElementById('shift-close-notes').value.trim();

    try {
        const res = await apiFetch(`/api/shifts/${shiftId}/close`, {
            method: 'POST',
            body: { actual_cash: actual, notes: notes }
        });

        if (res.ok) {
            const data = await res.json();
            playBeep('success');
            closeShiftManagementModal();
            Swal.fire({
                title: 'Shift Closed Successfully',
                text: `Cash difference: ₹${(data.shift.cash_difference || 0).toFixed(2)}. Z-Report generated.`,
                icon: 'success'
            });
        }
    } catch (e) {}
}

// ==========================================
// 19. SMART REORDER RECOMMENDATIONS
// ==========================================

async function loadSmartReorder() {
    try {
        const res = await apiFetch('/api/owner/smart-reorder');
        if (!res.ok) return;
        const recommendations = await res.json();
        const tbody = document.getElementById('smart-reorder-table-body');
        if (!tbody) return;

        if (recommendations.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">All products have sufficient stock. No reorders needed currently.</td></tr>`;
            return;
        }

        tbody.innerHTML = recommendations.map(r => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3 font-semibold text-slate-900">${r.product_name}</td>
                <td class="p-3 text-slate-600">${r.category}</td>
                <td class="p-3 text-right font-mono font-bold ${r.current_stock <= r.min_stock ? 'text-red-600' : 'text-slate-800'}">${r.current_stock}</td>
                <td class="p-3 text-right font-mono text-slate-500">${r.min_stock}</td>
                <td class="p-3 text-right font-mono">${r.avg_daily_sales || 0} /day</td>
                <td class="p-3 text-right font-mono font-black text-amber-700 text-sm">+${r.recommended_order_qty} ${r.unit || 'pcs'}</td>
                <td class="p-3 text-slate-700">${r.supplier_name || 'Direct Wholesale'}</td>
                <td class="p-3 text-center">
                    <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${r.current_stock <= 0 ? 'bg-red-100 text-red-800' : (r.current_stock <= r.min_stock ? 'bg-amber-100 text-amber-800' : 'bg-yellow-100 text-yellow-800')}">${r.urgency || 'REORDER'}</span>
                </td>
                <td class="p-3 text-center">
                    <button onclick="quickCreatePOForReorder(${r.product_id}, ${r.supplier_id || 1}, ${r.recommended_order_qty})" class="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-slate-950 rounded-lg text-xs font-bold transition">Order</button>
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {
        console.error('Smart reorder error:', e);
    }
}

function quickCreatePOForReorder(prodId, suppId, qty) {
    switchScreen('owner-purchases');
    setTimeout(() => {
        openCreatePurchaseModal();
        const prod = state.catalog.find(p => p.id === prodId);
        if (prod) {
            addProductToPO(prod.id, qty);
        }
    }, 200);
}

// ==========================================
// 20. PROMOTIONS & COUPONS STUDIO
// ==========================================

async function loadOwnerPromotions() {
    try {
        const res = await apiFetch('/api/promotions');
        if (!res.ok) return;
        const promos = await res.json();
        const tbody = document.getElementById('promotions-table-body');
        if (!tbody) return;

        if (promos.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-slate-400">No promotions created yet. Click '+ Create Coupon / Promo' to start.</td></tr>`;
            return;
        }

        tbody.innerHTML = promos.map(p => `
            <tr class="hover:bg-slate-50 transition">
                <td class="p-3"><span class="px-2.5 py-1 rounded-lg bg-pink-100 text-pink-800 font-mono font-black text-xs">${p.code}</span></td>
                <td class="p-3 font-semibold text-slate-900">${p.title}</td>
                <td class="p-3 text-slate-600">${p.discount_type}</td>
                <td class="p-3 text-right font-mono font-bold text-emerald-700">${p.discount_type === 'PERCENTAGE' ? `${p.discount_value}%` : `₹${p.discount_value.toFixed(2)}`}</td>
                <td class="p-3 text-right font-mono text-slate-700">₹${(p.min_bill_amount || 0).toFixed(2)}</td>
                <td class="p-3 text-center text-slate-500 text-[11px]">${p.start_date || 'Any'} to ${p.end_date || 'Any'}</td>
                <td class="p-3 text-center font-mono font-bold">${p.used_count || 0}</td>
                <td class="p-3 text-center">
                    <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${p.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}">${p.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
                </td>
                <td class="p-3 text-center">
                    <button onclick="deletePromotion(${p.id})" class="p-1 text-slate-400 hover:text-red-600" title="Delete Promo"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                </td>
            </tr>
        `).join('');

        lucide.createIcons();
    } catch (e) {
        console.error('Promotions load error:', e);
    }
}

function openAddPromoModal() {
    document.getElementById('modal-add-promo').classList.remove('hidden');
}

function closeAddPromoModal() {
    document.getElementById('modal-add-promo').classList.add('hidden');
}

async function saveNewPromotion() {
    const code = document.getElementById('promo-form-code').value.trim().toUpperCase();
    const type = document.getElementById('promo-form-type').value;
    const title = document.getElementById('promo-form-title').value.trim();
    const val = parseFloat(document.getElementById('promo-form-value').value) || 0;
    const minBill = parseFloat(document.getElementById('promo-form-minbill').value) || 0;
    const start = document.getElementById('promo-form-start').value || null;
    const end = document.getElementById('promo-form-end').value || null;

    if (!code || !title || val <= 0) {
        Swal.fire({ title: 'Missing Info', text: 'Please fill coupon code, title, and discount value.', icon: 'warning' });
        return;
    }

    try {
        const res = await apiFetch('/api/promotions', {
            method: 'POST',
            body: {
                code: code,
                discount_type: type,
                title: title,
                discount_value: val,
                min_bill_amount: minBill,
                start_date: start,
                end_date: end
            }
        });
        if (res.ok) {
            playBeep('success');
            closeAddPromoModal();
            Swal.fire({ title: 'Promotion Saved', icon: 'success', timer: 1200, showConfirmButton: false });
            loadOwnerPromotions();
        } else {
            const err = await res.json();
            Swal.fire({ title: 'Save Failed', text: err.detail || 'Could not save coupon.', icon: 'error' });
        }
    } catch (e) {}
}

async function deletePromotion(id) {
    try {
        const res = await apiFetch(`/api/promotions/${id}`, { method: 'DELETE' });
        if (res.ok) {
            playBeep('success');
            loadOwnerPromotions();
        }
    } catch (e) {}
}

// ==========================================
// 21. ADVANCED DATABASE BUSINESS REPORTS
// ==========================================

async function loadOwnerReports() {
    setReportDateRange('today');
}

function setReportDateRange(rangeKey) {
    const today = new Date();
    const startInput = document.getElementById('rep-start-date');
    const endInput = document.getElementById('rep-end-date');

    const fmt = (d) => d.toISOString().substring(0, 10);

    if (rangeKey === 'today') {
        startInput.value = fmt(today);
        endInput.value = fmt(today);
    } else if (rangeKey === 'yesterday') {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        startInput.value = fmt(y);
        endInput.value = fmt(y);
    } else if (rangeKey === 'this_week') {
        const w = new Date();
        w.setDate(w.getDate() - 7);
        startInput.value = fmt(w);
        endInput.value = fmt(today);
    } else if (rangeKey === 'this_month') {
        const m = new Date();
        m.setDate(1);
        startInput.value = fmt(m);
        endInput.value = fmt(today);
    } else if (rangeKey === 'all_time') {
        startInput.value = '';
        endInput.value = '';
    }

    runSelectedReport();
}

async function runSelectedReport() {
    const type = document.getElementById('rep-type-select').value;
    const start = document.getElementById('rep-start-date').value;
    const end = document.getElementById('rep-end-date').value;

    let url = `/api/reports?report_type=${encodeURIComponent(type)}`;
    if (start) url += `&start_date=${encodeURIComponent(start)}`;
    if (end) url += `&end_date=${encodeURIComponent(end)}`;

    try {
        const res = await apiFetch(url);
        if (!res.ok) return;
        const data = await res.json();
        renderReportOutput(type, data);
    } catch (e) {
        console.error('Report error:', e);
    }
}

function renderReportOutput(type, data) {
    const container = document.getElementById('report-output-container');
    if (!container) return;

    if (type === 'sales_summary') {
        container.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-[10px] uppercase font-bold text-slate-500">Gross Sales Revenue</div>
                    <div class="text-2xl font-black font-mono text-emerald-700 mt-1">₹${(data.gross_sales || data.total_sales || 0).toFixed(2)}</div>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-[10px] uppercase font-bold text-slate-500">Total Bills Processed</div>
                    <div class="text-2xl font-black font-mono text-blue-600 mt-1">${data.total_orders || data.bills_count || 0}</div>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-[10px] uppercase font-bold text-slate-500">Gross Estimated Profit</div>
                    <div class="text-2xl font-black font-mono text-indigo-700 mt-1">₹${(data.gross_profit || 0).toFixed(2)}</div>
                </div>
                <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <div class="text-[10px] uppercase font-bold text-slate-500">Total Discounts Given</div>
                    <div class="text-2xl font-black font-mono text-rose-600 mt-1">₹${(data.total_discount || 0).toFixed(2)}</div>
                </div>
            </div>
            <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <h4 class="font-bold text-sm text-slate-900">Payment Breakdown</h4>
                <div class="grid grid-cols-3 gap-3 text-xs">
                    <div class="p-3 bg-slate-50 rounded-xl border">Cash Sales: <strong class="font-mono text-slate-900">₹${(data.cash_sales || 0).toFixed(2)}</strong></div>
                    <div class="p-3 bg-slate-50 rounded-xl border">UPI Sales: <strong class="font-mono text-blue-600">₹${(data.upi_sales || 0).toFixed(2)}</strong></div>
                    <div class="p-3 bg-slate-50 rounded-xl border">Card Sales: <strong class="font-mono text-purple-600">₹${(data.card_sales || 0).toFixed(2)}</strong></div>
                </div>
            </div>
        `;
    } else {
        const rows = Array.isArray(data) ? data : (data.items || data.records || []);
        if (rows.length === 0) {
            container.innerHTML = `<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center text-slate-400">No records found for this reporting period.</div>`;
            return;
        }

        const keys = Object.keys(rows[0] || {});
        const ths = keys.map(k => `<th class="p-3">${k.replace(/_/g, ' ').toUpperCase()}</th>`).join('');
        const trs = rows.map(r => `
            <tr class="hover:bg-slate-50">
                ${keys.map(k => `<td class="p-3 font-medium text-slate-800">${typeof r[k] === 'number' ? (Number.isInteger(r[k]) ? r[k] : '₹' + r[k].toFixed(2)) : (r[k] || '-')}</td>`).join('')}
            </tr>
        `).join('');

        container.innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <table class="w-full text-left text-xs">
                    <thead class="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200">
                        <tr>${ths}</tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">${trs}</tbody>
                </table>
            </div>
        `;
    }
}

// ==========================================
// 22. SYSTEM HEALTH & SAFE BACKUP
// ==========================================

async function loadSystemHealthScreen() {
    try {
        const healthRes = await apiFetch('/api/system/health');
        if (healthRes.ok) {
            const h = await healthRes.json();
            const be = document.getElementById('health-backend-status');
            const db = document.getElementById('health-db-status');
            const bk = document.getElementById('health-backup-status');
            if (be) be.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>${h.backend.status} (${h.backend.engine})</span>`;
            if (db) db.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>${h.database.status}</span>`;
            if (bk) bk.textContent = h.last_backup || 'Never';
        }

        const backupsRes = await apiFetch('/api/owner/backups');
        if (backupsRes.ok) {
            const backups = await backupsRes.json();
            renderBackupsTable(backups);
        }
    } catch (e) {
        console.error('System health error:', e);
    }
}

function renderBackupsTable(backups) {
    const tbody = document.getElementById('backups-table-body');
    if (!tbody) return;

    if (backups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-slate-400">No backup snapshots found. Click 'Take Backup Now' to create one.</td></tr>`;
        return;
    }

    tbody.innerHTML = backups.map(b => `
        <tr class="hover:bg-slate-50 transition">
            <td class="p-3 font-mono font-bold text-purple-700">${b.filename}</td>
            <td class="p-3 text-slate-600">${b.created_at}</td>
            <td class="p-3 text-right font-mono">${(b.size_kb || 0).toFixed(1)} KB</td>
            <td class="p-3 text-center">
                <button onclick="openRestoreBackupModal('${b.filename}')" class="px-3 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition">Restore</button>
            </td>
        </tr>
    `).join('');
}

async function takeDatabaseBackup() {
    try {
        const res = await apiFetch('/api/owner/backup', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            playBeep('success');
            Swal.fire({
                title: 'Backup Successful',
                text: `Created database snapshot: ${data.filename}`,
                icon: 'success',
                timer: 1800,
                showConfirmButton: false
            });
            loadSystemHealthScreen();
        }
    } catch (e) {}
}

let restoreTargetFile = null;

function openRestoreBackupModal(filename) {
    restoreTargetFile = filename;
    document.getElementById('restore-target-filename').textContent = filename;
    document.getElementById('restore-confirm-check').checked = false;
    document.getElementById('modal-restore-backup').classList.remove('hidden');
}

function closeRestoreBackupModal() {
    document.getElementById('modal-restore-backup').classList.add('hidden');
}

async function executeRestoreDatabase() {
    const check = document.getElementById('restore-confirm-check').checked;
    if (!check) {
        Swal.fire({ title: 'Confirmation Required', text: 'Please check the confirmation box before restoring.', icon: 'warning' });
        return;
    }

    try {
        const res = await apiFetch('/api/owner/restore-backup', {
            method: 'POST',
            body: { filename: restoreTargetFile, confirm: true }
        });
        if (res.ok) {
            playBeep('success');
            closeRestoreBackupModal();
            Swal.fire({
                title: 'Database Restored!',
                text: 'System database restored successfully from snapshot.',
                icon: 'success'
            }).then(() => {
                location.reload();
            });
        }
    } catch (e) {}
}

// ==========================================
// 23. AI BUSINESS ASSISTANT
// ==========================================

function openAiAssistantModal() {
    document.getElementById('modal-ai-assistant').classList.remove('hidden');
    const input = document.getElementById('ai-query-input');
    if (input) input.focus();
}

function closeAiAssistantModal() {
    document.getElementById('modal-ai-assistant').classList.add('hidden');
}

function askAiPreset(question) {
    const input = document.getElementById('ai-query-input');
    if (input) input.value = question;
    submitAiAssistantQuery(new Event('submit'));
}

async function submitAiAssistantQuery(e) {
    if (e && e.preventDefault) e.preventDefault();
    const input = document.getElementById('ai-query-input');
    if (!input) return;
    const query = input.value.trim();
    if (!query) return;

    const messages = document.getElementById('ai-chat-messages');
    messages.innerHTML += `
        <div class="flex justify-end">
            <div class="bg-purple-600 text-white p-3 rounded-2xl max-w-[80%] shadow-sm">
                ${query}
            </div>
        </div>
    `;
    input.value = '';
    messages.scrollTop = messages.scrollHeight;

    const loadingId = `ai-loading-${Date.now()}`;
    messages.innerHTML += `
        <div id="${loadingId}" class="flex justify-start">
            <div class="bg-slate-100 text-slate-700 p-3 rounded-2xl flex items-center space-x-2">
                <span class="w-2 h-2 rounded-full bg-purple-600 animate-ping"></span>
                <span>Analyzing supermarket database metrics...</span>
            </div>
        </div>
    `;
    messages.scrollTop = messages.scrollHeight;

    try {
        const res = await apiFetch('/api/owner/ai-assistant', {
            method: 'POST',
            body: { query: query }
        });

        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) loadingEl.remove();

        if (res.ok) {
            const data = await res.json();
            messages.innerHTML += `
                <div class="flex justify-start">
                    <div class="bg-white border border-purple-200 p-4 rounded-2xl max-w-[90%] shadow-sm space-y-2 text-slate-800">
                        <div class="font-semibold text-slate-900 leading-relaxed whitespace-pre-line">${data.answer || data.response}</div>
                        ${data.source_data ? `
                            <div class="pt-2 border-t border-purple-100 text-[10px] text-purple-700 font-mono">
                                <strong>Database Source Figures:</strong> ${JSON.stringify(data.source_data)}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
            messages.scrollTop = messages.scrollHeight;
        }
    } catch (err) {
        console.error('AI assistant error:', err);
    }
}

// ==========================================
// 24. STORE NOTIFICATIONS & ALERTS
// ==========================================

async function checkStoreNotifications() {
    try {
        let count = 0;
        const alertRes = await apiFetch('/api/expiry-alerts');
        if (alertRes.ok) {
            const alerts = await alertRes.json();
            count += (alerts.expired?.length || 0) + (alerts.expiring_7_days?.length || 0);
        }
        const badge = document.getElementById('notif-badge');
        if (badge) badge.textContent = count;
    } catch (e) {}
}

async function renderNotificationsDrawer() {
    const list = document.getElementById('notifications-list-container');
    if (!list) return;

    try {
        const alertRes = await apiFetch('/api/expiry-alerts');
        const reorderRes = await apiFetch('/api/owner/smart-reorder');

        let html = '';
        if (alertRes.ok) {
            const alerts = await alertRes.json();
            (alerts.expired || []).forEach(item => {
                html += `
                    <div class="p-3 bg-red-50 border border-red-200 rounded-xl text-red-900">
                        <div class="font-bold">❌ Expired Product Alert</div>
                        <div>${item.product_name} (Batch: ${item.batch_number}) expired on ${item.expiry_date}.</div>
                    </div>
                `;
            });
            (alerts.expiring_7_days || []).forEach(item => {
                html += `
                    <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900">
                        <div class="font-bold">⚠️ Expiry Warning (7 Days)</div>
                        <div>${item.product_name} (Batch: ${item.batch_number}) expires in ${item.days_left} days.</div>
                    </div>
                `;
            });
        }

        if (reorderRes.ok) {
            const reorders = await reorderRes.json();
            (reorders || []).slice(0, 3).forEach(r => {
                html += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-yellow-900">
                        <div class="font-bold">📦 Low Stock Reorder Notice</div>
                        <div>${r.product_name}: Current stock ${r.current_stock} ≤ min ${r.min_stock}. Recommended order: +${r.recommended_order_qty} ${r.unit}.</div>
                    </div>
                `;
            });
        }

        if (!html) {
            html = `<div class="text-center py-6 text-slate-400">All systems operational. No critical store alerts.</div>`;
        }
        list.innerHTML = html;
    } catch (e) {}
}

