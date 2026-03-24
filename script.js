document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const chatUrlInput = document.getElementById('chatUrl');
    const generateBtn = document.getElementById('generateBtn');
    const formContainer = document.querySelector('.form-wrapper');
    const loadingState = document.getElementById('loadingState');
    const errorMessage = document.getElementById('errorMessage');
    const loadingText = document.querySelector('.loading-text');

    // --- Supported Domains Regex ---
    // chatgpt.com, chat.openai.com, claude.ai, g.co/gemini, gemini.google.com
    const aiUrlRegex = /^(https?:\/\/)?(chatgpt\.com|chat\.openai\.com|claude\.ai|g\.co\/gemini|gemini\.google\.com)\/.+/i;

    // --- Loading Texts Array ---
    const loadingMessages = [
        "Magic is happening... Extracting your chat!",
        "Analyzing AI responses...",
        "Applying beautiful styles...",
        "Generating high-quality PDF...",
        "Almost there! Wrapping things up..."
    ];

    let loadingInterval;

    // --- Helper Functions ---

    // Validate URL Input
    function isValidUrl(url) {
        if (!url || url.trim() === '') return false;
        return aiUrlRegex.test(url.trim());
    }

    // Show Error State
    function showError(message) {
        errorMessage.querySelector('span').textContent = message;
        errorMessage.classList.add('show');
        chatUrlInput.parentElement.style.borderColor = '#ef4444';
        chatUrlInput.parentElement.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.4)';
    }

    // Hide Error State
    function hideError() {
        errorMessage.classList.remove('show');
        chatUrlInput.parentElement.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        chatUrlInput.parentElement.style.boxShadow = 'none';
    }

    // Handle Generation Logic (Connected to real Backend)
    async function startGeneration(url) {
        // Hide Form, Show Loading
        formContainer.style.display = 'none';
        loadingState.classList.remove('hidden');

        // Cycle through loading messages
        let messageIndex = 0;
        loadingInterval = setInterval(() => {
            messageIndex = (messageIndex + 1) % loadingMessages.length;
            loadingText.textContent = loadingMessages[messageIndex];
        }, 2500);

        try {
            // Real API Call to Node.js Backend
            const response = await fetch('/api/generate-pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url: url })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Server error occurred.');
            }

            // Convert Response to a PDF File Blob
            const blob = await response.blob();
            
            // Create a fake URL for the Blob to trigger download
            const objectUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = 'ChatExport-ChatPDF.io.pdf';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(objectUrl);
            a.remove();
            
            clearInterval(loadingInterval);
            finishGeneration();

        } catch (error) {
            clearInterval(loadingInterval);
            console.error('API Error:', error);
            
            // Revert back and show error
            formContainer.style.display = 'block';
            loadingState.classList.add('hidden');
            showError(error.message);
        }
    }

    // Reset UI to initial state after "download"
    function finishGeneration() {
        loadingText.textContent = "🎉 PDF Generated Successfully!";
        loadingState.querySelector('.loader-ring').style.display = 'none';
        loadingState.querySelector('.progress-track').style.display = 'none';

        // Wait a moment then show form again
        setTimeout(() => {
            // alert removed, it actually downloads now!
            
            // Reset UI
            formContainer.style.display = 'block';
            loadingState.classList.add('hidden');
            loadingState.querySelector('.loader-ring').style.display = 'flex';
            loadingState.querySelector('.progress-track').style.display = 'block';
            chatUrlInput.value = '';
        }, 1500);
    }

    // --- Event Listeners ---

    // Button Click
    generateBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const url = chatUrlInput.value;
        
        if (isValidUrl(url)) {
            hideError();
            startGeneration(url);
        } else {
            showError('Please enter a valid ChatGPT, Claude, or Gemini link.');
        }
    });

    // Enter Key Support
    chatUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            generateBtn.click();
        }
    });

    // Clear error on input typing
    chatUrlInput.addEventListener('input', () => {
        if (errorMessage.classList.contains('show')) {
            hideError();
        }
    });
});
