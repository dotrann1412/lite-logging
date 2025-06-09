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
        this.maxReconnectAttempts = 32;
        this.baseReconnectDelay = 1000; // 1 second
        this.maxReconnectDelay = 30000; // 30 seconds
        this.reconnectTimer = null;
        this.connectionTimeoutTimer = null; // Manual timeout for connections
        this.isReconnecting = false;

        // Channel management
        this.currentChannel = this.loadCurrentChannel(); // Load saved channel or default to 'logs'
        this.channelHistory = this.loadChannelHistory(); // Keep track of channels used
        this.channelHistory.add(this.currentChannel); // Ensure current channel is in history

        // Log display settings
        this.maxPreviewLength = 200; // Maximum characters to show in collapsed state

        // Mouse interaction tracking
        this.mouseDownData = null;

        // Local storage settings
        this.maxStoredLogsPerChannel = 1000; // Maximum logs to store per channel
        this.storageKeyPrefix = 'logViewer_logs_';
        this.saveTimer = null; // Debounce timer for saving

        // DOM elements
        this.elements = {};

        // Initialize the application
        this.init();
    }

    loadCurrentChannel() {
        try {
            const saved = localStorage.getItem('logViewer_currentChannel');
            const channel = saved || 'default';
            console.log(`Loading saved channel: ${channel}`);
            return channel;
        } catch (error) {
            console.warn('Failed to load current channel:', error);
            return 'default';
        }
    }

    saveCurrentChannel() {
        try {
            localStorage.setItem('logViewer_currentChannel', this.currentChannel);
            console.log(`Saved current channel: ${this.currentChannel}`);
        } catch (error) {
            console.warn('Failed to save current channel:', error);
        }
    }

    loadChannelHistory() {
        try {
            const saved = localStorage.getItem('logViewer_channelHistory');
            const history = saved ? new Set(JSON.parse(saved)) : new Set(['default']);
            return history;
        } catch (error) {
            console.warn('Failed to load channel history:', error);
            return new Set(['default']);
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
        this.setChannelSelectorValue(); // Set the channel selector to the saved channel
        this.updateChannelHistoryDropdown();
        this.loadStoredLogs(); // Load stored logs before subscribing
        this.updateStats();
        this.subscribeToLogs();
    }

    setChannelSelectorValue() {
        // Set the channel selector input to match the current channel
        if (this.elements.channelSelector) {
            this.elements.channelSelector.value = this.currentChannel;
            console.log(`Set channel selector to: ${this.currentChannel}`);
        }
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

            // Help elements
            helpBtn: document.getElementById('help-btn'),
            helpModal: document.getElementById('help-modal'),
            closeHelp: document.getElementById('close-help'),

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

        // Help modal
        this.elements.helpBtn.addEventListener('click', () => this.showHelp());
        this.elements.closeHelp.addEventListener('click', () => this.hideHelp());
        this.elements.helpModal.addEventListener('click', (e) => {
            if (e.target === this.elements.helpModal) {
                this.hideHelp();
            }
        });

        // Copy button functionality
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('copy-btn')) {
                this.handleCopyButton(e.target);
            }
        });

        // Scroll detection
        this.elements.logsViewport.addEventListener('scroll', () => this.handleScroll());

        // Log expansion handling - use mousedown/mouseup to distinguish clicks from text selection
        this.elements.logsContent.addEventListener('mousedown', (e) => this.handleLogMouseDown(e));
        this.elements.logsContent.addEventListener('mouseup', (e) => this.handleLogMouseUp(e));

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

        // Clear any existing connection timeout
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }

        this.updateConnectionStatus('connecting', `Connecting to '${this.currentChannel}'...`);
        this.isReconnecting = false;

        const url = `/api/subscribe?channels=${encodeURIComponent(this.currentChannel)}`;

        // Create EventSource with proper constructor (no timeout parameter)
        this.eventSource = new EventSource(url);

        // Implement connection timeout manually (5 seconds)
        this.connectionTimeoutTimer = setTimeout(() => {
            console.warn('Connection timeout after 5 seconds');
            if (this.eventSource && this.eventSource.readyState === EventSource.CONNECTING) {
                this.eventSource.close();
                this.attemptReconnect();
            }
        }, 5000);

        this.eventSource.onopen = () => {
            console.log(`Connected to '${this.currentChannel}' channel`);
            this.updateConnectionStatus('connected', `Connected to '${this.currentChannel}'`);

            // Clear connection timeout since we're now connected
            if (this.connectionTimeoutTimer) {
                clearTimeout(this.connectionTimeoutTimer);
                this.connectionTimeoutTimer = null;
            }

            // Reset channel connect button
            this.elements.channelConnectBtn.disabled = false;
            this.elements.channelConnectBtn.textContent = '🔗';
            this.elements.channelConnectBtn.title = 'Connect to channel';

            // Hide loading indicator now that we're connected
            this.elements.loadingIndicator.classList.add('hidden');

            // If no logs are displayed, show empty message
            if (this.logs.length === 0) {
                this.elements.noLogsMessage.classList.remove('hidden');
            }

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

            // Clear connection timeout if it's still running
            if (this.connectionTimeoutTimer) {
                clearTimeout(this.connectionTimeoutTimer);
                this.connectionTimeoutTimer = null;
            }

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

        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
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

        const oldChannel = this.currentChannel;
        console.log(`Switching from '${oldChannel}' to '${newChannel}' channel`);

        // Show loading state
        this.elements.channelConnectBtn.disabled = true;
        this.elements.channelConnectBtn.textContent = '⏳';
        this.elements.channelConnectBtn.title = 'Switching channel...';

        console.log(`Starting channel switch process...`);

        // Close current connection
        if (this.eventSource) {
            this.eventSource.close();
        }

        // Clear reconnection state
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }

        // Save current channel logs BEFORE changing currentChannel
        if (this.logs.length > 0) {
            console.log(`Saving ${this.logs.length} logs for old channel '${oldChannel}'`);
            this.saveLogsToStorage(oldChannel);
        }

        // Completely clear all current state and UI BEFORE changing currentChannel
        console.log(`Clearing UI and state for old channel '${oldChannel}'`);
        this.clearCurrentChannelState(oldChannel);

        // NOW update to the new channel
        this.currentChannel = newChannel;
        this.channelHistory.add(newChannel); // Add to history
        this.saveChannelHistory();
        this.saveCurrentChannel(); // Save the current channel for persistence
        this.updateChannelHistoryDropdown();
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        // Wait a moment to ensure DOM is cleared
        setTimeout(() => {
            console.log(`DOM children after clear: ${this.elements.logsContent.children.length}`);

            // Load stored logs for new channel
            console.log(`Loading stored logs for new channel '${newChannel}'`);
            this.loadStoredLogs();

            // Start new subscription
            console.log(`Starting subscription for channel '${newChannel}'`);
            this.subscribeToLogs();

            console.log(`Channel switch to '${newChannel}' completed`);
        }, 50); // Small delay to ensure DOM operations complete
    }

    loadStoredLogs() {
        try {
            const storageKey = this.storageKeyPrefix + this.currentChannel;
            const storedData = localStorage.getItem(storageKey);

            if (storedData) {
                const storedLogs = JSON.parse(storedData);
                console.log(`Loading ${storedLogs.length} stored logs for channel '${this.currentChannel}'`);

                // Load stored logs
                this.logs = storedLogs;
                console.log(`Loaded ${storedLogs.length} logs into memory for channel '${this.currentChannel}'`);

                // Hide loading indicator
                this.elements.loadingIndicator.classList.add('hidden');

                // Update display - this should show only the stored logs for this channel
                this.filterAndDisplayLogs();
                this.updateStats();

                // Auto-scroll to bottom to show most recent
                if (this.isAutoScroll) {
                    setTimeout(() => this.scrollToBottom(), 100);
                }

                console.log(`Successfully loaded and displayed ${storedLogs.length} stored logs`);
            } else {
                console.log(`No stored logs found for channel '${this.currentChannel}'`);

                // Hide loading indicator and show empty state
                this.elements.loadingIndicator.classList.add('hidden');
                this.elements.noLogsMessage.classList.remove('hidden');
            }
        } catch (error) {
            console.warn('Failed to load stored logs:', error);
            // Clear corrupted data
            try {
                localStorage.removeItem(this.storageKeyPrefix + this.currentChannel);
            } catch (e) {
                console.warn('Failed to clear corrupted storage:', e);
            }
        }
    }

    saveLogsToStorage(channelName = this.currentChannel) {
        try {
            const storageKey = this.storageKeyPrefix + channelName;

            // Only store the most recent logs up to the limit
            const logsToStore = this.logs.slice(-this.maxStoredLogsPerChannel);

            localStorage.setItem(storageKey, JSON.stringify(logsToStore));
            console.log(`Saved ${logsToStore.length} logs for channel '${channelName}' using key '${storageKey}' (${this.getStorageSizeForChannel(channelName)} KB)`);
        } catch (error) {
            console.warn('Failed to save logs to storage:', error);

            // If storage is full, try to clear some old channel data
            if (error.name === 'QuotaExceededError') {
                this.cleanupOldStoredLogs();
            }
        }
    }

    cleanupOldStoredLogs() {
        try {
            console.log('Storage quota exceeded, cleaning up old logs...');

            // Get all log storage keys
            const logKeys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.storageKeyPrefix)) {
                    logKeys.push(key);
                }
            }

            // Sort by last access (if available) or remove oldest channels first
            // For now, we'll remove channels not in current history
            const currentChannels = Array.from(this.channelHistory);

            logKeys.forEach(key => {
                const channel = key.replace(this.storageKeyPrefix, '');
                if (!currentChannels.includes(channel)) {
                    localStorage.removeItem(key);
                    console.log(`Removed old logs for unused channel: ${channel}`);
                }
            });

            // Try to save again
            this.saveLogsToStorage();
        } catch (error) {
            console.warn('Failed to cleanup old logs:', error);
        }
    }

    debounceSaveToStorage() {
        // Clear existing timer
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }

        // Set new timer to save after 2 seconds of inactivity
        this.saveTimer = setTimeout(() => {
            this.saveLogsToStorage();
        }, 2000);
    }

    getStorageSizeForChannel(channel) {
        try {
            const storageKey = this.storageKeyPrefix + channel;
            const data = localStorage.getItem(storageKey);
            return data ? Math.round(data.length / 1024) : 0;
        } catch (error) {
            return 0;
        }
    }

    getTotalStorageInfo() {
        try {
            let totalSize = 0;
            let logChannels = 0;

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(this.storageKeyPrefix)) {
                    const data = localStorage.getItem(key);
                    if (data) {
                        totalSize += data.length;
                        logChannels++;
                    }
                }
            }

            return {
                totalSizeKB: Math.round(totalSize / 1024),
                logChannels: logChannels
            };
        } catch (error) {
            return { totalSizeKB: 0, logChannels: 0 };
        }
    }

    showStorageInfo() {
        const info = this.getTotalStorageInfo();
        const currentChannelSize = this.getStorageSizeForChannel(this.currentChannel);

        const message = `Local Storage Info:
        
Current Channel: ${this.currentChannel} (persisted)
- Stored logs: ${this.logs.length}
- Storage size: ${currentChannelSize} KB

Total:
- Channels with stored logs: ${info.logChannels}
- Total storage used: ${info.totalSizeKB} KB
- Max logs per channel: ${this.maxStoredLogsPerChannel}

Persistence:
- Current channel will be restored on reload
- Channel history is preserved

Keyboard Shortcuts:
- F1 or Ctrl+H: Show help instructions
- Ctrl+E: Export current logs
- Ctrl+L: Clear current channel logs
- Ctrl+Shift+Delete: Clear ALL storage data ⚠️`;

        alert(message);
    }

    clearAllStorageData() {
        const info = this.getTotalStorageInfo();

        const confirmMessage = `⚠️ CLEAR ALL STORAGE DATA ⚠️

This will permanently delete:
- All stored logs for ${info.logChannels} channels
- Channel history (${Array.from(this.channelHistory).join(', ')})
- Current channel preference
- Total data: ${info.totalSizeKB} KB

Current session data will also be cleared.
This action cannot be undone.

Are you sure you want to continue?`;

        if (!confirm(confirmMessage)) {
            console.log('Clear all storage cancelled by user');
            return;
        }

        console.log('🗑️ Starting complete storage cleanup...');

        try {
            // Get all storage keys related to log viewer
            const keysToRemove = [];

            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (
                        key.startsWith(this.storageKeyPrefix) ||
                        key === 'logViewer_channelHistory' ||
                        key === 'logViewer_currentChannel'
                    )) {
                    keysToRemove.push(key);
                }
            }

            console.log(`Found ${keysToRemove.length} storage keys to remove:`, keysToRemove);

            // Remove all found keys
            keysToRemove.forEach(key => {
                localStorage.removeItem(key);
                console.log(`Removed: ${key}`);
            });

            // Reset application state
            this.resetApplicationState();

            console.log('✅ All storage data cleared successfully');
            alert(`Storage cleanup complete!\n\n- Removed ${keysToRemove.length} storage items\n- Application state reset\n- Redirecting to default channel 'logs'`);

        } catch (error) {
            console.error('Failed to clear storage data:', error);
            alert('Failed to clear storage data. Check console for details.');
        }
    }

    resetApplicationState() {
        console.log('Resetting application state to defaults...');

        // Close current connection
        if (this.eventSource) {
            this.eventSource.close();
        }

        // Clear all timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
        }
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Reset to defaults
        this.currentChannel = 'default';
        this.channelHistory = new Set(['default']);
        this.logs = [];
        this.filteredLogs = [];
        this.pendingLogs = [];
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.isPaused = false;

        // Reset UI elements
        this.elements.channelSelector.value = 'default';
        this.elements.logsContent.innerHTML = '';
        this.elements.noLogsMessage.classList.remove('hidden');
        this.elements.loadingIndicator.classList.add('hidden');
        this.hideScrollToBottomButton();

        // Update UI components
        this.updateChannelHistoryDropdown();
        this.updateStats();
        this.updatePauseButton();

        // Reset connection status
        this.updateConnectionStatus('disconnected', 'Disconnected');
        this.elements.channelConnectBtn.disabled = false;
        this.elements.channelConnectBtn.textContent = '🔗';
        this.elements.channelConnectBtn.title = 'Connect to channel';

        // Start fresh connection to default channel
        setTimeout(() => {
            console.log('Starting fresh connection to default channel...');
            this.subscribeToLogs();
        }, 500);

        console.log('Application state reset complete');
    }

    showHelp() {
        console.log('Showing help modal');
        this.updateHelpContent(); // Update dynamic content
        this.elements.helpModal.classList.remove('hidden');
        // Focus the close button for accessibility
        setTimeout(() => {
            this.elements.closeHelp.focus();
        }, 100);
    }

    hideHelp() {
        console.log('Hiding help modal');
        this.elements.helpModal.classList.add('hidden');
        // Return focus to help button
        this.elements.helpBtn.focus();
    }

    updateHelpContent() {
        // Update current server info
        const serverUrl = window.location.origin;
        const currentChannel = this.currentChannel;
        const connectionStatus = this.elements.statusText.textContent;

        // Update server info elements
        const serverUrlElement = document.getElementById('current-server-url');
        const channelElement = document.getElementById('current-channel-name');
        const statusElement = document.getElementById('current-connection-status');

        if (serverUrlElement) serverUrlElement.textContent = serverUrl;
        if (channelElement) channelElement.textContent = currentChannel;
        if (statusElement) statusElement.textContent = connectionStatus;

        // Update usage example with current channel and server
        const usageExample = document.getElementById('usage-example');
        if (usageExample) {
            const exampleCode = this.generateUsageExample(serverUrl, currentChannel);
            usageExample.textContent = exampleCode;
        }
    }

    generateUsageExample(serverUrl, channel) {
        return `import asyncio
from lite_logging import async_log, sync_log, ContentType

# Set server URL (optional - defaults to localhost:8080)
import os
os.environ["LITE_LOGGING_BASE_URL"] = "${serverUrl}"

# Synchronous logging to current channel
sync_log("Hello from Python!", 
         tags=["python", "example"], 
         channel="${channel}")

# Asynchronous logging with JSON content
async def main():
    await async_log(
        {"message": "Structured log", "level": "info", "timestamp": "2024-01-01T12:00:00Z"},
        tags=["json", "structured"],
        channel="${channel}",
        content_type=ContentType.JSON
    )

# Run async example
asyncio.run(main())

# Different content types
sync_log("Plain text message", channel="${channel}")
sync_log('{"key": "value"}', channel="${channel}", content_type=ContentType.JSON)

# Different channels
sync_log("Error occurred!", tags=["error"], channel="errors")
sync_log("Debug info", tags=["debug"], channel="debug")`;
    }

    async handleCopyButton(button) {
        const copyType = button.dataset.copy;
        let textToCopy = '';

        if (copyType === 'install') {
            textToCopy = document.getElementById('install-command').textContent;
        } else if (copyType === 'usage') {
            textToCopy = document.getElementById('usage-example').textContent;
        }

        try {
            await navigator.clipboard.writeText(textToCopy);

            // Show success feedback
            const originalText = button.textContent;
            button.textContent = '✅';
            button.classList.add('copied');

            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);

            console.log('Text copied to clipboard');
        } catch (error) {
            console.warn('Failed to copy text:', error);

            // Fallback for older browsers
            try {
                const textArea = document.createElement('textarea');
                textArea.value = textToCopy;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);

                // Show success feedback
                const originalText = button.textContent;
                button.textContent = '✅';
                button.classList.add('copied');

                setTimeout(() => {
                    button.textContent = originalText;
                    button.classList.remove('copied');
                }, 2000);

                console.log('Text copied to clipboard (fallback)');
            } catch (fallbackError) {
                console.error('Copy failed:', fallbackError);
                button.textContent = '❌';
                setTimeout(() => {
                    button.textContent = '📋';
                }, 1000);
            }
        }
    }

    clearCurrentChannelState(channelName = this.currentChannel) {
        console.log(`Clearing all state for channel '${channelName}'`);

        // Clear all log arrays
        this.logs = [];
        this.filteredLogs = [];
        this.pendingLogs = [];

        // Force clear the UI completely - multiple approaches to ensure it works
        this.elements.logsContent.innerHTML = '';
        this.elements.logsContent.textContent = ''; // Backup clear

        // Remove all child nodes as additional safety
        while (this.elements.logsContent.firstChild) {
            this.elements.logsContent.removeChild(this.elements.logsContent.firstChild);
        }

        // Hide scroll-to-bottom button
        this.hideScrollToBottomButton();

        // Show loading state and hide other states
        this.elements.noLogsMessage.classList.add('hidden');
        this.elements.loadingIndicator.classList.remove('hidden');

        // Update stats to show 0
        this.updateStats();

        // Reset pause button if needed
        if (this.isPaused) {
            this.isPaused = false;
            this.updatePauseButton();
        }

        // Force a DOM reflow to ensure changes are applied
        this.elements.logsContent.offsetHeight;

        console.log(`Channel state cleared successfully for '${channelName}'. DOM children count: ${this.elements.logsContent.children.length}`);
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
        console.log(`Received log for channel '${this.currentChannel}':`, log.data.substring(0, 100) + '...');

        // Add timestamp if not present
        if (!log.timestamp) {
            log.timestamp = new Date().toISOString();
        }

        // Add unique ID for performance
        log.id = Date.now() + Math.random();

        // Add channel identifier to log for debugging
        log.receivedForChannel = this.currentChannel;

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

        // Hide empty message since we now have logs
        this.elements.noLogsMessage.classList.add('hidden');

        // Save logs to storage (debounced to avoid too frequent saves)
        this.debounceSaveToStorage();

        // Only re-filter if the new log matches current filters
        if (this.matchesFilters(log)) {
            console.log(`Adding log to DOM for channel '${this.currentChannel}'`);
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
        console.log(`Displaying ${this.filteredLogs.length} filtered logs for channel '${this.currentChannel}'`);

        // Always clear content first with multiple methods
        this.elements.logsContent.innerHTML = '';
        this.elements.logsContent.textContent = '';

        // Remove any remaining child nodes
        while (this.elements.logsContent.firstChild) {
            this.elements.logsContent.removeChild(this.elements.logsContent.firstChild);
        }

        if (this.filteredLogs.length === 0) {
            this.elements.noLogsMessage.classList.remove('hidden');
            console.log('No filtered logs to display, showing empty message');
            return;
        }

        this.elements.noLogsMessage.classList.add('hidden');

        // Create document fragment for efficient DOM manipulation
        const fragment = document.createDocumentFragment();

        // Use virtual scrolling for better performance with large lists
        this.filteredLogs.forEach((log, index) => {
            const logElement = this.createLogElement(log);
            fragment.appendChild(logElement);
        });

        // Append all logs at once
        this.elements.logsContent.appendChild(fragment);

        console.log(`Successfully displayed ${this.filteredLogs.length} logs. DOM children count: ${this.elements.logsContent.children.length}`);

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

            // Prepare both preview and full content
            const { previewData, fullData, isTruncated } = this.prepareLogContent(log);

            // Add expandable class if content is truncated
            if (isTruncated) {
                logItem.classList.add('expandable');
                logItem.setAttribute('tabindex', '0'); // Make focusable for keyboard navigation
                logItem.setAttribute('title', 'Click to expand/collapse log content');
            }
            const expandIcon = isTruncated ? '<span class="expand-icon" hidden title="Click to expand">▶</span>' : '';

            logItem.innerHTML = `
            <div class="log-header">
                <span class="log-timestamp">${timestamp}</span>
                <span class="log-type ${typeClass}">${log.type}</span>
                ${expandIcon}
            </div>
            <div class="log-tags">${tagsHTML}</div>
            <div class="log-data">
                <div class="log-preview">${previewData}</div>
                ${isTruncated ? `<div class="log-full hidden">${fullData}</div>` : ''}
            </div>
        `;

        return logItem;
    }

    prepareLogContent(log) {
        let rawData = log.data;
        let fullData, previewData;
        let isTruncated = false;

        // Handle JSON formatting
        if (log.type === 'json') {
            try {
                const jsonData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                // Full content with beautiful formatting
                fullData = `<pre class="json-formatted">${this.escapeHtml(JSON.stringify(jsonData, null, 2))}</pre>`;
                
                // Preview content (minified)
                const minified = JSON.stringify(jsonData);
                if (minified.length > this.maxPreviewLength) {
                    previewData = this.escapeHtml(minified.substring(0, this.maxPreviewLength) + '...');
                    isTruncated = true;
                } else {
                    previewData = this.escapeHtml(minified);
                }
            } catch (e) {
                // If JSON parsing fails, treat as plain text
                rawData = log.data;
                fullData = this.escapeHtml(rawData);
                if (rawData.length > this.maxPreviewLength) {
                    previewData = this.escapeHtml(rawData.substring(0, this.maxPreviewLength) + '...');
                    isTruncated = true;
                } else {
                    previewData = this.escapeHtml(rawData);
                }
            }
        } else {
            // Plain text content
            fullData = `<div class="text-formatted">${this.escapeHtml(rawData)}</div>`;
            if (rawData.length > this.maxPreviewLength) {
                previewData = this.escapeHtml(rawData.substring(0, this.maxPreviewLength) + '...');
                isTruncated = true;
            } else {
                previewData = this.escapeHtml(rawData);
            }
        }

        return { previewData, fullData, isTruncated };
    }

    handleLogMouseDown(e) {
        const logItem = e.target.closest('.log-item');
        if (!logItem || !logItem.classList.contains('expandable')) return;

        // Store mouse down information
        this.mouseDownData = {
            logItem: logItem,
            target: e.target,
            clientX: e.clientX,
            clientY: e.clientY,
            time: Date.now()
        };
    }

    handleLogMouseUp(e) {
        // Check if we have mouse down data
        if (!this.mouseDownData) return;

        const logItem = e.target.closest('.log-item');
        
        // Must be the same log item
        if (logItem !== this.mouseDownData.logItem) {
            this.mouseDownData = null;
            return;
        }

        // Check if this was a text selection (mouse moved significantly or text is selected)
        const hasTextSelection = window.getSelection().toString().length > 0;
        const mouseMoved = Math.abs(e.clientX - this.mouseDownData.clientX) > 5 || 
                          Math.abs(e.clientY - this.mouseDownData.clientY) > 5;
        const timeDiff = Date.now() - this.mouseDownData.time;

        // Don't toggle if:
        // 1. Text is selected
        // 2. Mouse moved significantly (dragging)
        // 3. Click was too long (likely text selection)
        // 4. Target is in expanded content area (allow text selection)
        const isExpandedContent = e.target.closest('.log-full');
        
        if (hasTextSelection || mouseMoved || timeDiff > 500 || isExpandedContent) {
            this.mouseDownData = null;
            return;
        }

        // Only toggle if clicking on header area or preview content
        const isClickableArea = e.target.closest('.log-header') || 
                               e.target.closest('.log-preview') ||
                               e.target.classList.contains('log-item');

        if (isClickableArea) {
            e.preventDefault();
            this.toggleLogExpansion(logItem);
        }

        this.mouseDownData = null;
    }

    toggleLogExpansion(logItem) {
        const expandIcon = logItem.querySelector('.expand-icon');
        const preview = logItem.querySelector('.log-preview');
        const full = logItem.querySelector('.log-full');

        if (!expandIcon || !preview || !full) return;

        // Clear any text selection when toggling
        if (window.getSelection) {
            window.getSelection().removeAllRanges();
        }

        const isExpanded = logItem.classList.contains('expanded');

        if (isExpanded) {
            // Collapse
            logItem.classList.remove('expanded');
            expandIcon.textContent = '▶';
            expandIcon.title = 'Click to expand';
            preview.classList.remove('hidden');
            full.classList.add('hidden');
            logItem.setAttribute('title', 'Click to expand log content');
        } else {
            // Expand
            logItem.classList.add('expanded');
            expandIcon.textContent = '▼';
            expandIcon.title = 'Click to collapse';
            preview.classList.add('hidden');
            full.classList.remove('hidden');
            logItem.setAttribute('title', 'Click to collapse log content');
        }
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
        if (confirm('Are you sure you want to clear all logs? This will also remove stored logs for this channel.')) {
            this.logs = [];
            this.filteredLogs = [];
            this.pendingLogs = [];
            this.elements.logsContent.innerHTML = '';
            this.updateStats();
            this.elements.noLogsMessage.classList.remove('hidden');
            
            // Clear stored logs for current channel
            try {
                const storageKey = this.storageKeyPrefix + this.currentChannel;
                localStorage.removeItem(storageKey);
                console.log(`Cleared stored logs for channel '${this.currentChannel}'`);
            } catch (error) {
                console.warn('Failed to clear stored logs:', error);
            }
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
        
        // Ctrl/Cmd + I: Show storage info
        if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            this.showStorageInfo();
        }
        
        // Ctrl/Cmd + Shift + Delete: Clear all storage data
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Delete') {
            e.preventDefault();
            this.clearAllStorageData();
        }
        
        // F1 or Ctrl+H: Show help
        if (e.key === 'F1' || ((e.ctrlKey || e.metaKey) && e.key === 'h')) {
            e.preventDefault();
            this.showHelp();
        }
        
        // Escape: Close help modal
        if (e.key === 'Escape') {
            if (!this.elements.helpModal.classList.contains('hidden')) {
                e.preventDefault();
                this.hideHelp();
            }
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
        
        // Enter: Toggle expansion of focused log (when not in input)
        if (e.key === 'Enter' && !['INPUT', 'SELECT'].includes(e.target.tagName)) {
            const focusedLog = document.activeElement?.closest('.log-item.expandable');
            if (focusedLog) {
                e.preventDefault();
                this.toggleLogExpansion(focusedLog);
            }
        }
    }
    
    cleanup() {
        // Save logs before cleanup
        if (this.logs.length > 0) {
            this.saveLogsToStorage();
        }
        
        // Save current channel
        this.saveCurrentChannel();
        
        if (this.eventSource) {
            this.eventSource.close();
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
        }
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        clearTimeout(this.debounceTimer);
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new LogViewer();
});