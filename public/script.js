document.getElementById('urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const urlInput = document.getElementById('urlInput');
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.innerHTML = `
        <div class="loading-container">
            <div class="loading-spinner"></div>
            <div class="loading-text">Analyzing website design...</div>
        </div>
    `;
    const results = document.getElementById('results');
    const summary = document.getElementById('summary');
    const scorecardContainer = document.getElementById('scorecardContainer');
    const issuesAccordion = document.getElementById('issuesAccordion');
    
    loadingIndicator.classList.remove('hidden');
    results.classList.add('hidden');
    
    try {
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: urlInput.value?.trim() }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.details || data.error || 'Failed to analyze website');
        }
        
        // Validate required data before processing
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid response data received');
        }
        
        // Show results container first
        results.classList.remove('hidden');
        
        // Update summary with safe HTML encoding
        summary.innerHTML = `
            <h3>Analysis Summary</h3>
            <p>${data.summary ? data.summary.replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'No summary available'}</p>
        `;
        
        // Update scorecard with null checks
        scorecardContainer.innerHTML = '';
        if (data.scorecard && typeof data.scorecard === 'object') {
            Object.entries(data.scorecard).forEach(([category, score]) => {
                if (category && score != null) {
                    const severityClass = score >= 8 ? 'good' : 
                                        score >= 6 ? 'minor' :
                                        score >= 4 ? 'moderate' : 'critical';
                    
                    const categoryTitle = category.charAt(0).toUpperCase() + category.slice(1);
                    
                    scorecardContainer.innerHTML += `
                        <div class="score-card ${severityClass}">
                            <h4>${categoryTitle}</h4>
                            <div class="score-details">
                                <div class="score-value">${score}/10</div>
                                <div class="issue-count">
                                    ${(data.issues?.[category]?.length || 0)} issues
                                </div>
                            </div>
                        </div>
                    `;
                }
            });
        }
        
        // Update issues accordion with additional validation
        issuesAccordion.innerHTML = '';
        if (data.issues && typeof data.issues === 'object') {
            renderIssues(data.issues);
        }
        
        // Updated screenshot viewer creation
        if (data.screenshot) {
            const screenshotSection = document.createElement('div');
            screenshotSection.className = 'screenshot-section';
            screenshotSection.innerHTML = `
                <h3>Visual Analysis</h3>
                <div class="screenshot-container">
                    <div class="screenshot-wrapper">
                        <img src="data:image/png;base64,${data.screenshot}" 
                             alt="Annotated screenshot of the analyzed website"
                             loading="lazy" />
                        ${generateIssueOverlays(data.issues)}
                    </div>
                </div>
            `;
            
            scorecardContainer.parentNode.insertBefore(
                screenshotSection,
                scorecardContainer.nextSibling
            );

            // Add hover interactions for issue overlays
            const overlays = screenshotSection.querySelectorAll('.issue-overlay');
            overlays.forEach(overlay => {
                overlay.addEventListener('mouseenter', () => {
                    overlay.style.zIndex = '200';
                    overlay.style.background = 'rgba(255, 0, 0, 0.2)';
                });
                
                overlay.addEventListener('mouseleave', () => {
                    overlay.style.zIndex = '100';
                    overlay.style.background = 'rgba(255, 0, 0, 0.1)';
                });
            });
        }
        
    } catch (error) {
        console.error('Error:', error);
        alert(`Analysis failed: ${error.message}`);
        results.classList.add('hidden'); // Hide results on error
    } finally {
        loadingIndicator.classList.add('hidden');
    }
});

// Add this function for accordion functionality
window.toggleAccordion = function(header) {
    const content = header.nextElementSibling;
    const isActive = content.classList.contains('active');
    
    // Close all accordion items
    document.querySelectorAll('.accordion-content').forEach(item => {
        item.classList.remove('active');
    });
    
    // Toggle the clicked item if it wasn't already active
    if (!isActive) {
        content.classList.add('active');
    }
};

// Add clustering helper functions
const CLUSTER_RADIUS = 50; // Base radius for clustering in pixels

const clusterIssues = (issues) => {
    const clusters = [];
    const allIssues = Object.entries(issues).flatMap(([category, categoryIssues]) =>
        categoryIssues.map(issue => ({...issue, category}))
    ).filter(issue => issue.location);

    allIssues.forEach(issue => {    
        let addedToCluster = false;
        
        for (const cluster of clusters) {
            if (isWithinCluster(issue.location, cluster.center)) {
                cluster.issues.push(issue);
                // Recalculate cluster center
                cluster.center = calculateClusterCenter(cluster.issues);
                addedToCluster = true;
                break;
            }
        }

        if (!addedToCluster) {
            clusters.push({
                center: { x: issue.location.x, y: issue.location.y },
                issues: [issue]
            });
        }
    });

    return clusters;
};

const isWithinCluster = (point, center) => {
    const distance = Math.sqrt(
        Math.pow(point.x - center.x, 2) + 
        Math.pow(point.y - center.y, 2)
    );
    return distance <= CLUSTER_RADIUS;
};

const calculateClusterCenter = (issues) => {
    const sum = issues.reduce((acc, issue) => ({
        x: acc.x + issue.location.x,
        y: acc.y + issue.location.y
    }), { x: 0, y: 0 });

    return {
        x: sum.x / issues.length,
        y: sum.y / issues.length
    };
};

// Update the getIssueType helper to be more comprehensive
const getIssueType = (issue) => {
    const message = issue.message.toLowerCase();
    
    // Accessibility issues
    if (message.includes('alt text') || 
        message.includes('aria') || 
        message.includes('screen reader') ||
        message.includes('accessibility')) {
        return 'accessibility';
    }
    
    // Technical issues
    if (message.includes('fixed-width') || 
        message.includes('non-responsive') ||
        message.includes('fixed width') ||
        message.includes('responsive')) {
        return 'technical';
    }
    
    // Visual issues
    if (message.includes('font size') || 
        message.includes('text detected') ||
        message.includes('small text') ||
        message.includes('contrast') ||
        message.includes('color')) {
        return 'visual';
    }
    
    // Layout issues
    if (message.includes('layout') || 
        message.includes('spacing') ||
        message.includes('alignment') ||
        message.includes('position')) {
        return 'layout';
    }
    
    // UX issues
    if (message.includes('navigation') || 
        message.includes('button') ||
        message.includes('interaction') ||
        message.includes('usability')) {
        return 'ux';
    }
    
    return 'other';
};

// Simplified overlay generation
const generateIssueOverlays = (issues) => {
    let overlays = '';
    
    Object.entries(issues).forEach(([category, categoryIssues]) => {
        if (!categoryIssues || categoryIssues.length === 0) return;
        
        categoryIssues.forEach(issue => {
            issue.locations.forEach(loc => {
                if (!loc.location) return;
                
                // Calculate dimensions with a minimum size
                const width = loc.location.width || 50;
                const height = loc.location.height || 20;
                
                overlays += `
                    <div class="issue-overlay" 
                         style="
                            left: ${loc.location.x}px;
                            top: ${loc.location.y}px;
                            width: ${width}px;
                            height: ${height}px;
                         "
                         title="${issue.message}"
                    >
                        <span class="issue-label">${issue.message}</span>
                    </div>
                `;
            });
        });
    });
    
    return overlays;
};

// Update the renderIssues function to use original categories
const renderIssues = (issues) => {
    const accordion = document.getElementById('issuesAccordion');
    accordion.innerHTML = '';

    // Categories to display in order
    const categories = [
        { key: 'accessibility', label: 'Accessibility' },
        { key: 'technical', label: 'Technical' },
        { key: 'visual', label: 'Visual' },
        { key: 'layout', label: 'Layout' },
        { key: 'ux', label: 'User Experience' }
    ];

    categories.forEach(({ key, label }) => {
        const categoryIssues = issues[key];
        if (!categoryIssues || categoryIssues.length === 0) return;

        // Create expandable category section
        const categoryDiv = document.createElement('div');
        categoryDiv.className = 'category-section';

        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.onclick = () => toggleAccordion(categoryHeader);
        categoryHeader.innerHTML = `<h3>${label}</h3>`;

        const categoryContent = document.createElement('div');
        categoryContent.className = 'accordion-content';

        categoryIssues.forEach(issue => {
            const issueDiv = document.createElement('div');
            issueDiv.className = 'issue-item';

            // Create header with severity and count
            const header = document.createElement('div');
            header.className = 'issue-header';
            header.innerHTML = `
                <div class="severity-container">
                    <span class="severity ${issue.severity.toLowerCase()}">${issue.severity}</span>
                    <span class="instance-count">#${issue.count}</span>
                </div>
                <div class="issue-message">${issue.message}</div>
            `;

            // Create content
            const content = document.createElement('div');
            content.className = 'issue-content';
            
            // Add location section
            const location = document.createElement('div');
            location.className = 'location';
            location.innerHTML = `
                <div>Location:</div>
                <details>
                    <summary>Details</summary>
                    <ul>
                        ${issue.locations.map(loc => 
                            `<li>At position ${loc.position}: ${loc.element}</li>`
                        ).join('')}
                    </ul>
                </details>
            `;

            // Add suggestion
            const suggestion = document.createElement('div');
            suggestion.className = 'suggestion';
            suggestion.innerHTML = `<strong>Suggestion:</strong> ${issue.suggestion}`;

            content.appendChild(location);
            content.appendChild(suggestion);
            
            issueDiv.appendChild(header);
            issueDiv.appendChild(content);
            categoryContent.appendChild(issueDiv);
        });

        categoryDiv.appendChild(categoryHeader);
        categoryDiv.appendChild(categoryContent);
        accordion.appendChild(categoryDiv);
    });
};

// Add styles to restore the original look
const additionalStyles = `
    .category-section {
        margin: 10px 0;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
    }

    .category-header {
        padding: 10px 15px;
        background: #f8f8f8;
        cursor: pointer;
        border-bottom: 1px solid #e0e0e0;
    }

    .category-header h3 {
        margin: 0;
        font-size: 1.1em;
    }

    .accordion-content {
        display: none;
        padding: 15px;
    }

    .accordion-content.active {
        display: block;
    }

    .issue-item {
        margin: 10px 0;
        padding-left: 15px;
    }

    .severity-container {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .severity {
        padding: 3px 8px;
        border-radius: 3px;
        font-size: 0.9em;
        font-weight: 500;
    }

    .severity.critical {
        background-color: #ffebee;
        color: #c62828;
    }

    .severity.moderate {
        background-color: #fff3e0;
        color: #ef6c00;
    }

    .severity.minor {
        background-color: #e8f5e9;
        color: #2e7d32;
    }

    .instance-count {
        background: #f0f0f0;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.9em;
        color: #666;
    }

    .location {
        margin: 10px 0;
    }

    .suggestion {
        margin-top: 10px;
        color: #444;
    }

    details {
        margin: 5px 0;
    }

    details summary {
        cursor: pointer;
        color: #2196f3;
    }

    details ul {
        margin: 8px 0;
        padding-left: 20px;
    }

    details li {
        margin: 4px 0;
        color: #666;
    }

    .filter-controls {
        margin: 10px 0;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .filter-btn {
        padding: 6px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: #f8f8f8;
        cursor: pointer;
        font-size: 0.9em;
        transition: all 0.2s ease;
    }

    .filter-btn:hover {
        background: #eee;
    }

    .filter-btn.active {
        background: #2196f3;
        color: white;
        border-color: #1976d2;
    }

    .issue-overlay {
        position: absolute;
        z-index: 100;
        width: 20px;
        height: 20px;
    }

    .issue-marker {
        display: block;
        width: 100%;
        height: 100%;
        border: 2px solid;
        border-radius: 50%;
        background: rgba(255, 0, 0, 0.2);
    }

    .issue-overlay.critical .issue-marker {
        border-color: #c62828;
        background: rgba(198, 40, 40, 0.2);
    }

    .issue-overlay.moderate .issue-marker {
        border-color: #ef6c00;
        background: rgba(239, 108, 0, 0.2);
    }

    .issue-overlay.minor .issue-marker {
        border-color: #2e7d32;
        background: rgba(46, 125, 50, 0.2);
    }

    .issue-tooltip {
        display: none;
        position: absolute;
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        background: white;
        padding: 8px;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        white-space: nowrap;
        z-index: 101;
    }

    .issue-overlay:hover .issue-tooltip {
        display: block;
    }

    .issue-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
    }

    .severity-container {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .issue-message {
        font-weight: 500;
    }

    .issue-overlay {
        position: absolute;
        z-index: 100;
        width: 20px;
        height: 20px;
        pointer-events: auto;
        cursor: pointer;
    }

    .issue-overlay[style*="display: none"] {
        pointer-events: none;
    }

    .screenshot-section {
        width: 100%;
        max-width: 100%;
        margin: 20px 0;
    }

    .screenshot-container {
        background: #fff;
    }

    .container {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: 0 20px;
    }

    @media (max-width: 1440px) {
        .container {
            padding: 0 10px;
        }
    }
`;

// Add the styles
const styleSheet = document.createElement('style');
styleSheet.textContent = additionalStyles;
document.head.appendChild(styleSheet);

const overlay = document.createElement('div');
overlay.style.position = 'absolute';
overlay.style.top = '0';
overlay.style.left = '0';
overlay.style.pointerEvents = 'none';
overlay.style.zIndex = '10000';
overlay.style.width = '100%';
overlay.style.height = '100%';
overlay.style.transformOrigin = 'top left';

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
        marker.style.transformOrigin = 'top left';
        
        const label = document.createElement('div');
        label.textContent = group.message;
        label.style.position = 'absolute';
        label.style.top = '-20px';
        label.style.left = '0';
        label.style.backgroundColor = 'red';
        label.style.color = 'white';
        label.style.padding = '2px 4px';
        label.style.fontSize = '10px';
        label.style.whiteSpace = 'nowrap';
        label.style.transformOrigin = 'top left';
        
        marker.appendChild(label);
        overlay.appendChild(marker);
    });
});

document.body.appendChild(overlay);

function showLoading() {
    const loadingContainer = document.createElement('div');
    loadingContainer.className = 'loading-container';
    
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    
    const loadingText = document.createElement('div');
    loadingText.className = 'loading-text';
    loadingText.textContent = 'Analyzing website design...';
    
    loadingContainer.appendChild(spinner);
    loadingContainer.appendChild(loadingText);
    document.body.appendChild(loadingContainer);
}

function hideLoading() {
    const loadingContainer = document.querySelector('.loading-container');
    if (loadingContainer) {
        loadingContainer.remove();
    }
} 