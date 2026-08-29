/* Site navigation toggle. Pair with assets/css/nav.css.

   Deferred, so it runs after the nav exists without needing to sit at the foot
   of five documents. */
(() => {
    const nav = document.querySelector('.site-nav');
    if (!nav) return;

    const toggle = nav.querySelector('.nav-toggle');
    const menu = nav.querySelector('.nav-menu');
    if (!toggle || !menu) return;

    // One source of truth for the state: the attribute CSS animates off, with
    // aria kept in step so the button announces what it actually does, and
    // inert so a faded-out menu cannot be tabbed into. inert is set here rather
    // than in the markup because with scripting off nothing would ever come
    // along to remove it, and the menu would be dead rather than merely
    // un-toggleable.
    const setOpen = (open) => {
        nav.toggleAttribute('data-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        menu.toggleAttribute('inert', !open);
    };

    setOpen(false);

    toggle.addEventListener('click', () => {
        setOpen(!nav.hasAttribute('data-open'));
    });

    // Escape hands focus back to the button, because the element the user was
    // on is about to become unfocusable.
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !nav.hasAttribute('data-open')) return;
        setOpen(false);
        toggle.focus();
    });

    // Clicking away just closes. pointerdown rather than click so the menu is
    // gone before a drag on the 3D model behind it begins.
    document.addEventListener('pointerdown', (e) => {
        if (!nav.hasAttribute('data-open') || nav.contains(e.target)) return;
        setOpen(false);
    });
})();
