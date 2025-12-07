# VerifAI — AI-Powered Fact-Checking in Your Browser

Select any text on any webpage → instantly fact-check it with a **local AI** powered by Ollama.

VerifAI is a fast, beautiful, **privacy-first** Chrome extension that turns your browser into a live fact-checking machine. Powered by local LLMs running on your own machine via Ollama, it analyzes claims and returns a clear verdict — all without sending your data to external servers.

## Why VerifAI Exists

- Misinformation spreads faster than ever
- Manual fact-checking is slow and tedious
- Most "fact-check" extensions require cloud APIs and collect your data

VerifAI fixes that: one highlight → accurate, locally-processed answer with **zero data collection**.

## Features

### 🎯 Easy Fact-Checking
- **Select-to-check**: Highlight any claim and click the floating button
- **Right-click context menu**: "Fact-check with VerifAI"
- **Keyboard shortcut**: Ctrl+Enter in the side panel
- **Manual entry**: Paste any claim directly into the side panel

### 🤖 Local AI Integration
- **100% Local**: Uses Ollama running on your machine
- **Model Selection**: Choose from all your installed Ollama models
- **Tool-Capable Models**: Highlights models with function-calling support (🔧)
- **No API Keys Required**: Everything runs locally

### 🌐 Web Search Integration
- **Live verification**: AI can search the web for current information
- **DuckDuckGo search**: No API key required
- **Multiple searches**: LLM decides what to search based on the claim
- **Source credibility**: 5-tier system prioritizing reputable sources
- **Source display**: Clickable links sorted by reliability

### 📊 Clear Verdicts
- **TRUE** ✅ - Claim is accurate
- **FALSE** ❌ - Claim is inaccurate
- **PARTIALLY TRUE** ⚠️ - Claim contains some truth but is misleading
- **UNVERIFIABLE** ❓ - Cannot be verified with available information
- **Confidence levels**: HIGH / MEDIUM / LOW

### 🎨 Modern Interface
- Clean side panel UI with progress indicators
- Dark mode support (follows system preference)
- Animated loading states with detailed progress
- Copy results with one click
- User-friendly error messages with suggestions
- CSS variables for consistent theming

## Prerequisites

1. **Install Ollama**: Visit [https://ollama.ai](https://ollama.ai) and install Ollama

2. **Pull a Model** (recommend models with tool support):
   ```bash
   # Recommended models for fact-checking
   ollama pull llama3.1
   ollama pull qwen2.5
   ollama pull mistral
   ```

3. **Start Ollama**:
   ```bash
   ollama serve
   ```

## Installation

1. **Clone this repository**:
   ```bash
   git clone https://github.com/LiteObject/verifai.git
   cd verifai
   ```

2. **Load the extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `verifai` folder

3. **Verify installation**:
   - The VerifAI icon should appear in your Chrome toolbar
   - Click it to open the side panel
   - Ensure Ollama is running and models are detected

## Usage

### Method 1: Floating Button
1. Select text on any webpage
2. Click the "✓ Fact-check" button that appears
3. View results in the side panel

### Method 2: Context Menu
1. Select text on any webpage
2. Right-click → "Fact-check with VerifAI"
3. View results in the side panel

### Method 3: Side Panel
1. Click the VerifAI icon to open the side panel
2. Paste or type a claim in the text area
3. Click "🔍 Fact-Check" or press Ctrl+Enter

## Project Structure

```
verifai/
├── manifest.json       # Extension manifest (V3)
├── sidepanel.html      # Main side panel interface with CSS
├── sidepanel.js        # Side panel logic & Ollama integration
├── content.js          # Content script for text selection
├── background.js       # Service worker & context menu
├── icons/              # Extension icons (PNG)
└── README.md           # This file
```

## Configuration

### Configuration Options
Edit the `CONFIG` object at the top of `sidepanel.js`:
```javascript
const CONFIG = {
    OLLAMA_ENDPOINT: 'http://localhost:11434',
    REQUEST_TIMEOUT: 120000,      // 2 minutes
    MAX_SEARCH_ITERATIONS: 3,     // Web search limit
    MAX_RETRIES: 3,               // Network retry attempts
    RETRY_BASE_DELAY: 1000,       // Exponential backoff base
    TOOL_CACHE_DURATION: 3600000, // 1 hour cache
};
```

### Recommended Models
Models with tool/function-calling support (marked with 🔧):
- `qwen2.5` - Excellent for reasoning
- `llama3.1` - Great balance of speed and accuracy
- `mistral` / `mistral-nemo` - Fast and capable
- `mixtral` - Larger but more thorough

## Roadmap

- [x] Phase 1: Basic extension structure & UI
- [x] Phase 2: Text selection & context menu
- [x] Phase 3: Ollama integration with model selection
- [x] Phase 4: Web search tool integration
- [x] Phase 5: Enhanced verdict display with sources
- [x] Phase 6: Source credibility & reliability tiers
- [x] Phase 7: Error handling, retry logic & polish

## Privacy

VerifAI is **100% privacy-focused**:
- All AI processing happens locally on your machine
- No data is sent to external servers
- No analytics or tracking
- No API keys required

## Troubleshooting

### "No models found"
- Ensure Ollama is running: `ollama serve`
- Check available models: `ollama list`
- Click "Refresh" in settings

### Side panel doesn't open
- Ensure you're using Chrome 114+
- Reload the extension
- Check for errors in `chrome://extensions/`

### AI processing is slow
- Use a smaller model (e.g., `qwen2.5:7b`)
- Ensure your system has enough RAM
- Check Ollama logs for issues

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Submit a pull request

## License

This project is open source. See the repository for license details.

## Links

- [Ollama](https://ollama.ai) - Local AI runtime
- [Chrome Extensions Docs](https://developer.chrome.com/docs/extensions/)
- [Side Panel API](https://developer.chrome.com/docs/extensions/reference/sidePanel/)

---

**One highlight. One truth.**
Stop wondering. Start verifying.
