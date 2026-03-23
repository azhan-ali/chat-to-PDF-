const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Use stealth plugin to bypass Cloudflare / Bot detection
puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3000;

// --- Middlewares ---
app.use(cors()); 
app.use(express.json());

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

    try {
        console.log(`\n[🚀] New Request Processed for URL: ${finalUrl}`);
        
        console.log('[🤖] Launching Stealth Headless Browser...');
        const browser = await puppeteer.launch({ 
            headless: true, // "new" headless mode often breaks stealth evasions on ChatGPT
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--ignore-certificate-errors',
                '--window-size=1280,800'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set a realistic User-Agent and Headers to prevent ChatGPT API from blocking the request
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9'
        });

        // Use a standard desktop viewport
        await page.setViewport({ width: 1280, height: 800 });

        console.log('[🌐] Navigating to the URL...');
        // Fix: Use 'domcontentloaded' instead of 'networkidle2' because ChatGPT/Gemini have background polling which causes 60s timeout crash
        await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait extra time for Cloudflare/Turnstile and heavy React rendering
        console.log('[⏳] Waiting for Security Checks & Data Fetch (ChatGPT/Gemini/Claude)...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Solid 10 seconds to guarantee hydration

        // Auto-click "Try again" if ChatGPT fails to load content first time
        const clickedP = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const tryAgainBtn = buttons.find(b => b.textContent && (b.textContent.includes('Try again') || b.textContent.includes('Reload') || b.textContent.includes('Accept')));
            if (tryAgainBtn) {
                tryAgainBtn.click();
                return true;
            }
            return false;
        });
        
        if (clickedP) {
            console.log('[⏳] Clicked "Try again / Accept", waiting 6 seconds for data to fetch...');
            await new Promise(resolve => setTimeout(resolve, 6000));
        }

        console.log('[🧹] Cleaning up the page (Hiding Popups, Headers, Footers)...');
        
        // Inject script to delete unwanted UI elements (DOM Manipulation)
        await page.evaluate(() => {
            // Helper function to remove elements by selector
            const removeEls = (selector) => {
                document.querySelectorAll(selector).forEach(el => el.remove());
            };

            // 1. ChatGPT specific cleanup
            removeEls('div.flex-shrink-0'); // Usually sidebars/headers
            removeEls('button'); // Hide all buttons (Copy, Share, Like, Dislike)
            removeEls('[max-width="md"] header'); // Hide header
            removeEls('footer'); 
            removeEls('.sticky'); // Make sure sticky footers are gone

            // 2. Claude specific cleanup
            removeEls('.fixed'); 
            removeEls('nav');
            
            // 3. Gemini specific cleanup
            removeEls('chat-window-header');
            removeEls('bottom-bar');

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
            `;
            document.head.appendChild(style);

            const branding = document.createElement('div');
            branding.className = 'premium-pdf-header';
            branding.innerHTML = `
                <h2>Converted via ChatPDF.io</h2>
                <p>Premium AI Conversation Export &bull; Developed by Azhan Ali</p>
            `;
            document.body.insertBefore(branding, document.body.firstChild);
        });

        console.log('[📄] Generating Premium PDF... (Step 4: PDF Builder)');
        // Generate a beautifully formatted PDF from the cleaned DOM
        const pdfBuffer = await page.pdf({ 
            format: 'A4', 
            printBackground: true, 
            margin: { top: '30px', bottom: '30px', left: '20px', right: '20px' } 
        });
        
        await browser.close();
        console.log('[✅] PDF Extraction Successful! Sending file to user.');

        // Sending the generated PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="Exported-Conversation.pdf"');
        res.status(200).send(pdfBuffer);
        
    } catch (error) {
        console.error('Ek error aa gai PDF banate waqt:', error);
        res.status(500).json({ error: 'Scraping failed or link was invalid. PDF nahi ban payi.' });
    }
});

app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`✅ Server is awake and running beautifully!`);
    console.log(`🔊 Listening on http://localhost:${PORT}`);
    console.log(`===========================================`);
});
