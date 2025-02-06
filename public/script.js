document.getElementById('urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const urlInput = document.getElementById('urlInput');
    const loadingIndicator = document.getElementById('loadingIndicator');
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
        
        // Add screenshot viewer before updating accordion
        if (data.screenshot) {
            const screenshotSection = document.createElement('div');
            screenshotSection.className = 'screenshot-section';
            screenshotSection.innerHTML = `
                <h3>Visual Analysis</h3>
                <div class="screenshot-viewer">
                    <div class="screenshot-container">
                        <img src="data:image/png;base64,${data.screenshot}" alt="Annotated screenshot" />
                        ${generateIssueOverlays(data.issues)}
                    </div>
                    <div class="screenshot-controls">
                        <button class="zoom-btn" onclick="zoomScreenshot(1.2)">Zoom In</button>
                        <button class="zoom-btn" onclick="zoomScreenshot(0.8)">Zoom Out</button>
                        <button class="zoom-btn" onclick="resetScreenshot()">Reset</button>
                    </div>
                </div>
            `;
            
            // Insert after scorecard
            scorecardContainer.parentNode.insertBefore(
                screenshotSection,
                scorecardContainer.nextSibling
            );
        }
        
        // Update issues accordion with additional validation
        issuesAccordion.innerHTML = '';
        if (data.issues && typeof data.issues === 'object') {
            Object.entries(data.issues).forEach(([category, issues]) => {
                if (!Array.isArray(issues) || issues.length === 0) return;
                
                const showIssueDetails = (issue) => {
                    if (!issue) return '';
                    return `
                        <div class="issue-details">
                            <div class="issue-location">
                                <strong>Location:</strong> 
                                <code>${issue.element || 'Unknown element'}</code>
                                ${issue.location ? `<span class="coordinates">(${issue.location.x || 0}, ${issue.location.y || 0})</span>` : ''}
                            </div>
                            <div class="issue-message">${issue.message || 'No message available'}</div>
                            <div class="issue-suggestion">
                                <strong>Suggestion:</strong> ${issue.suggestion || 'No suggestion available'}
                            </div>
                        </div>
                    `;
                };
                
                const issuesList = issues.map(issue => `
                    <li class="issue-item">
                        <div class="issue-severity severity-${issue.severity.toLowerCase()}">
                            ${issue.severity}
                        </div>
                        ${showIssueDetails(issue)}
                    </li>
                `).join('');
                
                issuesAccordion.innerHTML += `
                    <div class="accordion-item">
                        <div class="accordion-header" onclick="toggleAccordion(this)">
                            <span>${category} Issues</span>
                            <span class="issue-count">${issues.length}</span>
                        </div>
                        <div class="accordion-content">
                            <ul class="issue-list">
                                ${issuesList}
                            </ul>
                        </div>
                    </div>
                `;
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

// Update generateIssueOverlays to handle clustering
const generateIssueOverlays = (issues) => {
    const clusters = clusterIssues(issues);
    
    return clusters.map(cluster => {
        const severityClasses = new Set(cluster.issues.map(issue => issue.severity.toLowerCase()));
        const severityClass = severityClasses.size > 1 ? 'mixed' : Array.from(severityClasses)[0];
        
        const issuesList = cluster.issues.map(issue => 
            `<li>${issue.category}: ${issue.message}</li>`
        ).join('');

        return `
            <div class="issue-overlay ${severityClass}"
                 style="left: ${cluster.center.x}px; top: ${cluster.center.y}px;"
                 data-cluster-size="${cluster.issues.length}">
                <span class="issue-marker">
                    ${cluster.issues.length > 1 ? `<span class="cluster-count">${cluster.issues.length}</span>` : ''}
                </span>
                <div class="issue-tooltip">
                    <strong>${cluster.issues.length} ${cluster.issues.length > 1 ? 'Issues' : 'Issue'}</strong>
                    <ul>${issuesList}</ul>
                </div>
            </div>
        `;
    }).join('');
};

// Update zoom functionality to handle clustering visibility
window.zoomScreenshot = (factor) => {
    const container = document.querySelector('.screenshot-container');
    if (!container) return;
    
    currentZoom *= factor;
    container.style.transform = `scale(${currentZoom})`;
    container.style.transformOrigin = 'top left';

    // Update cluster visibility based on zoom level
    const overlays = container.querySelectorAll('.issue-overlay');
    overlays.forEach(overlay => {
        const clusterSize = parseInt(overlay.dataset.clusterSize) || 1;
        
        if (currentZoom >= 1.5 || clusterSize === 1) {
            overlay.classList.remove('clustered');
        } else {
            overlay.classList.add('clustered');
        }
    });
};

window.resetScreenshot = () => {
    const container = document.querySelector('.screenshot-container');
    if (!container) return;
    
    currentZoom = 1;
    container.style.transform = 'scale(1)';
}; 