import express from 'express';
import puppeteer from 'puppeteer';
import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import sharp from 'sharp';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Screenshot configuration
const SCREENSHOT_MAX_WIDTH = 1600;
const SCREENSHOT_MAX_HEIGHT = 1200;


// Initialize Vision model
let imageAnalyzer;

try {
    // Set to use local models
    env.cacheDir = './.cache';
    env.localModelPath = './.cache';

    // Use Microsoft's pre-trained vision model
    imageAnalyzer = await pipeline(
        'image-classification',
        'Xenova/vit-base-patch16-224'  // Changed to use Xenova's hosted version
    );
    console.log('Vision model loaded successfully');
} catch (error) {
    console.error('Error loading Vision model:', error);
    process.exit(1);
}

// Add this helper function to find related elements
const findRelatedElements = (pattern, pageDetails) => {
    if (!pageDetails) return [];
    
    return pageDetails.filter(element => {
        // Check element text content
        if (element.text && element.text.toLowerCase().includes(pattern)) {
            return true;
        }
        
        // Check element tag name
        if (element.tagName && element.tagName.toLowerCase().includes(pattern)) {
            return true;
        }
        
        // Check element class names
        if (element.className && element.className.toLowerCase().includes(pattern)) {
            return true;
        }
        
        // Check specific patterns
        switch (pattern) {
            case 'navigation':
                return ['nav', 'menu', 'navbar'].includes(element.tagName) ||
                       element.className.includes('nav') ||
                       element.className.includes('menu');
            case 'button':
                return element.tagName === 'button' || 
                       element.className.includes('btn') ||
                       element.className.includes('button');
            case 'layout':
                return ['header', 'footer', 'main', 'section', 'article'].includes(element.tagName);
            case 'table':
                return element.tagName === 'table' || 
                       element.className.includes('table') ||
                       element.className.includes('grid');
            default:
                return false;
        }
    });
};

// Add helper function to check contrast
const hasGoodContrast = (color1, color2) => {
    // Convert colors to RGB
    const getRGB = (color) => {
        const hex = color.replace('#', '');
        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
        };
    };

    // Calculate relative luminance
    const getLuminance = (r, g, b) => {
        const [rs, gs, bs] = [r, g, b].map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    };

    try {
        const rgb1 = getRGB(color1);
        const rgb2 = getRGB(color2);
        const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
        const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return ratio >= 4.5; // WCAG AA standard for normal text
    } catch (e) {
        return true; // If we can't calculate contrast, assume it's okay
    }
};

// Update the analyzeImage function to handle the pageDetails parameter
const analyzeImage = async (imageBase64, pageDetails) => {
    try {
        // Create a temporary file to store the image
        const tempImagePath = path.join(__dirname, 'temp_screenshot.png');
        
        // Write base64 to file
        await fs.promises.writeFile(tempImagePath, imageBase64, 'base64');
        
        // Process image with sharp
        await sharp(tempImagePath)
            .resize(224, 224)
            .toFormat('png')
            .toFile(path.join(__dirname, 'processed_screenshot.png'));

        // Read the processed file
        const processedImage = path.join(__dirname, 'processed_screenshot.png');

        // Analyze with the model
        const results = await imageAnalyzer(processedImage, {
            topk: 10
        });

        // Clean up temporary files
        try {
            await fs.promises.unlink(tempImagePath);
            await fs.promises.unlink(processedImage);
        } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
        }

        // Convert model output into design analysis
        const analysis = interpretResults(results, pageDetails);
        return analysis;
    } catch (error) {
        console.error('Analysis error:', error);
        throw error;
    }
};

// Add these constants for better analysis
const SEVERITY_LEVELS = {
    CRITICAL: 'Critical',
    MODERATE: 'Moderate',
    MINOR: 'Minor',
    GOOD: 'Good'
};

const DESIGN_PATTERNS = {
    OUTDATED: {
        patterns: ['table-based', 'marquee', 'frames', 'legacy', 'flash'],
        category: 'technical',
        impact: 'Critical: Outdated design patterns affect maintainability and user experience'
    },
    ACCESSIBILITY: {
        patterns: ['contrast', 'aria', 'alt-text', 'keyboard', 'focus'],
        category: 'accessibility',
        impact: 'Critical: Accessibility issues prevent some users from using the site'
    },
    RESPONSIVE: {
        patterns: ['mobile', 'responsive', 'adaptive', 'flexible'],
        category: 'technical',
        impact: 'Critical: Non-responsive design affects mobile users'
    },
    VISUAL_HIERARCHY: {
        patterns: ['hierarchy', 'heading', 'structure', 'organization'],
        category: 'visual',
        impact: 'Moderate: Poor visual hierarchy affects content comprehension'
    },
    NAVIGATION: {
        patterns: ['menu', 'navigation', 'links', 'sitemap'],
        category: 'ux',
        impact: 'Moderate: Navigation issues affect user journey'
    }
};

// Update the interpretResults function for more detailed analysis
const interpretResults = (results, pageDetails) => {
    let analysis = '';
    const issues = new Map();
    
    // Enhanced visual patterns with severity and impact
    const visualPatterns = {
        'text': {
            category: 'Typography and text content',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : score < 0.7 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects readability and content consumption'
        },
        'web': {
            category: 'Web interface elements',
            severity: score => score < 0.6 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects user interaction and experience'
        },
        'screen': {
            category: 'Screen layout',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects overall usability and content organization'
        },
        'interface': {
            category: 'User interface',
            severity: score => score < 0.6 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects user interaction patterns'
        },
        'button': {
            category: 'Interactive elements',
            severity: score => score < 0.7 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects user actions and conversions'
        },
        'menu': {
            category: 'Navigation',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects site navigation and user journey'
        },
        'image': {
            category: 'Visual content',
            severity: score => score < 0.6 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects visual appeal and content clarity'
        },
        'color': {
            category: 'Color scheme',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects brand consistency and accessibility'
        },
        'layout': {
            category: 'Page layout',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects content structure and readability'
        },
        'table': {
            category: 'Outdated table-based layout',
            severity: score => score < 0.3 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Severely affects maintainability and responsiveness'
        },
        'spacing': {
            category: 'Space utilization',
            severity: score => score < 0.6 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects content readability and visual appeal'
        },
        'mobile': {
            category: 'Mobile responsiveness',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects mobile user experience'
        },
        'navigation': {
            category: 'Navigation structure',
            severity: score => score < 0.5 ? SEVERITY_LEVELS.CRITICAL : SEVERITY_LEVELS.MODERATE,
            impact: 'Affects user journey and site usability'
        },
        'hierarchy': {
            category: 'Visual hierarchy',
            severity: score => score < 0.6 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects content comprehension and scanning'
        },
        'whitespace': {
            category: 'Space utilization',
            severity: score => score < 0.7 ? SEVERITY_LEVELS.MODERATE : SEVERITY_LEVELS.MINOR,
            impact: 'Affects readability and visual appeal'
        }
    };

    results.forEach(result => {
        const { label, score } = result;
        
        Object.entries(visualPatterns).forEach(([pattern, config]) => {
            if (label.toLowerCase().includes(pattern)) {
                // Find related elements in the page
                const relatedElements = findRelatedElements(pattern, pageDetails);
                
                const severity = config.severity(score);
                const issue = {
                    category: config.category,
                    severity,
                    confidence: Math.round(score * 100),
                    impact: config.impact,
                    suggestion: generateSuggestion(config.category, severity),
                    locations: relatedElements.map(el => ({
                        element: `${el.tagName}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className : ''}`,
                        position: `at (${el.rect.x}, ${el.rect.y})`,
                        preview: el.text?.substring(0, 50) || ''
                    }))
                };
                
                if (!issues.has(config.category)) {
                    issues.set(config.category, issue);
                }
            }
        });
    });

    // Convert issues map to formatted analysis text
    issues.forEach(issue => {
        analysis += `[${issue.severity}] ${issue.category}\n`;
        analysis += `- Confidence: ${issue.confidence}%\n`;
        analysis += `- Impact: ${issue.impact}\n`;
        analysis += `- Suggestion: ${issue.suggestion}\n\n`;
    });

    return analysis || 'No specific design issues detected';
};

// Add helper function to generate suggestions
const generateSuggestion = (category, severity) => {
    const suggestions = {
        'Typography and text content': {
            [SEVERITY_LEVELS.CRITICAL]: 'Implement consistent typography hierarchy and improve text contrast',
            [SEVERITY_LEVELS.MODERATE]: 'Review font sizes and line heights for better readability',
            [SEVERITY_LEVELS.MINOR]: 'Fine-tune typography for optimal reading experience'
        },
        'Navigation structure': {
            [SEVERITY_LEVELS.CRITICAL]: 'Restructure navigation to be more intuitive and user-friendly',
            [SEVERITY_LEVELS.MODERATE]: 'Simplify navigation and improve menu organization',
            [SEVERITY_LEVELS.MINOR]: 'Optimize navigation labels and structure'
        },
        // Add more suggestions for other categories...
    };

    return suggestions[category]?.[severity] || 
           'Consider updating this aspect following modern web design principles';
};

const categorizeIssues = (analysis) => {
    const categories = {
        visual: [],
        layout: [],
        ux: [],
        accessibility: [],
        technical: []
    };

    const lines = analysis.split('\n\n');
    lines.forEach(block => {
        if (!block.trim()) return;
        
        const [severityLine, ...details] = block.split('\n');
        const issue = {
            severity: severityLine.match(/\[(.*?)\]/)?.[1] || 'Unknown',
            details: details.map(d => d.replace(/^- /, '')).join(' | ')
        };

        if (severityLine.includes('Typography') || severityLine.includes('Color') || severityLine.includes('Visual')) {
            categories.visual.push(issue);
        } else if (severityLine.includes('Layout') || severityLine.includes('Space')) {
            categories.layout.push(issue);
        } else if (severityLine.includes('Navigation') || severityLine.includes('Interface')) {
            categories.ux.push(issue);
        } else if (severityLine.includes('Accessibility')) {
            categories.accessibility.push(issue);
        } else {
            categories.technical.push(issue);
        }
    });

    return categories;
};

// Update the page evaluation to get more specific details
const capturePageDetails = async (page) => {
    const elements = await page.evaluate(() => {
        const getElementInfo = (el) => {
            const rect = el.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(el);
            
            return {
                tagName: el.tagName.toLowerCase(),
                id: el.id,
                className: el.className,
                text: el.innerText,
                href: el.href || '',
                src: el.src || '',
                alt: el.alt || '',
                role: el.getAttribute('aria-role') || '',
                rect: {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height
                },
                styles: {
                    color: computedStyle.color,
                    backgroundColor: computedStyle.backgroundColor,
                    fontSize: computedStyle.fontSize,
                    fontFamily: computedStyle.fontFamily,
                    lineHeight: computedStyle.lineHeight,
                    display: computedStyle.display,
                    position: computedStyle.position,
                    padding: computedStyle.padding,
                    margin: computedStyle.margin
                },
                // Check for specific issues
                issues: {
                    missingAlt: el.tagName === 'IMG' && !el.alt,
                    missingLabel: (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.labels.length,
                    smallText: parseFloat(computedStyle.fontSize) < 12,
                    poorContrast: false, // Will be calculated later
                    outdatedHTML: el.tagName === 'FONT' || el.tagName === 'CENTER' || el.tagName === 'MARQUEE',
                    tableLayout: el.closest('table') !== null,
                    nonResponsive: computedStyle.width?.includes('px') && parseFloat(computedStyle.width) > 800
                }
            };
        };

        // Get all visible elements
        return Array.from(document.querySelectorAll('*'))
            .filter(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map(getElementInfo);
    });

    return elements;
};

// Update the analysis function to provide specific feedback
const analyzeWebsite = (pageDetails) => {
    // Initialize issues object with a new structure
    const issues = {
        accessibility: [],
        layout: [],
        ux: [],
        technical: [],
        visual: []
    };

    // Helper to add or update grouped issues
    const addGroupedIssue = (category, issue) => {
        // Create a unique key for the issue type
        const issueKey = `${issue.severity}_${issue.message}`;
        
        // Find existing group or create new one
        let group = issues[category].find(g => g.key === issueKey);
        
        if (!group) {
            group = {
                key: issueKey,
                severity: issue.severity,
                message: issue.message,
                suggestion: issue.suggestion,
                count: 0,
                locations: [],
                expanded: false // For UI toggle state
            };
            issues[category].push(group);
        }
        
        group.count++;
        group.locations.push({
            element: issue.element,
            location: issue.location
        });
    };

    pageDetails.forEach(element => {
        // Accessibility Issues
        if (element.issues.missingAlt) {
            addGroupedIssue('accessibility', {
                severity: 'Critical',
                message: 'Image missing alt text',
                element: `<img src="${element.src}">`,
                location: element.rect,
                suggestion: 'Add descriptive alt text to improve accessibility'
            });
        }

        // Technical Issues
        if (element.issues.nonResponsive) {
            addGroupedIssue('technical', {
                severity: 'Critical',
                message: 'Non-responsive fixed-width element detected',
                element: `<${element.tagName} style="width: ${element.styles.width}">`,
                location: element.rect,
                suggestion: 'Use relative units (%, rem) instead of fixed pixels'
            });
        }

        // Visual Issues
        if (element.issues.smallText) {
            addGroupedIssue('visual', {
                severity: 'Moderate',
                message: 'Small text detected',
                element: element.text?.substring(0, 50) || '',
                location: element.rect,
                suggestion: 'Increase font size to at least 12px for readability'
            });
        }

        // ... other issue checks ...
    });

    // Transform the issues object to include count in the summary
    Object.keys(issues).forEach(category => {
        issues[category] = issues[category].map(group => ({
            ...group,
            summary: `#${group.count} ${group.severity}`,
            // Format locations for display
            locations: group.locations.map(loc => ({
                ...loc,
                position: `(${loc.location.x}, ${loc.location.y})`
            }))
        }));
    });

    return issues;
};

app.post('/analyze', async (req, res) => {
    let browser;
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        console.log('Analyzing URL:', url);

        // Launch browser with additional options
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--window-size=1366,768'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        
        // Set longer timeout for requests
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(60000);
        
        // Set viewport
        await page.setViewport({ 
            width: 1920,
            height: 1440,
            deviceScaleFactor: 1
        });

        // Update request interception to allow CSS and images
        await page.setRequestInterception(true);
        page.on('request', request => {
            const blockedResourceTypes = [
                'media',
                'font',
                'websocket',
                'manifest',
                'other'
            ];
            
            if (blockedResourceTypes.includes(request.resourceType())) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigate to the page
        try {
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 45000 
            });
        } catch (navigationError) {
            console.warn('Navigation warning:', navigationError.message);
        }

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // First capture page details and analyze
        const pageDetails = await capturePageDetails(page);
        const issues = analyzeWebsite(pageDetails);

        // Now add the visual indicators and take screenshot
        await page.evaluate((analysisIssues) => {
            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '10000';
            
            Object.values(analysisIssues).flat().forEach(group => {
                group.locations.forEach(loc => {
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.left = `${loc.location.x}px`;
                    marker.style.top = `${loc.location.y}px`;
                    marker.style.width = `${loc.location.width || 20}px`;
                    marker.style.height = `${loc.location.height || 20}px`;
                    marker.style.border = '2px solid red';
                    marker.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                    marker.style.borderRadius = '3px';
                    
                    const label = document.createElement('div');
                    label.textContent = group.message;
                    label.style.position = 'absolute';
                    label.style.top = '-20px';
                    label.style.left = '0';
                    label.style.backgroundColor = 'red';
                    label.style.color = 'white';
                    label.style.padding = '2px 4px';
                    label.style.fontSize = '10px';
                    label.style.borderRadius = '2px';
                    label.style.whiteSpace = 'nowrap';
                    
                    marker.appendChild(label);
                    overlay.appendChild(marker);
                });
            });
            
            document.body.appendChild(overlay);
        }, issues);

        // Take screenshot with overlays
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            type: 'png',
            fullPage: true,
            captureBeyondViewport: true
        });

        // Clean up overlays
        await page.evaluate(() => {
            const overlay = document.querySelector('div[style*="z-index: 10000"]');
            if (overlay) overlay.remove();
        });

        // Calculate scores
        const calculateScore = (issueList) => {
            const weights = { Critical: 3, Moderate: 2, Minor: 1 };
            const totalIssues = issueList.reduce((sum, issue) => sum + weights[issue.severity], 0);
            return Math.max(0, 10 - totalIssues);
        };

        const scorecard = {
            accessibility: calculateScore(issues.accessibility),
            layout: calculateScore(issues.layout),
            ux: calculateScore(issues.ux),
            technical: calculateScore(issues.technical),
            visual: calculateScore(issues.visual)
        };

        await browser.close();
        browser = null;

        res.json({
            issues,
            scorecard,
            screenshot,
            summary: `Found ${Object.values(issues).flat().length} specific issues that need attention`
        });

    } catch (error) {
        console.error('Error during analysis:', error);
        res.status(500).json({ 
            error: 'Failed to analyze website', 
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
            }
        }
    }
});

// Add helper function to generate annotations
const generateAnnotations = (pageDetails) => {
    const annotations = [];
    pageDetails.forEach(element => {
        // Check for common issues
        if (element.styles.color && !hasGoodContrast(element.styles.color, element.styles.backgroundColor)) {
            annotations.push({
                input: Buffer.from(`<svg>
                    <rect x="${element.rect.x}" y="${element.rect.y}" 
                          width="${element.rect.width}" height="${element.rect.height}"
                          fill="none" stroke="red" stroke-width="2"/>
                    <text x="${element.rect.x}" y="${element.rect.y - 5}">Low Contrast</text>
                </svg>`),
                top: element.rect.y,
                left: element.rect.x
            });
        }
        // Add more issue checks...
    });
    return annotations;
};

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server with error handling
try {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
} catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
} 