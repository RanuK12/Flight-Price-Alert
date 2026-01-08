// API Base URL
const API_BASE = 'http://localhost:3000/api';

// DOM Elements
const searchForm = document.getElementById('searchForm');
const originInput = document.getElementById('origin');
const destinationInput = document.getElementById('destination');
const searchLoader = document.getElementById('searchLoader');
const resultsSection = document.getElementById('resultsSection');
const routeDisplay = document.getElementById('routeDisplay');
const cheapestCard = document.getElementById('cheapestCard');
const cheapestPrice = document.getElementById('cheapestPrice');
const cheapestAirline = document.getElementById('cheapestAirline');
const cheapestLink = document.getElementById('cheapestLink');
const sourcesGrid = document.getElementById('sourcesGrid');
const flightsList = document.getElementById('flightsList');
const statsSection = document.getElementById('statsSection');
const totalFlights = document.getElementById('totalFlights');
const minPrice = document.getElementById('minPrice');
const alertsList = document.getElementById('alertsList');
const historyList = document.getElementById('historyList');

// Event Listeners
searchForm.addEventListener('submit', handleSearch);

// Quick routes buttons
document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const origin = btn.dataset.origin;
        const dest = btn.dataset.dest;
        originInput.value = origin;
        destinationInput.value = dest;
        searchForm.dispatchEvent(new Event('submit'));
    });
});

// Handle search
async function handleSearch(e) {
    e.preventDefault();

    const origin = originInput.value.trim().toUpperCase();
    const destination = destinationInput.value.trim().toUpperCase();

    if (!origin || !destination) {
        showToast('Por favor ingresa origen y destino', 'error');
        return;
    }

    searchLoader.style.display = 'inline-block';

    try {
        const response = await fetch(`${API_BASE}/search?origin=${origin}&destination=${destination}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error en la búsqueda');
        }

        displayResults(data);
        loadSearchHistory();
        showToast(`✅ Se encontraron ${data.allFlights?.length || 0} vuelos`, 'success');

    } catch (error) {
        console.error('Error:', error);
        showToast(`Error: ${error.message}`, 'error');
    } finally {
        searchLoader.style.display = 'none';
    }
}

// Display results
function displayResults(data) {
    const { origin, destination, minPrice: min, cheapestFlight, allFlights, sources } = data;

    routeDisplay.textContent = `${origin} → ${destination}`;
    resultsSection.style.display = 'block';

    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });

    // Display cheapest flight
    if (cheapestFlight) {
        cheapestCard.style.display = 'block';
        cheapestPrice.textContent = `€${cheapestFlight.price}`;
        
        // Mostrar fecha de salida
        const dateText = cheapestFlight.departureDate || 'Próximamente';
        const cheapestDateEl = document.getElementById('cheapestDate');
        if (cheapestDateEl) {
            cheapestDateEl.textContent = `📅 Salida: ${dateText}`;
        }
        
        cheapestAirline.textContent = `${cheapestFlight.airline} • ${cheapestFlight.source}`;
        cheapestLink.href = cheapestFlight.link;
        cheapestLink.target = '_blank';
    }

    // Display sources comparison
    if (sources && sources.length > 0) {
        sourcesGrid.innerHTML = sources.map(source => `
            <div class="source-card">
                <h4>${source.name}</h4>
                <div class="price">€${source.minPrice}</div>
                <div class="count">${source.flightCount} vuelos</div>
                ${source.success ? '<span style="color: var(--success-color);">✓ Actualizado</span>' : '<span style="color: var(--warning-color);">⚠ Datos demo</span>'}
            </div>
        `).join('');
    }

    // Display all flights
    if (allFlights && allFlights.length > 0) {
        flightsList.innerHTML = allFlights.map(flight => `
            <div class="flight-item">
                <div class="flight-info">
                    <div class="flight-airline">${flight.airline}</div>
                    <div class="flight-source">${flight.source}</div>
                    <div class="flight-date">📅 ${flight.departureDate || 'Próximamente'}</div>
                </div>
                <div class="flight-price">€${Math.round(flight.price)}</div>
                <a href="${flight.link}" class="flight-link" target="_blank">
                    Ver Opciones →
                </a>
            </div>
        `).join('');

        // Display stats
        totalFlights.textContent = allFlights.length;
        minPrice.textContent = `€${min}`;
        statsSection.style.display = 'block';
    }
}

// Create alert
async function createAlert() {
    const origin = document.getElementById('alertOrigin').value.trim().toUpperCase();
    const destination = document.getElementById('alertDestination').value.trim().toUpperCase();
    const threshold = parseInt(document.getElementById('alertThreshold').value);

    if (!origin || !destination || !threshold) {
        showToast('Por favor completa todos los campos', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/alert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin, destination, threshold })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error creando alerta');
        }

        document.getElementById('alertOrigin').value = '';
        document.getElementById('alertDestination').value = '';
        document.getElementById('alertThreshold').value = '';

        showToast('✅ Alerta creada exitosamente', 'success');
        loadAlerts();

    } catch (error) {
        console.error('Error:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

// Load and display alerts
async function loadAlerts() {
    try {
        const response = await fetch(`${API_BASE}/alerts`);
        const alerts = await response.json();

        if (alerts.length === 0) {
            alertsList.innerHTML = '<p style="text-align: center; color: var(--gray-600);">No hay alertas creadas</p>';
            return;
        }

        alertsList.innerHTML = alerts.map(alert => `
            <div class="alert-item">
                <div class="alert-item-info">
                    <div class="alert-route">${alert.origin} → ${alert.destination}</div>
                    <div class="alert-threshold">Umbral: €${alert.price_threshold}</div>
                </div>
                <button class="btn-delete" onclick="deleteAlert(${alert.id})">Eliminar</button>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error cargando alertas:', error);
    }
}

// Delete alert
async function deleteAlert(alertId) {
    try {
        const response = await fetch(`${API_BASE}/alert/${alertId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            throw new Error('Error eliminando alerta');
        }

        showToast('Alerta eliminada', 'success');
        loadAlerts();

    } catch (error) {
        console.error('Error:', error);
        showToast(`Error: ${error.message}`, 'error');
    }
}

// Load search history
async function loadSearchHistory() {
    try {
        const response = await fetch(`${API_BASE}/search-history?limit=12`);
        const history = await response.json();

        if (history.length === 0) {
            historyList.innerHTML = '<p style="text-align: center; color: var(--gray-600);">Sin búsquedas recientes</p>';
            return;
        }

        historyList.innerHTML = history.map(item => `
            <div class="history-item" onclick="quickSearch('${item.origin}', '${item.destination}')">
                ${item.origin} → ${item.destination}
            </div>
        `).join('');

    } catch (error) {
        console.error('Error cargando historial:', error);
    }
}

// Quick search from history
function quickSearch(origin, destination) {
    originInput.value = origin;
    destinationInput.value = destination;
    searchForm.dispatchEvent(new Event('submit'));
}

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    loadAlerts();
    loadSearchHistory();
});
