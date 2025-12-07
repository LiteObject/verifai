# VerifAI

A Chrome extension for fact-checking text using local AI models via Ollama.

## What it does

Select any text on a webpage, click a button, and get a fact-check verdict powered by a local LLM. No cloud APIs, no data collection, everything runs on your machine.

## Why I built this

Most fact-checking tools send your data to external servers. I wanted something that:
- Runs entirely locally
- Doesn't require API keys
- Can search the web for verification
- Gives clear verdicts with sources

## Features

**Fact-Checking**
- Select text and click the floating button
- Right-click context menu option
- Manual entry in the side panel
- Keyboard shortcut (Ctrl+Enter)

**Local AI**
- Uses Ollama models running on your machine
- Automatically detects which models support function calling
- No external API calls for AI processing

**Web Search**
- AI can search DuckDuckGo to verify claims
- Sources ranked by credibility (government, academic, news, etc.)
- Results displayed with clickable links

**Verdicts**
- TRUE, FALSE, PARTIALLY TRUE, or UNVERIFIABLE
- Confidence level (HIGH, MEDIUM, LOW)
- Supporting evidence and sources

## Requirements

1. Install [Ollama](https://ollama.ai)
2. Pull a model:
   ```bash
   ollama pull qwen2.5
   ```
3. Start Ollama:
   ```bash
   ollama serve
   ```

## Installation

1. Clone the repo:
   ```bash
   git clone https://github.com/LiteObject/verifai.git
   ```

2. Open Chrome, go to `chrome://extensions/`

3. Enable "Developer mode"

4. Click "Load unpacked" and select the `verifai` folder

## Usage

**Option 1:** Select text on any page, click the floating "Fact-check" button

**Option 2:** Select text, right-click, choose "Fact-check with VerifAI"

**Option 3:** Open the side panel, paste text, click Fact-Check

## Project Structure

```
verifai/
├── manifest.json       # Extension manifest (V3)
├── sidepanel.html      # UI and styles
├── sidepanel.js        # Main logic, Ollama integration
├── content.js          # Text selection handling
├── background.js       # Service worker, context menu
├── icons/              # Extension icon (SVG)
└── README.md
```

## Configuration

Edit the `CONFIG` object in `sidepanel.js`:

```javascript
const CONFIG = {
    OLLAMA_ENDPOINT: 'http://localhost:11434',
    REQUEST_TIMEOUT: 120000,
    MAX_SEARCH_ITERATIONS: 3,
    MAX_RETRIES: 3,
};
```

## Recommended Models

These models work well for fact-checking:
- `qwen2.5` - Good reasoning, supports function calling
- `llama3.1` - Balanced speed and accuracy
- `mistral` - Fast responses

## Troubleshooting

**No models showing up?**
- Make sure Ollama is running (`ollama serve`)
- Check `ollama list` to see installed models
- Click Refresh in the extension settings

**Side panel won't open?**
- Requires Chrome 114 or newer
- Try reloading the extension

**Slow responses?**
- Try a smaller model variant
- Check available system memory

## Privacy

All processing happens locally. No data leaves your machine. No analytics, no tracking.

## License

Open source. See repository for details.

## Links

- [Ollama](https://ollama.ai)
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
