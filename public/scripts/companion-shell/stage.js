/** Keep the native Expressions extension in charge of every sprite update. */
export function initializeStage(getContext, caption, fitButton, savePreferences) {
    let lastAvatar = '';
    let observer;
    const fallback = document.getElementById('st-stage-fallback');
    const compact = document.getElementById('st-header-portrait');
    fallback.decoding = 'async';

    async function loadFallback(character, context) {
        fallback.hidden = true;
        if (!character) {
            fallback.removeAttribute('src');
            return;
        }
        const avatar = character.avatar;
        const originalAvatar = `/characters/${encodeURIComponent(avatar)}`;
        fallback.dataset.backupAvatar = originalAvatar;
        fallback.src = originalAvatar;
        // A neutral sprite keeps its original alpha and resolution. Avatar
        // thumbnails are deliberately avoided on this large portrait stage.
        const override = context.extensionSettings.expressionOverrides?.find(entry => entry.name === avatar.replace(/\.[^.]+$/, ''));
        const folder = override?.path || character.name;
        try {
            const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(folder)}`);
            if (!response.ok) return;
            const sprites = await response.json();
            if (lastAvatar !== avatar) return;
            const sprite = sprites.find(item => item.label === 'neutral') || sprites.find(item => item.label === 'joy') || sprites[0];
            if (sprite?.path) fallback.src = sprite.path;
        } catch (error) {
            console.warn('Companion portrait lookup failed', error);
        }
    }

    function refresh() {
        const context = getContext();
        const character = context.characters[context.characterId];
        const image = document.getElementById('expression-image');
        const hasExpression = !!(character && image?.getAttribute('src') && image.complete && image.naturalWidth
            && getComputedStyle(image).display !== 'none'
            && getComputedStyle(document.getElementById('expression-holder')).display !== 'none');
        document.body.classList.toggle('st-companion-no-expression', !hasExpression);
        document.body.classList.toggle('st-companion-has-character', !!character);
        document.body.classList.toggle('st-companion-group', !!context.groupId);
        caption.textContent = character?.name || 'Your companion';
        // Switch the fallback first so the compact portrait never shows the previous character.
        if (character?.avatar !== lastAvatar) {
            lastAvatar = character?.avatar || '';
            void loadFallback(character, context);
            fallback.alt = character ? character.name : '';
        }
        const portraitSource = character && (hasExpression ? image.getAttribute('src') : fallback.getAttribute('src'));
        compact.hidden = !portraitSource;
        if (portraitSource) {
            if (compact.getAttribute('src') !== portraitSource) compact.src = portraitSource;
        } else {
            compact.removeAttribute('src');
        }
        fitButton.textContent = document.body.dataset.companionFit === 'portrait' ? 'Full sprite' : 'Closer view';
        if (image && !observer) {
            observer = new MutationObserver(refresh);
            observer.observe(document.getElementById('expression-wrapper'), {
                subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'class'],
            });
            image.addEventListener('load', refresh);
            image.addEventListener('error', refresh);
        }
    }

    fitButton.addEventListener('click', () => {
        const preferences = getContext().extensionSettings.companion_shell;
        preferences.fit = preferences.fit === 'portrait' ? 'contain' : 'portrait';
        document.body.dataset.companionFit = preferences.fit;
        savePreferences();
        refresh();
    });
    fallback.addEventListener('load', () => { fallback.hidden = !lastAvatar; refresh(); });
    fallback.addEventListener('error', () => {
        if (lastAvatar && fallback.getAttribute('src') !== fallback.dataset.backupAvatar) fallback.src = fallback.dataset.backupAvatar;
        else fallback.hidden = true;
    });
    refresh();
    return refresh;
}
