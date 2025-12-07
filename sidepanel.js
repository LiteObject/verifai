// VerifAI Side Panel JavaScript
// Handles UI interactions and Ollama integration

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    // Ollama settings
    OLLAMA_ENDPOINT: 'http://localhost:11434',
    REQUEST_TIMEOUT: 120000, // 120 seconds for multi-step operations

    // Search settings
    MAX_SEARCH_ITERATIONS: 3,
    MAX_SEARCH_RESULTS: 7,

    // Retry settings
    MAX_RETRIES: 3,
    RETRY_BASE_DELAY: 1000, // Base delay in ms for exponential backoff

    // Cache settings
    TOOL_CACHE_DURATION: 3600000, // 1 hour in ms

    // Storage settings
    STORAGE_QUOTA_WARNING: 4 * 1024 * 1024, // Warn at 4MB (Chrome limit is ~5MB)

    // UI settings
    KEYBOARD_HINT_DELAY: 1000,
    KEYBOARD_HINT_DURATION: 3000,
    PENDING_CHECK_TIMEOUT: 30000 // 30 seconds
};

document.addEventListener('DOMContentLoaded', function () {
    // Apply theme based on system preference
    applyTheme();

    // DOM Elements
    const settingsButton = document.getElementById('btnSettings');
    const settingsPanel = document.getElementById('settingsPanel');
    const modelSelector = document.getElementById('modelSelector');
    const refreshModelsButton = document.getElementById('btnRefreshModels');
    const modelStatus = document.getElementById('modelStatus');
    const claimInput = document.getElementById('claimInput');
    const factCheckButton = document.getElementById('btnFactCheck');
    const clearButton = document.getElementById('btnClear');
    const copyButton = document.getElementById('btnCopy');
    const resultsContent = document.getElementById('resultsContent');
    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const keyboardHint = document.getElementById('keyboardHint');

    // State
    let selectedModel = '';
    let collectedSources = []; // Track sources from web searches
    let toolSupportCache = new Map(); // Cache for tool support checks with timestamps
    let pendingToolChecks = new Map(); // Track pending tool support checks to avoid duplicates
    let isFactChecking = false; // Prevent overlapping fact-check requests
    let abortController = null; // Track current request for cleanup

    // Web search tool definition for Ollama
    const WEB_SEARCH_TOOL = {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the web for current information to verify claims. Use this to find recent news, facts, statistics, or any information needed to fact-check a claim.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The search query to find relevant information for fact-checking"
                    }
                },
                required: ["query"]
            }
        }
    };

    // Event Listeners - Store references for cleanup
    const eventListeners = [];

    function addManagedEventListener(element, event, handler) {
        element.addEventListener(event, handler);
        eventListeners.push({ element, event, handler });
    }

    addManagedEventListener(settingsButton, 'click', toggleSettings);
    addManagedEventListener(refreshModelsButton, 'click', refreshModels);
    addManagedEventListener(modelSelector, 'change', handleModelSelection);
    addManagedEventListener(factCheckButton, 'click', handleFactCheck);
    addManagedEventListener(clearButton, 'click', handleClear);
    addManagedEventListener(copyButton, 'click', handleCopy);
    addManagedEventListener(document, 'keydown', handleKeyboardShortcuts);

    // Message listener reference for cleanup
    const messageListener = (message, sender, sendResponse) => {
        if (message.action === 'newFactCheck' && message.text) {
            claimInput.value = message.text;
            handleFactCheck();
            sendResponse({ success: true });
        }
        return true;
    };
    chrome.runtime.onMessage.addListener(messageListener);

    // Storage change listener reference for cleanup
    const storageListener = (changes, namespace) => {
        if (namespace === 'local' && changes.pendingFactCheck && changes.pendingFactCheck.newValue) {
            const { text, timestamp } = changes.pendingFactCheck.newValue;
            if (Date.now() - timestamp < CONFIG.PENDING_CHECK_TIMEOUT) {
                claimInput.value = text;
                chrome.storage.local.remove('pendingFactCheck');
                setTimeout(() => handleFactCheck(), 300);
            }
        }
    };
    chrome.storage.onChanged.addListener(storageListener);

    // Cleanup function for when sidepanel closes
    function cleanup() {
        // Abort any pending requests
        if (abortController) {
            abortController.abort();
            abortController = null;
        }

        // Remove all managed event listeners
        eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        eventListeners.length = 0;

        // Remove Chrome API listeners
        chrome.runtime.onMessage.removeListener(messageListener);
        chrome.storage.onChanged.removeListener(storageListener);

        // Clear caches
        toolSupportCache.clear();
        pendingToolChecks.clear();

        console.log('VerifAI: Cleanup completed');
    }

    // Register cleanup handlers
    window.addEventListener('beforeunload', cleanup);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Cancel pending requests when panel is hidden
            if (abortController) {
                abortController.abort();
            }
        }
    });

    // Initialize
    init();

    async function init() {
        await loadSettings();
        await refreshModels();
        checkForPendingFactCheck();

        // Show keyboard hint briefly
        setTimeout(() => {
            showKeyboardHint();
            setTimeout(hideKeyboardHint, CONFIG.KEYBOARD_HINT_DURATION);
        }, CONFIG.KEYBOARD_HINT_DELAY);
    }

    // Check for pending fact-check from context menu or content script
    async function checkForPendingFactCheck() {
        try {
            const result = await chrome.storage.local.get('pendingFactCheck');
            if (result.pendingFactCheck) {
                const { text, timestamp } = result.pendingFactCheck;
                // Only use if less than 30 seconds old
                if (Date.now() - timestamp < 30000) {
                    claimInput.value = text;
                    // Clear the pending fact-check
                    await chrome.storage.local.remove('pendingFactCheck');
                    // Auto-trigger fact-check
                    setTimeout(() => handleFactCheck(), 500);
                } else {
                    await chrome.storage.local.remove('pendingFactCheck');
                }
            }
        } catch (error) {
            console.error('Error checking pending fact-check:', error);
        }
    }

    // Settings functions
    function toggleSettings() {
        settingsPanel.classList.toggle('show');
    }

    /**
     * Check Chrome storage quota before saving
     * @returns {Promise<{bytesUsed: number, quotaAvailable: boolean}>}
     */
    async function checkStorageQuota() {
        try {
            const bytesUsed = await chrome.storage.sync.getBytesInUse(null);
            const quotaAvailable = bytesUsed < CONFIG.STORAGE_QUOTA_WARNING;
            return { bytesUsed, quotaAvailable };
        } catch (error) {
            console.warn('Could not check storage quota:', error);
            return { bytesUsed: 0, quotaAvailable: true };
        }
    }

    async function loadSettings() {
        try {
            const result = await chrome.storage.sync.get(['selectedModel']);
            if (result.selectedModel) {
                selectedModel = result.selectedModel;
            }
            updateModelStatus();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async function saveSelectedModel(model) {
        try {
            // Check storage quota before saving
            const { bytesUsed, quotaAvailable } = await checkStorageQuota();
            if (!quotaAvailable) {
                console.warn(`Storage quota warning: ${bytesUsed} bytes used`);
            }

            await chrome.storage.sync.set({ selectedModel: model });
            selectedModel = model;
            updateModelStatus();
        } catch (error) {
            console.error('Error saving model:', error);

            // Handle quota exceeded error
            if (error.message && error.message.includes('QUOTA_BYTES')) {
                modelStatus.textContent = 'Storage full - cannot save selection';
                // Try to clear old data
                try {
                    await chrome.storage.sync.clear();
                    await chrome.storage.sync.set({ selectedModel: model });
                    selectedModel = model;
                    updateModelStatus();
                    console.log('Cleared storage and saved model');
                } catch (retryError) {
                    console.error('Failed to recover from quota error:', retryError);
                }
            } else {
                modelStatus.textContent = 'Error saving model selection';
            }
        }
    }

    function updateModelStatus() {
        if (selectedModel) {
            modelStatus.textContent = `Current model: ${selectedModel}`;
        } else {
            modelStatus.textContent = 'No model selected';
        }
    }

    function handleModelSelection() {
        const selected = modelSelector.value;
        if (selected) {
            saveSelectedModel(selected);
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Check if an error is retryable (transient network issues)
     */
    function isRetryableError(error) {
        const message = error.message || '';
        return message.includes('Failed to fetch') ||
            message.includes('NetworkError') ||
            message.includes('net::ERR_') ||
            message.includes('ETIMEDOUT') ||
            message.includes('ECONNREFUSED') ||
            message.includes('503') ||
            message.includes('429') ||
            message.includes('502') ||
            message.includes('504');
    }

    /**
     * Fetch with retry logic and exponential backoff
     * @param {string} url - URL to fetch
     * @param {RequestInit} options - Fetch options
     * @param {number} maxRetries - Maximum number of retries
     * @returns {Promise<Response>}
     */
    async function fetchWithRetry(url, options = {}, maxRetries = CONFIG.MAX_RETRIES) {
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await fetch(url, options);

                // Retry on server errors (5xx) but not client errors (4xx)
                if (response.status >= 500 && attempt < maxRetries) {
                    throw new Error(`Server error: ${response.status}`);
                }

                return response;
            } catch (error) {
                lastError = error;

                // Don't retry if aborted
                if (error.name === 'AbortError') {
                    throw error;
                }

                // Check if error is retryable
                if (attempt < maxRetries && isRetryableError(error)) {
                    const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
                    console.log(`Retry ${attempt}/${maxRetries} after ${delay}ms:`, error.message);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                throw error;
            }
        }

        throw lastError;
    }

    // Model fetching - filters for models with tool support
    // Model fetching with dynamic tool support detection
    async function refreshModels() {
        refreshModelsButton.disabled = true;
        refreshModelsButton.textContent = 'Checking...';
        modelSelector.innerHTML = '<option value="">Detecting tool support...</option>';

        try {
            const response = await fetchWithRetry(`${CONFIG.OLLAMA_ENDPOINT}/api/tags`);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const data = await response.json();

            if (data.models && Array.isArray(data.models)) {
                modelSelector.innerHTML = '';

                if (data.models.length === 0) {
                    modelSelector.innerHTML = '<option value="">No models found</option>';
                    modelStatus.textContent = 'No models available. Run: ollama pull qwen2.5';
                    return;
                }

                // Check tool support for each model in parallel
                modelStatus.textContent = `Checking ${data.models.length} model(s) for tool support...`;

                const modelsWithToolInfo = await Promise.all(
                    data.models.map(async (model) => {
                        const hasTools = await checkModelToolSupport(model.name);
                        return { ...model, hasTools };
                    })
                );

                // Sort: tool-capable first, then alphabetically
                modelsWithToolInfo.sort((a, b) => {
                    if (a.hasTools && !b.hasTools) return -1;
                    if (!a.hasTools && b.hasTools) return 1;
                    return a.name.localeCompare(b.name);
                });

                let toolCount = 0;
                const availableModelNames = new Set(modelsWithToolInfo.map(m => m.name));

                // Check if saved model is still available locally
                if (selectedModel && !availableModelNames.has(selectedModel)) {
                    console.log(`Previously selected model "${selectedModel}" is no longer available locally`);
                    selectedModel = '';
                    await chrome.storage.sync.remove('selectedModel');
                }

                modelsWithToolInfo.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;

                    const sizeInfo = formatBytes(model.size);
                    if (model.hasTools) {
                        toolCount++;
                        option.textContent = `🔧 ${model.name} (${sizeInfo})`;
                        option.classList.add('tool-capable');
                    } else {
                        option.textContent = `${model.name} (${sizeInfo})`;
                    }

                    if (model.name === selectedModel) {
                        option.selected = true;
                    }
                    modelSelector.appendChild(option);
                });

                // Auto-select first tool-capable model if none selected
                if (!selectedModel) {
                    const firstToolModel = modelsWithToolInfo.find(m => m.hasTools);
                    if (firstToolModel) {
                        selectedModel = firstToolModel.name;
                        modelSelector.value = selectedModel;
                        saveSelectedModel(selectedModel);
                    }
                }

                updateModelStatus();
                modelStatus.textContent = `${data.models.length} model(s) found • ${toolCount} with tool support 🔧`;

                if (toolCount === 0) {
                    modelStatus.textContent += ' • Consider: ollama pull qwen2.5';
                }
            } else {
                throw new Error('Invalid response format from Ollama');
            }
        } catch (error) {
            console.error('Error fetching models:', error);
            modelSelector.innerHTML = '<option value="">Error loading models</option>';

            if (error.message.includes('Failed to fetch')) {
                modelStatus.textContent = 'Cannot connect to Ollama. Run: ollama serve';
            } else {
                modelStatus.textContent = `Error: ${error.message}`;
            }
        } finally {
            refreshModelsButton.disabled = false;
            refreshModelsButton.textContent = 'Refresh';
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Check if a model supports tool/function calling by inspecting its metadata
     * Uses Ollama's /api/show endpoint to examine the model template
     * @param {string} modelName - The model name to check
     * @returns {Promise<boolean>} - Whether the model likely supports tools
     */
    async function checkModelToolSupport(modelName) {
        // Return cached result if available (with expiration check)
        if (toolSupportCache.has(modelName)) {
            const cached = toolSupportCache.get(modelName);
            if (cached.timestamp && Date.now() - cached.timestamp < CONFIG.TOOL_CACHE_DURATION) {
                return cached.value;
            }
            toolSupportCache.delete(modelName);
        }

        // Avoid duplicate concurrent checks for the same model
        if (pendingToolChecks.has(modelName)) {
            return pendingToolChecks.get(modelName);
        }

        const checkPromise = (async () => {
            try {
                const response = await fetchWithRetry(`${CONFIG.OLLAMA_ENDPOINT}/api/show`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: modelName })
                });

                if (!response.ok) {
                    toolSupportCache.set(modelName, { value: false, timestamp: Date.now() });
                    return false;
                }

                const data = await response.json();

                // Check 1: Look for tool-related patterns in the template
                const template = (data.template || '').toLowerCase();
                const toolTemplatePatterns = [
                    '<tool_call>',
                    '<|tool_call|>',
                    '<<tool_call>>',
                    '<function_call>',
                    '<tools>',
                    '</tools>',
                    '[tool_calls]',
                    '<|python_tag|>',
                    '{"name":',
                    '"function"',
                    'action:',
                    'observation:'
                ];

                const hasToolTemplate = toolTemplatePatterns.some(pattern =>
                    template.includes(pattern.toLowerCase())
                );

                // Check 2: Check modelfile for tool/function mentions
                const modelfile = (data.modelfile || '').toLowerCase();
                const hasToolModelfile = modelfile.includes('tool') ||
                    modelfile.includes('function call');

                // Check 3: Known model families that support tools (fallback)
                const knownToolFamilies = [
                    'qwen', 'qwen2', 'qwen2.5', 'qwen3',
                    'llama3', 'llama-3', 'llama3.1', 'llama3.2', 'llama3.3',
                    'mistral', 'mistral-nemo', 'mistral-small', 'mistral-large',
                    'mixtral',
                    'command-r', 'command-r-plus',
                    'hermes', 'nous-hermes',
                    'functionary',
                    'firefunction',
                    'nexusraven',
                    'gorilla',
                    'deepseek'
                ];

                const modelLower = modelName.toLowerCase();
                const isKnownToolFamily = knownToolFamilies.some(family =>
                    modelLower.includes(family)
                );

                const hasToolSupport = hasToolTemplate || hasToolModelfile || isKnownToolFamily;

                // Cache the result with timestamp
                toolSupportCache.set(modelName, { value: hasToolSupport, timestamp: Date.now() });

                console.log(`Model ${modelName}: tool support = ${hasToolSupport}`,
                    { hasToolTemplate, hasToolModelfile, isKnownToolFamily });

                return hasToolSupport;
            } catch (error) {
                console.error(`Error checking tool support for ${modelName}:`, error);
                toolSupportCache.set(modelName, { value: false, timestamp: Date.now() });
                return false;
            } finally {
                pendingToolChecks.delete(modelName);
            }
        })();

        pendingToolChecks.set(modelName, checkPromise);
        return checkPromise;
    }

    // ============================================
    // WEB SEARCH FUNCTIONALITY
    // ============================================

    // Reputable domain tiers for source credibility
    const REPUTABLE_DOMAINS = {
        // Tier 1: Wire services, government, scientific journals, international orgs
        tier1: [
            // Major wire services
            'reuters.com', 'apnews.com', 'afp.com', 'dpa.com', 'efe.com',
            // Public broadcasters
            'bbc.com', 'bbc.co.uk', 'npr.org', 'pbs.org', 'c-span.org',
            // Scientific journals
            'nature.com', 'science.org', 'scientificamerican.com',
            'nejm.org', 'thelancet.com', 'jamanetwork.com', 'cell.com',
            'pubmed.ncbi.nlm.nih.gov', 'nih.gov',
            // International organizations
            'who.int', 'un.org', 'europa.eu', 'worldbank.org', 'imf.org',
            // Fact-checkers (IFCN certified)
            'fullfact.org', 'aap.com.au'
        ],
        // Tier 2: Major newspapers, encyclopedias, fact-checkers
        tier2: [
            // US quality press
            'nytimes.com', 'washingtonpost.com', 'wsj.com', 'theatlantic.com',
            // International quality press
            'theguardian.com', 'economist.com', 'ft.com', 'bloomberg.com',
            'lemonde.fr', 'spiegel.de', 'elpais.com', 'smh.com.au', 'globalnews.ca',
            // Fact-checkers
            'snopes.com', 'politifact.com', 'factcheck.org',
            // Reference sources
            'wikipedia.org', 'britannica.com',
            // Investigative journalism
            'propublica.org', 'theintercept.com', 'icij.org',
            // Specialized reliable sources
            'statnews.com', 'arstechnica.com', 'theverge.com',
            // Academic
            'scholar.google.com', 'jstor.org', 'arxiv.org'
        ],
        // Tier 3: Cable news, magazines, established blogs
        tier3: [
            // US broadcast/cable news
            'cnn.com', 'cbsnews.com', 'abcnews.go.com', 'nbcnews.com',
            // Magazines and digital media
            'usatoday.com', 'time.com', 'newsweek.com', 'forbes.com',
            'businessinsider.com', 'axios.com', 'politico.com', 'thehill.com',
            'vox.com', 'slate.com', 'salon.com',
            // International
            'aljazeera.com', 'dw.com', 'france24.com', 'rt.com', 'scmp.com'
        ],
        // Tier 4: Partisan/tabloid - use with caution
        tier4: [
            // Partisan US outlets
            'foxnews.com', 'msnbc.com', 'breitbart.com', 'dailykos.com',
            'theblaze.com', 'motherjones.com', 'dailywire.com',
            // Tabloids
            'dailymail.co.uk', 'nypost.com', 'thesun.co.uk', 'mirror.co.uk',
            // Opinion-heavy
            'huffpost.com', 'buzzfeed.com', 'buzzfeednews.com'
        ]
    };

    // Known unreliable/misinformation sources - will be flagged
    const UNRELIABLE_DOMAINS = [
        'naturalnews.com', 'infowars.com', 'beforeitsnews.com',
        'worldtruth.tv', 'yournewswire.com', 'newspunch.com',
        'thegatewaypundit.com', 'zerohedge.com', 'globalresearch.ca',
        'collective-evolution.com', 'davidwolfe.com', 'realfarmacy.com'
    ];

    /**
     * Get credibility tier for a domain (1 = most reliable, 5 = known unreliable)
     */
    function getSourceTier(domain) {
        const domainLower = domain.toLowerCase();

        // Check for known unreliable sources first
        if (UNRELIABLE_DOMAINS.some(d => domainLower.includes(d))) return 5;

        // Check TLD - government and education sites (international support)
        if (domainLower.endsWith('.gov') ||
            domainLower.endsWith('.gov.uk') ||
            domainLower.endsWith('.gov.au') ||
            domainLower.endsWith('.gov.ca') ||
            domainLower.endsWith('.gc.ca')) return 1;
        if (domainLower.endsWith('.edu') ||
            domainLower.endsWith('.ac.uk') ||
            domainLower.endsWith('.edu.au')) return 1;
        if (domainLower.endsWith('.mil')) return 1;

        // Check specific domains by tier
        if (REPUTABLE_DOMAINS.tier1.some(d => domainLower.includes(d))) return 1;
        if (REPUTABLE_DOMAINS.tier2.some(d => domainLower.includes(d))) return 2;
        if (REPUTABLE_DOMAINS.tier3.some(d => domainLower.includes(d))) return 3;
        if (REPUTABLE_DOMAINS.tier4.some(d => domainLower.includes(d))) return 4;

        return 4; // Unknown defaults to "use with caution"
    }

    /**
     * Get tier label for display
     */
    function getTierLabel(tier) {
        switch (tier) {
            case 1: return '⭐ HIGHLY RELIABLE';
            case 2: return '✓ RELIABLE';
            case 3: return '○ MODERATE';
            case 4: return '⚠ USE CAUTION';
            case 5: return '🚫 UNRELIABLE';
            default: return '? UNKNOWN';
        }
    }

    /**
     * Perform a web search using DuckDuckGo HTML (no API key needed)
     * Falls back to a simple search scraper approach
     */
    async function performWebSearch(query) {
        console.log('Performing web search for:', query);

        try {
            // Use DuckDuckGo's lite/html version with past month filter for recency
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&df=m`;

            const response = await fetch(searchUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'text/html',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const html = await response.text();
            const results = parseSearchResults(html);

            if (results.length === 0) {
                return {
                    success: true,
                    query: query,
                    results: [],
                    summary: "No search results found for this query."
                };
            }

            // Add tier information to results
            const resultsWithTiers = results.map(r => ({
                ...r,
                tier: getSourceTier(r.source),
                tierLabel: getTierLabel(getSourceTier(r.source))
            }));

            // Sort by reliability (most reputable first)
            resultsWithTiers.sort((a, b) => a.tier - b.tier);

            return {
                success: true,
                query: query,
                results: resultsWithTiers.slice(0, 7), // Top 7 results
                summary: formatSearchResultsForLLM(resultsWithTiers.slice(0, 7))
            };
        } catch (error) {
            console.error('Web search error:', error);

            // Fallback: Return a message that search is unavailable
            return {
                success: false,
                query: query,
                error: error.message,
                summary: `Web search failed: ${error.message}. Please verify this claim using your knowledge and indicate that real-time web verification was not available.`
            };
        }
    }

    /**
     * Parse DuckDuckGo HTML search results
     */
    function parseSearchResults(html) {
        const results = [];

        // Create a temporary DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // DuckDuckGo HTML results are in divs with class "result"
        const resultElements = doc.querySelectorAll('.result, .results_links_deep');

        resultElements.forEach((element, index) => {
            if (index >= 10) return; // Limit to 10 results

            const titleElement = element.querySelector('.result__a, a.result__a');
            const snippetElement = element.querySelector('.result__snippet, .snippet');
            const urlElement = element.querySelector('.result__url, .url');

            if (titleElement) {
                const title = titleElement.textContent?.trim() || '';
                const snippet = snippetElement?.textContent?.trim() || '';
                const url = titleElement.href || urlElement?.textContent?.trim() || '';

                if (title && title.length > 0) {
                    results.push({
                        title: title,
                        snippet: snippet,
                        url: url,
                        source: extractDomain(url)
                    });
                }
            }
        });

        // If parsing failed, try alternative approach
        if (results.length === 0) {
            // Look for any links with reasonable content
            const links = doc.querySelectorAll('a');
            links.forEach((link, index) => {
                if (index >= 10 || results.length >= 5) return;

                const href = link.href;
                const text = link.textContent?.trim() || '';

                // Filter out navigation links and empty links
                if (href && text.length > 20 && !href.includes('duckduckgo.com') &&
                    !text.toLowerCase().includes('next') && !text.toLowerCase().includes('previous')) {
                    results.push({
                        title: text.substring(0, 100),
                        snippet: '',
                        url: href,
                        source: extractDomain(href)
                    });
                }
            });
        }

        return results;
    }

    /**
     * Extract domain from URL
     */
    function extractDomain(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname.replace('www.', '');
        } catch {
            return url;
        }
    }

    /**
     * Format search results for the LLM to use
     * Includes source reliability ratings to help LLM prioritize credible sources
     */
    function formatSearchResultsForLLM(results) {
        if (results.length === 0) {
            return "No relevant search results found.";
        }

        let formatted = "Web Search Results (sorted by source reliability):\n\n";

        results.forEach((result, index) => {
            const tierLabel = result.tierLabel || getTierLabel(getSourceTier(result.source));
            formatted += `${index + 1}. [${tierLabel}] **${result.title}**\n`;
            formatted += `   Source: ${result.source}\n`;
            if (result.snippet) {
                formatted += `   Summary: ${result.snippet}\n`;
            }
            formatted += `   URL: ${result.url}\n\n`;
        });

        formatted += `---
SOURCE RELIABILITY GUIDE:
⭐ HIGHLY RELIABLE = .gov, .edu, wire services (AP, Reuters, BBC), scientific journals
✓ RELIABLE = Major newspapers, fact-checkers, encyclopedias, investigative journalism
○ MODERATE = Cable news, magazines, established digital media
⚠ USE CAUTION = Partisan outlets, tabloids, opinion-heavy sites
🚫 UNRELIABLE = Known misinformation sources - DO NOT cite as evidence

IMPORTANT: Prioritize information from tier 1-2 sources. Be skeptical of tier 4-5 sources.
If a claim is only supported by unreliable sources, note this in your analysis.`;

        return formatted;
    }

    // ============================================
    // TOOL CALLING SUPPORT
    // ============================================

    /**
     * Process tool calls from Ollama response
     */
    async function processToolCalls(toolCalls) {
        const results = [];

        for (const toolCall of toolCalls) {
            if (toolCall.function?.name === 'web_search') {
                const args = typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;

                updateProgress(50, `Searching: "${args.query}"...`);
                const searchResult = await performWebSearch(args.query);

                // Collect sources from search results
                if (searchResult.results && searchResult.results.length > 0) {
                    searchResult.results.forEach(r => {
                        if (r.url && !collectedSources.some(s => s.url === r.url)) {
                            collectedSources.push({
                                url: r.url,
                                domain: r.source || extractDomain(r.url),
                                title: r.title || r.source
                            });
                        }
                    });
                }

                results.push({
                    tool_call_id: toolCall.id || 'search_1',
                    role: 'tool',
                    name: 'web_search',
                    content: searchResult.summary
                });
            }
        }

        return results;
    }

    // Progress functions
    function showProgress(percentage, text) {
        progressContainer.style.display = 'block';
        progressFill.style.width = percentage + '%';
        progressText.textContent = text;
        resultsContent.innerHTML = '';
        copyButton.classList.remove('show');
    }

    function updateProgress(percentage, text) {
        progressFill.style.width = percentage + '%';
        progressText.textContent = text;
    }

    function hideProgress() {
        progressContainer.style.display = 'none';
    }

    // Fact-checking function
    async function handleFactCheck() {
        // Prevent overlapping requests (race condition fix)
        if (isFactChecking) {
            console.log('Fact-check already in progress, ignoring request');
            return;
        }

        const claim = claimInput.value.trim();

        if (!claim) {
            resultsContent.innerHTML = '<div style="color: var(--color-danger);">Please enter a claim to fact-check.</div>';
            return;
        }

        if (!selectedModel) {
            resultsContent.innerHTML = '<div style="color: var(--color-danger);">Please select an AI model first.</div>';
            return;
        }

        isFactChecking = true;
        factCheckButton.disabled = true;
        factCheckButton.textContent = 'Checking...';
        showProgress(10, 'Analyzing claim...');

        try {
            updateProgress(30, 'Sending to AI model...');

            const result = await performFactCheck(claim);

            updateProgress(90, 'Formatting results...');

            displayResults(result);

            updateProgress(100, 'Complete!');
            setTimeout(hideProgress, 500);

            copyButton.classList.add('show');
        } catch (error) {
            console.error('Fact-check error:', error);
            hideProgress();
            displayError(error);
        } finally {
            isFactChecking = false;
            factCheckButton.disabled = false;
            factCheckButton.textContent = 'Fact-Check';
        }
    }

    /**
     * Display user-friendly error messages
     */
    function displayError(error) {
        const errorMessage = error.message || 'Unknown error occurred';
        let userMessage = '';
        let suggestions = [];

        if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError')) {
            userMessage = 'Cannot connect to Ollama';
            suggestions = [
                'Make sure Ollama is running (ollama serve)',
                'Check that Ollama is accessible at localhost:11434',
                'Verify your firewall isn\'t blocking the connection'
            ];
        } else if (errorMessage.includes('timed out')) {
            userMessage = 'Request timed out';
            suggestions = [
                'The AI model may be overloaded',
                'Try a smaller/faster model',
                'Check if Ollama is still running'
            ];
        } else if (errorMessage.includes('No models')) {
            userMessage = 'No AI models available';
            suggestions = [
                'Pull a model with: ollama pull qwen2.5',
                'Or try: ollama pull llama3.2'
            ];
        } else if (errorMessage.includes('model')) {
            userMessage = 'AI Model Error';
            suggestions = [
                'The selected model may not be available',
                'Try refreshing the model list',
                'Try a different model'
            ];
        } else {
            userMessage = 'Fact-check failed';
            suggestions = [
                'Check that Ollama is running',
                'Try again in a moment',
                `Error: ${errorMessage.substring(0, 100)}`
            ];
        }

        resultsContent.innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <div class="error-title">${userMessage}</div>
                <ul class="error-suggestions">
                    ${suggestions.map(s => `<li>${s}</li>`).join('')}
                </ul>
                <button class="retry-btn" onclick="document.getElementById('btnFactCheck').click()">
                    🔄 Try Again
                </button>
            </div>
        `;
    }

    async function performFactCheck(claim) {
        // Create new abort controller for this request
        abortController = new AbortController();
        const controller = abortController;
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

        // Reset collected sources for new fact-check
        collectedSources = [];

        // Check if selected model supports tools
        const modelSupportsTools = await checkModelToolSupport(selectedModel);
        console.log(`Model ${selectedModel} supports tools: ${modelSupportsTools}`);

        try {
            // Step 1: Initial request with tools - ask LLM to search if needed
            updateProgress(25, 'Analyzing claim and determining search needs...');

            // Build request body - only include tools if model supports them
            const requestBody = {
                model: selectedModel,
                stream: false,
                messages: [
                    {
                        role: "system",
                        content: modelSupportsTools
                            ? `You are a professional fact-checker with access to web search. Your job is to analyze claims and determine their accuracy using credible sources.

IMPORTANT: You have access to a web_search tool. Use it to verify claims with current information from the internet. Always search for evidence before making a verdict.

SOURCE CREDIBILITY - PRIORITIZE IN THIS ORDER:
1. ⭐ HIGHLY RELIABLE: Government sites (.gov), academic (.edu), wire services (AP, Reuters, BBC, NPR)
2. ✓ RELIABLE: Major newspapers (NYT, Washington Post, Guardian), fact-checkers (Snopes, PolitiFact), Wikipedia
3. ○ MODERATE: Cable news, magazines, established publications
4. ? UNVERIFIED: Blogs, opinion pieces, unknown sites - use with caution

When fact-checking:
1. First, identify what needs to be verified
2. Use the web_search tool to find relevant, current information
3. PRIORITIZE information from higher-tier sources
4. Cross-reference claims across multiple reputable sources when possible
5. Be skeptical of sources with obvious bias or financial interest
6. After gathering evidence, provide your verdict

Your final response (after searching) should follow this format:
**VERDICT:** [TRUE / FALSE / PARTIALLY TRUE / UNVERIFIABLE]

**CLAIM ANALYZED:** [Restate the claim]

**EVIDENCE FOUND:**
[Summarize the evidence, noting which sources it came from and their reliability]

**ANALYSIS:**
[Your detailed analysis based on the evidence, explaining why you trust certain sources]

**SOURCES:**
[List the sources with their reliability tier]

**CONFIDENCE:** [HIGH / MEDIUM / LOW]
[Explain your confidence level - higher if based on multiple reliable sources]`
                            : `You are a professional fact-checker. Your job is to analyze claims and determine their accuracy based on your knowledge.

NOTE: You do not have access to web search, so you must rely on your training knowledge. Be clear about the limitations of your knowledge and when the claim requires more recent information than you may have.

Your response should follow this format:
**VERDICT:** [TRUE / FALSE / PARTIALLY TRUE / UNVERIFIABLE]

**CLAIM ANALYZED:** [Restate the claim]

**ANALYSIS:**
[Your detailed analysis based on your knowledge]

**LIMITATIONS:**
[Note any limitations due to lack of real-time information]

**CONFIDENCE:** [HIGH / MEDIUM / LOW]
[Explain your confidence level]`
                    },
                    {
                        role: "user",
                        content: modelSupportsTools
                            ? `Please fact-check the following claim. Use web search to find current, reliable information:\n\n"${claim}"`
                            : `Please fact-check the following claim based on your knowledge:\n\n"${claim}"`
                    }
                ]
            };

            // Only add tools if model supports them
            if (modelSupportsTools) {
                requestBody.tools = [WEB_SEARCH_TOOL];
            }

            const initialResponse = await fetch(`${CONFIG.OLLAMA_ENDPOINT}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(requestBody)
            });

            if (!initialResponse.ok) {
                const errorText = await initialResponse.text();
                console.error('Ollama error response:', errorText);
                throw new Error(`Ollama error (${initialResponse.status}): ${errorText.substring(0, 100)}`);
            }

            let data = await initialResponse.json();
            console.log('Initial Ollama response:', JSON.stringify(data, null, 2));
            let messages = [
                {
                    role: "system",
                    content: `You are a professional fact-checker with access to web search. Analyze evidence and provide accurate verdicts.`
                },
                {
                    role: "user",
                    content: `Please fact-check the following claim. Use web search to find current, reliable information:\n\n"${claim}"`
                }
            ];

            // Check if the model wants to use tools
            let iterationCount = 0;
            const maxIterations = CONFIG.MAX_SEARCH_ITERATIONS;

            while (data.message?.tool_calls && iterationCount < maxIterations) {
                iterationCount++;
                console.log(`Tool call iteration ${iterationCount}:`, data.message.tool_calls);

                // Add assistant's message with tool calls
                messages.push({
                    role: "assistant",
                    content: data.message.content || "",
                    tool_calls: data.message.tool_calls
                });

                // Process tool calls (perform searches)
                updateProgress(40 + (iterationCount * 15), `Searching the web (${iterationCount}/${maxIterations})...`);
                const toolResults = await processToolCalls(data.message.tool_calls);

                // Add tool results to messages
                for (const result of toolResults) {
                    messages.push(result);
                }

                // Continue the conversation with tool results
                updateProgress(60 + (iterationCount * 10), 'Analyzing search results...');

                const continueRequestBody = {
                    model: selectedModel,
                    stream: false,
                    messages: messages
                };

                // Only include tools if model supports them
                if (modelSupportsTools) {
                    continueRequestBody.tools = [WEB_SEARCH_TOOL];
                }

                const continueResponse = await fetch(`${CONFIG.OLLAMA_ENDPOINT}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify(continueRequestBody)
                });

                if (!continueResponse.ok) {
                    throw new Error(`HTTP error! Status: ${continueResponse.status}`);
                }

                data = await continueResponse.json();
            }

            clearTimeout(timeoutId);

            // Handle various response formats from Ollama
            console.log('Final Ollama response:', JSON.stringify(data, null, 2));

            // Try to extract content from different possible response structures
            let responseContent = null;

            // Check message.content first (most common format)
            if (data.message && typeof data.message.content === 'string' && data.message.content.trim().length > 0) {
                responseContent = data.message.content;
            }
            // Some Ollama versions use 'response' instead of 'message.content'
            else if (data.response && typeof data.response === 'string' && data.response.trim().length > 0) {
                responseContent = data.response;
            }
            // Direct content field
            else if (data.content && typeof data.content === 'string' && data.content.trim().length > 0) {
                responseContent = data.content;
            }
            // String response
            else if (typeof data === 'string' && data.trim().length > 0) {
                responseContent = data;
            }
            // Last resort: check if message exists and try to stringify it
            else if (data.message) {
                // Handle case where message might have different structure
                console.log('Message object:', JSON.stringify(data.message, null, 2));
                if (typeof data.message === 'string' && data.message.trim().length > 0) {
                    responseContent = data.message;
                } else if (data.message.text && data.message.text.trim().length > 0) {
                    responseContent = data.message.text;
                }
            }

            // If we still don't have content but the response looks valid, provide a fallback
            if (!responseContent && data.done === true) {
                // The model may have returned empty content - this can happen with some models
                responseContent = `**VERDICT:** UNVERIFIABLE

**CLAIM ANALYZED:** "${claim}"

**ANALYSIS:**
The AI model completed processing but did not provide a detailed response. This may indicate the model is not well-suited for fact-checking tasks or does not support the required prompt format.

**CONFIDENCE:** LOW

Please try a different model such as qwen2.5 or llama3.2 which have better support for this type of task.`;
            }

            if (responseContent) {
                return {
                    content: responseContent,
                    searchesPerformed: iterationCount,
                    sources: collectedSources
                };
            } else {
                // Log the full response for debugging
                console.error('Unexpected Ollama response structure:', JSON.stringify(data, null, 2));
                throw new Error(`Invalid response from AI model. The model may not support chat completions. Response keys: ${Object.keys(data).join(', ')}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timed out. The AI model may be taking too long.');
            }
            throw error;
        } finally {
            // Clean up abort controller
            if (abortController === controller) {
                abortController = null;
            }
        }
    }

    function displayResults(result) {
        // Handle both old string format and new object format
        const content = typeof result === 'object' ? result.content : result;
        const searchesPerformed = typeof result === 'object' ? result.searchesPerformed : 0;
        const searchSources = typeof result === 'object' ? (result.sources || []) : [];

        // Parse the verdict from the result
        let verdictClass = 'unverified';
        let verdictIcon = '❓';
        let verdictText = 'UNVERIFIABLE';
        let confidence = '';

        const resultUpper = content.toUpperCase();

        // Parse verdict - more robust matching
        const verdictMatch = content.match(/\*\*VERDICT:\*\*\s*([A-Z\s]+?)(?:\n|$)/i);
        if (verdictMatch) {
            const verdictValue = verdictMatch[1].trim().toUpperCase();
            if (verdictValue.includes('PARTIALLY') || verdictValue.includes('PARTIAL')) {
                verdictClass = 'partial';
                verdictIcon = '⚠️';
                verdictText = 'PARTIALLY TRUE';
            } else if (verdictValue.includes('FALSE')) {
                verdictClass = 'false';
                verdictIcon = '❌';
                verdictText = 'FALSE';
            } else if (verdictValue.includes('TRUE')) {
                verdictClass = 'true';
                verdictIcon = '✅';
                verdictText = 'TRUE';
            } else if (verdictValue.includes('UNVERIF')) {
                verdictClass = 'unverified';
                verdictIcon = '❓';
                verdictText = 'UNVERIFIABLE';
            }
        }

        // Parse confidence
        const confidenceMatch = content.match(/\*\*CONFIDENCE:\*\*\s*(HIGH|MEDIUM|LOW)/i);
        if (confidenceMatch) {
            confidence = confidenceMatch[1].toUpperCase();
        }

        // Use sources from search results, fallback to extracting from content
        let sources = searchSources.length > 0 ? searchSources : extractSources(content);

        // Format the result with HTML - improved formatting
        let formattedResult = content
            // Remove verdict line (we show it separately)
            .replace(/\*\*VERDICT:\*\*\s*[^\n]*/gi, '')
            // Remove confidence line (we show it in badge)
            .replace(/\*\*CONFIDENCE:\*\*\s*[^\n]*/gi, '')
            // Format section headers
            .replace(/\*\*([A-Z\s]+):\*\*/g, '<h4 class="section-header">$1</h4>')
            // Format bold text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            // Format URLs as clickable links
            .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
            // Format paragraphs
            .replace(/\n\n/g, '</p><p>')
            // Format bullet points
            .replace(/\n- /g, '</li><li class="bullet-item">')
            .replace(/\n• /g, '</li><li class="bullet-item">')
            .replace(/\n\* /g, '</li><li class="bullet-item">')
            // Format numbered lists
            .replace(/\n(\d+)\.\s/g, '</li><li class="numbered-item"><span class="num">$1.</span> ')
            // Format line breaks
            .replace(/\n/g, '<br>');

        // Clean up list formatting
        formattedResult = formattedResult
            .replace(/<\/li><li/g, '</li><li')
            .replace(/^<\/li>/, '')
            .replace(/<li class="bullet-item">([^<]*)<\/li>/g, '<ul><li>$1</li></ul>');

        // Build search info badge
        const searchBadge = searchesPerformed > 0
            ? `<div class="search-badge">🌐 ${searchesPerformed} web search${searchesPerformed > 1 ? 'es' : ''} performed</div>`
            : '<div class="search-badge offline">📴 No web search (model may not support tools)</div>';

        // Build confidence badge
        const confidenceBadge = confidence
            ? `<div class="confidence-badge ${confidence.toLowerCase()}">Confidence: ${confidence}</div>`
            : '';

        // Build sources section if we found any
        const sourcesHTML = sources.length > 0 ? buildSourcesSection(sources) : '';

        // Build the HTML
        resultsContent.innerHTML = `
            <div class="verdict ${verdictClass}">
                <span class="verdict-icon">${verdictIcon}</span>
                <span class="verdict-text">${verdictText}</span>
                ${confidenceBadge}
            </div>
            ${searchBadge}
            <div class="analysis-content">
                <p>${formattedResult}</p>
            </div>
            ${sourcesHTML}
        `;
    }

    /**
     * Extract sources/URLs from the content
     */
    function extractSources(content) {
        const sources = [];
        const urlRegex = /(https?:\/\/[^\s<\]]+)/g;
        const matches = content.match(urlRegex) || [];

        // Deduplicate and filter
        const seen = new Set();
        matches.forEach(url => {
            // Clean up URL
            url = url.replace(/[.,;:!?)]+$/, ''); // Remove trailing punctuation

            if (!seen.has(url) && !url.includes('localhost')) {
                seen.add(url);
                sources.push({
                    url: url,
                    domain: extractDomain(url),
                    title: extractDomain(url) // Use domain as title fallback
                });
            }
        });

        return sources.slice(0, 5); // Limit to 5 sources
    }

    /**
     * Build HTML for sources section
     */
    function buildSourcesSection(sources) {
        if (sources.length === 0) return '';

        // Sort sources by tier (most reliable first)
        const sortedSources = [...sources].sort((a, b) => {
            const tierA = getSourceTier(a.domain);
            const tierB = getSourceTier(b.domain);
            return tierA - tierB;
        });

        let html = '<div class="sources-section"><h4 class="sources-title">Sources</h4><ul class="sources-list">';

        sortedSources.forEach((source) => {
            html += `<li><a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.title || source.domain}</a></li>`;
        });

        html += '</ul>';

        html += '</div>';
        return html;
    }

    // Clear function
    function handleClear() {
        claimInput.value = '';
        resultsContent.innerHTML = '';
        copyButton.classList.remove('show');
        hideProgress();
    }

    // Copy function
    function handleCopy() {
        const textContent = resultsContent.textContent || resultsContent.innerText;
        navigator.clipboard.writeText(textContent).then(() => {
            copyButton.textContent = 'Copied!';
            copyButton.classList.add('copied');
            setTimeout(() => {
                copyButton.textContent = 'Copy';
                copyButton.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    // Keyboard shortcuts
    function handleKeyboardShortcuts(event) {
        // Ctrl+Enter to fact-check
        if (event.ctrlKey && event.key === 'Enter') {
            event.preventDefault();
            if (!factCheckButton.disabled) {
                handleFactCheck();
            }
        }
        // Escape to close settings
        else if (event.key === 'Escape') {
            if (settingsPanel.classList.contains('show')) {
                toggleSettings();
            }
        }
    }

    function showKeyboardHint() {
        keyboardHint.classList.add('show');
    }

    function hideKeyboardHint() {
        keyboardHint.classList.remove('show');
    }

    // Theme handling
    function applyTheme() {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            document.body.classList.add('dark-theme');
        }

        // Listen for theme changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (e.matches) {
                document.body.classList.add('dark-theme');
            } else {
                document.body.classList.remove('dark-theme');
            }
        });
    }
});
