// Content script for VerifAI extension
// Handles text selection detection and floating button

(function () {
    'use strict';

    let floatingButton = null;
    let selectedText = '';

    // Create floating fact-check button
    function createFloatingButton() {
        if (floatingButton) return floatingButton;

        floatingButton = document.createElement('button');
        floatingButton.id = 'verifai-floating-btn';
        floatingButton.innerHTML = '✓ Fact-check';
        floatingButton.style.cssText = `
            position: absolute;
            z-index: 2147483647;
            background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 4px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            display: none;
            transition: all 0.2s ease;
        `;

        floatingButton.addEventListener('mouseenter', () => {
            floatingButton.style.transform = 'scale(1.05)';
            floatingButton.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        });

        floatingButton.addEventListener('mouseleave', () => {
            floatingButton.style.transform = 'scale(1)';
            floatingButton.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
        });

        floatingButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            triggerFactCheck();
        });

        document.body.appendChild(floatingButton);
        return floatingButton;
    }

    // Show floating button near selection
    function showFloatingButton(x, y) {
        const button = createFloatingButton();

        // Position the button above the selection
        const buttonWidth = 100;
        const buttonHeight = 35;

        let left = x - buttonWidth / 2;
        let top = y - buttonHeight - 10;

        // Keep button within viewport
        left = Math.max(10, Math.min(left, window.innerWidth - buttonWidth - 10));
        top = Math.max(10, top);

        button.style.left = `${left + window.scrollX}px`;
        button.style.top = `${top + window.scrollY}px`;
        button.style.display = 'block';
    }

    // Hide floating button
    function hideFloatingButton() {
        if (floatingButton) {
            floatingButton.style.display = 'none';
        }
    }

    // Trigger fact-check via background script
    function triggerFactCheck() {
        if (selectedText.trim()) {
            chrome.runtime.sendMessage({
                action: 'factCheckText',
                text: selectedText.trim()
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('VerifAI: Error sending message:', chrome.runtime.lastError);
                }
            });
        }
        hideFloatingButton();
    }

    // Handle text selection
    function handleSelection() {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text && text.length > 10 && text.length < 5000) {
            selectedText = text;

            // Get selection position
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();

            // Show button above the selection
            showFloatingButton(
                rect.left + rect.width / 2,
                rect.top
            );
        } else {
            hideFloatingButton();
        }
    }

    // Debounce function
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Listen for mouseup to detect selection
    document.addEventListener('mouseup', debounce((e) => {
        // Don't show button if clicking the button itself
        if (e.target.id === 'verifai-floating-btn') return;

        setTimeout(handleSelection, 10);
    }, 100));

    // Hide button when clicking elsewhere
    document.addEventListener('mousedown', (e) => {
        if (e.target.id !== 'verifai-floating-btn') {
            hideFloatingButton();
        }
    });

    // Hide button on scroll
    document.addEventListener('scroll', debounce(hideFloatingButton, 100));

    console.log('VerifAI content script loaded');
})();
