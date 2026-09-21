
// script.js — shared across all Precifio pages
document.addEventListener('DOMContentLoaded', () => {

    // ===== TYPING EFFECT (home hero only) =====
    const typedText = document.getElementById('typedText');
    if (typedText) {
        const fullText = 'Intelligence That Saves Time';
        let charIndex = 0;
        function typeText() {
            if (charIndex < fullText.length) {
                typedText.textContent += fullText.charAt(charIndex);
                charIndex++;
                setTimeout(typeText, 80);
            }
        }
        setTimeout(typeText, 600);
    }

    // ===== NAVBAR SCROLL =====
    const navbar = document.getElementById('navbar');
    const onScroll = () => {
        if (window.pageYOffset > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll);
    onScroll();

    // ===== MOBILE MENU =====
    const mobileToggle = document.getElementById('mobileToggle');
    const mobileMenu = document.getElementById('mobileMenu');
    const ICON_OPEN = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
    const ICON_CLOSE = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    if (mobileToggle && mobileMenu) {
        mobileToggle.addEventListener('click', () => {
            const isOpen = mobileMenu.classList.toggle('open');
            mobileToggle.innerHTML = isOpen ? ICON_CLOSE : ICON_OPEN;
        });
        mobileMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.remove('open');
                mobileToggle.innerHTML = ICON_OPEN;
            });
        });
    }

    // ===== ACTIVE NAV LINK (by body[data-page]) =====
    const page = document.body.dataset.page;
    if (page) {
        document.querySelectorAll('.nav-link, .mobile-link, .dropdown-menu a').forEach(link => {
            if (link.dataset.nav === page) link.classList.add('active');
        });
        // Highlight "Resources" when on a resource sub-page
        if (['faq', 'blog', 'books'].includes(page)) {
            document.querySelectorAll('[data-nav="resources"]').forEach(link => link.classList.add('active'));
        }
    }

    // ===== FAQ ACCORDION =====
    document.querySelectorAll('.faq-q').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            const wasOpen = item.classList.contains('open');
            document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
            if (!wasOpen) item.classList.add('open');
        });
    });

    // ===== PARTICLES (home hero only) =====
    const particlesContainer = document.getElementById('particles');
    if (particlesContainer) {
        for (let i = 0; i < 20; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            const size = 2 + Math.random() * 4;
            p.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (Math.random()*100) +
                '%;top:' + (60 + Math.random()*40) + '%;animation-delay:' + (Math.random()*6) +
                's;animation-duration:' + (6 + Math.random()*4) + 's;';
            particlesContainer.appendChild(p);
        }
    }

    // ===== SCROLL REVEAL =====
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = entry.target.dataset.delay || 0;
                setTimeout(() => entry.target.classList.add('visible'), parseInt(delay));
                revealObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '-50px 0px' });
    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

    // ===== COUNTER ANIMATION =====
    const countObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const text = el.textContent;
                const numMatch = text.match(/[\d.]+/);
                if (numMatch) {
                    const targetNum = parseFloat(numMatch[0]);
                    const suffix = text.replace(/[\d.]+/, '');
                    const duration = 2000;
                    const startTime = performance.now();
                    function updateCount(currentTime) {
                        const progress = Math.min((currentTime - startTime) / duration, 1);
                        const easeOut = 1 - Math.pow(1 - progress, 3);
                        el.textContent = Math.floor(easeOut * targetNum) + suffix;
                        if (progress < 1) requestAnimationFrame(updateCount);
                    }
                    requestAnimationFrame(updateCount);
                }
                countObserver.unobserve(el);
            }
        });
    }, { threshold: 0.5 });
    document.querySelectorAll('.stat-value').forEach(stat => countObserver.observe(stat));

    // ===== CONTACT FORM → Node/Supabase/Resend endpoint with mailto fallback =====
    const form = document.getElementById('projectForm');
    if (form) {
        const status = document.getElementById('formStatus');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(form).entries());
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.textContent = 'Sending…';
            status.className = 'form-status';
            try {
                const res = await fetch(form.dataset.endpoint || '/api/contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!res.ok) throw new Error('Request failed');

// Google Ads conversion — successful project brief submission
if (typeof gtag === 'function') {
    gtag('event', 'conversion', {
        'send_to': 'AW-18465898424/aYgGCJ6NioAdELj_nOVE',
        'value': 1.0,
        'currency': 'USD'
    });
}

status.textContent = 'Thanks — your project brief was sent. We typically reply within 24 hours.';
status.classList.add('success');
form.reset();
            } catch (err) {
                // Fallback: open prefilled email so no lead is ever lost
                const subject = encodeURIComponent('Project Inquiry — ' + (data.service || 'General'));
                const body = encodeURIComponent(
                    'Name: ' + data.name + '\nEmail: ' + data.email + '\nCompany: ' + (data.company || '-') +
                    '\nService: ' + data.service + '\nBudget: ' + (data.budget || '-') +
                    '\n\nProject details:\n' + data.message
                );
                status.innerHTML = 'Could not reach the server — your email app will open instead so nothing is lost.';
                status.classList.add('error');
                window.location.href = 'mailto:hello@precifio.app?subject=' + subject + '&body=' + body;
            }
            btn.disabled = false;
            btn.textContent = 'Send Project Brief';
        });
    }
});
