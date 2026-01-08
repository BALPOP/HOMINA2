/**
 * Navigation System
 * Handles page switching and sidebar active states
 */

const PAGE_TITLES = {
    'dashboard': 'Operations Dashboard',
    'entries': 'All Entries',
    'results': 'Contest Results',
    'winners': 'Winners'
};

function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link[data-page]');
    const pages = document.querySelectorAll('.page-section');
    const pageTitle = document.getElementById('pageTitle');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageId = link.getAttribute('data-page');
            
            // Do not navigate if page is already active
            if (link.classList.contains('active')) return;

            // Update active link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Show current page
            pages.forEach(page => {
                if (page.id === `page-${pageId}`) {
                    page.style.display = 'block';
                } else {
                    page.style.display = 'none';
                }
            });

            // Update title
            if (pageTitle) {
                pageTitle.textContent = PAGE_TITLES[pageId] || 'Admin Console';
            }

            // Trigger page-specific initialization if defined in script.js
            if (typeof initializePage === 'function') {
                initializePage(pageId);
            }
        });
    });
}

// Initialize navigation when DOM is ready
document.addEventListener('DOMContentLoaded', setupNavigation);

