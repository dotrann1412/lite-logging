class LogViewer {
    constructor() {
        this.MAX_LOGS = 10000;
        this.logs = [];
        this.filteredLogs = [];
        this.eventSource = null;
        this.isAutoScroll = true;
        this.isPaused = false;
        this.pendingLogs = [];
        this.debounceTimer = null;

        // Auto-reconnect properties
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 1000; // 1 second
        this.maxReconnectDelay = 30000; // 30 seconds
        this.reconnectTimer = null;
        this.isReconnecting = false;

        // Channel management
        this.currentChannel = 'logs';
        this.channelHistory = this.loadChannelHistory(); // Keep track of channels used

        // DOM elements
        this.elements = {};

        // Initialize the application
        this.init();
    }

    loadChannelHistory() {
        try {
            const saved = localStorage.getItem('logViewer_channelHistory');
            const history = saved ? new Set(JSON.parse(saved)) : new Set(['logs']);
            return history;
        } catch (error) {
            console.warn('Failed to load channel history:', error);
            return new Set(['logs']);
        }
    }

    saveChannelHistory() {
        try {
            localStorage.setItem('logViewer_channelHistory', JSON.stringify(Array.from(this.channelHistory)));
        } catch (error) {
            console.warn('Failed to save channel history:', error);
        }
    }

    init() {
        this.initializeElements();
        this.setupEventListeners();
        this.updateChannelHistoryDropdown();
        this.updateStats();
        this.subscribeToLogs();
    }

    initializeElements() {
        this.elements = {
            // Status elements
            connectionStatus: document.getElementById('connection-status'),
            statusText: document.getElementById('status-text'),
            // totalLogs: document.getElementById('total-logs'),
            // visibleLogs: document.getElementById('visible-logs'),

            // Channel elements
            channelSelector: document.getElementById('channel-selector'),
            channelConnectBtn: document.getElementById('channel-connect-btn'),
            channelHistory: document.getElementById('channel-history'),

            // Filter elements
            keywordFilter: document.getElementById('keyword-filter'),
            tagFilter: document.getElementById('tag-filter'),
            typeFilter: document.getElementById('type-filter'),
            clearKeyword: document.getElementById('clear-keyword'),
            clearTag: document.getElementById('clear-tag'),

            // Action buttons
            autoScrollBtn: document.getElementById('auto-scroll-btn'),
            clearLogsBtn: document.getElementById('clear-logs-btn'),
            exportLogsBtn: document.getElementById('export-logs-btn'),
            pauseBtn: document.getElementById('pause-btn'),

            // Log container
            logsContent: document.getElementById('logs-content'),
            logsViewport: document.getElementById('logs-viewport'),
            loadingIndicator: document.getElementById('loading-indicator'),
            noLogsMessage: document.getElementById('no-logs-message'),
            scrollToBottom: document.getElementById('scroll-to-bottom'),
            scrollBottomBtn: document.getElementById('scroll-bottom-btn')
        };
    }

    setupEventListeners() {
        // Channel management
        this.elements.channelConnectBtn.addEventListener('click', () => this.switchChannel());
        this.elements.channelSelector.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.switchChannel();
            }
        });

        // Filter inputs with debouncing
        this.elements.keywordFilter.addEventListener('input', () => this.debounceFilter());
        this.elements.tagFilter.addEventListener('input', () => this.debounceFilter());
        this.elements.typeFilter.addEventListener('change', () => this.debounceFilter());

        // Clear buttons
        this.elements.clearKeyword.addEventListener('click', () => {
            this.elements.keywordFilter.value = '';
            this.debounceFilter();
        });

        this.elements.clearTag.addEventListener('click', () => {
            this.elements.tagFilter.value = '';
            this.debounceFilter();
        });

        // Action buttons
        this.elements.autoScrollBtn.addEventListener('click', () => this.toggleAutoScroll());
        this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        this.elements.exportLogsBtn.addEventListener('click', () => this.exportLogs());
        this.elements.pauseBtn.addEventListener('click', () => this.togglePause());
        this.elements.scrollBottomBtn.addEventListener('click', () => this.scrollToBottom());

        // Scroll detection
        this.elements.logsViewport.addEventListener('scroll', () => this.handleScroll());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Window events
        window.addEventListener('beforeunload', () => this.cleanup());

        // Add manual retry functionality
        document.addEventListener('click', (e) => {
            if (e.target.id === 'status-text' && this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.retryConnection();
            }
        });
    }

    debounceFilter() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.filterAndDisplayLogs();
        }, 300);
    }

    subscribeToLogs() {
        // Clear any existing reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.updateConnectionStatus('connecting', `Connecting to '${this.currentChannel}'...`);
        this.isReconnecting = false;

        const url = `/api/subscribe?channels=${encodeURIComponent(this.currentChannel)}`;
        this.eventSource = new EventSource(url);

        this.eventSource.onopen = () => {
            console.log(`Connected to '${this.currentChannel}' channel`);
            this.updateConnectionStatus('connected', `Connected to '${this.currentChannel}'`);

            // Reset channel connect button
            this.elements.channelConnectBtn.disabled = false;
            this.elements.channelConnectBtn.textContent = '🔗';
            this.elements.channelConnectBtn.title = 'Connect to channel';

            // Reset reconnection attempts on successful connection
            this.reconnectAttempts = 0;
        };

        this.eventSource.onmessage = (event) => {
            try {
                const eventPayload = JSON.parse(event.data);
                if (eventPayload.data && eventPayload.data.tags && eventPayload.data.data && eventPayload.data.type) {
                    this.receiveLog(eventPayload.data);
                }
            } catch (error) {
                console.error('Error parsing event data:', error);
            }
        };

        this.eventSource.onerror = (event) => {
            console.error('Error occurred with EventSource:', event);

            // Close the current connection
            if (this.eventSource) {
                this.eventSource.close();
            }

            this.attemptReconnect();
        };
    }

    attemptReconnect() {
        // Don't attempt reconnect if already reconnecting or max attempts reached
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.updateConnectionStatus('failed', 'Connection failed - Click to retry');
            }
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        // Calculate delay with exponential backoff
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        const nextAttemptTime = Math.ceil(delay / 1000);
        this.updateConnectionStatus('reconnecting',
            `Reconnecting to '${this.currentChannel}'... (${this.reconnectAttempts}/${this.maxReconnectAttempts}) - ${nextAttemptTime}s`);

        console.log(`Attempting reconnect #${this.reconnectAttempts} in ${delay}ms`);

        // Start countdown timer for visual feedback
        this.startReconnectCountdown(nextAttemptTime);

        this.reconnectTimer = setTimeout(() => {
            console.log(`Reconnection attempt #${this.reconnectAttempts}`);
            this.subscribeToLogs();
        }, delay);
    }

    startReconnectCountdown(seconds) {
        let remainingSeconds = seconds;

        const countdownInterval = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds > 0 && this.isReconnecting) {
                this.updateConnectionStatus('reconnecting',
                    `Reconnecting to '${this.currentChannel}'... (${this.reconnectAttempts}/${this.maxReconnectAttempts}) - ${remainingSeconds}s`);
            } else {
                clearInterval(countdownInterval);
            }
        }, 1000);
    }

    retryConnection() {
        console.log('Manual retry requested');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.subscribeToLogs();
    }

    switchChannel() {
        const newChannel = this.elements.channelSelector.value.trim();

        if (!newChannel) {
            alert('Please enter a channel name');
            return;
        }

        if (newChannel === this.currentChannel) {
            console.log(`Already connected to '${newChannel}' channel`);
            return;
        }

        console.log(`Switching from '${this.currentChannel}' to '${newChannel}' channel`);

        // Show loading state
        this.elements.channelConnectBtn.disabled = true;
        this.elements.channelConnectBtn.textContent = '⏳';
        this.elements.channelConnectBtn.title = 'Switching channel...';

        // Close current connection
        if (this.eventSource) {
            this.eventSource.close();
        }

        // Clear reconnection state
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Reset state for new channel
        this.currentChannel = newChannel;
        this.channelHistory.add(newChannel); // Add to history
        this.saveChannelHistory();
        this.updateChannelHistoryDropdown();
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        // Clear logs for new channel
        this.logs = [];
        this.filteredLogs = [];
        this.pendingLogs = [];
        this.elements.logsContent.innerHTML = '';
        this.updateStats();
        this.elements.noLogsMessage.classList.remove('hidden');

        // Start new subscription
        this.subscribeToLogs();
    }

    updateChannelHistoryDropdown() {
        // Clear existing options
        this.elements.channelHistory.innerHTML = '';

        // Add all channels from history
        Array.from(this.channelHistory).sort().forEach(channel => {
            const option = document.createElement('option');
            option.value = channel;
            this.elements.channelHistory.appendChild(option);
        });
    }

    receiveLog(log) {
        // Add timestamp if not present
        if (!log.timestamp) {
            log.timestamp = new Date().toISOString();
        }

        // Add unique ID for performance
        log.id = Date.now() + Math.random();

        if (this.isPaused) {
            this.pendingLogs.push(log);
            this.updatePauseButton();
            return;
        }

        // Maintain log limit
        if (this.logs.length >= this.MAX_LOGS) {
            this.logs.shift();
        }

        this.logs.push(log);
        this.updateStats();

        // Only re-filter if the new log matches current filters
        if (this.matchesFilters(log)) {
            this.addLogToDOM(log, true);

            // Auto-scroll if enabled and user is at bottom
            if (this.isAutoScroll && this.isScrolledToBottom()) {
                this.scrollToBottom();
            } else if (!this.isScrolledToBottom()) {
                this.showScrollToBottomButton();
            }
        }
    }

    matchesFilters(log) {
        const keywordFilter = this.elements.keywordFilter.value.toLowerCase();
        const tagFilter = this.elements.tagFilter.value.toLowerCase();
        const typeFilter = this.elements.typeFilter.value;

        // Keyword filter
        if (keywordFilter && !log.data.toLowerCase().includes(keywordFilter)) {
            return false;
        }

        // Tag filter
        if (tagFilter && !log.tags.some(tag => tag.toLowerCase().includes(tagFilter))) {
            return false;
        }

        // Type filter
        if (typeFilter && log.type !== typeFilter) {
            return false;
        }

        return true;
    }

    filterAndDisplayLogs() {
        this.filteredLogs = this.logs.filter(log => this.matchesFilters(log));
        this.displayLogs();
        this.updateStats();
    }

    displayLogs() {
        const fragment = document.createDocumentFragment();

        if (this.filteredLogs.length === 0) {
            this.elements.noLogsMessage.classList.remove('hidden');
            this.elements.logsContent.innerHTML = '';
            return;
        }

        this.elements.noLogsMessage.classList.add('hidden');

        // Use virtual scrolling for better performance with large lists
        this.filteredLogs.forEach(log => {
            const logElement = this.createLogElement(log);
            fragment.appendChild(logElement);
        });

        this.elements.logsContent.innerHTML = '';
        this.elements.logsContent.appendChild(fragment);

        if (this.isAutoScroll) {
            this.scrollToBottom();
        }
    }

    addLogToDOM(log, isNew = false) {
        if (!this.matchesFilters(log)) return;

        const logElement = this.createLogElement(log, isNew);
        this.elements.logsContent.appendChild(logElement);
        this.filteredLogs.push(log);

        // Remove animation class after animation completes
        if (isNew) {
            setTimeout(() => {
                logElement.classList.remove('new-log');
            }, 300);
        }
    }

    createLogElement(log, isNew = false) {
        const logItem = document.createElement('div');
        logItem.className = `log-item${isNew ? ' new-log' : ''}`;
        logItem.dataset.logId = log.id;

        const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A';
        const typeClass = log.type.replace(' ', '-');

        // Create tags HTML
        const tagsHTML = log.tags.map(tag =>
            `<span class="log-tag">${this.escapeHtml(tag)}</span>`
        ).join('');

        // Handle JSON formatting
        let dataDisplay = this.escapeHtml(log.data);
        if (log.type === 'json') {
            try {
                const jsonData = typeof log.data === 'string' ? JSON.parse(log.data) : log.data;
                dataDisplay = `<pre>${this.escapeHtml(JSON.stringify(jsonData, null, 2))}</pre>`;
            } catch (e) {
                dataDisplay = this.escapeHtml(log.data);
            }
        }

        logItem.innerHTML = `
            <div class="log-header">
                <span class="log-timestamp">${timestamp}</span>
                <span class="log-type ${typeClass}">${log.type}</span>
            </div>
            <div class="log-tags">${tagsHTML}</div>
            <div class="log-data">${dataDisplay}</div>
        `;

        return logItem;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateConnectionStatus(status, text) {
        this.elements.connectionStatus.className = `status-${status}`;
        this.elements.statusText.textContent = text;
    }

    updateStats() {
        // this.elements.totalLogs.textContent = this.logs.length.toLocaleString();
        // this.elements.visibleLogs.textContent = (this.filteredLogs.length || this.logs.length).toLocaleString();
    }

    toggleAutoScroll() {
        this.isAutoScroll = !this.isAutoScroll;
        this.elements.autoScrollBtn.classList.toggle('active', this.isAutoScroll);

        if (this.isAutoScroll) {
            this.scrollToBottom();
            this.hideScrollToBottomButton();
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        this.updatePauseButton();

        if (!this.isPaused && this.pendingLogs.length > 0) {
            // Process pending logs
            this.pendingLogs.forEach(log => this.receiveLog(log));
            this.pendingLogs = [];
        }
    }

    updatePauseButton() {
            const btn = this.elements.pauseBtn;
            if (this.isPaused) {
                btn.textContent = `▶️ Resume${this.pendingLogs.length > 0 ? ` (${this.pendingLogs.length})` : ''}`;
            btn.classList.add('active');
        } else {
            btn.textContent = '⏸️ Pause';
            btn.classList.remove('active');
        }
    }
    
    clearLogs() {
        if (confirm('Are you sure you want to clear all logs?')) {
            this.logs = [];
            this.filteredLogs = [];
            this.pendingLogs = [];
            this.elements.logsContent.innerHTML = '';
            this.updateStats();
            this.elements.noLogsMessage.classList.remove('hidden');
        }
    }
    
    exportLogs() {
        const data = this.filteredLogs.length > 0 ? this.filteredLogs : this.logs;
        const jsonData = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `logs_${new Date().toISOString().slice(0, 19)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    scrollToBottom() {
        this.elements.logsViewport.scrollTop = this.elements.logsViewport.scrollHeight;
        this.hideScrollToBottomButton();
    }
    
    isScrolledToBottom() {
        const viewport = this.elements.logsViewport;
        return viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 50;
    }
    
    showScrollToBottomButton() {
        this.elements.scrollToBottom.classList.remove('hidden');
    }
    
    hideScrollToBottomButton() {
        this.elements.scrollToBottom.classList.add('hidden');
    }
    
    handleScroll() {
        if (this.isScrolledToBottom()) {
            this.hideScrollToBottomButton();
        }
    }
    
    handleKeyboard(e) {
        // Ctrl/Cmd + K: Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            this.elements.keywordFilter.focus();
        }
        
        // Ctrl/Cmd + Shift + C: Focus channel selector
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
            e.preventDefault();
            this.elements.channelSelector.focus();
        }
        
        // Ctrl/Cmd + L: Clear logs
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            this.clearLogs();
        }
        
        // Ctrl/Cmd + E: Export logs
        if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            this.exportLogs();
        }
        
        // Space: Toggle pause (when not in input)
        if (e.key === ' ' && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
            e.preventDefault();
            this.togglePause();
        }
        
        // End: Scroll to bottom
        if (e.key === 'End') {
            e.preventDefault();
            this.scrollToBottom();
        }
    }
    
    cleanup() {
        if (this.eventSource) {
            this.eventSource.close();
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        clearTimeout(this.debounceTimer);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LogViewer();
});