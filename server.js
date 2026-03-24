const express = require('express');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const chromium = require('@sparticuz/chromium');

// Use stealth plugin to bypass Cloudflare / Bot detection
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
app.use(cors()); 
app.use(express.json());

// Serve static files from the current folder (Works locally)
app.use(express.static(__dirname));

// Fix for Vercel: Explicitly define routes so Vercel's bundler includes these files
app.get('/style.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/script.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'script.js'));
});

// Serve Frontend properly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Platform Detection Helper ---
function detectPlatform(url) {
    if (/chatgpt\.com|chat\.openai\.com/i.test(url)) return 'chatgpt';
    if (/gemini\.google\.com|g\.co\/gemini/i.test(url)) return 'gemini';
    if (/claude\.ai/i.test(url)) return 'claude';
    return 'unknown';
}

// --- Platform-specific content selectors to wait for ---
const PLATFORM_CONTENT_SELECTORS = {
    chatgpt: [
        '[data-message-author-role]',           // Chat message containers
        'article',                               // Article wrapper for messages  
        '.markdown',                             // Rendered markdown content
        '.text-message',                         // Text message blocks
    ],
    gemini: [
        'share-turn-viewer',                     // Gemini shared page turn viewer
        'message-content',                       // Message content container
        'response-container',                    // Response container
        '.markdown',                             // Markdown rendered content
    ],
    claude: [
        '.font-user-message',                   // Claude user message
        '[data-testid]',                         // Claude test IDs
    ]
};

// --- Wait for platform-specific content to load ---
async function waitForContent(page, platform) {
    const selectors = PLATFORM_CONTENT_SELECTORS[platform] || [];
    
    for (const selector of selectors) {
        try {
            await page.waitForSelector(selector, { timeout: 15000 });
            console.log(`[✅] Content selector found: "${selector}"`);
            return true;
        } catch (e) {
            console.log(`[⏳] Selector "${selector}" not found, trying next...`);
        }
    }
    
    // If no specific selector was found, check if the page has substantial content
    const hasContent = await page.evaluate(() => {
        return document.body.innerText.length > 200;
    });
    
    if (hasContent) {
        console.log('[✅] Page has substantial text content, proceeding...');
        return true;
    }
    
    console.log('[⚠️] No specific content selectors found, will rely on wait time...');
    return false;
}

// --- API Endpoint: Generate PDF ---
app.post('/api/generate-pdf', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Please provide a valid shared chat link.' });
    }

    // Fix: Ensure URL has https:// otherwise Puppeteer throws invalid URL error instantly
    let finalUrl = url.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl;
    }

    const platform = detectPlatform(finalUrl);
    let browser;

    try {
        console.log(`\n[🚀] New Request Processed for URL: ${finalUrl}`);
        console.log(`[🔍] Detected Platform: ${platform.toUpperCase()}`);
        
        console.log('[🤖] Launching Stealth Headless Browser...');
        
        const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
        let launchOptions = {
            headless: 'new',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--ignore-certificate-errors',
                '--window-size=1280,800',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process'
            ]
        };

        if (isVercel) {
            console.log('[☁️] Running in Vercel mode: Injecting @sparticuz/chromium');
            launchOptions = {
                args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            };
        }

        browser = await puppeteer.launch(launchOptions);
        
        const page = await browser.newPage();
        
        // Set a realistic User-Agent and Headers to prevent ChatGPT API from blocking the request
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
        });

        // Use a standard desktop viewport
        await page.setViewport({ width: 1280, height: 800 });

        // Enable JavaScript and allow all cookies
        await page.setJavaScriptEnabled(true);

        console.log('[🌐] Navigating to the URL...');
        
        // Platform-specific navigation strategy
        if (platform === 'chatgpt') {
            // ChatGPT shared pages: try networkidle2 first with generous timeout
            try {
                await page.goto(finalUrl, { waitUntil: 'networkidle2', timeout: 45000 });
            } catch (navError) {
                console.log('[⚠️] networkidle2 timed out for ChatGPT, retrying with domcontentloaded...');
                await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
        } else if (platform === 'gemini') {
            // Gemini shared pages: use networkidle2 - these pages load via JS
            try {
                await page.goto(finalUrl, { waitUntil: 'networkidle2', timeout: 45000 });
            } catch (navError) {
                console.log('[⚠️] networkidle2 timed out for Gemini, retrying with domcontentloaded...');
                await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            }
        } else {
            // Claude and others
            await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        
        // Wait for Cloudflare/Turnstile challenge if present
        console.log('[⏳] Waiting for Security Checks...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Auto-click "Try again" / "Accept" / "Verify" buttons if present
        const clickedP = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const actionBtn = buttons.find(b => b.textContent && (
                b.textContent.includes('Try again') || 
                b.textContent.includes('Reload') || 
                b.textContent.includes('Accept') ||
                b.textContent.includes('Verify') ||
                b.textContent.includes('Continue')
            ));
            if (actionBtn) {
                actionBtn.click();
                return true;
            }
            return false;
        });
        
        if (clickedP) {
            console.log('[⏳] Clicked action button, waiting for page reload...');
            await new Promise(resolve => setTimeout(resolve, 8000));
        }

        // Wait for actual platform content to appear
        console.log('[⏳] Waiting for chat content to render...');
        const contentFound = await waitForContent(page, platform);
        
        // Extra wait for JS hydration after content selectors are found
        if (platform === 'chatgpt') {
            console.log('[⏳] Extra wait for ChatGPT React hydration...');
            await new Promise(resolve => setTimeout(resolve, 8000));
        } else if (platform === 'gemini') {
            console.log('[⏳] Extra wait for Gemini web components to render...');
            await new Promise(resolve => setTimeout(resolve, 8000));
            
            // Gemini sometimes lazy-loads content, scroll to trigger it
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 300;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= document.body.scrollHeight) {
                            clearInterval(timer);
                            window.scrollTo(0, 0);
                            resolve();
                        }
                    }, 200);
                });
            });
            await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Debug: Log page content length and title
        const debugInfo = await page.evaluate(() => {
            return {
                title: document.title,
                bodyLength: document.body.innerText.length,
                url: window.location.href
            };
        });
        console.log(`[🔍] Page Debug: Title="${debugInfo.title}", Content Length=${debugInfo.bodyLength}, Final URL=${debugInfo.url}`);

        console.log('[🧹] Cleaning up the page (Hiding Popups, Headers, Footers)...');
        
        // Inject script to delete unwanted UI elements (DOM Manipulation)
        await page.evaluate((currentPlatform) => {
            // Helper function to remove elements by selector
            const removeEls = (selector) => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            };

            // Platform-specific cleanup
            if (currentPlatform === 'chatgpt') {
                removeEls('div.flex-shrink-0'); // Usually sidebars/headers
                removeEls('button'); // Hide all buttons (Copy, Share, Like, Dislike)
                removeEls('[max-width="md"] header'); // Hide header
                removeEls('footer'); 
                removeEls('.sticky'); // Make sure sticky footers are gone
                removeEls('header');
                removeEls('[role="banner"]');
                removeEls('.bg-token-sidebar-surface-primary');
            } else if (currentPlatform === 'claude') {
                removeEls('.fixed'); 
                removeEls('nav');
                removeEls('button');
            } else if (currentPlatform === 'gemini') {
                removeEls('chat-window-header');
                removeEls('bottom-bar');
                removeEls('.share-title-section button');
                removeEls('.link-action-buttons');
                removeEls('header');
                removeEls('footer');
                removeEls('[role="banner"]');
                removeEls('[role="navigation"]');
            }

            // 4. Premium PDF Styling & Branding injection
            const style = document.createElement('style');
            style.innerHTML = `
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
                
                body, * {
                    font-family: 'Plus Jakarta Sans', sans-serif !important;
                }
                
                body {
                    background-color: #fafafa !important;
                    color: #1e293b !important;
                }

                .premium-pdf-header {
                    background: linear-gradient(135deg, #8b5cf6, #ec4899) !important;
                    border-radius: 16px !important;
                    padding: 30px !important;
                    text-align: center !important;
                    margin-bottom: 40px !important;
                    box-shadow: 0 10px 25px rgba(139, 92, 246, 0.2) !important;
                }
                
                .premium-pdf-header h2 {
                    color: #ffffff !important;
                    font-size: 32px !important;
                    font-weight: 800 !important;
                    margin: 0 !important;
                    letter-spacing: -0.5px !important;
                }
                
                .premium-pdf-header p {
                    color: rgba(255, 255, 255, 0.9) !important;
                    margin-top: 10px !important;
                    font-weight: 500 !important;
                    font-size: 15px !important;
                }

                /* Make chat bubbles look premium too if possible */
                .font-user-message, div[data-message-author-role="user"] {
                    background-color: #f1f5f9 !important;
                    border: 1px solid #e2e8f0 !important;
                    padding: 20px !important;
                    border-radius: 12px !important;
                    margin-bottom: 20px !important;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05) !important;
                }

                /* Gemini specific premium styling */
                share-turn-viewer {
                    display: block !important;
                    padding: 16px !important;
                    margin-bottom: 12px !important;
                }

                user-query {
                    background-color: #f1f5f9 !important;
                    border: 1px solid #e2e8f0 !important;
                    padding: 16px !important;
                    border-radius: 12px !important;
                    display: block !important;
                    margin-bottom: 12px !important;
                }

                response-container {
                    display: block !important;
                    padding: 16px !important;
                }
            `;
            document.head.appendChild(style);

            const branding = document.createElement('div');
            branding.className = 'premium-pdf-header';
            branding.innerHTML = `
                <h2>Converted via ChatPDF.io</h2>
                <p>Premium AI Conversation Export &bull; Developed by Azhan Ali</p>
            `;
            document.body.insertBefore(branding, document.body.firstChild);
        }, platform);

        console.log('[📄] Generating Premium PDF... (Step 4: PDF Builder)');
        // Generate a beautifully formatted PDF from the cleaned DOM
        const pdfBuffer = await page.pdf({ 
            format: 'A4', 
            printBackground: true, 
            margin: { top: '30px', bottom: '30px', left: '20px', right: '20px' } 
        });
        
        await browser.close();
        browser = null;
        console.log('[✅] PDF Extraction Successful! Sending file to user.');

        // Sending the generated PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Exported-Conversation.pdf"');
        res.status(200).send(pdfBuffer);
        
    } catch (error) {
        console.error('Ek error aa gai PDF banate waqt:', error);
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
        res.status(500).json({ error: 'Scraping failed or link was invalid. PDF nahi ban payi.' });
    }
});

app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`✅ Server is awake and running beautifully!`);
    console.log(`🔊 Listening on http://localhost:${PORT}`);
    console.log(`===========================================`);
});
