// Background script for VerifAI extension
// Handles side panel setup and context menu

// Set up side panel behavior on install
chrome.runtime.onInstalled.addListener(() => {
    console.log('VerifAI extension installed');

    // Set the side panel to open on action click
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
        .catch((error) => console.error('Error setting panel behavior:', error));

    // Create context menu item for fact-checking selected text
    chrome.contextMenus.create({
        id: 'verifai-fact-check',
        title: 'Fact-check with VerifAI',
        contexts: ['selection']
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'verifai-fact-check' && info.selectionText) {
        // Store the selected text for the side panel to retrieve
        chrome.storage.local.set({
            pendingFactCheck: {
                text: info.selectionText,
                timestamp: Date.now()
            }
        });

        // Open the side panel
        chrome.sidePanel.open({ windowId: tab.windowId })
            .then(() => {
                console.log('Side panel opened for fact-checking');
            })
            .catch((error) => {
                console.error('Error opening side panel:', error);
            });
    }
});

// Handle action click to open side panel
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        console.log('Side panel opened from action click');
    } catch (error) {
        console.error('Error opening side panel from action click:', error);
    }
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openSidePanel') {
        chrome.sidePanel.open({ windowId: message.windowId })
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error('Error opening side panel:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }

    if (message.action === 'factCheckText') {
        // Store the text and open side panel
        chrome.storage.local.set({
            pendingFactCheck: {
                text: message.text,
                timestamp: Date.now()
            }
        });

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.sidePanel.open({ windowId: tabs[0].windowId })
                    .then(() => sendResponse({ success: true }))
                    .catch((error) => sendResponse({ success: false, error: error.message }));
            }
        });
        return true;
    }
});
