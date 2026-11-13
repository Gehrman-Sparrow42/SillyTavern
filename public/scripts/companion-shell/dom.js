/** Small DOM helpers. User text is always assigned as text, never markup. */
export function element(tag, className = '', text = '') {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function button(label, handler, className = 'st-action') {
    const node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', async () => {
        node.disabled = true;
        try {
            await handler();
        } catch (error) {
            reportError(error);
        } finally {
            node.disabled = false;
        }
    });
    return node;
}

export function reportError(error) {
    console.error('Companion UI:', error);
    globalThis.toastr?.error(error.message || String(error), 'Companion');
}

export function nativeAction(selector) {
    const target = document.querySelector(selector);
    if (!target) throw new Error('This tool is still loading. Open Studio and try again.');
    globalThis.jQuery(target).trigger('click');
}

export function section(title, description = '') {
    const node = element('section', 'st-companion-section');
    node.append(element('h3', 'st-section-heading', title));
    if (description) node.append(element('p', 'st-muted', description));
    return node;
}
