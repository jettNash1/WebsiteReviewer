document.getElementById('urlForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const urlInput = document.getElementById('urlInput');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const results = document.getElementById('results');
    const issuesList = document.getElementById('issuesList');
    
    // Show loading indicator
    loadingIndicator.classList.remove('hidden');
    results.classList.add('hidden');
    
    try {
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: urlInput.value }),
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('Server error:', data);
            throw new Error(data.details || data.error || 'Failed to analyze website');
        }
        
        // Clear previous results
        issuesList.innerHTML = '';
        
        // Add new results
        if (data.issues && data.issues.length > 0) {
            data.issues.forEach(issue => {
                const li = document.createElement('li');
                li.textContent = issue;
                issuesList.appendChild(li);
            });
        } else {
            const li = document.createElement('li');
            li.textContent = 'No issues found';
            issuesList.appendChild(li);
        }
        
        // Show results
        results.classList.remove('hidden');
    } catch (error) {
        console.error('Error:', error);
        alert(`Analysis failed: ${error.message}`);
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}); 