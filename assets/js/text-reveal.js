/* ============================================================================
 * Text Reveal 02
 * ----------------------------------------------------------------------------
 * Splits opted-in text into lines / words / chars with GSAP SplitText and fades
 * each piece up from opacity 0.1. Opt in with `data-reveal-02` ON THE TEXT
 * ELEMENT ITSELF, never on a wrapper.
 *
 *   data-reveal-02="lines|words|chars"   what to split into
 *   data-scroll                          reveal when it enters the viewport
 *   data-scroll="scrub"                  reveal tied to scroll position
 *   data-duration / data-stagger
 *   data-delay / data-ease               per-element overrides
 *   data-once="false"                    replay on scroll back
 *   data-manual                          split only, no animation
 *
 * The site has no bundler, so GSAP arrives as UMD globals rather than ESM
 * imports; the helper body is otherwise the reference implementation.
 * ========================================================================== */
(function (global) {
    'use strict';

    var gsap = global.gsap;
    var SplitText = global.SplitText;
    var ScrollTrigger = global.ScrollTrigger;

    // The CDN can fail. Text that starts at `visibility: hidden` and never gets
    // revealed is worse than text that never animates, so bail loudly-but-safely.
    if (!gsap || !SplitText || !ScrollTrigger) {
        showEverything();
        console.warn('[text-reveal] GSAP, SplitText or ScrollTrigger did not load — text shown unanimated.');
        return;
    }

    gsap.registerPlugin(SplitText, ScrollTrigger);

    function showEverything(scope) {
        (scope || document).querySelectorAll('[data-reveal-02]').forEach(function (el) {
            el.style.visibility = 'visible';
        });
    }

    /* --- Tuning surface ------------------------------------------------------
     * The reference config uses 0.04/0.03 for all three types, which is
     * calibrated for chars: 13 characters run 0.40s and read fine, but a
     * three-line paragraph runs 0.04 + 2 x 0.03 = 0.10s, which is a flicker
     * rather than a reveal. Each type gets its own timing instead.
     * -------------------------------------------------------------------- */
    var CONFIG = {
        lines: { duration: 0.6, stagger: 0.12, ease: 'power1.out' },
        words: { duration: 0.5, stagger: 0.04, ease: 'power1.out' },
        chars: { duration: 0.4, stagger: 0.02, ease: 'power1.out' },
        scrollStart: 'top 85%',
        scrubStart: 'top 80%',
        scrubEnd: 'top 20%',
        once: true,
        markers: false,
    };

    function textReveal02(scope, delay, opts) {
        scope = scope || document;
        delay = delay || 0;
        var ignoreManual = !!(opts && opts.ignoreManual);

        // Every other animation on this site honours the setting; this one does
        // too. Show the text and skip the split entirely.
        if (global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            showEverything(scope);
            return;
        }

        var allSplitEls = scope.querySelectorAll('[data-reveal-02]');
        var autoEls = ignoreManual
            ? [].slice.call(allSplitEls)
            : [].slice.call(allSplitEls).filter(function (el) { return !el.hasAttribute('data-manual'); });

        gsap.set(autoEls, { visibility: 'visible' });

        allSplitEls.forEach(function (el) {
            var splitType = el.getAttribute('data-reveal-02');
            var c = CONFIG[splitType];
            if (!c) return;

            var type, linesClass, wordsClass, charsClass;
            switch (splitType) {
                case 'lines':
                    type = 'lines';
                    linesClass = 'line';
                    break;
                case 'words':
                    type = 'words, lines';
                    wordsClass = 'word';
                    linesClass = 'line';
                    break;
                case 'chars':
                    type = 'chars, words, lines';
                    charsClass = 'char';
                    wordsClass = 'word';
                    linesClass = 'line';
                    break;
                default:
                    return;
            }

            var splitVars = { type: type, autoSplit: true };
            if (linesClass) splitVars.linesClass = linesClass;
            if (wordsClass) splitVars.wordsClass = wordsClass;
            if (charsClass) splitVars.charsClass = charsClass;

            // Manual elements are split so a bespoke timeline can drive the
            // generated .line / .word / .char nodes, but nothing animates here.
            if (!ignoreManual && el.hasAttribute('data-manual')) {
                SplitText.create(el, splitVars);
                return;
            }

            var scrollMode = el.getAttribute('data-scroll');
            var useScroll = el.hasAttribute('data-scroll');
            var useScrub = scrollMode === 'scrub';

            splitVars.onSplit = function (instance) {
                var durationValue = parseFloat(el.dataset.duration);
                var staggerValue = parseFloat(el.dataset.stagger);
                var delayValue = parseFloat(el.dataset.delay);
                var duration = isNaN(durationValue) ? c.duration : durationValue;
                var stagger = isNaN(staggerValue) ? c.stagger : staggerValue;
                var elDelay = isNaN(delayValue) ? 0 : delayValue;
                var ease = el.dataset.ease || c.ease;

                var targets = instance[splitType];
                var once = el.hasAttribute('data-once')
                    ? el.getAttribute('data-once') !== 'false'
                    : CONFIG.once;

                var tween = {
                    opacity: 0.1,
                    duration: duration,
                    stagger: stagger,
                    // Scroll-driven elements ignore the helper-level delay and
                    // use only their own; load-time elements add the two.
                    delay: useScroll ? elDelay : elDelay + delay,
                    immediateRender: true,
                    ease: ease,
                };

                if (useScrub) {
                    tween.scrollTrigger = {
                        trigger: el,
                        start: CONFIG.scrubStart,
                        end: CONFIG.scrubEnd,
                        scrub: true,
                        markers: CONFIG.markers,
                    };
                    // Lock the finished state rather than letting it re-dim.
                    if (once) tween.scrollTrigger.onLeave = function (self) { self.kill(false); };
                } else if (useScroll) {
                    var start = scrollMode || CONFIG.scrollStart;
                    tween.scrollTrigger = {
                        trigger: el,
                        // clamp() stops an element already past the start point
                        // on load from being skipped or firing mid-air.
                        start: 'clamp(' + start + ')',
                        markers: CONFIG.markers,
                    };
                    if (once) tween.scrollTrigger.once = true;
                    else tween.scrollTrigger.toggleActions = 'play none none reverse';
                }

                return gsap.from(targets, tween);
            };

            SplitText.create(el, splitVars);
        });

        global.__textReveal02Ran = true;
    }

    global.textReveal02 = textReveal02;

    // IBM Plex is loaded with `display=swap`, so line breaks genuinely move when
    // the webfont lands. Splitting before that would measure the fallback font
    // and leave the lines wrong.
    document.addEventListener('DOMContentLoaded', function () {
        document.fonts.ready.then(function () { textReveal02(); });
    });

})(window);
