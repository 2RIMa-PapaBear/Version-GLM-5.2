const STATE_KEY_PREFIX = 'collapse-';

const ALWAYS_OPEN = new Set(['go-nogo-banner', 'flight-window-banner']);

export function makeCollapsible(container, title, icon) {
    if (!container) return null;

    const existingBody = container.querySelector('[data-body]');
    if (existingBody) {

        const titleEl = container.querySelector('.collapsible-title');
        if (titleEl) titleEl.textContent = title;
        const iconEl = container.querySelector('.collapsible-header-icon');
        if (iconEl) iconEl.setAttribute('data-lucide', icon);
        return existingBody;
    }

    const id = container.id;
    let open = true;
    if (!ALWAYS_OPEN.has(id)) {
        try {
            open = localStorage.getItem(STATE_KEY_PREFIX + id) !== '0';
        } catch {   }
    }

    if (open) container.classList.add('open');

    const existingContent = container.innerHTML;

    container.classList.add('collapsible-panel');
    container.innerHTML = `
        <div class="collapsible-header" data-toggle>
            <i data-lucide="${icon}" class="collapsible-header-icon" style="width:16px;height:16px;"></i>
            <span class="collapsible-title">${title}</span>
            <i data-lucide="chevron-down" class="collapsible-chevron"></i>
        </div>
        <div class="collapsible-body" data-body>${existingContent}</div>
    `;

    const header = container.querySelector('[data-toggle]');
    header.addEventListener('click', () => {
        const isOpen = container.classList.toggle('open');
        if (!ALWAYS_OPEN.has(id)) {
            try {
                localStorage.setItem(STATE_KEY_PREFIX + id, isOpen ? '1' : '0');
            } catch {   }
        }
    });

    if (window.lucide) window.lucide.createIcons({ root: container });

    return container.querySelector('[data-body]');
}

export function isCollapsible(container) {
    return !!container?.querySelector('[data-body]');
}
